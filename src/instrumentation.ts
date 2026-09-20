/*
 * Startup validation — the process refuses to start misconfigured.
 *
 * Why the check lives here and not in the code that reads the values: a
 * configuration mistake that is only discovered on the first render produces a
 * container that a scheduler reports as healthy while every page it serves is a
 * 500. Liveness answers "is the process up", and the process IS up; nothing in
 * an orchestrator is looking at the log. Refusing to start turns a silent, live,
 * useless container into a loud, dead one.
 *
 * This is the same stance the BFF already takes with PAP_OIDC_ISSUER — a blank
 * value raises `misconfigured` and the route answers 500 rather than falling
 * back to trusting the caller — moved one layer earlier, to where it can stop
 * the deployment instead of each request.
 *
 * `process.exit(1)` rather than a throw, deliberately: whether a rejected
 * `register()` terminates the process is the framework's business and could
 * change between versions, and a guard whose effect depends on that is not a
 * guard. Exiting states the intent in one line and behaves the same everywhere.
 */

/** Names that were renamed and now do nothing. Setting one is a silent no-op. */
const RETIRED: ReadonlyArray<readonly [retired: string, replacement: string]> = [
  ["NEXT_PUBLIC_KEYCLOAK_URL", "PAP_PUBLIC_KEYCLOAK_URL"],
  ["NEXT_PUBLIC_KEYCLOAK_REALM", "PAP_PUBLIC_KEYCLOAK_REALM"],
  ["NEXT_PUBLIC_KEYCLOAK_CLIENT_ID", "PAP_PUBLIC_KEYCLOAK_CLIENT_ID"],
  ["NEXT_PUBLIC_DEFAULT_LOCALE", "PAP_DEFAULT_LOCALE"],
];

/**
 * Names that were removed outright, with nothing to rename them to: the BFF's
 * own credential toward the PDP, and the roles claim only the removed
 * console-side gate read. The BFF now forwards the signed-in person's token, so
 * a value left here — a client secret among them — is kept in the environment
 * for nothing, and nothing else would say so.
 */
const REMOVED = [
  "PDP_TOKEN_URL",
  "PDP_CLIENT_ID",
  "PDP_CLIENT_SECRET",
  "PDP_SERVICE_TOKEN",
  "PAP_OIDC_ROLES_CLAIM_PATH",
];

/**
 * Required only when the build compiled the adapter that needs them. A demo
 * image built with the mock has no IdP to point at, and an unconditional check
 * would stop it from starting at all.
 */
const KEYCLOAK_COORDINATES = [
  "PAP_PUBLIC_KEYCLOAK_URL",
  "PAP_PUBLIC_KEYCLOAK_REALM",
  "PAP_PUBLIC_KEYCLOAK_CLIENT_ID",
];

/** Read at build time by definition — this is the value the bundle was built with. */
const ADAPTER = process.env.NEXT_PUBLIC_AUTH_ADAPTER ?? "mock";

export async function register() {
  // The edge runtime imports this module too, and it has neither the same
  // environment nor a process to exit.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  for (const [retired, replacement] of RETIRED) {
    if (process.env[retired]) {
      console.warn(
        `[pap] ${retired} is set and is no longer read. It was renamed to ` +
          `${replacement}; the value you set is being ignored.`,
      );
    }
  }

  for (const removed of REMOVED) {
    if (process.env[removed]) {
      console.warn(
        `[pap] ${removed} is set and is no longer read: the BFF forwards the ` +
          `signed-in person's token to the PDP and holds no credential of its ` +
          `own. Remove it from the environment.`,
      );
    }
  }

  if (ADAPTER !== "ricardoqmd-auth") return;

  const missing = KEYCLOAK_COORDINATES.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `[pap] refusing to start: this image was built with the ` +
        `"${ADAPTER}" auth adapter, which cannot sign anyone in without ` +
        `${missing.join(", ")}. Set ${missing.length > 1 ? "them" : "it"} in ` +
        `the container's environment. See docs/deployment.md.`,
    );
    process.exit(1);
  }
}
