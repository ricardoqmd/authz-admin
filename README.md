# PAP — Authz Admin (POC, phase 1: read-only)

Control plane UI for the [service-policy](https://github.com/ricardoqmd/service-policy)
PDP. This proof of concept covers the read surface (policy list, detail,
version history) with the structural seams already in place for phase 2
(writes, meta-policy enforcement, real Keycloak auth).

## Architecture in one paragraph

The browser never talks to the PDP. Every call goes through the **BFF**
(Next.js route handlers under `src/app/api/pdp/`), which is the only holder
of the PDP service credential and the single enforcement point
(`ProjectAccessPolicy` — hardcoded now, PDP `/v1/evaluate` meta-policy later).
UI components live behind the `src/ui` facade (owned, shadcn-style, tokens in
`src/ui/tokens.css` aligned with the future Stencil DS). Auth is a facade too
(`src/lib/auth`): a pluggable adapter port — mock for dev/tests,
`@ricardoqmd/auth-nextjs` as reference adapter, and any OIDC client
(keycloak-js, oidc-client-ts, ...) as a one-file adapter.

```
src/
├── app/            # routes only (thin wrappers) + BFF route handlers
├── lib/
│   ├── auth/       # auth facade (mock | keycloak)
│   ├── authz/      # ProjectAccessPolicy — the model-D enforcement seam
│   └── pdp/        # PDP contracts + server-side and browser-side clients
├── modules/
│   └── policies/   # feature: screens, queries, components
└── ui/             # UI facade — the only import point for components
```

## Run it

1. Start the PDP (in the service-policy repo, Docker running):

   ```bash
   ./mvnw quarkus:dev
   ```

2. Seed at least one policy (run steps 1-6 of `docs/http/lifecycle-walkthrough.http` in the service-policy repo).

3. Configure and start the PAP:

   ```bash
   cp .env.example .env        # paste a dev token into PDP_SERVICE_TOKEN
   pnpm install
   pnpm dev                    # http://localhost:3000
   ```

Tokens in dev: Quarkus Dev UI -> `http://localhost:8080/q/dev` -> OIDC.

## Typed client

Contracts in `src/lib/pdp/contracts.ts` are hand-written from the documented
REST contract. With the PDP running, regenerate full types from the live
OpenAPI (`pnpm generate:pdp-types`, requires `pnpm add -D openapi-typescript`).

## Phase 2 (planned)

- Writes with the ETag/If-Match/412 pattern (create, new version, activate,
  deactivate) and the reload-and-retry concurrency UX.
- Meta-policy enforcement: seed `pap-project-access` + swap
  `HardcodedProjectAccessPolicy` -> `EvaluateProjectAccessPolicy`.
- Real auth: JWKS validation in the
  BFF (resource-server style) + `client_credentials` service account. (The
  browser side is already wired: `ricardoqmd-auth` adapter.)
- Policy tester against `/v1/evaluate`.
