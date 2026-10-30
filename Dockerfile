# syntax=docker/dockerfile:1
# Medoro app image: multi-stage, Node 22 (Debian slim, so Prisma and argon2 use glibc builds), pnpm via corepack,
# Next.js standalone output. Build:  docker compose build   (or docker build -t medoro/app .)
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
# Optional package mirror for pnpm install (corepack itself fetches pnpm from registry.npmjs.org).
ARG NPM_CONFIG_REGISTRY
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN if [ -n "$NPM_CONFIG_REGISTRY" ]; then export npm_config_registry="$NPM_CONFIG_REGISTRY"; else unset NPM_CONFIG_REGISTRY; fi \
  && corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec prisma generate && NEXT_OUTPUT=standalone pnpm exec next build

# One-shot job: applies pending migrations, then exits. Uses DATABASE_MIGRATOR_URL when set (owner role).
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
USER node
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_MIGRATOR_URL:-$DATABASE_URL}\" exec node_modules/.bin/prisma migrate deploy"]

FROM base AS app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage && chown -R node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Migration folders, read by the startup check and /api/ready.
COPY --from=build --chown=node:node /app/prisma/migrations ./prisma/migrations
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
