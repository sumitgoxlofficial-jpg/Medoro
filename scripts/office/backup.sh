#!/usr/bin/env bash
# Daily database backup for the office server when the database runs on this machine (compose.localdb.yml).
# Keeps the last 14 days in ./backups (custom-format pg_dump). Copy that folder somewhere off this machine too
# (another disk, Google Drive), or a fire/theft/disk failure loses everything. With Supabase, Supabase holds the data.
#   bash scripts/office/backup.sh              # run now
#   crontab -e  →  30 2 * * * cd /path/to/Medoro && bash scripts/office/backup.sh >> backups/backup.log 2>&1
# Restore into an empty database:  docker compose … exec -T db pg_restore -U medoro -d medoro --clean --if-exists < backups/<file>.dump
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p backups
f="backups/medoro-$(date +%Y%m%d-%H%M%S).dump"
docker compose --env-file .env.office -f deploy/office/compose.yml -f deploy/office/compose.localdb.yml exec -T db pg_dump -U medoro -d medoro --format=custom > "$f"
[ -s "$f" ] || { echo "Backup failed: $f is empty"; rm -f "$f"; exit 1; }
find backups -name 'medoro-*.dump' -mtime +14 -delete
echo "Backup written: $f ($(du -h "$f" | cut -f1))"
