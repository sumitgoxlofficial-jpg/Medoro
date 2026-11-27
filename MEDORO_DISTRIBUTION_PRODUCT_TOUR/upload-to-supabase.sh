#!/usr/bin/env bash
# Uploads the 26 Medoro Distribution tour videos to Supabase Storage, next to the pharmacy tour, under the names the
# website expects (src/data/dist-tour-videos.ts):  bucket tour-videos (public), project medoro-production.
#   web/distribution-part-NN-<title>.mp4  ->  tour-videos/distribution-part-NN-<title>.mp4
# (Thumbnails are served by the website from public/videos/thumbs; the bucket only takes MP4/WebM.)
#
# Run it yourself with the project's secret key (Supabase → Project Settings → API Keys → secret key):
#   SUPABASE_SECRET_KEY=sb_secret_... bash upload-to-supabase.sh
# The key is never printed. Re-running overwrites (x-upsert), so it is safe to repeat.
set -euo pipefail
: "${SUPABASE_SECRET_KEY:?Set SUPABASE_SECRET_KEY to the project's secret key}"
BASE="${SUPABASE_URL:-https://dckgdlraaoxlnvdwluax.supabase.co}/storage/v1/object/tour-videos"
cd "$(dirname "$0")/web"
auth=(-H "apikey: $SUPABASE_SECRET_KEY")
[[ "$SUPABASE_SECRET_KEY" == eyJ* ]] && auth+=(-H "Authorization: Bearer $SUPABASE_SECRET_KEY")  # legacy service_role JWT
ok=0; fail=0
for f in distribution-part-*.mp4; do
  code=$(curl -sS -o /tmp/medoro-upload.out -w '%{http_code}' -X POST "$BASE/$f" "${auth[@]}" \
    -H "Content-Type: video/mp4" -H "x-upsert: true" -H "Cache-Control: max-age=31536000" --data-binary @"$f")
  if [[ "$code" == 200 ]]; then echo "ok   $f"; ok=$((ok+1)); else echo "FAIL $f ($code): $(cat /tmp/medoro-upload.out)"; fail=$((fail+1)); fi
done
echo "Uploaded $ok, failed $fail. Check: ${BASE/object\//object/public/}/distribution-part-01-introduction-to-medoro-distribution.mp4"
