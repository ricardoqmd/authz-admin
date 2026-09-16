# PAP — Authz Admin (POC)

Control plane UI for the [service-policy](https://github.com/ricardoqmd/service-policy)
PDP. This proof of concept covers the read surface (policy list, detail,
version history), the write surface (create, new version, activate/deactivate,
action catalogue and per-app configuration, all with the ETag/If-Match
concurrency pattern), the policy tester against `/v1/evaluate`, and
server-side verification of the caller's token in the BFF. One seam is still a
stand-in for its target implementation: project-access enforcement runs on
`HardcodedProjectAccessPolicy` rather than the PDP meta-policy.

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

## Deploy

The image is built once and the same artifact is promoted through every
environment, so nothing environment-specific is compiled into the bundle:
browser-side configuration is read on the server per request and passed down as
props. `docs/deployment.md` has the build and run commands, the full list of
what is runtime and what is build-time, and what a deployment today does and
does not serve.

```bash
docker build -t pap:$(git rev-parse --short HEAD) .
docker run --rm -p 3000:3000 --env-file .env pap:$(git rev-parse --short HEAD)
```

## Typed client

Contracts in `src/lib/pdp/contracts.ts` are hand-written from the documented
REST contract. With the PDP running, regenerate full types from the live
OpenAPI (`pnpm generate:pdp-types`, requires `pnpm add -D openapi-typescript`).

## Planned

- Meta-policy enforcement: seed `pap-project-access` + swap
  `HardcodedProjectAccessPolicy` -> `EvaluateProjectAccessPolicy`.
