"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiPost } from "@/lib/pdp/client";
import type { Decision, EvaluationRequest, SimulationRequest } from "@/lib/pdp/contracts";

/**
 * Policy tester (data plane): POST /v1/apps/{app}/evaluate. Evaluates against
 * the ACTIVE version — the same engine production uses. Answers "what would
 * production decide right now".
 */
export function useEvaluate(app: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (request: EvaluationRequest) =>
      apiPost<Decision>(`apps/${app}/evaluate`, request, await getToken()),
  });
}

/**
 * Policy tester (dry-run, R027): POST /v1/apps/{app}/policies:simulate. Runs a
 * case against a hypothetical policy document (a draft, or a saved version's
 * content) WITHOUT persisting anything. Control-plane / authoring op — the BFF
 * gates it as write (mirrors the PDP's admin marker), same as create/edit.
 */
export function useSimulate(app: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (input: SimulationRequest) =>
      apiPost<Decision>(`apps/${app}/policies:simulate`, input, await getToken()),
  });
}
