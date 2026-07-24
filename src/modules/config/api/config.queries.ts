"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/pdp/client";
import type { AppConfig } from "@/lib/pdp/contracts";

/**
 * The per-app configuration singleton (R029). A 404 (APP_CONFIG_NOT_FOUND) is a
 * NORMAL state — the app simply has no configuration and degrades to token-only
 * attributes — so retries are disabled: the screen renders the "declare it"
 * affordance immediately instead of waiting out backoff.
 */
export function useAppConfig(app: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["app-config", app],
    queryFn: async () => apiGet<AppConfig>(`apps/${app}/configuration`, await getToken()),
    enabled: !!app,
    retry: false,
  });
}
