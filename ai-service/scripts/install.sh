#!/usr/bin/env bash
# Installs the Medoro AI service on a verified Ubuntu 22.04/24.04 host with 8 GB RAM (run as root, from ai-service/).
# It does not open any port except 80/443 through Nginx. Read it before running it.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$total_mb" -ge 7000 ] || echo "WARNING: ${total_mb} MB RAM; 8 GB is the tested minimum"

apt-get update
apt-get install -y curl ca-certificates git python3 python3-venv python3-pip ffmpeg nginx ufw

# Ollama, bound to localhost, one model, one request at a time
command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
mkdir -p /etc/systemd/system/ollama.service.d
install -m 644 deploy/ollama-override.conf /etc/systemd/system/ollama.service.d/override.conf
systemctl daemon-reload && systemctl enable ollama && systemctl restart ollama
sleep 3
ollama pull qwen2.5:1.5b-instruct
ollama create medoro-hr -f Modelfile

# Service user, code, virtualenv
id medoro-ai >/dev/null 2>&1 || useradd --system --home /opt/medoro-ai --shell /usr/sbin/nologin medoro-ai
mkdir -p /opt/medoro-ai/service /opt/medoro-ai/voices /opt/medoro-ai/cache
cp -r app requirements.txt /opt/medoro-ai/service/
python3 -m venv /opt/medoro-ai/.venv
/opt/medoro-ai/.venv/bin/pip install --upgrade pip
/opt/medoro-ai/.venv/bin/pip install -r /opt/medoro-ai/service/requirements.txt

# Piper Hindi female voice (check its licence in MODEL_CARD before commercial use)
base=https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/priyamvada/medium
for f in hi_IN-priyamvada-medium.onnx hi_IN-priyamvada-medium.onnx.json MODEL_CARD; do
  [ -s "/opt/medoro-ai/voices/$f" ] || curl -fsSL -o "/opt/medoro-ai/voices/$f" "$base/$f"
done
chown -R medoro-ai:medoro-ai /opt/medoro-ai

# Secrets
if [ ! -f /etc/medoro-ai.env ]; then
  install -m 600 deploy/medoro-ai.env.example /etc/medoro-ai.env
  sed -i "s/^MEDORO_AI_TOKEN=.*/MEDORO_AI_TOKEN=$(openssl rand -hex 32)/" /etc/medoro-ai.env
  echo "Created /etc/medoro-ai.env with a new token. Put the same token in the app as AI_HR_SERVICE_TOKEN."
fi

# Warm the speech model once (downloads faster-whisper small into the cache)
sudo -u medoro-ai HF_HOME=/opt/medoro-ai/cache/huggingface /opt/medoro-ai/.venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

install -m 644 deploy/medoro-ai.service /etc/systemd/system/medoro-ai.service
systemctl daemon-reload && systemctl enable medoro-ai && systemctl restart medoro-ai

# Firewall: SSH and HTTPS only; Ollama and the service stay on 127.0.0.1
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
echo "Now: copy deploy/nginx-medoro-ai.conf, set server_name, get a certificate (certbot --nginx -d <host>), reload nginx."
echo "Check: curl -s -H \"Authorization: Bearer \$(grep MEDORO_AI_TOKEN /etc/medoro-ai.env | cut -d= -f2)\" http://127.0.0.1:8090/health"
