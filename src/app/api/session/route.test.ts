/*
 * Tests for the session endpoint.
 *
 * The assertion that matters is not that it returns a user — it is that it returns
 * the user the TOKEN names, and never anything the request carries, and that it
 * returns nothing more than the selector needs: no roles, no capability flag, and
 * never the raw token the verifier now keeps for the upstream call.
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HttpResponse, http } from "msw";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSigningKeyCache } from "@/lib/auth/server";
import { server } from "@/test/msw/server";
import { GET } from "./route";

const ISSUER = "https://idp.test/realms/pap-test";
const CLIENT_ID = "authz-admin";
const KID = "test-key-1";
const keys = await generateKeyPair("RS256");

function session({
  token,
  query,
  headers,
}: {
  token?: string;
  query?: string;
  headers?: HeadersInit;
} = {}) {
  return GET(
    new NextRequest(`http://pap.test/api/session${query ?? ""}`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }),
  );
}

beforeEach(async () => {
  resetSigningKeyCache();
  process.env.PAP_OIDC_ISSUER = ISSUER;
  process.env.PAP_OIDC_CLIENT_ID = CLIENT_ID;
  const jwk = await exportJWK(keys.publicKey);
  server.use(
    http.get(`${ISSUER}/.well-known/openid-configuration`, () =>
      HttpResponse.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/keys` }),
    ),
    http.get(`${ISSUER}/keys`, () =>
      HttpResponse.json({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] }),
    ),
  );
});

function mintToken({
  sub = "a-real-subject",
  apps = ["records"],
}: {
  sub?: string;
  apps?: string[];
} = {}) {
  return new SignJWT({
    azp: CLIENT_ID,
    // Present so the tests below can show it does NOT come back.
    realm_access: { roles: ["platform-operator"] },
    authz_apps: apps,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

describe("session route", () => {
  it("refuses an unauthenticated caller with the same 401 as the proxy", async () => {
    const res = await session();

    expect(res.status).toBe(401);
    // Byte-identical to the PDP proxy's 401: one guard, one body, so the two
    // routes cannot be told apart by an anonymous prober.
    await expect(res.json()).resolves.toEqual({
      title: "Unauthorized",
      status: 401,
      code: "UNAUTHENTICATED",
      detail: "A valid Bearer token is required.",
    });
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("refuses a garbage token", async () => {
    const res = await session({ token: "not-a-jwt" });

    expect(res.status).toBe(401);
  });

  it("returns sub and apps — and nothing else", async () => {
    const token = await mintToken({ apps: ["records", "billing"] });

    const res = await session({ token });

    expect(res.status).toBe(200);
    // `toEqual`, not `toMatchObject`: the absence of every other key is the
    // assertion — no `roles`, no `canReadAcrossApps`, no `token`.
    await expect(res.json()).resolves.toEqual({
      sub: "a-real-subject",
      apps: ["records", "billing"],
    });
  });

  it("never serialises the raw token it verified", async () => {
    const token = await mintToken();

    const text = await (await session({ token })).text();

    // The verifier now hands the raw token to the handler (for the upstream
    // call). The session payload is built field by field so it cannot leak.
    expect(text).not.toContain(token);
    expect(text).not.toContain(token.split(".")[1]);
  });

  /*
   * THE LOAD-BEARING ONE. Everything the request can carry claims a different,
   * larger identity than the token does; the answer must come from the signature
   * and nothing else.
   */
  it("ignores identity planted in the query string and in headers", async () => {
    const res = await session({
      token: await mintToken({ apps: ["records"] }),
      query: "?sub=impostor&apps=billing",
      headers: {
        "x-user-sub": "impostor",
        "x-forwarded-user": "impostor",
        "x-authz-apps": "billing,payroll",
      },
    });

    await expect(res.json()).resolves.toEqual({
      sub: "a-real-subject",
      apps: ["records"],
    });
  });

  it("gives a caller with no apps claim an empty list, never 'all'", async () => {
    const res = await session({ token: await mintToken({ apps: [] }) });

    await expect(res.json()).resolves.toEqual({ sub: "a-real-subject", apps: [] });
  });

  it("is never cached — it is per-caller and the token expires", async () => {
    const res = await session({ token: await mintToken() });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 500, not 401, when the deployment forgot to configure the issuer", async () => {
    const token = await mintToken();
    process.env.PAP_OIDC_ISSUER = "";

    const res = await session({ token });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: "BFF_MISCONFIGURED" });
  });
});
