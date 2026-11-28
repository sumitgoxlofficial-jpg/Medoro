#!/usr/bin/env python3
"""Downloads Kokoro-82M and the Hindi female voices once into HF_HOME (never into the Git checkout), then checks that
Hindi speech can be made offline. Run as the service user with the service's environment:

    sudo -u medoro-ai env HF_HOME=/opt/medoro-ai/cache/huggingface /opt/medoro-ai/.venv/bin/python scripts/fetch_kokoro.py

After it succeeds, set HF_HUB_OFFLINE=1 (the installer does) so the service never contacts Hugging Face again.
Hosts used (once): huggingface.co, cdn-lfs.hf.co / cdn-lfs-us-1.hf.co, cas-bridge.xethub.hf.co, us.aws.cdn.hf.co.
"""
from __future__ import annotations

import os
import sys
import time

REPO = os.environ.get("KOKORO_MODEL", "hexgrad/Kokoro-82M")
FILES = ["config.json", "kokoro-v1_0.pth", "voices/hf_alpha.pt", "voices/hf_beta.pt"]
if os.environ.get("KOKORO_EN_MODE") == "english_voice":
    FILES.append(f"voices/{os.environ.get('KOKORO_EN_VOICE', 'bf_emma')}.pt")


def main() -> int:
    from huggingface_hub import hf_hub_download

    for f in FILES:
        for attempt in range(4):  # slow or unsteady office internet: retry with back-off
            try:
                p = hf_hub_download(REPO, f)
                print(f"ok  {f}  {os.path.getsize(p) / 1e6:.1f} MB")
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    print(f"FAILED {f}: {type(e).__name__}: {e}", file=sys.stderr)
                    return 1
                time.sleep(2 ** attempt * 3)
    os.environ["HF_HUB_OFFLINE"] = "1"  # prove it works without the network
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app.tts import Voice

    t0 = time.perf_counter()
    v = Voice()
    v.engine.load()
    out = v.render("नमस्ते, मैं नैना हूँ, मेडोरो एच आर की ए आई असिस्टेंट।")
    print(f"ok  offline Hindi test: {out['duration_ms']} ms of audio, {int((time.perf_counter() - t0) * 1000)} ms incl. load")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
