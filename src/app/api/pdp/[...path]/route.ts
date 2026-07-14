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
/** Write allowlist: create under an app. */
const CREATE_PATH = /^apps\/([a-z0-9-]+)\/policies$/;

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

  if (!READ_PATHS.test(joined)) {
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

  const createMatch = CREATE_PATH.exec(joined);
  if (!createMatch) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }
  const app = createMatch[1];

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json(
      { title: "Bad request", status: 400, code: "BFF_INVALID_JSON" },
      { status: 400 },
    );
  }

  // Enforcement seam (model D): since R026 the app is a ROUTE coordinate;
  // the check runs BEFORE the BFF spends its credential.
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
  const etag = res.headers.get("etag");

  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      ...(etag ? { etag } : {}),
    },
  });
}
