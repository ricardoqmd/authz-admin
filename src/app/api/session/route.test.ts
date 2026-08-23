/*
 * Tests for the session endpoint.
 *
 * The assertion that matters is not that it returns a user — it is that it returns
 * the user the TOKEN names, and never anything the request carries. A session
 * endpoint that could be steered by a query parameter or a header would be a way to
 * tell the browser it administers projects it does not, and pap-003 is going to
 * render exactly this payload.
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HttpResponse, http } from "msw";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSigningKeyCache } from "@/lib/auth/server";
import { projectAccess } from "@/lib/authz/project-access";
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
  roles = ["pap-author"],
  apps = ["records"],
}: {
  sub?: string;
  roles?: string[];
  apps?: string[];
} = {}) {
  return new SignJWT({
    azp: CLIENT_ID,
    realm_access: { roles },
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

  it("returns the verified claims and the capability, and NOT roles", async () => {
    const res = await session({
      token: await mintToken({ roles: ["pap-author"], apps: ["records", "billing"] }),
    });

    expect(res.status).toBe(200);
    // `toEqual`, not `toMatchObject`: the absence of `roles` is the assertion.
    // pap-002b removed it — the browser must not be handed the ingredients of a
    // decision the server already made for it.
    await expect(res.json()).resolves.toEqual({
      sub: "a-real-subject",
      apps: ["records", "billing"],
      canReadAcrossApps: false,
    });
  });

  /*
   * THE LOAD-BEARING ONE. Everything the request can carry claims a different,
   * larger identity than the token does; the answer must come from the signature
   * and nothing else.
   */
  it("ignores identity and capability planted in the query string and in headers", async () => {
    const res = await session({
      token: await mintToken({ roles: ["pap-author"], apps: ["records"] }),
      query: "?sub=impostor&roles=pap-admin&apps=billing&canReadAcrossApps=true",
      headers: {
        "x-user-sub": "impostor",
        "x-forwarded-user": "impostor",
        "x-authz-apps": "billing,payroll",
        "x-can-read-across-apps": "true",
      },
    });

    // The capability is asserted here too (pap-002b): the request asks for `true`
    // in two different ways and the policy's `false` is what comes back.
    await expect(res.json()).resolves.toEqual({
      sub: "a-real-subject",
      apps: ["records"],
      canReadAcrossApps: false,
    });
  });

  it("gives a caller with no apps claim an empty list, never 'all'", async () => {
    const res = await session({ token: await mintToken({ roles: [], apps: [] }) });

    await expect(res.json()).resolves.toEqual({
      sub: "a-real-subject",
      apps: [],
      canReadAcrossApps: false,
    });
  });

  /*
   * The capability (pap-002b). Asserted through the ROUTE, never by calling the
   * policy directly: what is being tested is that the handler asks, not that the
   * policy answers — the policy's own answers are covered in server.test.ts.
   */
  describe("canReadAcrossApps", () => {
    it("is true for a caller the policy admits", async () => {
      const res = await session({ token: await mintToken({ roles: ["pap-admin"] }) });

      await expect(res.json()).resolves.toMatchObject({ canReadAcrossApps: true });
    });

    it("is false for a caller it does not", async () => {
      const res = await session({ token: await mintToken({ roles: ["pap-author"] }) });

      await expect(res.json()).resolves.toMatchObject({ canReadAcrossApps: false });
    });

    /*
     * THE CASE THAT MOTIVATED THIS PROMPT. An administrator holding NO apps still
     * reads across every application. Any implementation that derived the field
     * from the `apps` claim — `apps.length > 0`, or a list of apps to check —
     * answers `false` here and hides the whole catalogue from the one caller
     * entitled to it.
     */
    it("is true for an administrator with an empty apps claim", async () => {
      const res = await session({
        token: await mintToken({ roles: ["pap-admin"], apps: [] }),
      });

      await expect(res.json()).resolves.toEqual({
        sub: "a-real-subject",
        apps: [],
        canReadAcrossApps: true,
      });
    });

    /*
     * The one property the behavioural tests above CANNOT see. While
     * HardcodedProjectAccessPolicy answers with `roles.includes("pap-admin")`, an
     * inlined copy of that same expression in this handler passes every assertion in
     * this file — and then stops being true the day the PDP-backed implementation
     * lands, silently, with the UI showing the old answer. So the call itself is
     * asserted: the handler must ASK, not agree by coincidence.
     */
    it("resolves the field by calling the policy, with the verified caller", async () => {
      const faculty = vi.spyOn(projectAccess, "canReadAcrossApps");

      await session({ token: await mintToken({ roles: ["pap-admin"], apps: [] }) });

      expect(faculty).toHaveBeenCalledTimes(1);
      expect(faculty).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "a-real-subject", apps: [] }),
      );
      faculty.mockRestore();
    });

    /* The mirror: holding apps is not the same statement as reading across them. */
    it("is false for a scoped caller holding two apps, which it still reports", async () => {
      const res = await session({
        token: await mintToken({ roles: ["pap-author"], apps: ["records", "billing"] }),
      });

      await expect(res.json()).resolves.toEqual({
        sub: "a-real-subject",
        apps: ["records", "billing"],
        canReadAcrossApps: false,
      });
    });
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
