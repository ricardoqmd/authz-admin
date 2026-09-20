/*
 * BFF proxy — the ONLY door between the browser and the PDP.
 *
 * What it does, in order:
 *   1. Verify the caller's Bearer JWT against the issuer's published keys
 *      (resource-server style; see lib/auth/server.ts). A request without a
 *      verified caller is answered here and never reaches the engine.
 *   2. Narrow the surface: a path allowlist, and a vetted query string.
 *   3. Forward to the engine WITH THE CALLER'S OWN TOKEN, and pass the engine's
 *      answer back unchanged — status, body and content type.
 *
 * What it does NOT do: decide authorization. There is no access check here, no
 * role, no application list consulted. The engine authorises the person who
 * presented the token, for reads and writes alike (service-policy ADR-033), and
 * its refusal is the one this console returns. A second gate here would be a
 * second opinion that can disagree with the first — the defect ADR-033 removed
 * from the engine's side — so there is none.
 *
 * The allowlist in step 2 is not authorization either: it limits which engine
 * resources this console exposes at all, identically for every caller.
 */
import { type NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/route-guard";
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
 * The engine's answer, as the engine gave it. Status and body are copied
 * verbatim — a refusal is the engine's refusal, with its code and detail, and
 * this console adds nothing to it and invents nothing. `etag` is kept because
 * the conditional writes need it.
 */
async function passThrough(res: Response): Promise<NextResponse> {
  const body = await res.text();
  const etag = res.headers.get("etag");
  return new NextResponse(body || null, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      ...(etag ? { etag } : {}),
    },
  });
}

/**
 * The read surface, one entry per shape — the allowlist AND the recognised query
 * parameters, in one place because they are one fact.
 *
 * `params` is measured against the PDP's own resources, not assumed — an
 * unrecognised parameter is a 400 (see {@link buildQuery}), so a wrong entry here
 * breaks a screen rather than silently widening the surface.
 *
 * Upstream sources for `params`, read rather than assumed:
 *   PolicyCatalogResource.list   page, size, view, app, status
 *   PolicyResource.list          page, size, view, status
 *   PolicyResource.getById       (none)
 *   PolicyResource.listVersions  page, size, view      — note: no `status`
 *   PolicyResource.getVersion    (none)
 *   ActionCatalogueResource      (none, both shapes)
 *   AppConfigResource.get        (none)
 */
type ReadShape = {
  readonly pattern: RegExp;
  /** Recognised query parameters for THIS path, in the order sent upstream. */
  readonly params: readonly string[];
};

const READS: readonly ReadShape[] = [
  // The one read that names no application: the merged catalogue. The engine
  // scopes it to what the caller may read BEFORE it queries (ADR-033 §2), so
  // `?app=` narrows within that scope and can never widen it.
  { pattern: /^policies$/, params: ["page", "size", "view", "app", "status"] },
  {
    pattern: /^apps\/[a-z0-9-]+\/policies$/,
    params: ["page", "size", "view", "status"],
  },
  { pattern: /^apps\/[a-z0-9-]+\/policies\/[^/]+$/, params: [] },
  {
    pattern: /^apps\/[a-z0-9-]+\/policies\/[^/]+\/versions$/,
    params: ["page", "size", "view"],
  },
  { pattern: /^apps\/[a-z0-9-]+\/policies\/[^/]+\/versions\/\d+$/, params: [] },
  { pattern: /^apps\/[a-z0-9-]+\/action-catalogue$/, params: [] },
  { pattern: /^apps\/[a-z0-9-]+\/action-catalogue\/[a-z0-9-]+$/, params: [] },
  { pattern: /^apps\/[a-z0-9-]+\/configuration$/, params: [] },
];

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

/** Write allowlist (POST): create, activate and deactivate under an app. */
const WRITE_PATH =
  /^apps\/[a-z0-9-]+\/policies(?:\/[a-z0-9-]+\/(?:activate|deactivate))?$/;
/** Append allowlist (PUT): a new version on an existing policy. */
const APPEND_PATH = /^apps\/[a-z0-9-]+\/policies\/[a-z0-9-]+$/;
/** Evaluate allowlist (POST): the policy tester (data plane). */
const EVALUATE_PATH = /^apps\/[a-z0-9-]+\/evaluate$/;
/** Simulate allowlist (POST, R027): dry-run a hypothetical policy document. */
const SIMULATE_PATH = /^apps\/[a-z0-9-]+\/policies:simulate$/;
/** Catalogue create (POST): a new entry for a resourceType under the app. */
const CATALOGUE_CREATE_PATH = /^apps\/[a-z0-9-]+\/action-catalogue$/;
/** Catalogue item (PUT replace / DELETE): one entry, conditional (If-Match). */
const CATALOGUE_ITEM_PATH = /^apps\/[a-z0-9-]+\/action-catalogue\/[a-z0-9-]+$/;
/**
 * Per-app configuration (R029). A singleton — the SAME path serves all four
 * verbs: GET (read), POST (create), PUT (replace), DELETE. `revision`/If-Match
 * gate the conditional writes; a missing config degrades, never denies.
 */
const CONFIG_PATH = /^apps\/[a-z0-9-]+\/configuration$/;

function unknownPath() {
  return NextResponse.json(
    { title: "Not found", status: 404, code: "BFF_UNKNOWN_PATH" },
    { status: 404 },
  );
}

function invalidJson() {
  return NextResponse.json(
    { title: "Bad request", status: 400, code: "BFF_INVALID_JSON" },
    { status: 400 },
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

  const read = READS.find((shape) => shape.pattern.test(joined));
  if (!read) return unknownPath();

  const query = buildQuery(req.nextUrl.searchParams, read.params);
  if (!query.ok) {
    return NextResponse.json(
      { title: "Bad request", status: 400, code: query.code, detail: query.detail },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await pdpFetch(caller.token, `/v1/${joined}${query.search}`);
  } catch (error) {
    return upstreamProblem(error);
  }
  return passThrough(res);
}

/**
 * POST: evaluate and simulate (the tester), and the unconditional creates plus
 * the conditional lifecycle writes. Create is the only write with no If-Match —
 * there is no prior ETag.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  const { path } = await params;
  const joined = path.join("/");

  const tester = EVALUATE_PATH.test(joined) || SIMULATE_PATH.test(joined);
  const write =
    WRITE_PATH.test(joined) ||
    CATALOGUE_CREATE_PATH.test(joined) ||
    CONFIG_PATH.test(joined);
  if (!tester && !write) return unknownPath();

  // The tester's body goes to the engine as parsed, even when it did not parse:
  // the engine owns that validation and its answer is the one rendered.
  const body = await req.json().catch(() => null);
  if (write && body === null) return invalidJson();

  // Conditional writes (R018): forward the client's If-Match untouched so the
  // PDP arbitrates concurrency — the BFF never fabricates preconditions.
  const ifMatch = req.headers.get("if-match");
  let res: Response;
  try {
    res = await pdpFetch(caller.token, `/v1/${joined}`, {
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
  return passThrough(res);
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

  if (!CATALOGUE_ITEM_PATH.test(joined) && !CONFIG_PATH.test(joined)) {
    return unknownPath();
  }

  const ifMatch = req.headers.get("if-match");
  let res: Response;
  try {
    res = await pdpFetch(caller.token, `/v1/${joined}`, {
      method: "DELETE",
      headers: { ...(ifMatch ? { "If-Match": ifMatch } : {}) },
    });
  } catch (error) {
    return upstreamProblem(error);
  }
  return passThrough(res);
}

/**
 * Append a policy version (R014), or replace a catalogue entry (R028) or an app
 * configuration (R029) — all conditional (If-Match) writes under the app.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const caller = await authenticate(req);
  if (caller instanceof NextResponse) return caller;

  const { path } = await params;
  const joined = path.join("/");

  const known =
    APPEND_PATH.test(joined) ||
    CATALOGUE_ITEM_PATH.test(joined) ||
    CONFIG_PATH.test(joined);
  if (!known) return unknownPath();

  const body = await req.json().catch(() => null);
  if (body === null) return invalidJson();

  const ifMatch = req.headers.get("if-match");
  let res: Response;
  try {
    res = await pdpFetch(caller.token, `/v1/${joined}`, {
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
  return passThrough(res);
}
