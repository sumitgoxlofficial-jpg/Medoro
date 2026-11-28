#!/bin/sh
# First start only (Docker): downloads Kokoro-82M with the Hindi female voices and the Whisper model into /models
# (a Docker volume, never the image or Git). Later starts find them there and download nothing.
set -e
mkdir -p /models/huggingface
HF_HUB_OFFLINE=0 python /srv/scripts/fetch_kokoro.py || echo "Kokoro not downloaded yet (Naina's server voice stays off until it is; devices speak instead)."
# Voice-only mode (a laptop giving Naina her voice): speech is recognised in the browsers, so Whisper isn't needed.
[ "${VOICE_ONLY:-0}" = "1" ] && exit 0
python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL:-base}', device='cpu', compute_type='${WHISPER_COMPUTE:-int8}')" || echo "Whisper model not downloaded yet; it will be fetched on the first request."
