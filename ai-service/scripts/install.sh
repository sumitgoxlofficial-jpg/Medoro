#!/usr/bin/env bash
# Installs (or updates) the Medoro AI service on Ubuntu 22.04/24.04, 8 GB RAM, CPU only. Run as root, from ai-service/.
# Re-running is safe: it reuses the virtualenv, the model cache, the token and the Nginx site. Read it before running it.
#   bash scripts/install.sh                 # full: Kokoro voice + Faster-Whisper + Ollama
#   SKIP_OLLAMA=1 bash scripts/install.sh   # voice (and STT) only, e.g. when Ollama runs elsewhere or isn't wanted
# It no longer downloads the Piper hi_IN-priyamvada voice (non-commercial licence). Only 80/443 are opened (Nginx).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
cd "$(dirname "$0")/.."
total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$total_mb" -ge 7000 ] || echo "WARNING: ${total_mb} MB RAM; 8 GB is the target"

# 1. System packages (ffmpeg decodes browser audio for Whisper; espeak-ng for Kokoro's Hindi comes bundled with pip)
apt-get update
apt-get install -y curl ca-certificates git python3 python3-venv python3-pip ffmpeg nginx ufw openssl
py=python3
for v in 3.12 3.11 3.10; do command -v "python$v" >/dev/null && { py="python$v"; break; }; done
"$py" -c 'import sys; assert (3, 10) <= sys.version_info[:2] < (3, 13), sys.version' || { echo "Kokoro needs Python 3.10-3.12"; exit 1; }

# 2. Ollama, bound to localhost, one model, one request at a time
if [ "${SKIP_OLLAMA:-0}" != 1 ]; then
  command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
  mkdir -p /etc/systemd/system/ollama.service.d
  install -m 644 deploy/ollama-override.conf /etc/systemd/system/ollama.service.d/override.conf
  systemctl daemon-reload && systemctl enable ollama && systemctl restart ollama
  for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  ollama pull qwen2.5:1.5b-instruct
  ollama create medoro-hr -f Modelfile
fi

# 3. Service user, code, virtualenv (reused), CPU-only dependencies
id medoro-ai >/dev/null 2>&1 || useradd --system --home /opt/medoro-ai --shell /usr/sbin/nologin medoro-ai
mkdir -p /opt/medoro-ai/service /opt/medoro-ai/cache/huggingface /etc/medoro-ai
rm -rf /opt/medoro-ai/service.prev && [ -d /opt/medoro-ai/service/app ] && cp -a /opt/medoro-ai/service /opt/medoro-ai/service.prev || true
rm -rf /opt/medoro-ai/service/app /opt/medoro-ai/service/scripts
cp -r app scripts requirements*.txt /opt/medoro-ai/service/
[ -x /opt/medoro-ai/.venv/bin/python ] || "$py" -m venv /opt/medoro-ai/.venv
/opt/medoro-ai/.venv/bin/pip install --upgrade pip
/opt/medoro-ai/.venv/bin/pip install --default-timeout=180 --retries 10 -r /opt/medoro-ai/service/requirements.txt
# English pipeline data, only used with KOKORO_EN_MODE=english_voice (installed now so nothing downloads at run time)
/opt/medoro-ai/.venv/bin/pip install --default-timeout=180 "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl" || echo "en_core_web_sm not installed (only needed for KOKORO_EN_MODE=english_voice)"
chown -R medoro-ai:medoro-ai /opt/medoro-ai

# 4. Secrets and settings (kept on re-runs)
if [ ! -f /etc/medoro-ai.env ]; then
  install -m 600 deploy/medoro-ai.env.example /etc/medoro-ai.env
  sed -i "s/^MEDORO_AI_TOKEN=.*/MEDORO_AI_TOKEN=$(openssl rand -hex 32)/" /etc/medoro-ai.env
  echo "Created /etc/medoro-ai.env with a new token. Put the same token in the app as AI_HR_SERVICE_TOKEN."
fi
[ -f /etc/medoro-ai/lexicon.json ] || echo '{"terms": {}, "names": {}, "words": {}}' > /etc/medoro-ai/lexicon.json
chown root:medoro-ai /etc/medoro-ai /etc/medoro-ai/lexicon.json && chmod 750 /etc/medoro-ai && chmod 640 /etc/medoro-ai/lexicon.json

# 5. Models, downloaded once into /opt/medoro-ai/cache (outside Git), then checked offline
sudo -u medoro-ai env HF_HOME=/opt/medoro-ai/cache/huggingface HF_HUB_OFFLINE=0 OMP_NUM_THREADS=2 TTS_LEXICON_PATH= \
  /opt/medoro-ai/.venv/bin/python /opt/medoro-ai/service/scripts/fetch_kokoro.py
whisper_model=$(grep -E '^WHISPER_MODEL=' /etc/medoro-ai.env | cut -d= -f2); whisper_model=${whisper_model:-base}
sudo -u medoro-ai env HF_HOME=/opt/medoro-ai/cache/huggingface /opt/medoro-ai/.venv/bin/python -c \
  "from faster_whisper import WhisperModel; WhisperModel('$whisper_model', device='cpu', compute_type='int8')" \
  || echo "Whisper '$whisper_model' not downloaded (only needed when recognition runs on this host)."

# 6. systemd
install -m 644 deploy/medoro-ai.service /etc/systemd/system/medoro-ai.service
systemctl daemon-reload && systemctl enable medoro-ai && systemctl restart medoro-ai

# 7. Firewall: SSH and HTTPS only; Ollama (11434) and the service (8090) stay on 127.0.0.1
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

# 8. Health and a real Hindi sentence through the API (the voice loads in ~10-60 s after a restart)
token=$(grep -E '^MEDORO_AI_TOKEN=' /etc/medoro-ai.env | cut -d= -f2)
for _ in $(seq 1 90); do
  curl -fsS -H "Authorization: Bearer $token" http://127.0.0.1:8090/health 2>/dev/null | grep -q '"loaded":true' && break; sleep 2
done
curl -fsS -H "Authorization: Bearer $token" http://127.0.0.1:8090/health | head -c 600; echo
curl -fsS -H "Authorization: Bearer $token" -H 'content-type: application/json' \
  -d '{"text":"Namaste Rahul ji, aapka attendance record incomplete hai."}' http://127.0.0.1:8090/tts \
  | "$py" -c 'import sys,json; j=json.load(sys.stdin); print("TTS ok:", j["engine"], j["voice"], j["ms"], "ms,", j["duration_ms"], "ms of audio")'

echo
echo "Next: Nginx + HTTPS (docs/ai-hr-assistant/DEPLOYMENT.md §4):"
echo "  cp deploy/nginx-medoro-ai.conf /etc/nginx/sites-available/medoro-ai && edit server_name"
echo "  ln -sf /etc/nginx/sites-available/medoro-ai /etc/nginx/sites-enabled/ && certbot --nginx -d <host> && nginx -t && systemctl reload nginx"
echo "Then in the app (Vercel): AI_HR_SERVICE_URL=https://<host>  AI_HR_SERVICE_TOKEN=<the token above>"
