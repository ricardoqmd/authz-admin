/*
 * Server-side token verification — the BFF's door check.
 *
 * Counterpart of ./index.tsx: that facade authenticates the BROWSER (it gates
 * the screen); this module authenticates the REQUEST (it gates the API). They
 * are independent on purpose — a caller that never loads the UI still has to
 * get past this.
 *
 * Same split as lib/pdp: `client.ts` runs in the browser, `server.ts` never
 * leaves the server. Nothing here may be imported from a client component.
 *
 * Provider-agnostic by the same rule as the auth port (see ./types.ts): the
 * issuer is configuration, and the signing keys are found through OIDC
 * Discovery, not through a Keycloak-shaped URL. `jose` owns the JWKS cache —
 * there is deliberately no cache of ours around the keys.
 */
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

/** The caller, as derived from verified claims. Never from a constant. */
export interface VerifiedUser {
  /** Opaque IdP subject. Never PII. */
  sub: string;
  /** Roles, read from PAP_OIDC_ROLES_CLAIM_PATH; absent claim → empty. */
  roles: string[];
  /** Projects this subject may administer, read from PAP_OIDC_APPS_CLAIM_PATH;
   *  absent claim → empty, never "all". */
  apps: string[];
}

/**
 * Why a reason code and not just a message: the route turns `misconfigured`
 * into a 500 and everything else into a 401. A deployment that forgot an env
 * var must not look to the caller like a bad token — and must never look to
 * the BFF like a reason to serve the request.
 */
export type AuthFailureReason =
  | "missing_token"
  | "invalid_token"
  | "wrong_client"
  | "misconfigured";

export class TokenError extends Error {
  constructor(
    readonly reason: AuthFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

interface AuthConfig {
  issuer: string;
  clientId: string;
  rolesPath: string;
  appsPath: string;
}

/**
 * Where Keycloak puts these — NOT where "roles" and "apps" live.
 *
 * They are defaults, not a contract: Auth0, Okta and Entra each put the same
 * information somewhere else, and a deployment on one of them must be a
 * config change, not a code change. Same discipline the PDP already holds
 * with `role-claim-path` and `mode = role | scope` (its ADR-013): the product
 * may not hardcode an IdP or a claim location.
 */
const DEFAULT_ROLES_CLAIM_PATH = "realm_access.roles";
const DEFAULT_APPS_CLAIM_PATH = "authz_apps";

/**
 * Read on first use rather than at module load: CI builds this app with no
 * environment at all (`pnpm build` in ci.yml), and a throw at import time
 * would turn a missing runtime secret into a broken build. The property that
 * matters is preserved either way — a blank issuer or client id NEVER degrades
 * to permissive, it raises `misconfigured`, and the route answers 500.
 *
 * The claim paths are the opposite case on purpose: blank means "use the
 * Keycloak default", never "misconfigured". Configuration nobody set must not
 * become a new way to fail — a deployment that never heard of these two
 * variables keeps behaving exactly as it did before they existed.
 */
function authConfig(): AuthConfig {
  const issuer = process.env.PAP_OIDC_ISSUER?.trim();
  const clientId = process.env.PAP_OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) {
    throw new TokenError(
      "misconfigured",
      "PAP_OIDC_ISSUER and PAP_OIDC_CLIENT_ID are required to verify caller tokens.",
    );
  }
  return {
    issuer,
    clientId,
    rolesPath: process.env.PAP_OIDC_ROLES_CLAIM_PATH?.trim() || DEFAULT_ROLES_CLAIM_PATH,
    appsPath: process.env.PAP_OIDC_APPS_CLAIM_PATH?.trim() || DEFAULT_APPS_CLAIM_PATH,
  };
}

/* ---- signing keys, found by discovery ---- */

type KeyResolver = ReturnType<typeof createRemoteJWKSet>;

let keysFor: { issuer: string; resolver: Promise<KeyResolver> } | null = null;

/**
 * One discovery round-trip per issuer, memoized. The memo holds the PROMISE so
 * concurrent first requests share a single fetch instead of racing — the same
 * in-flight discipline the service-account cache uses in lib/pdp/server.ts. A
 * failed discovery is evicted so the next request retries.
 */
function signingKeys(issuer: string): Promise<KeyResolver> {
  if (keysFor?.issuer !== issuer) {
    const resolver = discoverJwks(issuer).catch((cause) => {
      if (keysFor?.issuer === issuer) keysFor = null;
      throw cause;
    });
    keysFor = { issuer, resolver };
  }
  return keysFor.resolver;
}

async function discoverJwks(issuer: string): Promise<KeyResolver> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    throw new TokenError(
      "misconfigured",
      `OIDC discovery failed for issuer ${issuer}: ${(cause as Error)?.message ?? "unreachable"}`,
    );
  }
  if (!res.ok) {
    throw new TokenError(
      "misconfigured",
      `OIDC discovery failed for issuer ${issuer}: HTTP ${res.status}`,
    );
  }
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new TokenError(
      "misconfigured",
      `OIDC discovery document for ${issuer} has no jwks_uri.`,
    );
  }
  return createRemoteJWKSet(new URL(doc.jwks_uri));
}

/** Test seam: drop the memoized discovery so a test can point at a new issuer. */
export function resetSigningKeyCache(): void {
  keysFor = null;
}

/* ---- the check ---- */

/** `Authorization: Bearer <jwt>` → the raw token. Nothing else is accepted. */
function bearer(req: { headers: { get(name: string): string | null } }): string {
  const header = req.headers.get("authorization");
  if (!header) {
    throw new TokenError("missing_token", "No Authorization header.");
  }
  const [scheme, ...rest] = header.split(" ");
  const token = rest.join(" ").trim();
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new TokenError("missing_token", "Authorization header is not a Bearer token.");
  }
  return token;
}

/**
 * Was this token minted for THIS application?
 *
 * Measured, not assumed (pap-001 step 1): in the realm this PAP is configured
 * against, the browser client's identity travels in `azp` — `aud` is used for
 * the DOWNSTREAM audience (the PDP), so an aud-only check would reject every
 * valid caller. Deployments that add an audience mapper for the PAP put the
 * client id in `aud` instead, which is why both are accepted: either claim
 * naming us is signed proof the token was issued for us, and neither is a
 * weaker statement than the other.
 */
function mintedForThisApp(payload: JWTPayload, clientId: string): boolean {
  if (payload.azp === clientId) return true;
  const aud = payload.aud;
  return Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
}

/**
 * Read a dot-path off the verified payload and return the strings there.
 *
 * TOTAL by construction: every input produces a value and nothing throws. A
 * token is attacker-supplied data — a claim shaped unexpectedly must produce a
 * denial, not a 500 that hides what happened. So every miss lands on the same
 * answer, the empty array:
 *
 *   path absent · null/undefined · a string · an object · a number ·
 *   a segment traversing a non-object  →  []
 *
 * Never a wildcard, never a partial guess, and deliberately NOT "wrap a lone
 * string in an array": a claim the deployment shaped wrong should be visibly
 * empty, not silently half-understood. Empty means denied — for `apps` because
 * the caller administers no project, and now equally for `roles`, which
 * HardcodedProjectAccessPolicy turns into a refusal. Fail closed.
 */
function stringsAt(payload: JWTPayload, path: string): string[] {
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      payload,
    );
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Verify the caller's token and derive the user from it. Throws TokenError on
 * every failure path — there is no return value that means "could not verify".
 *
 * Checked: signature against the realm JWKS, `iss`, `exp` (and `nbf`) via jose,
 * and the client the token was minted for.
 */
export async function verifyCaller(req: {
  headers: { get(name: string): string | null };
}): Promise<VerifiedUser> {
  const { issuer, clientId, rolesPath, appsPath } = authConfig();
  const token = bearer(req);
  const keys = await signingKeys(issuer);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys, { issuer }));
  } catch (cause) {
    // The reason stays on the server: a caller learns "invalid", not which
    // check failed, and never sees a claim echoed back.
    throw new TokenError("invalid_token", (cause as Error)?.message ?? "Token rejected.");
  }

  if (!mintedForThisApp(payload, clientId)) {
    throw new TokenError("wrong_client", "Token was not minted for this application.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new TokenError("invalid_token", "Token has no subject.");
  }

  return {
    sub: payload.sub,
    roles: stringsAt(payload, rolesPath),
    apps: stringsAt(payload, appsPath),
  };
}
