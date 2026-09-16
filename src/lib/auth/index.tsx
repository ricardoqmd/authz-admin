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
 *
 * WHY THIS ONE STAYS A BUILD-TIME FLAG. Everything else the browser needs and
 * that varies between deployments now comes from the runtime configuration
 * (@/lib/config/public), so one image can serve every environment. The adapter
 * is the deliberate exception, for two reasons that point the same way:
 *
 *   - A build that does not compile the mock in cannot be talked into using it.
 *     Making the choice configurable would turn "the mock cannot ship" from a
 *     property of the artifact into a property of a deployment's environment
 *     file — the weaker of the two, and the one nobody checks.
 *   - The selection is read once, at module scope, so the hook chosen below is
 *     stable for the lifetime of the app. A value that could change between
 *     renders cannot pick a hook.
 *
 * The adapter therefore distinguishes one KIND of build (the real one, and a
 * demo one) rather than one environment from another, and promoting a single
 * artifact across environments stays true.
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
