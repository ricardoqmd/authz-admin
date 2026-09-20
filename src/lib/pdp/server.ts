/*
 * Server-side PDP client — used ONLY by the BFF route handlers.
 * The PDP base URL never reaches the browser.
 *
 * Whose credential: the CALLER's. Every request carries the Bearer token the
 * person presented to this console, already verified by the route guard
 * (lib/auth/route-guard.ts), so the engine authorises the person and not this
 * console (service-policy ADR-033 §3, "whose token"). This module holds no
 * credential of its own and has no way to obtain one: there is no token
 * endpoint, no client secret and no fallback — a caller that cannot present a
 * token never gets this far.
 */

const PDP_BASE_URL = process.env.PDP_BASE_URL ?? "http://localhost:8080";

/** Upstream calls must fail loudly, never hang the UI (504 beats a spinner). */
const UPSTREAM_TIMEOUT_MS = Number(process.env.PDP_TIMEOUT_MS ?? 10_000);

/** Thrown when the PDP is slow or unreachable. */
export class UpstreamError extends Error {
  constructor(cause: unknown) {
    const reason =
      cause instanceof Error && cause.name === "TimeoutError"
        ? `timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : ((cause as Error)?.message ?? "unreachable");
    super(`pdp ${reason}`);
  }
}

/**
 * Call the PDP as the caller.
 *
 * `callerToken` is the raw Bearer string the route guard verified — required,
 * not optional, so a call site cannot forget it and silently reach the engine
 * with no credential. It replaces any Authorization header in `init`.
 */
export async function pdpFetch(
  callerToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // `set`, on a Headers object: header names are case-insensitive, so a plain
  // object spread could end up carrying `authorization` beside `Authorization`.
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${callerToken}`);
  try {
    return await fetch(`${PDP_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new UpstreamError(cause);
  }
}
