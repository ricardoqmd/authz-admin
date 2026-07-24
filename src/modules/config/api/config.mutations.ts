"use client";

import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiDelete, apiPost, apiPut } from "@/lib/pdp/client";
import type { AppConfig, AppConfigWrite } from "@/lib/pdp/contracts";

function invalidateConfig(qc: QueryClient, app: string) {
  qc.invalidateQueries({ queryKey: ["app-config", app] });
}

/** Create the configuration (POST) — unconditional (no prior ETag). 409 if it exists. */
export function useCreateAppConfig(app: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AppConfigWrite) =>
      apiPost<AppConfig>(`apps/${app}/configuration`, input, await getToken()),
    onSuccess: () => invalidateConfig(qc, app),
  });
}

/**
 * Replace the FULL configuration (PUT) — conditional (If-Match = revision). PUT
 * is a full replace, not a section patch: the body carries both sections (or
 * omits the ones being cleared). 412 on a stale revision.
 */
export function useReplaceAppConfig(app: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { config: AppConfigWrite; revision: number }) =>
      apiPut<AppConfig>(`apps/${app}/configuration`, input.config, await getToken(), {
        ifMatch: `"${input.revision}"`,
      }),
    onSuccess: () => invalidateConfig(qc, app),
  });
}

/** Delete the configuration (DELETE) — conditional (If-Match). Returns to the degraded default. */
export function useDeleteAppConfig(app: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { revision: number }) =>
      apiDelete(`apps/${app}/configuration`, await getToken(), {
        ifMatch: `"${input.revision}"`,
      }),
    onSuccess: () => invalidateConfig(qc, app),
  });
}
