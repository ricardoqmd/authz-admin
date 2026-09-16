# syntax=docker/dockerfile:1

# Built once, promoted by digest. Nothing environment-specific may enter this
# image: the browser's configuration is read at request time on the server
# (src/lib/config/public.ts) and the server's own settings come from the
# container's environment. See docs/deployment.md.

# ---------- dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
# Only the manifests, so this layer is reused whenever sources change but
# dependencies do not.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The ONE value this image bakes, and it is not an environment: it selects
# which auth adapter is compiled in. A production image is built with the real
# adapter and therefore cannot be configured into using the mock. See
# src/lib/auth/index.tsx for why this one is deliberately not runtime.
ARG NEXT_PUBLIC_AUTH_ADAPTER=ricardoqmd-auth
ENV NEXT_PUBLIC_AUTH_ADAPTER=${NEXT_PUBLIC_AUTH_ADAPTER}
RUN pnpm build

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Unprivileged, with a fixed uid so a mounted volume's ownership is predictable.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# The standalone bundle carries its own minimal node_modules and server.js.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets and public files are NOT part of the standalone trace.
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Translations are loaded through a dynamic import whose specifier is built at
# runtime, so they are copied explicitly rather than relied on being traced.
COPY --from=build --chown=nextjs:nodejs /app/messages ./messages

USER nextjs
EXPOSE 3000

# Unauthenticated liveness only — it reports that the process answers, and
# nothing about the build, the configuration or the PDP behind it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
