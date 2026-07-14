"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiPost } from "@/lib/pdp/client";
import type { PolicyDocument } from "@/lib/pdp/contracts";

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
    mutationFn: async (document: PolicyDocument) =>
      apiPost<PolicyCreated>("policies", document, await getToken()),
    onSuccess: () => {
      // The list is stale the moment the PDP accepts the write.
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });
}
