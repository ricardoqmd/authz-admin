"use client";

import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiDelete, apiPost, apiPut } from "@/lib/pdp/client";
import type { CatalogueEntry } from "@/lib/pdp/contracts";

function invalidateCatalogue(qc: QueryClient, app: string) {
  qc.invalidateQueries({ queryKey: ["catalogue", app] });
}

/** Create a catalogue entry (POST) — unconditional (no prior ETag). */
export function useCreateCatalogueEntry(app: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { resourceType: string; actions: string[] }) =>
      apiPost<CatalogueEntry>(`apps/${app}/action-catalogue`, input, await getToken()),
    onSuccess: () => invalidateCatalogue(qc, app),
  });
}

/**
 * Replace the FULL action set (PUT) — conditional (If-Match = revision).
 * 412 on a stale revision; 409 ACTION_IN_USE if the removed action is still
 * governed by an active policy (problem carries `policyIds`).
 */
export function useReplaceCatalogueEntry(app: string, resourceType: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { actions: string[]; revision: number }) =>
      apiPut<CatalogueEntry>(
        `apps/${app}/action-catalogue/${resourceType}`,
        { actions: input.actions },
        await getToken(),
        { ifMatch: `"${input.revision}"` },
      ),
    onSuccess: () => invalidateCatalogue(qc, app),
  });
}

/** Delete an entry (DELETE) — conditional (If-Match). Same ACTION_IN_USE guard. */
export function useDeleteCatalogueEntry(app: string, resourceType: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { revision: number }) =>
      apiDelete(`apps/${app}/action-catalogue/${resourceType}`, await getToken(), {
        ifMatch: `"${input.revision}"`,
      }),
    onSuccess: () => invalidateCatalogue(qc, app),
  });
}
