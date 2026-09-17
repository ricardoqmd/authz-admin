import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicConfig } from "./public";

/**
 * Every server-only variable this application reads, each seeded with a sentinel
 * no other value can collide with. The bag is serialised into the HTML, so the
 * property under test is that none of these can reach it — asserted against the
 * whole object and against its serialised form, not against today's key names.
 */
const SERVER_ONLY = [
  "PDP_BASE_URL",
  "PDP_TOKEN_URL",
  "PDP_CLIENT_ID",
  "PDP_CLIENT_SECRET",
  "PDP_SERVICE_TOKEN",
  "PDP_TIMEOUT_MS",
  "PAP_OIDC_ISSUER",
  "PAP_OIDC_CLIENT_ID",
  "PAP_OIDC_ROLES_CLAIM_PATH",
  "PAP_OIDC_APPS_CLAIM_PATH",
] as const;

function sentinel(name: string) {
  return `SENTINEL-${name}-b41f9c`;
}

describe("readPublicConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the Keycloak coordinates from the runtime environment", () => {
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_URL", "https://idp.example.com");
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_REALM", "example");
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_CLIENT_ID", "authz-admin");

    expect(readPublicConfig().keycloak).toEqual({
      url: "https://idp.example.com",
      realm: "example",
      clientId: "authz-admin",
    });
  });

  it("does not invent a default for a coordinate that is not set", () => {
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_URL", "");
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_REALM", "");
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_CLIENT_ID", "");

    const { keycloak } = readPublicConfig();

    expect(keycloak.url).toBeFalsy();
    expect(keycloak.realm).toBeFalsy();
    expect(keycloak.clientId).toBeFalsy();
  });

  /**
   * The property this module exists for. A value read through `NEXT_PUBLIC_*` is
   * inlined by the bundler, so it cannot change between two runs of the same
   * image; a value read here can. The test asserts the observable half of that:
   * two calls with different environments return different results, which is
   * false for anything the build froze.
   */
  it("reflects a change in the environment between calls", () => {
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_REALM", "staging");
    expect(readPublicConfig().keycloak.realm).toBe("staging");

    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_REALM", "production");
    expect(readPublicConfig().keycloak.realm).toBe("production");
  });

  /**
   * The shape, fixed exactly and deeply.
   *
   * An earlier version of this file checked only the top-level key names, and a
   * measurement found that too weak: spreading the server-only variables into
   * the object, or widening the type with one optional field carrying a token,
   * passed both this suite and the type-checker. Fixing the whole shape is what
   * makes either of those turn red.
   */
  it("has exactly the published shape, and nothing else at any depth", () => {
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_URL", "https://idp.example.com");
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_REALM", "example");
    vi.stubEnv("PAP_PUBLIC_KEYCLOAK_CLIENT_ID", "authz-admin");
    for (const name of SERVER_ONLY) vi.stubEnv(name, sentinel(name));

    expect(readPublicConfig()).toStrictEqual({
      keycloak: {
        url: "https://idp.example.com",
        realm: "example",
        clientId: "authz-admin",
      },
    });
  });

  /**
   * The same property stated against the serialised form, because that — not the
   * object graph — is what the server sends to the browser. It also survives a
   * refactor that nests the bag differently.
   */
  it("carries no server-only value once serialised, whatever the shape", () => {
    for (const name of SERVER_ONLY) vi.stubEnv(name, sentinel(name));

    const serialised = JSON.stringify(readPublicConfig());

    for (const name of SERVER_ONLY) {
      expect(serialised).not.toContain(sentinel(name));
    }
    // The positive control: a negative measurement proves nothing until the
    // instrument is shown capable of a positive. If the sentinels never reached
    // the environment, the loop above would pass against an empty world.
    expect(process.env.PDP_CLIENT_SECRET).toBe(sentinel("PDP_CLIENT_SECRET"));
  });
});
