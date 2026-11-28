#!/usr/bin/env bash
# Sets up Medoro on an office computer/server with Docker (Linux, or Windows with Docker Desktop in Git Bash / WSL).
#
#   bash scripts/office/setup.sh --db supabase --url https://medoro.in    # keep the current Supabase data (moving from Vercel)
#   bash scripts/office/setup.sh --db local    --url https://medoro.in    # brand-new install, database on this machine
#   add --no-tunnel to skip Cloudflare Tunnel (office network only), --ai for the optional server voice,
#   --no-build to start already-built images (a restart).
#
# Writes .env.office (asks for what it can't generate), builds, starts, and checks the app. Safe to run again: an
# existing .env.office is kept and only missing values are asked for. Guide: docs/OFFICE_SERVER.md
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="" URL="" TUNNEL=1 AI=0 BUILD=--build
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;; --url) URL="$2"; shift 2 ;;
    --no-tunnel) TUNNEL=0; shift ;; --ai) AI=1; shift ;; --no-build) BUILD=""; shift ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;; *) echo "Unknown option $1"; exit 1 ;;
  esac
done
ENV=.env.office
command -v docker >/dev/null || { echo "Docker is not installed. See docs/OFFICE_SERVER.md, step 2."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is needed (docker compose …)."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start Docker (Desktop) and try again."; exit 1; }

get() { [ -f "$ENV" ] && grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' || true; }
set_kv() { # set or replace KEY=value in .env.office
  local k="$1" v="$2"
  touch "$ENV"; chmod 600 "$ENV" 2>/dev/null || true
  if grep -qE "^$k=" "$ENV"; then grep -vE "^$k=" "$ENV" > "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; fi
  printf '%s=%s\n' "$k" "$v" >> "$ENV"
}
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }
ask() { # ask KEY "question" [secret]
  local cur; cur="$(get "$1")"; [ -n "$cur" ] && return 0
  local v=""; if [ -t 0 ]; then if [ "${3:-}" = secret ]; then read -rsp "$2: " v; echo; else read -rp "$2: " v; fi; fi
  [ -n "$v" ] || { echo "Missing $1. Add it to $ENV and run again."; exit 1; }
  set_kv "$1" "$v"
}

[ -n "$DB" ] || DB="$(get MEDORO_DB_MODE)"
[ "$DB" = supabase ] || [ "$DB" = local ] || { echo "Choose --db supabase (keep current data) or --db local (new install)."; exit 1; }
set_kv MEDORO_DB_MODE "$DB"
[ -n "$URL" ] && set_kv APP_URL "${URL%/}"
ask APP_URL "Public address, e.g. https://medoro.in"
[ -n "$(get NODE_ENV)" ] || set_kv NODE_ENV production
[ -n "$(get TZ)" ] || set_kv TZ Asia/Kolkata
[ -n "$(get DEPLOYMENT_MODE)" ] || set_kv DEPLOYMENT_MODE cloud
[ -n "$(get STORAGE_DIR)" ] || true

if [ "$DB" = supabase ]; then
  echo "Keeping the Supabase database. Copy these from Vercel → Project → Settings → Environment Variables:"
  ask DATABASE_URL "DATABASE_URL (Supabase pooler URL)" secret
  ask DIRECT_URL "DIRECT_URL (Supabase direct URL)" secret
  [ -n "$(get DATABASE_MIGRATOR_URL)" ] || set_kv DATABASE_MIGRATOR_URL "$(get DIRECT_URL)"
  # Existing encrypted data needs the existing keys: never generate these here.
  ask SESSION_SECRET "SESSION_SECRET (same as Vercel)" secret
  ask HOST_KEY "HOST_KEY (same as Vercel; it decrypts bank, KYC, chat and transcripts)" secret
  ask CRON_SECRET "CRON_SECRET (same as Vercel)" secret
else
  [ -n "$(get POSTGRES_PASSWORD)" ] || set_kv POSTGRES_PASSWORD "$(rand 32)"
  [ -n "$(get SESSION_SECRET)" ] || set_kv SESSION_SECRET "$(rand 48)"
  [ -n "$(get HOST_KEY)" ] || { set_kv HOST_KEY "$(rand 48)"; echo "Generated a new HOST_KEY. Keep a copy of .env.office somewhere safe: without it encrypted data can't be read."; }
  [ -n "$(get CRON_SECRET)" ] || set_kv CRON_SECRET "$(rand 40)"
fi

FILES=(-f deploy/office/compose.yml)
[ "$DB" = local ] && FILES+=(-f deploy/office/compose.localdb.yml)
PROFILES=()
if [ "$TUNNEL" = 1 ]; then
  set_kv TRUST_PROXY cloudflare
  ask CLOUDFLARE_TUNNEL_TOKEN "Cloudflare Tunnel token (Zero Trust → Networks → Tunnels)" secret
  PROFILES+=(--profile tunnel)
fi
if [ "$AI" = 1 ]; then
  [ -n "$(get AI_HR_SERVICE_TOKEN)" ] || set_kv AI_HR_SERVICE_TOKEN "$(rand 48)"
  set_kv AI_HR_SERVICE_URL http://ai-service:8090
  PROFILES+=(--profile ai)
fi

echo "Building and starting (the first build takes several minutes)…"
docker compose --env-file "$ENV" "${FILES[@]}" "${PROFILES[@]}" up -d $BUILD
echo "Waiting for the app…"
for i in $(seq 1 60); do
  if docker compose --env-file "$ENV" "${FILES[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "Medoro is running. Local check: http://localhost:$(get MEDORO_HTTP_PORT | grep . || echo 3000)/api/ready"
    [ "$TUNNEL" = 1 ] && echo "Public address (once the tunnel's public hostname points to http://app:3000): $(get APP_URL)"
    exit 0
  fi
  sleep 5
done
echo "The app didn't become ready. Logs: docker compose ${FILES[*]} logs app --tail 100"
exit 1
