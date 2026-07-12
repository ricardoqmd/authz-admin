/*
 * Server-side PDP client — used ONLY by the BFF route handlers.
 * The PDP base URL and the service credential never reach the browser.
 *
 * Phase 1 (dev): PDP_SERVICE_TOKEN is a token pasted from the Quarkus Dev UI.
 * Phase 2: replace with a client_credentials flow against Keycloak (service
 * account carrying the authz-admin + pdp-client markers), cached until expiry.
 */
import { isProblem, type Problem } from "./contracts";

const PDP_BASE_URL = process.env.PDP_BASE_URL ?? "http://localhost:8080";

export class PdpError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `PDP request failed (${status})`);
  }
}

async function serviceToken(): Promise<string> {
  // TODO(phase 2): client_credentials grant against Keycloak, with caching.
  return process.env.PDP_SERVICE_TOKEN ?? "";
}

export async function pdpFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await serviceToken();
  const res = await fetch(`${PDP_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  return res;
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
