# Kokoro-82M voice: setup

Naina's server voice is [Kokoro-82M](https://github.com/hexgrad/kokoro) (weights Apache-2.0), running on CPU on
Medoro's own Ubuntu host. Female Hindi voices: **`hf_alpha`** (default) and **`hf_beta`**. Output: 16-bit mono WAV,
24 kHz. No external speech API is called and nothing is paid per use.

## 1. Requirements

| | Tested here | Target |
|---|---|---|
| OS | Ubuntu 24.04 (container) | Ubuntu 22.04 / 24.04 |
| Python | 3.12.3 | 3.10–3.12 (Kokoro 0.9.4 refuses 3.13; 3.10 not tested) |
| CPU / RAM | 2 and 4 cores of a 4-vCPU VM, 16 GB | 8 GB, CPU only |
| Disk | Kokoro 314 MB (model 312 MB + 2 voices), venv ~1.2 GB | 3 GB free incl. Whisper and Ollama models |
| Network, once | huggingface.co, cdn-lfs.hf.co, cdn-lfs-us-1.hf.co, cas-bridge.xethub.hf.co, us.aws.cdn.hf.co, cas-server.xethub.hf.co, download.pytorch.org, download-r2.pytorch.org, pypi.org, files.pythonhosted.org, github.com (en_core_web_sm) | then none (`HF_HUB_OFFLINE=1`) |

## 2. Pinned dependencies (`ai-service/requirements.txt`)

`kokoro==0.9.4`, `misaki[en]==0.9.4`, `torch==2.6.0+cpu` (CPU-only index, no CUDA), `transformers==4.51.3`,
`huggingface-hub==0.30.2`, `numpy==2.2.6`, plus FastAPI/uvicorn/httpx/faster-whisper as before. Pins matter: with
unpinned installs pip chose `transformers 5.x`, which refuses `torch < 2.6` (measured failure: "CustomAlbert requires
PyTorch >= 2.6"). `piper-tts` is no longer installed (see `requirements-piper-rollback.txt`).

espeak-ng (used by misaki for Hindi phonemes) comes **bundled** in the `espeakng-loader` wheel; no `apt install
espeak-ng` is needed.

## 3. Install (exact commands)

On the AI host, as root, from a checkout of the repository:

```bash
git clone https://github.com/sumitgoxlofficial-jpg/Medoro.git /opt/medoro-src
```

```bash
cd /opt/medoro-src/ai-service && bash scripts/install.sh
```

The installer: installs system packages (python3-venv, ffmpeg, nginx, ufw), Ollama on localhost (skip with
`SKIP_OLLAMA=1`), creates the `medoro-ai` user, copies the code to `/opt/medoro-ai/service` (previous copy kept as
`service.prev`), creates or reuses `/opt/medoro-ai/.venv`, installs the pinned CPU dependencies, creates
`/etc/medoro-ai.env` with a fresh token (kept on re-runs) and `/etc/medoro-ai/lexicon.json`, downloads Kokoro and the
two Hindi voices **once** into `/opt/medoro-ai/cache/huggingface` (outside Git) and proves Hindi speech works offline,
warms Whisper, installs and starts the systemd unit, opens only SSH/80/443, then calls `/health` and speaks a real
sentence through `/tts`.

Model download alone (e.g. after clearing the cache):

```bash
sudo -u medoro-ai env HF_HOME=/opt/medoro-ai/cache/huggingface HF_HUB_OFFLINE=0 /opt/medoro-ai/.venv/bin/python /opt/medoro-ai/service/scripts/fetch_kokoro.py
```

## 4. Configuration (`/etc/medoro-ai.env`)

| Variable | Default | Meaning |
|---|---|---|
| `TTS_ENGINE` | `kokoro` | `kokoro`, `piper` (rollback only), `off` |
| `KOKORO_MODEL` / `KOKORO_LANG` | `hexgrad/Kokoro-82M` / `h` | model repo, Hindi pipeline |
| `KOKORO_VOICE` | `hf_alpha` | default voice; the app can ask for `hf_beta` per request (Settings → Kokoro voice) |
| `KOKORO_EN_MODE` | `same_voice` | English replies: `same_voice` keeps Naina's Hindi voice; `english_voice` uses Kokoro's English pipeline with `KOKORO_EN_VOICE` (needs `en_core_web_sm`; a different-sounding voice) |
| `TTS_SPEED` | `0.95` | default pace (0.7–1.3); Settings → Speaking speed overrides per request (0.8–1.2) |
| `TTS_PAUSE_MS` | `260` | pause after a sentence (questions +20 %, comma splits 40 %) |
| `TTS_CHUNK_CHARS` | `160` | longest piece sent to Kokoro at once (long sentences are cut at commas, then spaces) |
| `TTS_THREADS` (`OMP_NUM_THREADS`, `MKL_NUM_THREADS`) | `2` | CPU threads for torch |
| `TTS_CONCURRENCY` / `TTS_QUEUE_MAX` / `TTS_TIMEOUT_S` | `1` / `8` / `60` | at once / waiting (then 503) / per request (then 504) |
| `TTS_CACHE_SIZE` / `TTS_CACHE_MB` | `100` / `48` | repeated lines are served from memory |
| `TTS_WARM` | `1` | make five common lines at start-up |
| `TTS_LEXICON_PATH` | `/etc/medoro-ai/lexicon.json` | pronunciation fixes, hot-reloaded (HINGLISH-PRONUNCIATION.md) |
| `HF_HOME` / `HF_HUB_OFFLINE` | `/opt/medoro-ai/cache/huggingface` / `1` | model cache outside Git; never download again |
| `MALLOC_ARENA_MAX` | `2` | fewer glibc arenas |

Restart after changing it: `systemctl restart medoro-ai` (the voice loads again in ~5–10 s; `/health` shows
`tts.loaded`).

## 5. App side (Vercel)

* `AI_HR_SERVICE_URL=https://<ai-host>` and `AI_HR_SERVICE_TOKEN=<MEDORO_AI_TOKEN>` (Production + Preview).
* HRMS → AI HR Assistant → Settings: **Voice** "On the employee's device" + **Naina's voice** "Medoro's own voice
  (Kokoro, self-hosted)", or **Voice** "Our AI host"; then **Kokoro voice** and **Speaking speed**. Model status shows
  engine, voice, average time per line and when it last spoke.

## 6. Check it

```bash
TOKEN=$(grep ^MEDORO_AI_TOKEN= /etc/medoro-ai.env | cut -d= -f2)
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8090/health | python3 -m json.tool
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"text":"Namaste Rahul ji, aapka attendance record incomplete hai.","voice":"hf_alpha"}' http://127.0.0.1:8090/tts | python3 -c 'import sys,json,base64; j=json.load(sys.stdin); open("/tmp/naina.wav","wb").write(base64.b64decode(j["audio_b64"])); print(j["ms"], "ms", j["duration_ms"], "ms audio")'
```

## 7. Choosing the production voice (manual, required)

Run the benchmark on the real host; it writes one WAV per real Naina line and voice plus a rating sheet:

```bash
cd /opt/medoro-ai/service && sudo -u medoro-ai env HF_HOME=/opt/medoro-ai/cache/huggingface HF_HUB_OFFLINE=1 OMP_NUM_THREADS=2 TTS_THREADS=2 /opt/medoro-ai/.venv/bin/python scripts/benchmark_tts.py --spawn --out /tmp/medoro-tts-bench
```

Have at least three Hindi-speaking colleagues rate `listening-sheet.csv` (naturalness and pronunciation, 1–5) for
both voices. Keep Kokoro as the default only if the average is acceptable to HR; otherwise use "Each device's own
voice" until a better voice is available. This step cannot be automated and has **not** been done yet.
