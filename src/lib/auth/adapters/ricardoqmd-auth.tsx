"use client";

import { createKeycloakProvider } from "@ricardoqmd/auth-keycloak";
import {
  AuthProvider as CoreAuthProvider,
  useAuth as useCoreAuth,
} from "@ricardoqmd/auth-nextjs";
/*
 * Reference adapter: @ricardoqmd/auth-nextjs + @ricardoqmd/auth-keycloak
 * (Keycloak 26 via the auth-core XState machine).
 *
 * This file is the ONLY place that knows the library exists. Swapping the auth
 * stack (keycloak-js directly, oidc-client-ts, Auth0 SPA SDK, ...) means
 * writing a sibling adapter that implements AuthApi and registering it in
 * ../index.tsx — nothing outside the lib/auth boundary changes.
 *
 * Claim mapping lives HERE, per adapter:
 *   sub   ← token.sub (opaque Keycloak subject; never PII)
 *   roles ← normalized realm roles, filtered to the PAP's own ("pap-*")
 *   apps  ← "authz_apps" claim (group-populated in Keycloak; see ADR P001)
 */
import type { ReactNode } from "react";
import type { AuthApi, SessionUser } from "../types";

/**
 * Lazy module singleton. The library requires ONE provider per application,
 * created outside render; making it lazy (instead of a top-level const) means
 * merely importing this module — e.g. while running with the mock adapter —
 * never instantiates keycloak-js.
 */
let provider: ReturnType<typeof createKeycloakProvider> | null = null;

function getProvider() {
  provider ??= createKeycloakProvider({
    // Authorization Code + PKCE — the right flow for a public SPA client.
    pkceMethod: "S256",
    config: {
      url: requiredEnv("NEXT_PUBLIC_KEYCLOAK_URL", process.env.NEXT_PUBLIC_KEYCLOAK_URL),
      realm: requiredEnv(
        "NEXT_PUBLIC_KEYCLOAK_REALM",
        process.env.NEXT_PUBLIC_KEYCLOAK_REALM,
      ),
      clientId: requiredEnv(
        "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID",
        process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID,
      ),
    },
  });
  return provider;
}

/** Fail-fast config validation (same philosophy as the PDP's startup check). */
function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required when NEXT_PUBLIC_AUTH_ADAPTER=ricardoqmd-auth`);
  }
  return value;
}

export function RicardoqmdAuthProvider({ children }: { children: ReactNode }) {
  return <CoreAuthProvider provider={getProvider()}>{children}</CoreAuthProvider>;
}

/** Claims beyond the normalized set; the PAP only cares about authz_apps. */
interface PapIdpClaims {
  authz_apps?: string[];
}

export function useRicardoqmdAuth(): AuthApi {
  const auth = useCoreAuth();

  // acquireToken (auth-nextjs >= 1.1.0, ADR-016 of the auth monorepo) IS the
  // port's getToken: stable identity, safe in long-lived closures, refreshes
  // on demand (single shared refresh across concurrent callers), resolves null
  // when the session is over. It replaced this adapter's former ref-bridge
  // workaround — the friction report that motivated it lives in the project
  // notes (friccion-auth-core-gettoken.md).
  const getToken = auth.acquireToken;

  const user: SessionUser | null =
    auth.isAuthenticated && auth.user
      ? {
          sub: auth.user.sub ?? auth.user.preferred_username ?? "",
          name: auth.user.name ?? auth.user.preferred_username ?? "",
          roles: (auth.user.roles ?? []).filter((r) => r.startsWith("pap-")),
          apps: (auth.idpClaims as PapIdpClaims | null)?.authz_apps ?? [],
        }
      : null;

  return {
    user,
    isLoading: auth.isLoading,
    getToken,
    logout: auth.logout,
  };
}
