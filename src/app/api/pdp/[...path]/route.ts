/*
 * BFF proxy — the ONLY door between the browser and the PDP.
 *
 * Responsibilities (target shape, model D):
 *   1. Validate the user's Bearer JWT against Keycloak JWKS (resource-server
 *      style; @ricardoqmd/auth-* stays client-side). — TODO(phase 2)
 *   2. Enforce project access via ProjectAccessPolicy (meta-policy check).
 *   3. Execute against the PDP with the BFF's own service credential.
 *
 * Phase 1 scope: READ endpoints only, mock user, permissive access policy.
 * The seams (steps 1–2) are in place so phase 2 swaps implementations, not
 * structure.
 */
import { type NextRequest, NextResponse } from "next/server";
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

// TODO(phase 2): derive from the validated JWT, not from a constant.
// Neutral demo values only — real app names belong to the internal deployment.
const MOCK_USER = {
  sub: "mock-admin",
  roles: ["pap-admin"],
  apps: ["records", "billing"],
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const joined = path.join("/");

  if (!READ_PATHS.test(joined) && !CATALOGUE_READ.test(joined)) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }

  // Enforcement seam. For list endpoints the app filter is applied client-side
  // in phase 1 (the PDP has no ?app filter yet); per-policy reads could check
  // projectOf(resourceType) here once reads are gated too.
  const allowed = await projectAccess.can(MOCK_USER, "read", "*");
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
  const { path } = await params;
  const joined = path.join("/");

  // Evaluate (policy tester) is a read-like query, not a write — separate path.
  const evalMatch = EVALUATE_PATH.exec(joined);
  if (evalMatch) {
    return proxyEvaluate(req, joined, evalMatch[1]);
  }

  // Simulate (R027 dry-run) is authoring: gated as write, effect-free upstream.
  const simMatch = SIMULATE_PATH.exec(joined);
  if (simMatch) {
    return proxySimulate(req, joined, simMatch[1]);
  }

  // Policy write OR catalogue create (R028) — both are write-gated creates.
  const writeMatch = WRITE_PATH.exec(joined);
  const catMatch = CATALOGUE_CREATE_PATH.exec(joined);
  const match = writeMatch ?? catMatch;
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
  const allowed = await projectAccess.can(MOCK_USER, action, app);
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
 * Delete a catalogue entry (R028) — conditional (If-Match). Only the action
 * catalogue exposes DELETE; policies are never deleted (append-only, R016).
 * A 409 ACTION_IN_USE (active policies still govern the type) is forwarded
 * untouched so the UI can surface the blocking policyIds.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const joined = path.join("/");

  const catItem = CATALOGUE_ITEM_PATH.exec(joined);
  if (!catItem) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }
  const app = catItem[1];

  const allowed = await projectAccess.can(MOCK_USER, "write", app);
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
async function proxyEvaluate(req: NextRequest, joined: string, app: string) {
  const allowed = await projectAccess.can(MOCK_USER, "read", app);
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
async function proxySimulate(req: NextRequest, joined: string, app: string) {
  const allowed = await projectAccess.can(MOCK_USER, "write", app);
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
  const { path } = await params;
  const joined = path.join("/");

  // Append a policy version OR replace a catalogue entry (R028) — both are
  // conditional (If-Match) writes under the app.
  const appendMatch = APPEND_PATH.exec(joined);
  const catItem = CATALOGUE_ITEM_PATH.exec(joined);
  const match = appendMatch ?? catItem;
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

  const allowed = await projectAccess.can(MOCK_USER, "write", app);
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
