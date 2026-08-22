/*
 * Route tests for the BFF door.
 *
 * The assertion that matters is not the status code — it is that `pdpFetch`
 * was never called. A 401 with the upstream already contacted would still mean
 * the BFF spent its service credential (the one carrying the PDP's admin
 * marker) on an anonymous caller, which is the whole defect pap-001 fixes.
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HttpResponse, http } from "msw";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSigningKeyCache } from "@/lib/auth/server";
import { server } from "@/test/msw/server";

vi.mock("@/lib/pdp/server", () => ({
  pdpFetch: vi.fn(),
  UpstreamError: class UpstreamError extends Error {},
}));

const { pdpFetch } = await import("@/lib/pdp/server");
const { GET, POST } = await import("./route");

const upstream = vi.mocked(pdpFetch);

const ISSUER = "https://idp.test/realms/pap-test";
const CLIENT_ID = "authz-admin";
const KID = "test-key-1";
const keys = await generateKeyPair("RS256");

function get(path: string, token?: string) {
  return GET(
    new NextRequest(`http://pap.test/api/pdp/${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

function post(path: string, token?: string) {
  return POST(
    new NextRequest(`http://pap.test/api/pdp/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: "{}",
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

beforeEach(async () => {
  upstream.mockReset();
  upstream.mockResolvedValue(
    new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
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

function mintToken() {
  return new SignJWT({
    azp: CLIENT_ID,
    realm_access: { roles: ["pap-admin"] },
    authz_apps: ["records"],
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setSubject("a-real-subject")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

describe("BFF route — unauthenticated callers", () => {
  it("refuses a GET with no token and never contacts the PDP", async () => {
    const res = await get("policies");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a POST with no token and never contacts the PDP", async () => {
    const res = await post("apps/records/policies");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a garbage Bearer token without contacting the PDP", async () => {
    const res = await get("policies", "not-a-jwt");

    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("says nothing about which check failed", async () => {
    const body = await (await get("policies", "not-a-jwt")).json();

    // Same body as the no-token case: an anonymous prober learns nothing.
    expect(body).toEqual({
      title: "Unauthorized",
      status: 401,
      code: "UNAUTHENTICATED",
      detail: "A valid Bearer token is required.",
    });
  });

  it("announces the Bearer scheme on the 401 (RFC 6750)", async () => {
    const res = await get("policies");

    // Bare `Bearer`: no realm, no error code. A parameterised challenge would
    // reintroduce through the header exactly what the body refuses to say.
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("returns the identical body and header for every rejection reason", async () => {
    const expired = await new SignJWT({ azp: CLIENT_ID })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(ISSUER)
      .setSubject("a-real-subject")
      .setIssuedAt()
      .setExpirationTime("-1m")
      .sign(keys.privateKey);
    const wrongClient = await new SignJWT({ azp: "some-other-app" })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(ISSUER)
      .setSubject("a-real-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);

    // missing_token, invalid_token (malformed), invalid_token (expired),
    // wrong_client — four distinct server-side reasons, one public answer.
    const responses = await Promise.all([
      get("policies"),
      get("policies", "not-a-jwt"),
      get("policies", expired),
      get("policies", wrongClient),
    ]);
    const seen = await Promise.all(
      responses.map(async (res) => ({
        status: res.status,
        challenge: res.headers.get("www-authenticate"),
        body: await res.json(),
      })),
    );

    for (const answer of seen) {
      expect(answer).toEqual(seen[0]);
    }
    expect(seen[0].status).toBe(401);
    expect(seen[0].challenge).toBe("Bearer");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 500, not 401, when the deployment forgot to configure the issuer", async () => {
    process.env.PAP_OIDC_ISSUER = "";

    const res = await get("policies", await mintToken());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: "BFF_MISCONFIGURED" });
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("BFF route — verified callers", () => {
  it("lets a verified caller through to the PDP", async () => {
    const res = await get("policies", await mintToken());

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith("/v1/policies");
  });

  it("still applies the path allowlist to a verified caller", async () => {
    const res = await get("not-a-real-surface", await mintToken());

    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
