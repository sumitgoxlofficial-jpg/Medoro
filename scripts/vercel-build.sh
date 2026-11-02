#!/usr/bin/env bash
# Vercel build. Database migrations run for production deployments, over the session-mode connection
# (DIRECT_URL). Preview deployments use their own database (Preview-only DATABASE_URL / DIRECT_URL in Vercel) and
# migrate it only when it is marked as the preview database with PREVIEW_DATABASE=1, so a preview can never migrate
# the production database by mistake. Without it, preview builds touch no database.
set -euo pipefail
pnpm prisma generate
if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${DIRECT_URL:-}" ]; then echo "DIRECT_URL is not set; refusing to deploy without migrating." >&2; exit 1; fi
  DATABASE_URL="$DIRECT_URL" pnpm prisma migrate deploy
elif [ "${VERCEL_ENV:-}" = "preview" ] && [ "${PREVIEW_DATABASE:-}" = "1" ] && [ -n "${DIRECT_URL:-}" ]; then
  echo "Migrating the preview database."
  DATABASE_URL="$DIRECT_URL" pnpm prisma migrate deploy
fi
node scripts/copy-sqlite.mjs
pnpm next build
