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
import { projectAccess } from "@/lib/authz/project-access";
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

function mintToken({ roles, apps }: { roles?: string[]; apps?: string[] } = {}) {
  return new SignJWT({
    azp: CLIENT_ID,
    realm_access: { roles: roles ?? ["pap-admin"] },
    authz_apps: apps ?? ["records"],
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setSubject("a-real-subject")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

/** A caller who administers `records` and nothing else — no admin shortcut. */
function scopedToken(apps = ["records"]) {
  return mintToken({ roles: [], apps });
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

/*
 * The read gate (pap-002).
 *
 * Every read that names an application is authorised against THAT application,
 * taken from the route. Before this, all eight shapes asked `can(caller, "read",
 * "*")` — a literal compared with `includes` against a list of real app names, so
 * every non-admin was denied every read while still being allowed to write.
 */
const APP_READ_SHAPES = [
  { path: "apps/records/policies", other: "apps/billing/policies" },
  { path: "apps/records/policies/p-1", other: "apps/billing/policies/p-1" },
  {
    path: "apps/records/policies/p-1/versions",
    other: "apps/billing/policies/p-1/versions",
  },
  {
    path: "apps/records/policies/p-1/versions/2",
    other: "apps/billing/policies/p-1/versions/2",
  },
  { path: "apps/records/action-catalogue", other: "apps/billing/action-catalogue" },
  {
    path: "apps/records/action-catalogue/document",
    other: "apps/billing/action-catalogue/document",
  },
  { path: "apps/records/configuration", other: "apps/billing/configuration" },
] as const;

describe("BFF read gate — a read that names an app is gated on that app", () => {
  it.each(APP_READ_SHAPES)("$path — a caller holding the app reads it", async ({
    path,
  }) => {
    const res = await get(path, await scopedToken(["records"]));

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(`/v1/${path}`);
  });

  it.each(
    APP_READ_SHAPES,
  )("$path — a caller without the app gets 403 and the PDP is never contacted", async ({
    path,
  }) => {
    const res = await get(path, await scopedToken(["billing"]));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      status: 403,
      code: "PROJECT_ACCESS_DENIED",
    });
    // The point of the whole gate: the BFF never spends its admin-marked
    // service credential on a request it was going to refuse.
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(APP_READ_SHAPES)("$path — pap-admin reads it", async ({ path }) => {
    const res = await get(path, await mintToken());

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(`/v1/${path}`);
  });

  /*
   * THE TEST THAT PROVES THE COORDINATE IS REAL. One caller, two paths that differ
   * only in the app segment: allowed on their own, refused on the other. A gate
   * that merely checked "is this caller scoped to something" would pass the first
   * half and fail the second.
   */
  it.each(
    APP_READ_SHAPES,
  )("$path — the same caller is refused the identical read under another app", async ({
    path,
    other,
  }) => {
    const token = await scopedToken(["records"]);

    const mine = await get(path, token);
    expect(mine.status).toBe(200);

    upstream.mockClear();
    const theirs = await get(other, token);
    expect(theirs.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("BFF read gate — the cross-app catalogue is its own faculty", () => {
  it("refuses a caller without it, however many apps they hold", async () => {
    const res = await get("policies", await scopedToken(["records", "billing"]));

    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("allows a caller who holds it", async () => {
    const res = await get("policies", await mintToken());

    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith("/v1/policies");
  });

  it("refuses it in a body byte-identical to a per-app refusal", async () => {
    // Distinguishable bodies would let a prober map which applications exist,
    // one request at a time.
    const crossApp = await get("policies", await scopedToken(["records"]));
    const perApp = await get("apps/billing/policies", await scopedToken(["records"]));

    expect(crossApp.status).toBe(perApp.status);
    await expect(crossApp.json()).resolves.toEqual(await perApp.json());
  });

  it("asks the faculty question, not `can` with a placeholder app", async () => {
    const can = vi.spyOn(projectAccess, "can");
    const faculty = vi.spyOn(projectAccess, "canReadAcrossApps");

    await get("policies", await mintToken());

    expect(faculty).toHaveBeenCalledTimes(1);
    expect(can).not.toHaveBeenCalled();

    can.mockRestore();
    faculty.mockRestore();
  });

  it("hands `can` the app from the route on a per-app read", async () => {
    const can = vi.spyOn(projectAccess, "can");

    await get("apps/records/policies/p-1", await mintToken());

    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "a-real-subject" }),
      "read",
      "records",
    );
    can.mockRestore();
  });
});

/*
 * The query string is read, vetted and rebuilt — never forwarded. Before this it
 * was concatenated onto the upstream URL verbatim.
 */
describe("BFF read gate — the upstream query is built, not forwarded", () => {
  it("keeps page and size on the cross-app listing", async () => {
    // The browser sends both on every listing (policy.queries.ts): an allowlist
    // that dropped them would silently pin every list to the upstream default.
    await get("policies?page=2&size=50", await mintToken());

    expect(upstream).toHaveBeenCalledWith("/v1/policies?page=2&size=50");
  });

  it("keeps page and size on a versions listing", async () => {
    await get("apps/records/policies/p-1/versions?page=3&size=10", await mintToken());

    expect(upstream).toHaveBeenCalledWith(
      "/v1/apps/records/policies/p-1/versions?page=3&size=10",
    );
  });

  it("keeps status on the per-app listing", async () => {
    await get("apps/records/policies?status=active", await mintToken());

    expect(upstream).toHaveBeenCalledWith("/v1/apps/records/policies?status=active");
  });

  it("keeps ?app= on the cross-app listing, where it narrows an admin's view", async () => {
    await get("policies?app=records", await mintToken());

    expect(upstream).toHaveBeenCalledWith("/v1/policies?app=records");
  });

  it("emits the allowlist's order, not the caller's", async () => {
    await get("policies?size=5&status=active&page=2", await mintToken());

    // Deterministic upstream URL whatever order they arrived in.
    expect(upstream).toHaveBeenCalledWith("/v1/policies?page=2&size=5&status=active");
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

  it("answers 403 before 400 — a refused caller learns nothing about the surface", async () => {
    const res = await get(
      "apps/billing/policies?sort=name",
      await scopedToken(["records"]),
    );

    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
