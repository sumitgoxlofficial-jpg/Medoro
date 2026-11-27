#!/usr/bin/env bash
# Uploads the Medoro Distribution tour to Supabase Storage, next to the pharmacy tour:
#   bucket  tour-videos (public)   project  medoro-production (dckgdlraaoxlnvdwluax)
#   videos  distribution/<slug>.mp4      (web copies in web/, ~0.7 Mbps like the pharmacy videos)
#   thumbs  distribution/thumbs/<slug>.png
#
# Run it yourself with the project's secret key (Supabase → Project Settings → API Keys → secret key):
#   SUPABASE_SECRET_KEY=sb_secret_... bash upload-to-supabase.sh
# It never prints the key. Re-running overwrites (x-upsert), so it is safe to repeat.
set -euo pipefail
: "${SUPABASE_SECRET_KEY:?Set SUPABASE_SECRET_KEY to the project's secret key}"
BASE="${SUPABASE_URL:-https://dckgdlraaoxlnvdwluax.supabase.co}/storage/v1/object/tour-videos/distribution"
cd "$(dirname "$0")"
auth=(-H "apikey: $SUPABASE_SECRET_KEY")
[[ "$SUPABASE_SECRET_KEY" == eyJ* ]] && auth+=(-H "Authorization: Bearer $SUPABASE_SECRET_KEY")  # legacy service_role JWT

up() { # file, object path, content type
  local code; code=$(curl -sS -o /tmp/medoro-upload.out -w '%{http_code}' -X POST "$BASE/$2" "${auth[@]}" \
    -H "Content-Type: $3" -H "x-upsert: true" -H "Cache-Control: max-age=31536000" --data-binary @"$1")
  if [[ "$code" == 200 ]]; then echo "ok   $2"; else echo "FAIL $2 ($code): $(cat /tmp/medoro-upload.out)"; return 1; fi
}

slug() { # Part_05_Product_Management -> part-05-product-management
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr '_' '-'
}

n=0
for f in web/Part_*.mp4; do up "$f" "$(slug "$(basename "$f" .mp4)").mp4" video/mp4; n=$((n+1)); done
for f in 28_Thumbnails/Part_*.png 28_Thumbnails/V*.png; do up "$f" "thumbs/$(slug "$(basename "$f" .png)").png" image/png; done
echo "Uploaded $n videos. Public URL: ${BASE/object\//object/public/}/part-01-introduction.mp4"
