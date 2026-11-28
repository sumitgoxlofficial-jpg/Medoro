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
RUN node scripts/copy-sqlite.mjs && pnpm exec prisma generate && NEXT_OUTPUT=standalone pnpm exec next build

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
# ONNX runtime for the AI HR Assistant's in-browser speech, served from this server when Settings → "Speech model from:
# this server" (src/app/staff/hrms/ai-speech). The model files themselves come from scripts/office/fetch-speech-model.sh.
COPY --from=deps --chown=node:node /app/node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.* ./ai-speech/ort/
COPY --from=deps --chown=node:node /app/node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs /app/node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm ./ai-speech/ort/
# Migration folders, read by the startup check and /api/ready.
COPY --from=build --chown=node:node /app/prisma/migrations ./prisma/migrations
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
