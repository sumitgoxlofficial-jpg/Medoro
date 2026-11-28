#!/bin/sh
# First start only: downloads the Piper Hindi voice and the Whisper model into /models (kept in a Docker volume).
set -e
mkdir -p /models/voices
base=https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/priyamvada/medium
for f in hi_IN-priyamvada-medium.onnx hi_IN-priyamvada-medium.onnx.json MODEL_CARD; do
  [ -s "/models/voices/$f" ] || curl -fsSL -o "/models/voices/$f" "$base/$f" || echo "Could not download $f (voice replies stay off until it is there)."
done
python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL:-small}', device='cpu', compute_type='${WHISPER_COMPUTE:-int8}')" || echo "Whisper model not downloaded yet; it will be fetched on the first request."
