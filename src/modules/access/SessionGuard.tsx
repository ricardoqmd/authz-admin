"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { endsSession } from "./errors";

/**
 * Ends the session on the BFF's own `401` — and on nothing else.
 *
 * That `401` means the token is no longer one the BFF accepts, so every further
 * request would fail the same way; signing out is the only useful answer. A
 * `401` passed through from the engine does not end it (see `endsSession`): it
 * is a deployment fault, rendered where it happened. A
 * `403` is the opposite case: the session is fine and the engine refused one
 * thing, which each screen renders in place. Treating a refusal as a broken
 * session would sign a person out for looking at an application they do not
 * administer.
 *
 * Watches every query and every mutation, so no screen has to remember to.
 */
export function SessionGuard() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const ended = useRef(false);

  useEffect(() => {
    function onError(error: unknown) {
      if (ended.current || !endsSession(error)) return;
      ended.current = true;
      logout();
    }
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        onError(event.action.error);
      }
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        onError(event.action.error);
      }
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient, logout]);

  return null;
}
