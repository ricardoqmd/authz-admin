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
 *
 * The IdP coordinates come from the RUNTIME configuration, not from the build
 * (see @/lib/config/public). They are the values that differ between one
 * deployment of this image and the next, and an image that carries them baked
 * in is an image that can only ever serve one of them.
 */
import type { ReactNode } from "react";
import { usePublicConfig } from "@/lib/config/context";
import type { KeycloakPublicConfig } from "@/lib/config/public";
import type { AuthApi, SessionUser } from "../types";

/**
 * The library requires ONE provider per application, created outside render.
 * Keying this cache by the coordinates preserves that — the same configuration
 * always yields the same instance, however many times it is asked for — while
 * allowing the coordinates themselves to be decided at runtime. Merely
 * importing this module, e.g. while running with the mock adapter, still
 * instantiates nothing.
 *
 * The cache is why the component below needs no `useMemo`: memoising a lookup
 * that is already idempotent buys nothing and only adds a dependency list to
 * keep correct.
 */
const providers = new Map<string, ReturnType<typeof createKeycloakProvider>>();

function getProvider(config: KeycloakPublicConfig) {
  const key = `${config.url}|${config.realm}|${config.clientId}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = createKeycloakProvider({
      // Authorization Code + PKCE — the right flow for a public SPA client.
      pkceMethod: "S256",
      config: {
        url: config.url,
        realm: config.realm,
        clientId: config.clientId,
      },
    });
    providers.set(key, provider);
  }
  return provider;
}

/** Fail-fast config validation (same philosophy as the PDP's startup check). */
function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required when NEXT_PUBLIC_AUTH_ADAPTER=ricardoqmd-auth`);
  }
  return value;
}

function required(keycloak: Partial<KeycloakPublicConfig>): KeycloakPublicConfig {
  return {
    url: requiredEnv("PAP_PUBLIC_KEYCLOAK_URL", keycloak.url),
    realm: requiredEnv("PAP_PUBLIC_KEYCLOAK_REALM", keycloak.realm),
    clientId: requiredEnv("PAP_PUBLIC_KEYCLOAK_CLIENT_ID", keycloak.clientId),
  };
}

export function RicardoqmdAuthProvider({ children }: { children: ReactNode }) {
  const { keycloak } = usePublicConfig();
  const provider = getProvider(required(keycloak));

  return <CoreAuthProvider provider={provider}>{children}</CoreAuthProvider>;
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
