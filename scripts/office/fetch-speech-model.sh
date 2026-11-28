#!/usr/bin/env bash
# Downloads the AI HR Assistant's browser speech model (Whisper, ONNX) to ./speech-models, so employees' browsers load
# it from your own server instead of Hugging Face. Run once on the office server (needs internet this one time):
#   bash scripts/office/fetch-speech-model.sh                 # whisper-base (~80 MB to the browser)
#   bash scripts/office/fetch-speech-model.sh whisper-small   # better Hindi, larger
# Then: AI HR Assistant → Settings → "Speech model from: This server". Licence: Whisper weights are MIT (OpenAI).
set -euo pipefail
cd "$(dirname "$0")/../.."
MODEL="${1:-whisper-base}"
case "$MODEL" in whisper-base|whisper-small) ;; *) echo "Use whisper-base or whisper-small"; exit 1 ;; esac
REPO="onnx-community/$MODEL"
DEST="speech-models/$REPO"
mkdir -p "$DEST/onnx"
command -v curl >/dev/null || { echo "curl is needed"; exit 1; }
echo "Listing $REPO…"
files=$(curl -fsSL "https://huggingface.co/api/models/$REPO" | grep -o '"rfilename":"[^"]*"' | cut -d'"' -f4)
# Configuration and tokenizer files, plus the two weight sets the browser uses:
#   WebAssembly: 8-bit encoder + decoder; WebGPU: full-precision encoder + 4-bit decoder.
want() {
  case "$1" in
    *.json|*.txt) [[ "$1" != */* || "$1" == onnx/* ]] && [[ "$1" != onnx/*.json ]] ;;
    onnx/encoder_model_quantized.onnx|onnx/decoder_model_merged_quantized.onnx|onnx/encoder_model.onnx|onnx/decoder_model_merged_q4.onnx) true ;;
    onnx/encoder_model.onnx_data|onnx/decoder_model_merged_q4.onnx_data) true ;;
    *) false ;;
  esac
}
n=0
for f in $files; do
  want "$f" || continue
  out="$DEST/$f"
  if [ -s "$out" ]; then echo "have $f"; continue; fi
  mkdir -p "$(dirname "$out")"
  echo "get  $f"
  curl -fsSL --retry 3 -o "$out.part" "https://huggingface.co/$REPO/resolve/main/$f" && mv "$out.part" "$out"
  n=$((n+1))
done
echo "Done: $n new file(s) in $DEST ($(du -sh "$DEST" | cut -f1))."
echo "Restart is not needed. In the HRMS: AI HR Assistant → Settings → Speech model from: This server."
