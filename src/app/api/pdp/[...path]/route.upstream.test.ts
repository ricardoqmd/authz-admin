/*
 * The BFF over the REAL `pdpFetch`, with the engine played by MSW.
 *
 * route.test.ts reads the arguments handed to a mocked `pdpFetch`; this file
 * reads what actually leaves the process. The two properties:
 *
 *   - the Authorization header the engine receives is `Bearer <the caller's
 *     token>`, byte for byte, on every verb;
 *   - the BFF makes NO other outbound request: no token endpoint, no second
 *     credential. Every request that starts is recorded and compared with the
 *     list expected, and MSW's `onUnhandledRequest: "error"` (vitest.setup.ts)
 *     fails any request nobody declared.
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HttpResponse, http } from "msw";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSigningKeyCache } from "@/lib/auth/server";
import { server } from "@/test/msw/server";
import { DELETE, GET, POST, PUT } from "./route";

const ISSUER = "https://idp.test/realms/pap-test";
const CLIENT_ID = "authz-admin";
const KID = "test-key-1";
/** PDP_BASE_URL is unset in the test run, so lib/pdp/server.ts uses its default. */
const PDP = "http://localhost:8080";
const keys = await generateKeyPair("RS256");

/** Every request that left the process, as `METHOD url`. */
let outbound: string[] = [];
/** The Authorization header of every request the engine received. */
let seenByEngine: (string | null)[] = [];

function recordOutbound({ request }: { request: Request }) {
  outbound.push(`${request.method} ${request.url}`);
}

beforeEach(async () => {
  outbound = [];
  seenByEngine = [];
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
    http.all(`${PDP}/v1/*`, ({ request }) => {
      seenByEngine.push(request.headers.get("authorization"));
      return HttpResponse.json({ ok: true });
    }),
  );
  server.events.on("request:start", recordOutbound);
});

afterEach(() => {
  server.events.removeListener("request:start", recordOutbound);
});

function mintToken(sub = "a-real-subject") {
  return new SignJWT({ azp: CLIENT_ID, authz_apps: ["records"] })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

function request(method: string, path: string, token?: string) {
  return new NextRequest(`http://pap.test/api/pdp/${path}`, {
    method,
    headers: {
      ...(method === "GET" || method === "DELETE"
        ? {}
        : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
  });
}

const HANDLERS = { GET, POST, PUT, DELETE } as const;

const CALLS = [
  { method: "GET", path: "apps/records/policies" },
  { method: "GET", path: "policies" },
  { method: "POST", path: "apps/records/policies" },
  { method: "POST", path: "apps/records/evaluate" },
  { method: "PUT", path: "apps/records/configuration" },
  { method: "DELETE", path: "apps/records/action-catalogue/document" },
] as const;

function send(method: keyof typeof HANDLERS, path: string, token?: string) {
  return HANDLERS[method](request(method, path, token), {
    params: Promise.resolve({ path: path.split("/") }),
  });
}

describe("BFF upstream — on the wire", () => {
  it.each(CALLS)("$method $path reaches the engine as `Bearer <caller token>`", async ({
    method,
    path,
  }) => {
    const token = await mintToken();

    const res = await send(method, path, token);

    expect(res.status).toBe(200);
    expect(seenByEngine).toEqual([`Bearer ${token}`]);
  });

  it("makes no outbound request except discovery, keys and the engine call", async () => {
    const token = await mintToken();

    await send("POST", "apps/records/policies", token);

    // Discovery and the JWKS verify the caller; the third request is the one
    // the engine receives. A token endpoint — the removed client_credentials
    // grant — would appear here as a fourth.
    expect(outbound).toEqual([
      `GET ${ISSUER}/.well-known/openid-configuration`,
      `GET ${ISSUER}/keys`,
      `POST ${PDP}/v1/apps/records/policies`,
    ]);
  });

  it.each(CALLS)("$method $path with no token never reaches the engine", async ({
    method,
    path,
  }) => {
    const res = await send(method, path);

    expect(res.status).toBe(401);
    expect(seenByEngine).toEqual([]);
    expect(outbound.filter((line) => line.includes(PDP))).toEqual([]);
  });

  it("with a token the issuer did not sign, never reaches the engine", async () => {
    const forged = await new SignJWT({ azp: CLIENT_ID })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(ISSUER)
      .setSubject("someone")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign((await generateKeyPair("RS256")).privateKey);

    const res = await send("GET", "apps/records/policies", forged);

    expect(res.status).toBe(401);
    expect(seenByEngine).toEqual([]);
  });
});
