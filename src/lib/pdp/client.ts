/*
 * Browser-side client. Talks ONLY to the PAP BFF (/api/pdp/*) — never to the
 * PDP directly. Sends the user's token: the BFF verifies it and forwards it,
 * and the PDP authorises the person it names.
 *
 * No write body carries `subject`. The engine accepts that field to record that
 * a write was made on behalf of someone other than the caller (service-policy
 * ADR-033 §4). Here the person IS the token's subject — the BFF forwards their
 * own token — so there is no one else to declare, and the audit records the
 * acting identity as verified rather than declared. Omitting it is the
 * decision, not an oversight.
 */
import { isProblem, type Problem } from "./contracts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed (${status})`);
  }
}

export async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(`/api/pdp/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, isProblem(body) ? body : null);
  }
  return (await res.json()) as T;
}

async function apiWrite<T>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  token: string | null,
  options?: { ifMatch?: string },
): Promise<T> {
  const res = await fetch(`/api/pdp/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Conditional writes (R018): the ETag equals the head revision.
      ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, isProblem(payload) ? payload : null);
  }
  return (await res.json()) as T;
}

export function apiPost<T>(
  path: string,
  body: unknown,
  token: string | null,
  options?: { ifMatch?: string },
): Promise<T> {
  return apiWrite<T>("POST", path, body, token, options);
}

export function apiPut<T>(
  path: string,
  body: unknown,
  token: string | null,
  options?: { ifMatch?: string },
): Promise<T> {
  return apiWrite<T>("PUT", path, body, token, options);
}

/** Conditional delete (R018/R028): If-Match = the entry revision. 204 → null. */
export async function apiDelete(
  path: string,
  token: string | null,
  options?: { ifMatch?: string },
): Promise<void> {
  const res = await fetch(`/api/pdp/${path}`, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
    },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, isProblem(payload) ? payload : null);
  }
}
