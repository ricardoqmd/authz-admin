# Deployment

## The property this packaging protects

The image is **built once** and the **same artifact** is promoted through every
environment it will run in. What reaches production is then the object that was
tested, as a matter of construction rather than of process discipline.

That property is worth stating because it is easy to lose by accident, and one
thing loses it: **an environment-specific value compiled into the bundle**. Next
replaces every `process.env.NEXT_PUBLIC_*` with a literal at build time, so a
browser-side setting read that way is frozen into the image, and an image with
one environment frozen into it can only serve that environment. Producing one
build per environment then yields N different artifacts, and "what runs in
production is what was tested" stops being true no matter how identical the
sources were.

So this application reads browser-side configuration **on the server, per
request**, and hands it to the client as props:

- `src/lib/config/public.ts` reads the environment;
- the root layout passes the result into `PublicConfigProvider`;
- client code calls `usePublicConfig()` for these values rather than
  `process.env` — with one exception, the two build flags below, which client
  code does read from `process.env` precisely because they are inlined.

## What is runtime and what is build-time

| setting | when | why |
|---|---|---|
| `PDP_*`, `PAP_OIDC_*` | runtime | server-side only; already read where they are used |
| `PAP_PUBLIC_KEYCLOAK_URL` / `_REALM` / `_CLIENT_ID` | runtime | differ per environment and the browser needs them |
| `PAP_DEFAULT_LOCALE` | runtime | resolved on the server; never needed in the bundle |
| `NEXT_PUBLIC_AUTH_ADAPTER` | **build** | see below |
| `NEXT_PUBLIC_ALLOW_MOCK_AUTH` | **build** | inlined like the adapter; a demo image needs **both** |

The adapter is the deliberate exception, and it is a choice rather than a
necessity. What it buys: the selection is inlined, so **no runtime path reaches
the adapter that was not selected**, and the guard in `src/lib/auth/index.tsx`
throws in the browser if one ever did.

What it does **not** buy, stated because an earlier version of this document
claimed otherwise: a production image still **contains** the mock. A grep of the
built client chunks finds it, because a bundler cannot prove that a branch on an
inlined constant is dead. The guarantee is *unreachable*, not *absent*. Making it
absent would need a build-time module alias — bundler configuration that
development and production do not necessarily share, which is a worse class of
defect than the one it would close.

The honest reason to keep it at build time is therefore the modest one: it does
not need to vary per environment, and making it vary would add one more setting
that can be wrong in a way that silently weakens authentication.

Nothing may be added to the `PAP_PUBLIC_*` family except values that are public
by nature: that object is serialised into the HTML the server sends.

## Startup

The process **refuses to start** when the image was built with the real adapter
and any of the three `PAP_PUBLIC_KEYCLOAK_*` values is missing: it logs which
ones and exits (`src/instrumentation.ts`). A configuration mistake that surfaced
only on the first render would otherwise leave a container that a scheduler
reports as healthy while every page it serves is a 500.

Setting one of the four names retired in this change logs a warning naming its
replacement, rather than being ignored in silence.

## Build

```bash
docker build -t pap:<git-commit> .
```

Tag with the immutable commit, not with a moving name: the tag is how the digest
is found again, and a tag that moves cannot identify what was promoted.

For a demo build with the simulated session, **both** flags are needed. The
adapter selects the mock; the second one satisfies the guard that otherwise
throws in the browser because the image is a production build:

```bash
docker build \
  --build-arg NEXT_PUBLIC_AUTH_ADAPTER=mock \
  --build-arg NEXT_PUBLIC_ALLOW_MOCK_AUTH=true \
  -t pap:demo .
```

## Run

```bash
docker run --rm -p 3000:3000 --env-file .env pap:<git-commit>
```

`.env.example` lists every variable with what it is for, and deliberately puts
every explanation on its own line: `--env-file` does **not** strip trailing
comments, so `NAME=   # explanation` is read as the literal value
`# explanation`.

The three `PAP_PUBLIC_KEYCLOAK_*` values are required when the image was built
with the real adapter; see **Startup** above for what happens when one is
missing.

## Health

`GET /api/health` answers `{"status":"ok"}` and nothing else. It is a **liveness**
probe: unauthenticated, because it runs before anyone has a token, and free of
detail, because a probe that reports versions or upstream state is a free
reconnaissance endpoint on a console that is otherwise closed.

It deliberately does **not** reach the PDP. A console that cannot reach the PDP
still has to come up and say so on screen; a probe that failed for that reason
would take the console down as well, turning one outage into two.

## Who authorises, and what the person's token must carry

Read this before announcing the console to anyone.

The console decides no authorization. The BFF verifies the caller's token and
forwards **that same token** to the PDP, which authorises the person per
application (service-policy ADR-033). A `403` from the PDP is shown as "you
cannot administer this application". Only the BFF's own `401` ends the session;
a `401` that comes from the PDP — a token the BFF accepted and the PDP did not,
typically one missing the PDP's audience — is shown as a deployment fault and
signs no one out.

So the token a person signs in with must be accepted by the PDP as well as by
the BFF. That is identity-provider configuration, outside this repository:

- **Issuer** — the PDP's configured realm (`QUARKUS_OIDC_AUTH_SERVER_URL`) must be
  the same issuer as `PAP_OIDC_ISSUER`.
- **Audience** — the token's `aud` must include the PDP's audience
  (`QUARKUS_OIDC_TOKEN_AUDIENCE`); the BFF separately requires this console's
  client in `azp` or `aud`.
- **Applications** — the claim the PDP's control-plane mapping names (stored in
  its reserved application's configuration) must list the applications the
  person administers. Point `PAP_OIDC_APPS_CLAIM_PATH` at the same claim: the BFF
  reads it only to fill the application selector.
- **Editing the control plane itself** — the PDP's reserved application is
  administered like any other, by the people whose applications claim lists its
  id. Two restrictions hold even for them: its configuration can be replaced
  but never created or deleted, and a replacement must still give the person
  making it the reserved application (the PDP refuses a change that would lock
  its author out).
- **Delegation role** — only when the tester's *subject* field names someone
  other than the signed-in person. Asking the PDP about another subject, in
  either of the tester's modes, needs its delegation marker on the token;
  leaving the field empty, or naming yourself, does not. Without the marker that
  request is refused, and the tester says why.

The selector is fed by `/api/session`, and the policy list takes its application
from the route; the cross-application view shows only what the PDP lets the
person read, so an empty page there means "nothing you may read".

## A gap this test suite does not close

The whole suite runs under the **mock** adapter, which is what lets it render
screens without an identity provider. The consequence is worth stating rather
than discovering: **no test exercises the real adapter's path.** That it
initialises, refreshes a token and maps claims correctly is reasoning, not
measurement. Closing it needs a test that mints real tokens against an identity
provider; until someone does, this paragraph is the declaration that it is open.
