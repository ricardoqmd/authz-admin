/*
 * Auth PORT of the PAP. The app consumes ONLY this contract (via "@/lib/auth");
 * WHO authenticates the user is an adapter concern (see ./adapters/).
 *
 * The PAP is OIDC-agnostic by design — the same stance the PDP takes with its
 * configurable role|scope markers: ship a reference adapter, let any consumer
 * plug their own (keycloak-js, oidc-client-ts, Auth0 SPA SDK, ...) by
 * implementing AuthApi and registering it in ../index.tsx.
 */

export interface SessionUser {
  /** Opaque subject from the IdP. Never PII. */
  sub: string;
  name: string;
  /**
   * Roles decoded in the browser, for DISPLAY only. Nothing authorises on them:
   * the PDP decides every request against the person's own token.
   */
  roles: string[];
  /**
   * Applications decoded in the browser. Claim mapping lives in each adapter.
   * Display only — the application selector is fed by the server's
   * `/api/session`, and even that list is advisory.
   */
  apps: string[];
}

export interface AuthApi {
  user: SessionUser | null;
  isLoading: boolean;
  /**
   * Fresh Bearer token for the PAP BFF (never sent to the PDP directly).
   * Async on purpose: real adapters refresh tokens; a static string goes stale.
   */
  getToken(): Promise<string | null>;
  logout(): void;
}
