/*
 * Server-side PDP client — used ONLY by the BFF route handlers.
 * The PDP base URL and the service credential never reach the browser.
 *
 * Service credential resolution:
 *   1. PDP_TOKEN_URL set → client_credentials grant (the BFF's own service
 *      account), cached until shortly before expiry, single in-flight refresh.
 *   2. Otherwise → PDP_SERVICE_TOKEN (dev-only pasted token; expires in ~5 min).
 */
import { isProblem, type Problem } from "./contracts";

const PDP_BASE_URL = process.env.PDP_BASE_URL ?? "http://localhost:8080";

/** Upstream calls must fail loudly, never hang the UI (504 beats a spinner). */
const UPSTREAM_TIMEOUT_MS = Number(process.env.PDP_TIMEOUT_MS ?? 10_000);

/** Thrown when the PDP or the token endpoint is slow/unreachable. */
export class UpstreamError extends Error {
  constructor(
    public readonly upstream: "pdp" | "token-endpoint",
    cause: unknown,
  ) {
    const reason =
      cause instanceof Error && cause.name === "TimeoutError"
        ? `timed out after ${UPSTREAM_TIMEOUT_MS}ms`
        : ((cause as Error)?.message ?? "unreachable");
    super(`${upstream} ${reason}`);
  }
}

export class PdpError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `PDP request failed (${status})`);
  }
}

/* ---- service-account token (client_credentials) with expiry cache ---- */

const EXPIRY_SAFETY_SECONDS = 30;

let cachedToken: { value: string; expiresAtMs: number } | null = null;
let inFlightRequest: Promise<string> | null = null;

/**
 * Same shape as the browser-side acquireToken lesson, server edition: a
 * question ("valid token NOW"), not a snapshot. Concurrent callers share one
 * refresh (in-flight promise), and the cache expires before the token does.
 */
async function serviceToken(): Promise<string> {
  const tokenUrl = process.env.PDP_TOKEN_URL;
  if (!tokenUrl) {
    // Dev fallback: manually pasted token. Loud warning so nobody ships it.
    if (!process.env.PDP_SERVICE_TOKEN) {
      console.warn(
        "[pap-bff] No PDP credential configured: set PDP_TOKEN_URL (+ client id/secret) or PDP_SERVICE_TOKEN (dev only).",
      );
    }
    return process.env.PDP_SERVICE_TOKEN ?? "";
  }

  if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
    return cachedToken.value;
  }
  inFlightRequest ??= requestServiceToken(tokenUrl).finally(() => {
    inFlightRequest = null;
  });
  return inFlightRequest;
}

async function requestServiceToken(tokenUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.PDP_CLIENT_ID ?? "",
        client_secret: process.env.PDP_CLIENT_SECRET ?? "",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    cachedToken = null;
    throw new UpstreamError("token-endpoint", cause);
  }
  if (!res.ok) {
    cachedToken = null;
    throw new Error(
      `[pap-bff] service-account token request failed (${res.status}) — check PDP_TOKEN_URL / PDP_CLIENT_ID / PDP_CLIENT_SECRET`,
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAtMs: Date.now() + Math.max(data.expires_in - EXPIRY_SAFETY_SECONDS, 5) * 1000,
  };
  return cachedToken.value;
}

/* ---- fetch helpers ---- */

export async function pdpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await serviceToken();
  try {
    return await fetch(`${PDP_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new UpstreamError("pdp", cause);
  }
}

/** Fetch JSON from the PDP, translating problem+json errors into PdpError. */
export async function pdpJson<T>(path: string): Promise<T> {
  const res = await pdpFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new PdpError(res.status, isProblem(body) ? body : null);
  }
  return (await res.json()) as T;
}
