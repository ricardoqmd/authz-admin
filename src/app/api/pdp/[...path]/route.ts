/*
 * BFF proxy — the ONLY door between the browser and the PDP.
 *
 * Responsibilities (target shape, model D):
 *   1. Validate the user's Bearer JWT against the realm JWKS (resource-server
 *      style; @ricardoqmd/auth-* stays client-side). — see lib/auth/server.ts
 *   2. Enforce project access via ProjectAccessPolicy (meta-policy check).
 *      — TODO(phase 2, step 2): swap in EvaluateProjectAccessPolicy.
 *   3. Execute against the PDP with the BFF's own service credential.
 *
 * Step 1 is done: every handler derives its caller from a verified token
 * before anything else runs, so the BFF never spends its credential on an
 * unauthenticated request. Step 2 still ships the permissive hardcoded
 * policy — the seam is unchanged, it just receives a real user now.
 */
import { type NextRequest, NextResponse } from "next/server";
import { TokenError, type VerifiedUser, verifyCaller } from "@/lib/auth/server";
import { projectAccess } from "@/lib/authz/project-access";
import { pdpFetch, UpstreamError } from "@/lib/pdp/server";

/** Upstream failures become problem+json the UI can render — never a hang. */
function upstreamProblem(error: unknown) {
  if (error instanceof UpstreamError) {
    return NextResponse.json(
      {
        title: "Upstream unavailable",
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
        detail: error.message,
      },
      { status: 504 },
    );
  }
  throw error;
}

/**
 * Read allowlist (R026): the cross-app catalog (`policies`) plus the nested
 * per-app surface (`apps/{app}/policies[...]`).
 */
const READ_PATHS =
  /^(policies|apps\/[a-z0-9-]+\/policies(\/[^/]+(\/versions(\/\d+)?)?)?)$/;
/**
 * Write allowlist (POST): create, activate and deactivate under an app. The
 * second capture (lifecycle verb) doubles as the ProjectAccessPolicy action.
 */
const WRITE_PATH =
  /^apps\/([a-z0-9-]+)\/policies(?:\/[a-z0-9-]+\/(activate|deactivate))?$/;
/** Append allowlist (PUT): a new version on an existing policy. */
const APPEND_PATH = /^apps\/([a-z0-9-]+)\/policies\/[a-z0-9-]+$/;
/** Evaluate allowlist (POST): the policy tester (data plane, read-like). */
const EVALUATE_PATH = /^apps\/([a-z0-9-]+)\/evaluate$/;
/**
 * Simulate allowlist (POST, R027): dry-run a hypothetical policy document. The
 * PDP treats it as control-plane (admin marker), so the BFF gates it as WRITE
 * — same authoring bar as create/edit, not the read bar of evaluate.
 */
const SIMULATE_PATH = /^apps\/([a-z0-9-]+)\/policies:simulate$/;
/** Action catalogue (R028). Read: list + one entry. */
const CATALOGUE_READ = /^apps\/[a-z0-9-]+\/action-catalogue(\/[a-z0-9-]+)?$/;
/** Catalogue create (POST): a new entry for a resourceType under the app. */
const CATALOGUE_CREATE_PATH = /^apps\/([a-z0-9-]+)\/action-catalogue$/;
/** Catalogue item (PUT replace / DELETE): one entry, conditional (If-Match). */
const CATALOGUE_ITEM_PATH = /^apps\/([a-z0-9-]+)\/action-catalogue\/[a-z0-9-]+$/;
/**
 * Per-app configuration (R029). A singleton — the SAME path serves all four
 * verbs: GET (read), POST (create), PUT (replace), DELETE. `revision`/If-Match
 * gate the conditional writes; a missing config degrades, never denies.
 */
const CONFIG_PATH = /^apps\/([a-z0-9-]+)\/configuration$/;

/**
 * Authenticate the caller, or produce the response that refuses them.
 *
 * Returns the verified user on success and a ready-to-send NextResponse on
 * failure, so a handler cannot forget to stop: `instanceof NextResponse` is
 * the only way past it. Fail closed — there is no path through this function
 * that yields a user without a verified token.
 *
 * A misconfigured deployment answers 500, never 401 and never "allow": a
 * missing env var is our fault, not the caller's, and must not be mistakable
 * for a bad token in the logs.
 */
async function authenticate(req: NextRequest): Promise<VerifiedUser | NextResponse> {
  try {
    return await verifyCaller(req);
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    if (error.reason === "misconfigured") {
      console.error(`[pap-bff] ${error.message}`);
      return NextResponse.json(
        {
          title: "Server misconfigured",
          status: 500,
          code: "BFF_MISCONFIGURED",
          detail: "Caller token verification is not configured.",
        },
        { status: 500 },
      );
    }
    // Server-side only, and only the reason: no token, no claim, no subject.
    // Without it the first production 401 is undiagnosable; with anything more
    // than the reason it becomes a leak.
    console.warn(`[pap-bff] rejected caller: ${error.reason}`);
    // One body for every rejection reason. Which check failed (absent,
    // expired, bad signature, wrong client) stays server-side: telling an
    // anonymous caller narrows their next guess for free. Never echo the
    // token or any claim.
    return NextResponse.json(
      {
        title: "Unauthorized",
        status: 401,
        code: "UNAUTHENTICATED",
        detail: "A valid Bearer token is required.",
      },
      // RFC 6750 §3: a bearer-token resource announces the scheme on a 401.
      // Header only — bare `Bearer`, with no realm or error code, so the body
      // stays byte-identical across all four rejection reasons and the header
      // does not become the side channel the body refuses to be.
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Before anything else — including the path allowlist, so an anonymous
  // caller cannot map which routes exist by their status codes.
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  const { path } = await params;
  const joined = path.join("/");

  if (
    !READ_PATHS.test(joined) &&
    !CATALOGUE_READ.test(joined) &&
    !CONFIG_PATH.test(joined)
  ) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }

  // Enforcement seam. For list endpoints the app filter is applied client-side
  // in phase 1 (the PDP has no ?app filter yet); per-policy reads could check
  // projectOf(resourceType) here once reads are gated too.
  const allowed = await projectAccess.can(caller, "read", "*");
  if (!allowed) {
    return NextResponse.json(
      { title: "Forbidden", status: 403, code: "PROJECT_ACCESS_DENIED" },
      { status: 403 },
    );
  }

  const search = req.nextUrl.search;
  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}${search}`);
  } catch (error) {
    return upstreamProblem(error);
  }
  const body = await res.text();
  const etag = res.headers.get("etag");

  return new NextResponse(body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      ...(etag ? { etag } : {}),
    },
  });
}

/**
 * Phase 2, first write: policy creation. Create is the only unconditional
 * write (no If-Match — there is no prior ETag); the conditional writes
 * (PUT / activate / deactivate) arrive with their own reload-and-retry UX.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  const { path } = await params;
  const joined = path.join("/");

  // Evaluate (policy tester) is a read-like query, not a write — separate path.
  const evalMatch = EVALUATE_PATH.exec(joined);
  if (evalMatch) {
    return proxyEvaluate(req, caller, joined, evalMatch[1]);
  }

  // Simulate (R027 dry-run) is authoring: gated as write, effect-free upstream.
  const simMatch = SIMULATE_PATH.exec(joined);
  if (simMatch) {
    return proxySimulate(req, caller, joined, simMatch[1]);
  }

  // Policy write OR catalogue create (R028) OR config create (R029) — all
  // write-gated creates under the app.
  const writeMatch = WRITE_PATH.exec(joined);
  const catMatch = CATALOGUE_CREATE_PATH.exec(joined);
  const configMatch = CONFIG_PATH.exec(joined);
  const match = writeMatch ?? catMatch ?? configMatch;
  if (!match) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }
  const app = match[1];
  const action = (writeMatch?.[2] ?? "write") as "write" | "activate" | "deactivate";

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json(
      { title: "Bad request", status: 400, code: "BFF_INVALID_JSON" },
      { status: 400 },
    );
  }

  // Enforcement seam (model D): since R026 the app is a ROUTE coordinate;
  // the check runs BEFORE the BFF spends its credential.
  const allowed = await projectAccess.can(caller, action, app);
  if (!allowed) {
    return NextResponse.json(
      {
        title: "Forbidden",
        status: 403,
        code: "PROJECT_ACCESS_DENIED",
        detail: `You have no write access to project "${app}".`,
      },
      { status: 403 },
    );
  }

  // Conditional writes (R018): forward the client's If-Match untouched so the
  // PDP arbitrates concurrency — the BFF never fabricates preconditions.
  const ifMatch = req.headers.get("if-match");
  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ifMatch ? { "If-Match": ifMatch } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return upstreamProblem(error);
  }
  const text = await res.text();
  const etag = res.headers.get("etag");

  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      ...(etag ? { etag } : {}),
    },
  });
}

/**
 * Delete a catalogue entry (R028) or an app configuration (R029) — conditional
 * (If-Match). Policies are never deleted (append-only, R016). A 409
 * ACTION_IN_USE (active policies still govern the type) is forwarded untouched
 * so the UI can surface the blocking policyIds; deleting a config just returns
 * the app to the degraded default.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  const { path } = await params;
  const joined = path.join("/");

  const catItem = CATALOGUE_ITEM_PATH.exec(joined);
  const configMatch = CONFIG_PATH.exec(joined);
  const match = catItem ?? configMatch;
  if (!match) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }
  const app = match[1];

  const allowed = await projectAccess.can(caller, "write", app);
  if (!allowed) {
    return NextResponse.json(
      {
        title: "Forbidden",
        status: 403,
        code: "PROJECT_ACCESS_DENIED",
        detail: `You have no write access to project "${app}".`,
      },
      { status: 403 },
    );
  }

  const ifMatch = req.headers.get("if-match");
  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}`, {
      method: "DELETE",
      headers: { ...(ifMatch ? { "If-Match": ifMatch } : {}) },
    });
  } catch (error) {
    return upstreamProblem(error);
  }
  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

/** Policy tester: forward an evaluation to the PDP (read access to the app). */
async function proxyEvaluate(
  req: NextRequest,
  caller: VerifiedUser,
  joined: string,
  app: string,
) {
  const allowed = await projectAccess.can(caller, "read", app);
  if (!allowed) {
    return NextResponse.json(
      { title: "Forbidden", status: 403, code: "PROJECT_ACCESS_DENIED" },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return upstreamProblem(error);
  }
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

/**
 * Policy tester dry-run (R027): forward a { policy, request } simulation to the
 * PDP. Authoring op → WRITE access. Effect-free upstream (validates the policy
 * as a create, then evaluates in-memory; nothing is persisted). No If-Match:
 * there is no head to arbitrate — the document travels in the body.
 */
async function proxySimulate(
  req: NextRequest,
  caller: VerifiedUser,
  joined: string,
  app: string,
) {
  const allowed = await projectAccess.can(caller, "write", app);
  if (!allowed) {
    return NextResponse.json(
      {
        title: "Forbidden",
        status: 403,
        code: "PROJECT_ACCESS_DENIED",
        detail: `You have no write access to project "${app}".`,
      },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return upstreamProblem(error);
  }
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

/** Append a new version to an existing policy (R014); conditional (If-Match). */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  const { path } = await params;
  const joined = path.join("/");

  // Append a policy version OR replace a catalogue entry (R028) OR replace an
  // app configuration (R029) — all conditional (If-Match) writes under the app.
  const appendMatch = APPEND_PATH.exec(joined);
  const catItem = CATALOGUE_ITEM_PATH.exec(joined);
  const configMatch = CONFIG_PATH.exec(joined);
  const match = appendMatch ?? catItem ?? configMatch;
  if (!match) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }
  const app = match[1];

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json(
      { title: "Bad request", status: 400, code: "BFF_INVALID_JSON" },
      { status: 400 },
    );
  }

  const allowed = await projectAccess.can(caller, "write", app);
  if (!allowed) {
    return NextResponse.json(
      {
        title: "Forbidden",
        status: 403,
        code: "PROJECT_ACCESS_DENIED",
        detail: `You have no write access to project "${app}".`,
      },
      { status: 403 },
    );
  }

  const ifMatch = req.headers.get("if-match");
  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(ifMatch ? { "If-Match": ifMatch } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return upstreamProblem(error);
  }
  const text = await res.text();
  const etag = res.headers.get("etag");

  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      ...(etag ? { etag } : {}),
    },
  });
}
