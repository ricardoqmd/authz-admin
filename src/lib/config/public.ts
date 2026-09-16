/*
 * Public runtime configuration.
 *
 * Read on the SERVER, at request time, and handed to the browser as props —
 * never inlined at build time. That distinction is the whole point of this
 * module. Next replaces every `process.env.NEXT_PUBLIC_*` with a literal while
 * the bundle is being built, so a value read that way is frozen into the image,
 * and an image with an environment frozen into it can only serve that one
 * environment.
 *
 * This deployment builds an image once and promotes the same artifact through
 * its environments, which is what makes "what runs in production is what was
 * tested" a fact rather than a hope. A baked environment value breaks exactly
 * that: it forces a rebuild per environment, and a rebuild is a different
 * artifact no matter how identical the source.
 *
 * The rule that follows:
 *
 *   - differs between ENVIRONMENTS and the browser needs it  → read here;
 *   - differs between BUILDS (which auth adapter is compiled in) → stays a
 *     build-time flag, deliberately (see ../auth/index.tsx).
 *
 * Only values that are public by nature belong in this object. It is
 * serialised into the HTML the server sends, so a secret placed here is a
 * secret published. Server-only settings — the PDP base URL, the BFF's own
 * credential, the issuer it verifies against — are read where they are used
 * and never travel through this bag.
 */

/**
 * Browser-side OIDC coordinates. Public by nature: they end up in the URL the
 * browser is redirected to.
 */
export interface KeycloakPublicConfig {
  url: string;
  realm: string;
  clientId: string;
}

export interface PublicConfig {
  /**
   * Partial on purpose. A deployment running the mock adapter has none of
   * these, and that is not an error; the adapter that needs them is the one
   * that refuses to start without them, with a message naming the variable.
   */
  keycloak: Partial<KeycloakPublicConfig>;
}

/**
 * Reads the environment on every call rather than caching at module load, so
 * the value cannot be captured before the process has its configuration.
 */
export function readPublicConfig(): PublicConfig {
  return {
    keycloak: {
      url: process.env.PAP_PUBLIC_KEYCLOAK_URL,
      realm: process.env.PAP_PUBLIC_KEYCLOAK_REALM,
      clientId: process.env.PAP_PUBLIC_KEYCLOAK_CLIENT_ID,
    },
  };
}
