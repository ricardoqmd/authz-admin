# PAP — Authz Admin (POC)

Control plane UI for the [service-policy](https://github.com/ricardoqmd/service-policy)
PDP. This proof of concept covers the read surface (policy list, detail,
version history), the write surface (create, new version, activate/deactivate,
action catalogue and per-app configuration, all with the ETag/If-Match
concurrency pattern), the policy tester against `/v1/evaluate`, and
server-side verification of the caller's token in the BFF. Authorization is not
decided here: the PDP decides every request, for the person who signed in.

## Architecture in one paragraph

The browser never talks to the PDP. Every call goes through the **BFF**
(Next.js route handlers under `src/app/api/pdp/`), which verifies the caller's
token and forwards **that same token** to the PDP. The BFF holds no credential
of its own and makes no authorization decision: the PDP authorises the person
per application, for reads and writes alike (its ADR-033), and the BFF returns
the PDP's answer unchanged.
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
│   └── pdp/        # PDP contracts + server-side and browser-side clients
├── modules/
│   ├── access/     # session, refusal rendering, application selector
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
   cp .env.example .env        # PAP_OIDC_* must name the realm you sign in with
   pnpm install
   pnpm dev                    # http://localhost:3000
   ```

The PDP authorises the person who signs in, so their token must be one the PDP
accepts: see `docs/deployment.md` for what it must carry.

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
