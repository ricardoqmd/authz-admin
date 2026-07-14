/*
 * Browser-side client. Talks ONLY to the PAP BFF (/api/pdp/*) — never to the
 * PDP directly. Sends the user's token so the BFF can validate and enforce.
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

export async function apiPost<T>(
  path: string,
  body: unknown,
  token: string | null,
  options?: { ifMatch?: string },
): Promise<T> {
  const res = await fetch(`/api/pdp/${path}`, {
    method: "POST",
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
