#!/usr/bin/env bash
# Shop-LAN helper: creates a local certificate authority and an HTTPS certificate for this PC with openssl,
# writes .env with random secrets if it doesn't exist yet, and prints the addresses counters should open.
# Usage: bash scripts/lan-setup.sh [--host medoro.local] [--port 443] [--force-cert]
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="medoro.local"; PORT="443"; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --force-cert) FORCE=1; shift ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done
command -v openssl >/dev/null || { echo "openssl is required (apt install openssl / brew install openssl)." >&2; exit 1; }

DIR=certs; mkdir -p "$DIR"; chmod 700 "$DIR"
SHORT="$(hostname -s 2>/dev/null || hostname)"
# LAN IPv4 addresses, skipping Docker/VM bridges.
IPS="$(ip -4 -o addr show scope global 2>/dev/null | grep -vE ' (lo|docker[0-9]*|br-[0-9a-f]+|veth[^ ]*|virbr[0-9]*) ' | awk '{print $4}' | cut -d/ -f1 || true)"
[ -z "$IPS" ] && IPS="$( (hostname -I 2>/dev/null || true) | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^(127|172\.17)\.' || true)"
if [ -z "$IPS" ] && command -v ipconfig >/dev/null; then IPS="$(ipconfig getifaddr en0 2>/dev/null || true)"; fi

if [ ! -f "$DIR/medoro-local-ca.key" ]; then
  openssl genrsa -out "$DIR/medoro-local-ca.key" 3072 2>/dev/null
  openssl req -x509 -new -key "$DIR/medoro-local-ca.key" -sha256 -days 3650 -subj "/CN=Medoro Local CA ($SHORT)/O=Medoro shop LAN" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$DIR/medoro-local-ca.crt"
  chmod 600 "$DIR/medoro-local-ca.key"
  echo "Created local CA: $DIR/medoro-local-ca.crt"
fi

if [ ! -f "$DIR/medoro.crt" ] || [ "$FORCE" = 1 ]; then
  SAN="DNS:$HOST,DNS:$SHORT.local,DNS:$SHORT,DNS:localhost,IP:127.0.0.1"
  for ip in $IPS; do SAN="$SAN,IP:$ip"; done
  openssl genrsa -out "$DIR/medoro.key" 2048 2>/dev/null
  openssl req -new -key "$DIR/medoro.key" -subj "/CN=$HOST" -out "$DIR/medoro.csr"
  printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$SAN" > "$DIR/medoro.ext"
  # 825 days is the longest validity Apple devices accept for a server certificate.
  openssl x509 -req -in "$DIR/medoro.csr" -CA "$DIR/medoro-local-ca.crt" -CAkey "$DIR/medoro-local-ca.key" -CAcreateserial \
    -days 825 -sha256 -extfile "$DIR/medoro.ext" -out "$DIR/medoro.crt" 2>/dev/null
  rm -f "$DIR/medoro.csr" "$DIR/medoro.ext"
  chmod 600 "$DIR/medoro.key"
  echo "Created server certificate for: $SAN"
fi

rand() { openssl rand -hex "$1"; }
if [ ! -f .env ]; then
  ORIGIN="https://$HOST"; [ "$PORT" != 443 ] && ORIGIN="$ORIGIN:$PORT"
  cat > .env <<EOF
# Written by scripts/lan-setup.sh. Keep a copy of HOST_KEY offline: losing it makes stored secrets unreadable.
POSTGRES_PASSWORD=$(rand 24)
SESSION_SECRET=$(rand 32)
HOST_KEY=$(rand 32)
SETUP_TOKEN=$(rand 12)
APP_URL=$ORIGIN
MEDORO_HOST=$HOST
MEDORO_HTTPS_PORT=$PORT
DEPLOYMENT_MODE=lan
TRUST_PROXY=1
TZ=Asia/Kolkata
LOG_LEVEL=info
EOF
  chmod 600 .env
  echo "Wrote .env with new random secrets."
else
  echo ".env already exists; left unchanged."
fi

SUFFIX=""; [ "$PORT" != 443 ] && SUFFIX=":$PORT"
echo
echo "Start:   docker compose --profile https up -d --build"
echo "Open on this PC and on counters (after trusting the CA below):"
echo "  https://$HOST$SUFFIX"
echo "  https://$SHORT.local$SUFFIX"
for ip in $IPS; do echo "  https://$ip$SUFFIX"; done
echo
echo "Trust $DIR/medoro-local-ca.crt once on every counter (never share medoro-local-ca.key):"
echo "  Windows: certutil -addstore -f Root medoro-local-ca.crt   (admin prompt)"
echo "  Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate"
echo "  macOS/iOS: open the file, then mark it trusted (iOS: Settings > General > About > Certificate Trust Settings)"
echo "  Linux: sudo cp medoro-local-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates"
grep -q '^SETUP_TOKEN=' .env 2>/dev/null && echo && echo "First-run setup asks for SETUP_TOKEN from .env."
