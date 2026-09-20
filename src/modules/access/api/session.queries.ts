"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import type { SessionView } from "@/lib/auth/session";
import { ApiError } from "@/lib/pdp/client";
import { isProblem } from "@/lib/pdp/contracts";

/**
 * GET /api/session — the applications the caller's VERIFIED token carries.
 *
 * ADVISORY, and nothing here may forget it: this list feeds the application
 * selector and decides nothing. The engine authorises every request against the
 * same token, and a `403` for an application listed here is a normal answer.
 */
export function useSession() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionView> => {
      const token = await getToken();
      const res = await fetch("/api/session", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, isProblem(body) ? body : null);
      }
      return (await res.json()) as SessionView;
    },
  });
}

/** The selector's options: the session's apps, or none while loading or failed. */
export function useSessionApps(): string[] {
  return useSession().data?.apps ?? [];
}
