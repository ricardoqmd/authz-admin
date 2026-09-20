/*
 * Route tests for the BFF door.
 *
 * Three properties, each asserted on what reaches `pdpFetch` rather than on a
 * status code alone:
 *
 *   1. No verified caller, no upstream call. A 401 with the engine already
 *      contacted would still be a request the engine saw from nobody.
 *   2. The upstream call carries THE CALLER'S token — the exact string the
 *      caller presented — so the engine authorises the person.
 *   3. This console decides nothing: whatever the token's claims say, the
 *      request goes to the engine, and the engine's answer comes back unchanged.
 *
 * `pdpFetch` is mocked here so each call's arguments can be read directly. The
 * sibling route.upstream.test.ts runs the same route over the real `pdpFetch`
 * and asserts the Authorization header on the wire.
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
const { GET, POST, PUT, DELETE } = await import("./route");

const upstream = vi.mocked(pdpFetch);

const ISSUER = "https://idp.test/realms/pap-test";
const CLIENT_ID = "authz-admin";
const KID = "test-key-1";
const keys = await generateKeyPair("RS256");

/**
 * `path` may carry a query string. Next fills the catch-all `params` from the
 * PATHNAME only and leaves the query on the request, so the split here mirrors
 * that — a helper that fed the query into the segments would be testing a shape
 * the framework never produces.
 */
function get(path: string, token?: string) {
  const [pathname = ""] = path.split("?");
  return GET(
    new NextRequest(`http://pap.test/api/pdp/${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ path: pathname.split("/") }) },
  );
}

function post(path: string, token?: string, body = "{}") {
  return POST(
    new NextRequest(`http://pap.test/api/pdp/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

function put(path: string, token?: string, body = "{}") {
  return PUT(
    new NextRequest(`http://pap.test/api/pdp/${path}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

function del(path: string, token?: string) {
  return DELETE(
    new NextRequest(`http://pap.test/api/pdp/${path}`, {
      method: "DELETE",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

/** Every verb the door exposes, so a table can name one per row. */
const SEND = { get, post, put, delete: del } as const;

/**
 * The whole response, as it goes on the wire — status, every header, the body
 * byte for byte. Comparing against this is what makes a header or a rewritten
 * value fail, which a check on a few body keys cannot see.
 */
async function onTheWire(res: Response) {
  return {
    status: res.status,
    headers: [...res.headers],
    body: await res.text(),
  };
}

beforeEach(async () => {
  upstream.mockReset();
  // A fresh Response per call: a body can be read once.
  upstream.mockImplementation(
    async () =>
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

function mintToken({
  sub = "a-real-subject",
  apps = ["records"],
}: {
  sub?: string;
  apps?: string[];
} = {}) {
  return new SignJWT({ azp: CLIENT_ID, authz_apps: apps })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

/** The token each upstream call carried: argument 0 of `pdpFetch`. */
function tokensSentUpstream(): string[] {
  return upstream.mock.calls.map(([token]) => token);
}

/*
 * The engine's refusal, exactly as service-policy 0.6.1 writes it
 * (ControlPlaneGate.DENIED, ProblemException.toProblemDetail, served as
 * application/problem+json). One fixed body for every control-plane denial —
 * whether or not the application exists.
 */
const ENGINE_REFUSAL_BODY =
  '{"type":"https://github.com/ricardoqmd/service-policy/blob/main/docs/ERRORS.md#forbidden",' +
  '"code":"FORBIDDEN","title":"Forbidden","status":403,' +
  '"detail":"not authorized for this control-plane operation."}';

function engineRefusal() {
  return new Response(ENGINE_REFUSAL_BODY, {
    status: 403,
    headers: { "content-type": "application/problem+json" },
  });
}

/** A read of every shape the allowlist admits. */
const READ_SHAPES = [
  "policies",
  "apps/records/policies",
  "apps/records/policies/p-1",
  "apps/records/policies/p-1/versions",
  "apps/records/policies/p-1/versions/2",
  "apps/records/action-catalogue",
  "apps/records/action-catalogue/document",
  "apps/records/configuration",
] as const;

/** Every write surface, plus the tester's two POSTs. */
const WRITE_SURFACES = [
  { verb: "post", path: "apps/records/policies", what: "create a policy" },
  { verb: "post", path: "apps/records/policies/p-1/activate", what: "activate a policy" },
  {
    verb: "post",
    path: "apps/records/policies/p-1/deactivate",
    what: "deactivate a policy",
  },
  { verb: "post", path: "apps/records/policies:simulate", what: "simulate a policy" },
  { verb: "post", path: "apps/records/evaluate", what: "evaluate a request" },
  {
    verb: "post",
    path: "apps/records/action-catalogue",
    what: "create a catalogue entry",
  },
  { verb: "post", path: "apps/records/configuration", what: "create the configuration" },
  { verb: "put", path: "apps/records/policies/p-1", what: "append a version" },
  {
    verb: "put",
    path: "apps/records/action-catalogue/doc-1",
    what: "replace a catalogue entry",
  },
  { verb: "put", path: "apps/records/configuration", what: "replace the configuration" },
  {
    verb: "delete",
    path: "apps/records/action-catalogue/doc-1",
    what: "delete a catalogue entry",
  },
  {
    verb: "delete",
    path: "apps/records/configuration",
    what: "delete the configuration",
  },
] as const;

describe("BFF route — no verified caller, no upstream call", () => {
  it("refuses a GET with no token and never contacts the PDP", async () => {
    const res = await get("policies");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(WRITE_SURFACES)("$what — refused with no token, PDP never contacted", async ({
    verb,
    path,
  }) => {
    const res = await SEND[verb](path);

    expect(res.status).toBe(401);
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

describe("BFF route — the caller's token is what goes upstream", () => {
  it.each(READ_SHAPES)("GET %s carries the caller's own token", async (path) => {
    const token = await mintToken();

    const res = await get(path, token);

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledWith(token, `/v1/${path}`);
  });

  it.each(WRITE_SURFACES)("$what carries the caller's own token", async ({
    verb,
    path,
  }) => {
    const token = await mintToken();

    const res = await SEND[verb](path, token);

    expect(res.status).toBe(200);
    expect(tokensSentUpstream()).toEqual([token]);
    expect(upstream.mock.calls[0]?.[1]).toBe(`/v1/${path}`);
  });

  it("forwards each caller's token, never one caller's for another", async () => {
    // Two callers in a row: a cached or shared credential would show up here as
    // the first token reaching the engine on the second request.
    const alice = await mintToken({ sub: "alice" });
    const bob = await mintToken({ sub: "bob" });

    await get("apps/records/policies", alice);
    await get("apps/records/policies", bob);

    expect(tokensSentUpstream()).toEqual([alice, bob]);
  });

  it("still applies the path allowlist to a verified caller", async () => {
    const res = await get("not-a-real-surface", await mintToken());

    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

/*
 * This console decides nothing. Before pap-003 a caller whose token did not carry
 * the application was refused HERE, and the engine never saw the request. Now the
 * engine is the only gate: the claims in the token change nothing about whether
 * the request is forwarded.
 */
describe("BFF route — no console-side authorization", () => {
  it.each(
    READ_SHAPES,
  )("GET %s is forwarded for a token carrying no apps", async (path) => {
    const token = await mintToken({ apps: [] });

    await get(path, token);

    expect(upstream).toHaveBeenCalledWith(token, `/v1/${path}`);
  });

  it.each(WRITE_SURFACES)("$what is forwarded for a token carrying other apps", async ({
    verb,
    path,
  }) => {
    const token = await mintToken({ apps: ["billing"] });

    await SEND[verb](path, token);

    expect(tokensSentUpstream()).toEqual([token]);
  });
});

/*
 * TODAY'S behaviour, pinned so that its change is visible — not endorsed.
 *
 * Before pap-003 this console refused an evaluate under an application the
 * caller did not hold, and answered the same bytes for one that did not exist.
 * That property did not move to the engine: it stopped holding. At
 * service-policy 0.6.1 `/evaluate` is `@Authenticated` only
 * (EvaluateResource.java:44) and is not among the control-plane operations the
 * engine gates, so an evaluate from a token carrying no application at all is
 * answered with a decision. Routed to the architect (pap-003 report, Routed 1).
 * The day the engine gates it, the engine's answer here becomes its refusal and
 * this test is what shows it.
 */
describe("BFF route — evaluate is forwarded ungated, and answered by the engine", () => {
  it("forwards an evaluate from a token carrying no application, and returns the engine's answer", async () => {
    const decision =
      '{"allowed":false,"reason":"no applicable policy","decisionId":"d-1",' +
      '"policyVersion":"0","obligations":[]}';
    upstream.mockResolvedValue(
      new Response(decision, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const token = await mintToken({ apps: [] });

    const res = await post("apps/zz-nonce-7f3a/evaluate", token);

    expect(tokensSentUpstream()).toEqual([token]);
    expect(upstream.mock.calls[0]?.[1]).toBe("/v1/apps/zz-nonce-7f3a/evaluate");
    expect(await onTheWire(res)).toEqual({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: decision,
    });
  });
});

describe("BFF route — the engine's answer passes through unchanged", () => {
  it.each(READ_SHAPES)("GET %s returns the engine's 403 byte for byte", async (path) => {
    upstream.mockResolvedValue(engineRefusal());

    const res = await get(path, await mintToken());

    expect(await onTheWire(res)).toEqual({
      status: 403,
      headers: [["content-type", "application/problem+json"]],
      body: ENGINE_REFUSAL_BODY,
    });
  });

  it.each(WRITE_SURFACES)("$what returns the engine's 403 byte for byte", async ({
    verb,
    path,
  }) => {
    upstream.mockResolvedValue(engineRefusal());

    const res = await SEND[verb](path, await mintToken());

    expect(await onTheWire(res)).toEqual({
      status: 403,
      headers: [["content-type", "application/problem+json"]],
      body: ENGINE_REFUSAL_BODY,
    });
  });

  it("returns the same bytes for an application held and one that does not exist", async () => {
    // The engine answers both with one body. What this asserts is that the BFF
    // does not reintroduce the difference: nothing it adds depends on the app.
    upstream.mockImplementation(async () => engineRefusal());
    const token = await mintToken({ apps: ["records"] });

    const held = await get("apps/records/policies", token);
    const invented = await get("apps/zz-nonce-7f3a/policies", token);

    expect(await onTheWire(held)).toEqual(await onTheWire(invented));
  });

  it("passes a validation failure through with its code and its fields", async () => {
    const problem = JSON.stringify({
      type: "about:blank",
      code: "INVALID_POLICY",
      title: "Invalid policy",
      status: 400,
      detail: "The policy document was rejected.",
      invalidParams: [{ field: "rules[0].effect", reason: "must be PERMIT or DENY" }],
    });
    upstream.mockResolvedValue(
      new Response(problem, {
        status: 400,
        headers: { "content-type": "application/problem+json" },
      }),
    );

    const res = await post("apps/records/policies", await mintToken());

    expect(await onTheWire(res)).toEqual({
      status: 400,
      headers: [["content-type", "application/problem+json"]],
      body: problem,
    });
  });

  it("passes the engine's 401 through as the engine's — never as the BFF's UNAUTHENTICATED", async () => {
    // The browser tells the two apart by the code: only the BFF's own 401 ends
    // the session (modules/access/errors.ts). An engine 401 is a deployment
    // fault, so it must reach the browser as the engine sent it.
    upstream.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await get("apps/records/policies", await mintToken());

    expect(await onTheWire(res)).toEqual({
      status: 401,
      headers: [["content-type", "application/json"]],
      body: "",
    });
  });

  it("keeps the ETag the conditional writes need", async () => {
    upstream.mockResolvedValue(
      new Response('{"revision":4}', {
        status: 200,
        headers: { "content-type": "application/json", etag: '"4"' },
      }),
    );

    const res = await get("apps/records/configuration", await mintToken());

    expect(res.headers.get("etag")).toBe('"4"');
  });
});

describe("BFF route — request bodies", () => {
  it("rejects a write whose body is not JSON, without contacting the PDP", async () => {
    const res = await post("apps/records/policies", await mintToken(), "not json");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "BFF_INVALID_JSON" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards the tester's body as parsed, leaving its validation to the engine", async () => {
    const token = await mintToken();

    await post("apps/records/evaluate", token, "not json");

    expect(upstream).toHaveBeenCalledWith(token, "/v1/apps/records/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
  });

  it("forwards If-Match untouched on a conditional write", async () => {
    await PUT(
      new NextRequest("http://pap.test/api/pdp/apps/records/configuration", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await mintToken()}`,
          "if-match": '"7"',
        },
        body: "{}",
      }),
      { params: Promise.resolve({ path: ["apps", "records", "configuration"] }) },
    );

    expect(upstream.mock.calls[0]?.[2]?.headers).toMatchObject({ "If-Match": '"7"' });
  });
});

/*
 * The query string is read, vetted and rebuilt — never forwarded.
 */
describe("BFF route — the upstream query is built, not forwarded", () => {
  it("keeps page and size on the cross-app listing", async () => {
    const token = await mintToken();
    // The browser sends both on every listing (policy.queries.ts): an allowlist
    // that dropped them would silently pin every list to the upstream default.
    await get("policies?page=2&size=50", token);

    expect(upstream).toHaveBeenCalledWith(token, "/v1/policies?page=2&size=50");
  });

  it("keeps page and size on a versions listing", async () => {
    const token = await mintToken();
    await get("apps/records/policies/p-1/versions?page=3&size=10", token);

    expect(upstream).toHaveBeenCalledWith(
      token,
      "/v1/apps/records/policies/p-1/versions?page=3&size=10",
    );
  });

  it("keeps page, size and status on the per-app listing", async () => {
    const token = await mintToken();
    await get("apps/records/policies?page=1&size=50&status=active", token);

    expect(upstream).toHaveBeenCalledWith(
      token,
      "/v1/apps/records/policies?page=1&size=50&status=active",
    );
  });

  it("keeps ?app= on the cross-app listing, which the engine has already scoped", async () => {
    const token = await mintToken();
    await get("policies?app=records", token);

    expect(upstream).toHaveBeenCalledWith(token, "/v1/policies?app=records");
  });

  it("emits the allowlist's order, not the caller's", async () => {
    const token = await mintToken();
    await get("policies?size=5&status=active&page=2", token);

    // Deterministic upstream URL whatever order they arrived in.
    expect(upstream).toHaveBeenCalledWith(
      token,
      "/v1/policies?page=2&size=5&status=active",
    );
  });

  it("rejects an unrecognised parameter with 400 and never contacts the PDP", async () => {
    const res = await get("policies?sort=name", await mintToken());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "BFF_UNKNOWN_PARAMETER" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects ?app= on a per-app route — the app is already in the path", async () => {
    // A second, disagreeing coordinate must never be silently ignored.
    const res = await get("apps/records/policies?app=billing", await mintToken());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "BFF_UNKNOWN_PARAMETER" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects ?status= on a versions listing, which upstream does not take", async () => {
    // Measured from PolicyResource.listVersions: page, size, view — no status.
    const res = await get(
      "apps/records/policies/p-1/versions?status=active",
      await mintToken(),
    );

    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects any parameter on a read shape that takes none", async () => {
    const res = await get("apps/records/configuration?page=1", await mintToken());

    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a repeated parameter rather than picking one of the two", async () => {
    const res = await get("policies?page=1&page=99", await mintToken());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "BFF_REPEATED_PARAMETER" });
    expect(upstream).not.toHaveBeenCalled();
  });
});
