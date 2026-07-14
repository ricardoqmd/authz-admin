"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/pdp/client";
import type {
  Paginated,
  PolicyHeadSummary,
  PolicyHeadView,
  PolicyVersionSummary,
} from "@/lib/pdp/contracts";

export type StatusFilter = "all" | "active" | "inactive";

/**
 * Cross-app catalog (R026: GET /v1/policies) — the supervision view. Same
 * path and filters as before R026; per-app work uses the nested routes below.
 */
export function usePolicies(status: StatusFilter = "all", page = 1, size = 50) {
  const { getToken } = useAuth();
  // Server-side filter (R025). Default is all — omit the param for it.
  const statusParam = status === "all" ? "" : `&status=${status}`;
  return useQuery({
    queryKey: ["policies", status, page, size],
    queryFn: async () =>
      apiGet<Paginated<PolicyHeadSummary>>(
        `policies?page=${page}&size=${size}${statusParam}`,
        await getToken(),
      ),
  });
}

export function usePolicy(app: string, policyId: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["policy", app, policyId],
    queryFn: async () =>
      apiGet<PolicyHeadView>(`apps/${app}/policies/${policyId}`, await getToken()),
    enabled: !!app && !!policyId,
  });
}

export function usePolicyVersions(app: string, policyId: string, page = 1, size = 50) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["policy-versions", app, policyId, page, size],
    queryFn: async () =>
      apiGet<Paginated<PolicyVersionSummary>>(
        `apps/${app}/policies/${policyId}/versions?page=${page}&size=${size}`,
        await getToken(),
      ),
    enabled: !!app && !!policyId,
  });
}
