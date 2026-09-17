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
 * is the deliberate exception, and it is a CHOICE, not a necessity — the
 * reasoning is worth stating exactly, because an earlier version of this comment
 * overstated it and someone would have relied on the overstatement.
 *
 * What is true: the selection is inlined by the bundler, so no runtime path
 * reaches the adapter that was not selected. Add the guard below and a mock
 * build cannot be served as a production one by accident.
 *
 * What is NOT true, and was claimed here before: that a production image does
 * not CONTAIN the mock. It does. A grep of the built client chunks finds this
 * module's strings, because a bundler cannot prove that a branch on an inlined
 * constant is dead. The guarantee is UNREACHABLE, not ABSENT, and the two are
 * different promises. Making it absent needs a build-time module alias, which is
 * bundler configuration that dev and production do not necessarily share — a
 * worse class of defect than the one it would close.
 *
 * So the honest reason to keep it at build time is the modest one: this value
 * does not need to vary per environment, and making it vary would add one more
 * setting that can be wrong in a way that silently weakens authentication.
 * Revisit if someone outside this team ever builds the image.
 *
 * (The module-scope read also keeps the hook chosen below stable, which is
 * convenient — but it is a consequence of the decision, not a reason for it: a
 * runtime adapter could keep hooks stable by other means.)
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
