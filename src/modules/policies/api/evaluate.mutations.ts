"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiPost } from "@/lib/pdp/client";
import type { Decision, EvaluationRequest } from "@/lib/pdp/contracts";

/**
 * Policy tester (data plane): POST /v1/apps/{app}/evaluate. Evaluates against
 * the ACTIVE version — the same engine production uses. Dry-run against an
 * explicit inactive version is a future PDP capability (proposed R027).
 */
export function useEvaluate(app: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (request: EvaluationRequest) =>
      apiPost<Decision>(`apps/${app}/evaluate`, request, await getToken()),
  });
}
