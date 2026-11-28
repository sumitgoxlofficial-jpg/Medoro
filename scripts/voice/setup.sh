#!/usr/bin/env bash
# Gives Naina (Medoro's AI HR assistant) her built-in voice from this Mac or Linux laptop/PC, which must stay on, like
# the WhatsApp connector. Medoro itself stays on Vercel. Run from the Medoro folder:
#
#   bash scripts/voice/setup.sh
#
# Same steps as scripts/voice/setup.ps1 (Windows). Safe to run again. Guide: docs/OFFICE_SERVER.md §10c
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=.env.voice PORT=8090

command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is needed (Mac: xcode-select --install; Linux: sudo apt install python3)."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start it and try again."; exit 1; }

# 1. The private key shared with Medoro on Vercel (made once, then kept).
token=$(grep -E '^AI_HR_SERVICE_TOKEN=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
if [ "${#token}" -lt 24 ]; then
  token=$(python3 -c 'import secrets, string; a = string.ascii_letters + string.digits; print("".join(secrets.choice(a) for _ in range(48)))')
  umask 077; printf 'AI_HR_SERVICE_TOKEN=%s\n' "$token" >"$ENV_FILE"
  echo "Made a new private key in $ENV_FILE (keep this file; don't share it)."
fi

# 2. Build and start (the first build takes a few minutes).
echo "Building and starting Naina's voice server..."
docker compose --env-file "$ENV_FILE" -f deploy/voice/compose.yml up -d --build

# 3. Wait until the voice is downloaded and answering.
ready=0
echo "Waiting for Naina's voice to download and load (up to 30 minutes the first time)..."
for i in $(seq 1 360); do
  h=$(curl -fsS -m 10 -H "Authorization: Bearer $token" "http://127.0.0.1:$PORT/health" 2>/dev/null || true)
  if echo "$h" | grep -q '"tts":{"ok":true' && echo "$h" | grep -q '"loaded":true'; then ready=1; break; fi
  [ $((i % 12)) = 0 ] && echo "  still loading... $((i / 12)) min (progress: docker logs medoro-voice-ai-service-1 --tail 5)"
  sleep 5
done
[ "$ready" = 1 ] || { echo "The voice didn't become ready. Logs: docker logs medoro-voice-ai-service-1 --tail 50"; exit 1; }

# 4. A test sentence you can play (the first one on a slow computer can take a few minutes).
curl -fsS -m 600 -H "Authorization: Bearer $token" -H 'content-type: application/json; charset=utf-8' \
  -d '{"text":"नमस्ते! मैं नैना हूँ, मेडोरो HR की AI असिस्टेंट।"}' "http://127.0.0.1:$PORT/tts" \
  | python3 -c 'import sys,json,base64; open("naina-test.wav","wb").write(base64.b64decode(json.load(sys.stdin)["audio_b64"]))'
echo "Naina's voice works. Listen: naina-test.wav (in the Medoro folder)."

# 5. Publish over HTTPS with Tailscale Funnel, on a port the WhatsApp connector isn't using (remembered in .env.voice).
url=""
if command -v tailscale >/dev/null; then
  fport=$(grep -E '^FUNNEL_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
  if [ -z "$fport" ]; then
    status=$(tailscale funnel status 2>&1 || true)
    for p in 8443 10000; do grep -qE ":$p\b" <<<"$status" || { fport=$p; break; }; done
    [ -n "$fport" ] && echo "FUNNEL_PORT=$fport" >>"$ENV_FILE"
  fi
  if [ -n "$fport" ]; then
    tailscale funnel --bg --https="$fport" "http://127.0.0.1:$PORT" >/dev/null
    dns=$(tailscale status --json | python3 -c 'import sys,json; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)
    [ -n "$dns" ] && url="https://$dns:$fport"
  else echo "Tailscale Funnel ports 8443 and 10000 are both in use: publish port $PORT yourself."; fi
fi

echo
echo "Done. Now in Vercel -> medoro -> Settings -> Environment Variables (Production), add:"
if [ -n "$url" ]; then echo "  AI_HR_SERVICE_URL   = $url"; else echo "  AI_HR_SERVICE_URL   = https://<this computer's Tailscale name>:8443   (run: tailscale funnel --bg --https=8443 http://127.0.0.1:$PORT)"; fi
echo "  AI_HR_SERVICE_TOKEN = $token   (mark it Sensitive)"
echo "Then Deployments -> Redeploy, and in HRMS -> AI HR Assistant -> Settings choose: Naina's voice = Medoro's own voice (Kokoro, self-hosted)."
