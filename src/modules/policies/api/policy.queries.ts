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

export function usePolicies(page = 1, size = 50) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["policies", page, size],
    queryFn: async () =>
      apiGet<Paginated<PolicyHeadSummary>>(
        `policies?page=${page}&size=${size}`,
        await getToken(),
      ),
  });
}

export function usePolicy(policyId: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["policy", policyId],
    queryFn: async () =>
      apiGet<PolicyHeadView>(`policies/${policyId}`, await getToken()),
    enabled: !!policyId,
  });
}

export function usePolicyVersions(policyId: string, page = 1, size = 50) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["policy-versions", policyId, page, size],
    queryFn: async () =>
      apiGet<Paginated<PolicyVersionSummary>>(
        `policies/${policyId}/versions?page=${page}&size=${size}`,
        await getToken(),
      ),
    enabled: !!policyId,
  });
}
