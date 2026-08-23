/*
 * Verifier tests. Every case asserts the OUTCOME — which reason came back, and
 * for the happy path which claims were mapped — never merely "it threw".
 *
 * The realm is real enough to be worth testing against: a generated RS256 key
 * pair, a discovery document and a JWKS endpoint served by MSW, and tokens
 * signed for real. Nothing here is stubbed at the jose boundary, so a token
 * that these tests accept is one the library actually verified.
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { projectAccess } from "@/lib/authz/project-access";
import { server } from "@/test/msw/server";
import { resetSigningKeyCache, TokenError, verifyCaller } from "./server";

const ISSUER = "https://idp.test/realms/pap-test";
const CLIENT_ID = "authz-admin";
const KID = "test-key-1";

const realmKeys = await generateKeyPair("RS256");
/** A second, unrelated key pair: the one an attacker would sign with. */
const foreignKeys = await generateKeyPair("RS256");

/** Serve <issuer>/.well-known/openid-configuration and the JWKS it points at. */
function serveRealm(publicJwk: Record<string, unknown>) {
  server.use(
    http.get(`${ISSUER}/.well-known/openid-configuration`, () =>
      HttpResponse.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/keys` }),
    ),
    http.get(`${ISSUER}/keys`, () =>
      HttpResponse.json({ keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] }),
    ),
  );
}

interface TokenOptions {
  issuer?: string;
  expiresIn?: string;
  signWith?: CryptoKey;
  claims?: Record<string, unknown>;
}

async function mintToken(options: TokenOptions = {}) {
  const { issuer = ISSUER, expiresIn = "5m", signWith = realmKeys.privateKey } = options;
  return new SignJWT({
    azp: CLIENT_ID,
    aud: "account",
    realm_access: { roles: ["pap-admin", "offline_access"] },
    authz_apps: ["records"],
    ...options.claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer)
    .setSubject("11111111-2222-3333-4444-555555555555")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signWith);
}

/** Minimal stand-in for the request: the verifier only reads one header. */
function requestWith(token: string | null) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null,
    },
  };
}

async function reasonOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "no-error";
  } catch (error) {
    return error instanceof TokenError ? error.reason : `unexpected: ${error}`;
  }
}

beforeEach(async () => {
  resetSigningKeyCache();
  process.env.PAP_OIDC_ISSUER = ISSUER;
  process.env.PAP_OIDC_CLIENT_ID = CLIENT_ID;
  // The claim-path variables stay UNSET for every test that does not name
  // them: the default path is what the current deployment exercises, so it is
  // what the bulk of this suite must exercise too. `delete`, not `= undefined`
  // — assigning undefined to process.env stores the STRING "undefined".
  delete process.env.PAP_OIDC_ROLES_CLAIM_PATH;
  delete process.env.PAP_OIDC_APPS_CLAIM_PATH;
  serveRealm(await exportJWK(realmKeys.publicKey));
});

describe("verifyCaller", () => {
  it("accepts a valid token and maps sub, realm roles and authz_apps", async () => {
    const user = await verifyCaller(requestWith(await mintToken()));

    expect(user).toEqual({
      sub: "11111111-2222-3333-4444-555555555555",
      roles: ["pap-admin", "offline_access"],
      apps: ["records"],
    });
  });

  it("rejects an expired token", async () => {
    // Signed in the past and already lapsed — the signature is perfectly good.
    const token = await mintToken({ expiresIn: "-1m" });

    expect(await reasonOf(verifyCaller(requestWith(token)))).toBe("invalid_token");
  });

  it("rejects a token from another issuer", async () => {
    const token = await mintToken({ issuer: "https://idp.test/realms/somewhere-else" });

    expect(await reasonOf(verifyCaller(requestWith(token)))).toBe("invalid_token");
  });

  it("rejects a token signed with a key the realm does not publish", async () => {
    // Same kid, same issuer, same claims — only the private key differs.
    const token = await mintToken({ signWith: foreignKeys.privateKey });

    expect(await reasonOf(verifyCaller(requestWith(token)))).toBe("invalid_token");
  });

  it("rejects a request with no Authorization header", async () => {
    expect(await reasonOf(verifyCaller(requestWith(null)))).toBe("missing_token");
  });

  it("rejects a token minted for a different client", async () => {
    const token = await mintToken({ claims: { azp: "some-other-app", aud: "account" } });

    expect(await reasonOf(verifyCaller(requestWith(token)))).toBe("wrong_client");
  });

  it("accepts a token whose audience names this client (audience-mapper deployments)", async () => {
    const token = await mintToken({
      claims: { azp: "some-other-app", aud: ["account", CLIENT_ID] },
    });

    await expect(verifyCaller(requestWith(token))).resolves.toMatchObject({
      sub: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("treats an absent authz_apps claim as no projects, never as all of them", async () => {
    const token = await mintToken({ claims: { authz_apps: undefined } });

    const user = await verifyCaller(requestWith(token));

    expect(user.apps).toEqual([]);
  });

  it("reports misconfiguration when the issuer is blank instead of letting the caller in", async () => {
    process.env.PAP_OIDC_ISSUER = "   ";

    expect(await reasonOf(verifyCaller(requestWith(await mintToken())))).toBe(
      "misconfigured",
    );
  });

  it("reports misconfiguration when the expected client id is missing", async () => {
    process.env.PAP_OIDC_CLIENT_ID = "";

    expect(await reasonOf(verifyCaller(requestWith(await mintToken())))).toBe(
      "misconfigured",
    );
  });
});

/*
 * The claim paths are configuration with Keycloak-shaped DEFAULTS, not a
 * contract. `realm_access.roles` is where Keycloak puts realm roles, not where
 * "roles" live — Auth0, Okta and Entra each put them somewhere else, and that
 * has to be a config change rather than a code change (the same rule the PDP
 * holds in its ADR-013).
 */
describe("configurable claim paths", () => {
  it("reproduces today's behaviour when neither variable is set", async () => {
    // The backwards-compatibility test: the current deployment sets neither.
    const user = await verifyCaller(requestWith(await mintToken()));

    expect(user.roles).toEqual(["pap-admin", "offline_access"]);
    expect(user.apps).toEqual(["records"]);
  });

  it("reads roles from a custom nested path", async () => {
    process.env.PAP_OIDC_ROLES_CLAIM_PATH = "authorization.claims.roles";
    const token = await mintToken({
      claims: {
        realm_access: { roles: ["ignore-me"] },
        authorization: { claims: { roles: ["pap-admin", "pap-editor"] } },
      },
    });

    const user = await verifyCaller(requestWith(token));

    // Three levels deep, and the Keycloak location is NOT consulted as a
    // fallback: a configured path is the only answer, right or wrong.
    expect(user.roles).toEqual(["pap-admin", "pap-editor"]);
  });

  it("cannot address a namespaced claim whose NAME contains dots", async () => {
    // Known limitation of a dot-path, pinned so it is a decision and not a
    // surprise: Auth0/Okta namespace custom claims as URLs, and every dot in
    // the URL reads as a separator. See pap-001b report, risk 1.
    process.env.PAP_OIDC_ROLES_CLAIM_PATH = "https://claims.example/roles";
    const token = await mintToken({
      claims: { "https://claims.example/roles": ["pap-admin"] },
    });

    const user = await verifyCaller(requestWith(token));

    // Empty, not a throw and not a wrong guess — it denies, loudly and safely.
    expect(user.roles).toEqual([]);
  });

  it("reads apps from a custom nested path", async () => {
    process.env.PAP_OIDC_APPS_CLAIM_PATH = "app_metadata.authorization.projects";
    const token = await mintToken({
      claims: {
        authz_apps: ["ignore-me"],
        app_metadata: { authorization: { projects: ["records", "billing"] } },
      },
    });

    const user = await verifyCaller(requestWith(token));

    expect(user.apps).toEqual(["records", "billing"]);
  });

  it("yields an empty list when the path resolves to a non-array", async () => {
    process.env.PAP_OIDC_ROLES_CLAIM_PATH = "scope";
    // A string, which is the shape a scope claim really has — the tempting
    // wrong answer is to wrap it; the right one is to refuse to guess.
    const token = await mintToken({ claims: { scope: "openid profile" } });

    const user = await verifyCaller(requestWith(token));

    expect(user.roles).toEqual([]);
  });

  it("yields an empty list when a segment traverses a non-object", async () => {
    process.env.PAP_OIDC_ROLES_CLAIM_PATH = "sub.roles.nested";

    const user = await verifyCaller(requestWith(await mintToken()));

    expect(user.roles).toEqual([]);
  });

  it("yields an empty list for a path that does not exist at all", async () => {
    process.env.PAP_OIDC_APPS_CLAIM_PATH = "nothing.here";

    const user = await verifyCaller(requestWith(await mintToken()));

    expect(user.apps).toEqual([]);
  });

  it("keeps only the strings when the array is mixed", async () => {
    const token = await mintToken({
      claims: { realm_access: { roles: ["pap-admin", 7, null, { nested: true }] } },
    });

    const user = await verifyCaller(requestWith(token));

    expect(user.roles).toEqual(["pap-admin"]);
  });

  it("treats a blank variable as the default, not as misconfiguration", async () => {
    process.env.PAP_OIDC_ROLES_CLAIM_PATH = "   ";

    const user = await verifyCaller(requestWith(await mintToken()));

    // Blank must not become a new failure mode, and must not become [] either.
    expect(user.roles).toEqual(["pap-admin", "offline_access"]);
  });

  it("gives a caller with no roles claim an empty list, which denies", async () => {
    const token = await mintToken({
      claims: { realm_access: undefined, authz_apps: undefined },
    });

    const user = await verifyCaller(requestWith(token));

    expect(user.roles).toEqual([]);
    // The consequence, asserted rather than assumed: verified is NOT
    // authorized. Without pap-admin and without apps, the policy refuses.
    await expect(projectAccess.can(user, "read", "records")).resolves.toBe(false);
  });

  it("denies an unlisted app when roles are missing but apps are not", async () => {
    // The narrower true statement: losing the roles claim costs the caller the
    // pap-admin shortcut, so access collapses to exactly their apps list.
    const token = await mintToken({ claims: { realm_access: undefined } });

    const user = await verifyCaller(requestWith(token));

    await expect(projectAccess.can(user, "write", "billing")).resolves.toBe(false);
    await expect(projectAccess.can(user, "write", "records")).resolves.toBe(true);
  });
});

/*
 * The cross-app faculty (pap-002 §2) — the question `can(user, action, app)` could
 * not ask, and which the literal `"*"` stood in for.
 */
describe("canReadAcrossApps", () => {
  const scoped = { sub: "s", roles: ["pap-author"], apps: ["records", "billing"] };
  const admin = { sub: "s", roles: ["pap-admin"], apps: [] };

  it("grants an administrator", async () => {
    await expect(projectAccess.canReadAcrossApps(admin)).resolves.toBe(true);
  });

  it("refuses a scoped caller however many apps they hold", async () => {
    // Holding every app that happens to exist today is not the same statement as
    // "may read the catalogue of what exists" — this is the second one.
    await expect(projectAccess.canReadAcrossApps(scoped)).resolves.toBe(false);
  });

  it("is not can(...) with a placeholder: an admin with no apps still passes", async () => {
    // Under the old `can(user, "read", "*")`, an admin passed only through the
    // role shortcut and everyone else was compared against a literal that is not
    // an app. The faculty is now the question, not a side effect of one.
    await expect(projectAccess.can(admin, "read", "records")).resolves.toBe(true);
    await expect(projectAccess.can(scoped, "read", "*")).resolves.toBe(false);
  });
});
