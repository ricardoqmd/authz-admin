"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/pdp/client";
import type {
  Paginated,
  PolicyDocument,
  PolicyHeadSummary,
  PolicyHeadView,
  PolicyVersionSummary,
} from "@/lib/pdp/contracts";

export type StatusFilter = "all" | "active" | "inactive";

/**
 * Cross-app catalog (R026: GET /v1/policies) — the supervision view. The engine
 * scopes it to the applications the caller may read BEFORE it queries
 * (ADR-033 §2), so its page and its totals are already the caller's own: they
 * are rendered as given, never re-counted or filtered here.
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

/**
 * One application's policies (GET /v1/apps/{app}/policies). The application is a
 * ROUTE coordinate, taken from the screen's own route — never recovered from the
 * cross-application listing.
 */
export function useAppPolicies(
  app: string,
  status: StatusFilter = "all",
  page = 1,
  size = 50,
) {
  const { getToken } = useAuth();
  const statusParam = status === "all" ? "" : `&status=${status}`;
  return useQuery({
    // Under the "policies" prefix so every write's invalidation reaches it too.
    queryKey: ["policies", "app", app, status, page, size],
    queryFn: async () =>
      apiGet<Paginated<PolicyHeadSummary>>(
        `apps/${app}/policies?page=${page}&size=${size}${statusParam}`,
        await getToken(),
      ),
    enabled: !!app,
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

/**
 * A single immutable version — the endpoint returns the policy DOCUMENT
 * directly (not wrapped in a `content` field). Prefill source for the edit
 * form and the version-history inspector.
 */
export function usePolicyVersion(app: string, policyId: string, version: number | null) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["policy-version", app, policyId, version],
    queryFn: async () =>
      apiGet<PolicyDocument>(
        `apps/${app}/policies/${policyId}/versions/${version}`,
        await getToken(),
      ),
    enabled: !!app && !!policyId && version != null,
  });
}
