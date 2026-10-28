#!/usr/bin/env bash
# Vercel build. Database migrations run only for production deployments, over the session-mode
# connection (DIRECT_URL); preview builds never touch the production database.
set -euo pipefail
pnpm prisma generate
if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${DIRECT_URL:-}" ]; then echo "DIRECT_URL is not set; refusing to deploy without migrating." >&2; exit 1; fi
  DATABASE_URL="$DIRECT_URL" pnpm prisma migrate deploy
fi
pnpm next build
