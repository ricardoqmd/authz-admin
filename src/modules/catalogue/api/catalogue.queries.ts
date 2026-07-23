"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/pdp/client";
import type { CatalogueEntry, CatalogueList } from "@/lib/pdp/contracts";

/**
 * All catalogue entries of an app (R028). Unpaginated by contract — a vocabulary
 * is bounded by design. Sorted by resourceType upstream.
 */
export function useCatalogue(app: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["catalogue", app],
    queryFn: async () =>
      apiGet<CatalogueList>(`apps/${app}/action-catalogue`, await getToken()),
    enabled: !!app,
  });
}

/** One entry (+ revision as ETag) — the prefill source when editing its actions. */
export function useCatalogueEntry(app: string, resourceType: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["catalogue-entry", app, resourceType],
    queryFn: async () =>
      apiGet<CatalogueEntry>(
        `apps/${app}/action-catalogue/${resourceType}`,
        await getToken(),
      ),
    enabled: !!app && !!resourceType,
  });
}
