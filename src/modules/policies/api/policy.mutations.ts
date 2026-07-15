"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiPost, apiPut } from "@/lib/pdp/client";
import type { PolicyDocument, PolicyHeadView } from "@/lib/pdp/contracts";

/** Response of POST /v1/policies (PolicyCreated). */
export interface PolicyCreated {
  policyId: string;
  version: number;
  active: boolean; // always false: create never activates (R014/R020)
}

export function useCreatePolicy() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    // R026: the app is a route coordinate, not a body field.
    mutationFn: async ({ app, document }: { app: string; document: PolicyDocument }) =>
      apiPost<PolicyCreated>(`apps/${app}/policies`, document, await getToken()),
    onSuccess: () => {
      // The list is stale the moment the PDP accepts the write.
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });
}

/**
 * Conditional lifecycle writes (R018/R020): If-Match carries the head revision
 * read by the caller. A 412 means another admin moved the head — the UI
 * reloads the head (fresh revision) and retries without losing input.
 */
export function useActivatePolicy(app: string, policyId: string) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      version: number;
      changeReason: string;
      revision: number;
    }) =>
      apiPost<PolicyHeadView>(
        `apps/${app}/policies/${policyId}/activate`,
        { version: input.version, changeReason: input.changeReason },
        await getToken(),
        { ifMatch: `"${input.revision}"` },
      ),
    onSuccess: () => invalidatePolicy(queryClient, app, policyId),
  });
}

export function useDeactivatePolicy(app: string, policyId: string) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { changeReason: string; revision: number }) =>
      apiPost<PolicyHeadView>(
        `apps/${app}/policies/${policyId}/deactivate`,
        { changeReason: input.changeReason },
        await getToken(),
        { ifMatch: `"${input.revision}"` },
      ),
    onSuccess: () => invalidatePolicy(queryClient, app, policyId),
  });
}

import type { QueryClient } from "@tanstack/react-query";

function invalidatePolicy(queryClient: QueryClient, app: string, policyId: string) {
  queryClient.invalidateQueries({ queryKey: ["policy", app, policyId] });
  queryClient.invalidateQueries({ queryKey: ["policy-versions", app, policyId] });
  queryClient.invalidateQueries({ queryKey: ["policies"] });
}

/**
 * Append a new version (PUT, R014) — conditional write (R018): If-Match = the
 * head revision. The new version is created INACTIVE; activating it is the
 * separate explicit step (R020). Same reload-and-retry UX on 412 as activation.
 */
export function useAppendVersion(app: string, policyId: string) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      content: PolicyDocument;
      changeReason: string;
      revision: number;
    }) =>
      apiPut<PolicyHeadView>(
        `apps/${app}/policies/${policyId}`,
        { content: input.content, changeReason: input.changeReason },
        await getToken(),
        { ifMatch: `"${input.revision}"` },
      ),
    onSuccess: () => invalidatePolicy(queryClient, app, policyId),
  });
}
