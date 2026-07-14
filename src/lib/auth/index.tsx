"use client";

/*
 * Auth facade — single entry point. Feature code imports ONLY from "@/lib/auth".
 *
 * Adapter selection (NEXT_PUBLIC_AUTH_ADAPTER):
 *   "mock"            → simulated session (dev/tests; blocked in production)
 *   "ricardoqmd-auth" → reference adapter (@ricardoqmd/auth-nextjs, Keycloak 26)
 *
 * To plug a different OIDC client (keycloak-js, oidc-client-ts, Auth0 SPA SDK):
 * add one file under ./adapters implementing AuthApi, add its case below. That
 * is the whole extension surface — no plugin framework on purpose.
 */
import type { ReactNode } from "react";
import { MockAuthProvider, useMockAuth } from "./adapters/mock";
import { RicardoqmdAuthProvider, useRicardoqmdAuth } from "./adapters/ricardoqmd-auth";
import type { AuthApi } from "./types";

export type { AuthApi, SessionUser } from "./types";

const ADAPTER = process.env.NEXT_PUBLIC_AUTH_ADAPTER ?? "mock";

/**
 * Fail-fast (same philosophy as the PDP's startup validation, R013): the mock
 * adapter must be impossible to ship by accident. Browser-only check so static
 * prerendering at build time is unaffected.
 */
function assertMockAllowed() {
  if (
    typeof window !== "undefined" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_ALLOW_MOCK_AUTH !== "true"
  ) {
    throw new Error(
      "Mock auth adapter is not allowed in production. Set NEXT_PUBLIC_AUTH_ADAPTER " +
        "to a real adapter (or NEXT_PUBLIC_ALLOW_MOCK_AUTH=true for a demo build).",
    );
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  switch (ADAPTER) {
    case "ricardoqmd-auth":
      return <RicardoqmdAuthProvider>{children}</RicardoqmdAuthProvider>;
    case "mock":
      assertMockAllowed();
      return <MockAuthProvider>{children}</MockAuthProvider>;
    default:
      throw new Error(`Unknown auth adapter: "${ADAPTER}"`);
  }
}

// ADAPTER is constant for the app's lifetime, so selecting the hook at module
// level keeps the rules of hooks intact (stable call order across renders).
const useAdapterAuth = ADAPTER === "ricardoqmd-auth" ? useRicardoqmdAuth : useMockAuth;

export function useAuth(): AuthApi {
  return useAdapterAuth();
}
