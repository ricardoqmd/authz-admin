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
- client code calls `usePublicConfig()` and never `process.env`.

## What is runtime and what is build-time

| setting | when | why |
|---|---|---|
| `PDP_*`, `PAP_OIDC_*` | runtime | server-side only; already read where they are used |
| `PAP_PUBLIC_KEYCLOAK_URL` / `_REALM` / `_CLIENT_ID` | runtime | differ per environment and the browser needs them |
| `PAP_DEFAULT_LOCALE` | runtime | resolved on the server; never needed in the bundle |
| `NEXT_PUBLIC_AUTH_ADAPTER` | **build** | see below |

The adapter is the deliberate exception. It selects which implementation is
**compiled in**, so a production image simply does not contain the mock and
cannot be configured into using it. Making it runtime would move "the mock
cannot ship" from a property of the artifact to a line in a deployment's
environment file — the weaker of the two, and the one nobody re-reads. It also
distinguishes one *kind* of build from another rather than one environment from
another, so promoting a single artifact across environments stays true.

Nothing may be added to the `PAP_PUBLIC_*` family except values that are public
by nature: that object is serialised into the HTML the server sends.

## Build

```bash
docker build -t pap:<git-commit> .
```

Tag with the immutable commit, not with a moving name: the tag is how the digest
is found again, and a tag that moves cannot identify what was promoted.

For a demo build with the simulated session:

```bash
docker build --build-arg NEXT_PUBLIC_AUTH_ADAPTER=mock -t pap:demo .
```

## Run

```bash
docker run --rm -p 3000:3000 --env-file .env pap:<git-commit>
```

`.env.example` lists every variable with what it is for. The three
`PAP_PUBLIC_KEYCLOAK_*` values are required when the image was built with the
real adapter; the adapter refuses to start without them and names the one that
is missing rather than degrading to a broken login.

## Health

`GET /api/health` answers `{"status":"ok"}` and nothing else. It is a **liveness**
probe: unauthenticated, because it runs before anyone has a token, and free of
detail, because a probe that reports versions or upstream state is a free
reconnaissance endpoint on a console that is otherwise closed.

It deliberately does **not** reach the PDP. A console that cannot reach the PDP
still has to come up and say so on screen; a probe that failed for that reason
would take the console down as well, turning one outage into two.

## What a deployment today serves, and what it does not

Read this before announcing the console to anyone.

Every read is authorised against the application in its own route, and the
cross-application listing answers `403` to a caller without the platform role.
Nothing in the UI consumes `/api/session` yet, and the policy list still queries
the cross-application collection.

**A deployment today therefore serves platform administrators.** Per-application
administrators can be authorised by the API but will not get a usable screen
until the listing takes its application from the route. That is acceptable while
the console is operated by the platform team; it is not acceptable to announce to
per-application administrators.
