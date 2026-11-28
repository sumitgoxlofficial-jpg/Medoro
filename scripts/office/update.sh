#!/usr/bin/env bash
# Updates the office server to the newest version of Medoro, safely:
#   1. fetch; stop if there is nothing new (unless --force)
#   2. build the new images while the current version keeps serving
#   3. back up the local database (if it is on this machine)
#   4. switch over (migrations run first), wait for /api/ready
#   5. if the new version doesn't become ready in 5 minutes: switch back to the previous images and code
# Every run is logged to logs/update.log. Schedule it nightly:
#   Ubuntu:  crontab -e  →  30 3 * * * cd /path/to/Medoro && bash scripts/office/update.sh >> logs/update.log 2>&1
#   Windows: Task Scheduler → daily 03:30 → "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/path/to/Medoro && bash scripts/office/update.sh >> logs/update.log 2>&1"
# Database migrations in Medoro are additive (old code keeps working with them), so a code rollback is safe; a
# migration is never undone automatically.
set -euo pipefail
cd "$(dirname "$0")/../.."
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1
ENV=.env.office
[ -f "$ENV" ] || { echo "No $ENV: run scripts/office/setup.sh first."; exit 1; }
get() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' || true; }
say() { echo "$(date '+%F %T') $*"; }
FILES=(-f deploy/office/compose.yml)
[ "$(get MEDORO_DB_MODE)" = local ] && FILES+=(-f deploy/office/compose.localdb.yml)
for f in $(get MEDORO_COMPOSE_EXTRA); do FILES+=(-f "$f"); done
PROFILES=(); for p in $(get MEDORO_PROFILES); do PROFILES+=(--profile "$p"); done
DC=(docker compose --env-file "$ENV" "${FILES[@]}" "${PROFILES[@]}")
BRANCH="$(get MEDORO_BRANCH)"; BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
ready() { "${DC[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; }
wait_ready() { for _ in $(seq 1 60); do ready && return 0; sleep 5; done; return 1; }

say "Checking for updates on $BRANCH…"
git fetch --quiet origin "$BRANCH"
OLD="$(git rev-parse HEAD)" NEW="$(git rev-parse "origin/$BRANCH")"
if [ "$OLD" = "$NEW" ] && [ "$FORCE" = 0 ]; then say "Up to date ($(git log -1 --format=%h))."; exit 0; fi
BAD=logs/bad-releases
if [ "$FORCE" = 0 ] && [ -f "$BAD" ] && grep -qx "$NEW" "$BAD"; then say "$(git log -1 --format=%h "$NEW") failed before and was rolled back; skipping it until a newer version arrives (or run with --force)."; exit 0; fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || { say "Local code changes found; not updating. Commit or discard them first."; exit 1; }

say "Updating $(git log -1 --format=%h "$OLD") → $(git log -1 --format=%h "$NEW")"
for img in app migrate; do docker image inspect "medoro/$img:office" >/dev/null 2>&1 && docker image tag "medoro/$img:office" "medoro/$img:previous"; done
git merge --ff-only --quiet "origin/$BRANCH" || { say "Can't fast-forward (diverged history); not updating."; exit 1; }
if ! "${DC[@]}" build app migrate; then
  say "Build failed: staying on the current version."
  git reset --hard --quiet "$OLD"
  for img in app migrate; do docker image inspect "medoro/$img:previous" >/dev/null 2>&1 && docker image tag "medoro/$img:previous" "medoro/$img:office"; done
  exit 1
fi
[ "$(get MEDORO_DB_MODE)" = local ] && { bash scripts/office/backup.sh || { say "Backup failed: not updating."; git reset --hard --quiet "$OLD"; exit 1; }; }
"${DC[@]}" up -d || say "Start reported an error (e.g. a migration failed); checking readiness…"
if wait_ready; then say "Updated and ready ($(git log -1 --format='%h %s'))."; docker image prune -f >/dev/null 2>&1 || true; exit 0; fi

say "New version did not become ready: rolling back to $(git log -1 --format=%h "$OLD")."
mkdir -p logs && echo "$NEW" >> logs/bad-releases
"${DC[@]}" logs app --tail 60 || true
git reset --hard --quiet "$OLD"
for img in app migrate; do docker image inspect "medoro/$img:previous" >/dev/null 2>&1 && docker image tag "medoro/$img:previous" "medoro/$img:office"; done
"${DC[@]}" up -d --force-recreate app || true
if wait_ready; then say "Rolled back; the previous version is serving."; else say "Rollback did not become ready either: check 'docker compose logs app'."; fi
exit 1
