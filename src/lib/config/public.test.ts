import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicConfig } from "./public";

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
   * The property this module exists for. A value read through `NEXT_PUBLIC_*`
   * is inlined by the bundler, so it cannot change between two runs of the same
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

  /** A secret must never be carried in the bag that is serialised into the HTML. */
  it("carries nothing but the public coordinates", () => {
    vi.stubEnv("PDP_CLIENT_SECRET", "must-not-travel");

    expect(JSON.stringify(readPublicConfig())).not.toContain("must-not-travel");
    expect(Object.keys(readPublicConfig())).toEqual(["keycloak"]);
  });
});
