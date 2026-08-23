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
import { authenticate } from "@/lib/auth/route-guard";
import type { VerifiedUser } from "@/lib/auth/server";
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
 * The read surface, one entry per shape — the allowlist AND the app coordinate
 * AND the recognised query parameters, in one place because they are one fact.
 *
 * The app is a ROUTE coordinate on every read that names one, exactly as it is on
 * all five write call sites. It is captured from the SAME match that admits the
 * path, so the app authorised and the app requested cannot diverge: `joined` is
 * both what is matched here and what is forwarded upstream.
 *
 * `params` is measured against the PDP's own resources, not assumed — an
 * unrecognised parameter is a 400 (see {@link buildQuery}), so a wrong entry here
 * breaks a screen rather than silently widening the surface.
 */
type ReadShape = {
  readonly pattern: RegExp;
  /** Recognised query parameters for THIS path, in the order sent upstream. */
  readonly params: readonly string[];
};

/**
 * The one read that names no application: the cross-app catalogue (R026).
 * `PolicyCatalogResource.list` — page, size, view, app, status.
 *
 * `?app=` stays available here because it narrows an administrator's view. It can
 * never grant a scoped caller anything, because a scoped caller never gets past the
 * faculty check on this path.
 */
const CROSS_APP_READ: ReadShape = {
  pattern: /^policies$/,
  params: ["page", "size", "view", "app", "status"],
};

/**
 * Every read whose path carries an application. Anchored and mutually exclusive,
 * so the first match is the only match; capture 1 is always the app.
 *
 * Upstream sources for `params`, read rather than assumed:
 *   PolicyResource.list          page, size, view, status
 *   PolicyResource.getById       (none)
 *   PolicyResource.listVersions  page, size, view      — note: no `status`
 *   PolicyResource.getVersion    (none)
 *   ActionCatalogueResource      (none, both shapes)
 *   AppConfigResource.get        (none)
 */
const APP_READS: readonly ReadShape[] = [
  {
    pattern: /^apps\/([a-z0-9-]+)\/policies$/,
    params: ["page", "size", "view", "status"],
  },
  { pattern: /^apps\/([a-z0-9-]+)\/policies\/[^/]+$/, params: [] },
  {
    pattern: /^apps\/([a-z0-9-]+)\/policies\/[^/]+\/versions$/,
    params: ["page", "size", "view"],
  },
  { pattern: /^apps\/([a-z0-9-]+)\/policies\/[^/]+\/versions\/\d+$/, params: [] },
  { pattern: /^apps\/([a-z0-9-]+)\/action-catalogue$/, params: [] },
  { pattern: /^apps\/([a-z0-9-]+)\/action-catalogue\/[a-z0-9-]+$/, params: [] },
  { pattern: /^apps\/([a-z0-9-]+)\/configuration$/, params: [] },
];

/** What a matched read is: a faculty question, or a question about one app. */
type ResolvedRead =
  | { readonly kind: "cross-app"; readonly params: readonly string[] }
  | { readonly kind: "app"; readonly app: string; readonly params: readonly string[] };

/** Resolve a GET path to its shape, or null — which is the 404. */
function resolveRead(joined: string): ResolvedRead | null {
  if (CROSS_APP_READ.pattern.test(joined)) {
    return { kind: "cross-app", params: CROSS_APP_READ.params };
  }
  for (const shape of APP_READS) {
    const match = shape.pattern.exec(joined);
    // biome-ignore lint/style/noNonNullAssertion: capture 1 exists in every APP_READS pattern.
    if (match) return { kind: "app", app: match[1]!, params: shape.params };
  }
  return null;
}

/** The result of vetting the caller's query string against one shape's allowlist. */
type QueryResult =
  | { readonly ok: true; readonly search: string }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/**
 * Build the upstream query from the parameters this path recognises.
 *
 * The caller's query string is never forwarded: it is read, vetted and rebuilt.
 *
 * **Unrecognised parameters are rejected, not dropped.** Dropping makes a filter
 * vanish silently — the caller gets a page of results that quietly ignores what
 * they asked for. Rejecting fails loudly, and the only client is the UI in this
 * repo, so a mismatch surfaces in this repo's own test run.
 *
 * A parameter valid on another path is still unrecognised here: `app` on a per-app
 * route is a 400, because the app is already in the route and a second, disagreeing
 * coordinate must never be silently ignored.
 *
 * Output order follows the allowlist, not the caller, so the upstream URL for a
 * given set of parameters is deterministic whatever order they arrived in.
 */
function buildQuery(source: URLSearchParams, recognised: readonly string[]): QueryResult {
  for (const name of source.keys()) {
    if (!recognised.includes(name)) {
      return {
        ok: false,
        code: "BFF_UNKNOWN_PARAMETER",
        detail: `Query parameter "${name}" is not recognised on this path.`,
      };
    }
  }

  const out = new URLSearchParams();
  for (const name of recognised) {
    const values = source.getAll(name);
    if (values.length === 0) continue;
    // Repeated is ambiguous, so it is refused rather than resolved. Taking the
    // first (or the last) would be this function silently choosing which of the
    // caller's two answers it meant — the same silent-drop failure the unknown
    // check above exists to avoid.
    if (values.length > 1) {
      return {
        ok: false,
        code: "BFF_REPEATED_PARAMETER",
        detail: `Query parameter "${name}" was sent more than once.`,
      };
    }
    // biome-ignore lint/style/noNonNullAssertion: length checked immediately above.
    out.set(name, values[0]!);
  }
  const search = out.toString();
  return { ok: true, search: search ? `?${search}` : "" };
}

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
 * The read denial — ONE body for both read shapes.
 *
 * A caller refused the cross-app catalogue and a caller refused one application
 * receive byte-identical answers, with no `detail`. The writes name the app they
 * refused, which is safe there because the caller put it in the route themselves;
 * here, distinguishing "you may not read across apps" from "you may not read app
 * X" would tell a prober which applications exist, one request at a time.
 */
function readDenied() {
  return NextResponse.json(
    { title: "Forbidden", status: 403, code: "PROJECT_ACCESS_DENIED" },
    { status: 403 },
  );
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

  const read = resolveRead(joined);
  if (!read) {
    return NextResponse.json(
      { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
      { status: 404 },
    );
  }

  // Enforcement seam, per read shape. A read that names an application is
  // authorised against THAT application, from the route; the one read that names
  // none asks the faculty question instead. There is no wildcard app and no role
  // check here — both live behind ProjectAccessPolicy.
  const allowed =
    read.kind === "cross-app"
      ? await projectAccess.canReadAcrossApps(caller)
      : await projectAccess.can(caller, "read", read.app);
  if (!allowed) return readDenied();

  // After the gate, deliberately: a caller who may not read this at all learns
  // nothing about which parameters it would have accepted.
  const query = buildQuery(req.nextUrl.searchParams, read.params);
  if (!query.ok) {
    return NextResponse.json(
      { title: "Bad request", status: 400, code: query.code, detail: query.detail },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await pdpFetch(`/v1/${joined}${query.search}`);
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
