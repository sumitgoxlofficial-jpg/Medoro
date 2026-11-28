# AI HR Assistant: test report (Kokoro voice change)

Date: 2026-11-28. Every number here was produced by running code in this build environment. **This is not the
target 8 GB office machine**: it is a 4-vCPU / 16 GB cloud VM (Python 3.12.3, torch 2.6.0+cpu). CPU-limited runs used
`taskset` to pin the service to 2 or 4 cores. Re-run `scripts/benchmark_tts.py` on the real host before setting
acceptance thresholds.

## 1. Automated tests

| Suite | Command | Result |
|---|---|---|
| AI service (FastAPI, TTS contract, cache, queue, concurrency, errors, health; Hinglish layer) | `cd ai-service && python -m pytest -q` | **63 passed** |
| AI HR engine, NLU, scenarios (unit) | `pnpm vitest run src/staff/hrms/ai-hr` | **36 passed** |
| AI HR integration (real PostgreSQL 16: voice/speed sent to the AI host, sentence-by-sentence `speakRest`, external TTS opt-in, opening language, idle timeout, access control, escalation, retention…) | `pnpm vitest run tests/integration/ai-hr.test.ts` | **30 passed** |
| Whole repository | `pnpm vitest run` | 236 / 237 files, **1,482 / 1,486 tests**. The 4 failures are in `tests/integration/hrms-workforce.test.ts`, **fail identically without this change** (checked with `git stash`), and are unrelated (workforce activity windows). |
| Typecheck / lint | `pnpm tsc --noEmit`, `eslint` on changed files | clean |
| Scenario library | `pnpm tsx scripts/ai-hr/evaluate.ts` | **1,060 / 1,060** (848 tuning, 212 held-out), 106 categories, 0 duplicates |

Covered by the Python tests (fake engine, so they run anywhere): the exact brief examples become the expected
Devanagari; Kokoro is never handed a Latin letter for Hindi/Hinglish; every one of Naina's **270 distinct real lines**
(97 Hinglish phrase variants + 173 spoken lines from 1,285 scenario turns) becomes pure Devanagari; every word she says
is in a reviewed dictionary; ≥ 500 HR terms (796); numbers, times, money, dates, IDs, phones, emails, URLs, OTPs,
percentages; names and fallback; language detection; long-text chunking; empty / invalid / too-long / bad-JSON /
bad-speed / bad-lang input → 422; unknown voice → default; engine off → 503 not a crash; cache hit, LRU and MB bound;
**one synthesis at a time under a burst and 503 beyond the queue limit**; health contents and that it never echoes text;
override file hot-reload, bad entries skipped, broken file ignored.

## 2. Kokoro-82M measured (real model, real HTTP API)

`scripts/benchmark_tts.py --spawn`: 24 real Naina lines per voice (Devanagari speech text from the scenario library,
average ~10 s of audio each), `TTS_CHUNK_CHARS=160`, `MALLOC_ARENA_MAX=2`, one synthesis at a time.

| | 2 cores, 2 threads | 4 cores, 4 threads |
|---|---|---|
| Cold start (process start → model and both voices loaded) | 5.3 s | 4.5 s |
| Model load (cached files, `HF_HUB_OFFLINE=1`) | 4.6 s | 4.0 s |
| First request after load | 1.4 s | 0.9 s |
| **hf_alpha**, full line: avg / p50 / p95 / max | 5.9 / 6.2 / 8.0 / 9.0 s | **3.1 / 3.2 / 5.0 / 5.0 s** |
| hf_alpha real-time factor (synthesis ÷ audio) | 0.52 | 0.30 |
| **hf_beta**, full line: avg / p50 / p95 / max | 5.1 / 5.3 / 7.5 / 7.6 s (RTF 0.53) | p50 3.2 s; avg/p95 not valid (see note) |
| **Time to first sound** (first sentence, the app's way) | **0.8 s** | **0.5 s** |
| 742-character reply in one request (18 chunks, 67 s of audio) | 29.5 s | 22.5 s |
| Cache hit | 12 ms | 11 ms |
| 4 concurrent requests (queued, none dropped) | 4/4 OK, 20.8 s wall | 4/4 OK, 12.0 s wall |
| Bad requests then a good one | 422, 422, 422 → 200 | same |
| Service CPU while speaking | 187 % (≈ 2 cores) | 334 % |
| RSS after load | 1.07 GB | 1.05 GB |
| RSS at the end / peak | 2.10 / 2.69 GB | 1.80 / 2.28 GB |

Note: the 4-core hf_beta tail overlapped another test run on the same VM and is not reported as a voice difference.
On 2 cores, measured in isolation, both voices were equally fast (RTF ~0.5).

### Memory investigation (in-process, 10 real lines, 2 threads)

| Variant | RSS after 10 replies | Avg time |
|---|---|---|
| plain | 2.45 GB | 4.96 s |
| `torch.inference_mode` | 2.40 GB | 4.90 s |
| `malloc_trim(0)` after each reply | 1.27 GB | 5.31 s |
| **inference_mode + malloc_trim (shipped)** | **1.26 GB** | **4.90 s** |
| + `MALLOC_MMAP_THRESHOLD_=65536` | 1.25 GB | 7.97 s (rejected) |

With synthesis in a worker thread (as in the service), RSS settles at ~1.4 GB, with transient peaks of ~2.0 GB during
one line and ~2.4–2.7 GB during a single 740-character request. Chunk size (100 vs 220 chars) didn't change the peak.
Hence `MemoryHigh=2800M`, `MemoryMax=3G` in the systemd unit, and sentence-sized requests from the app.

### What this means for the 8 GB host (estimate, not measured there)

Kokoro ≤ ~2.7 GB peak + Ollama with Qwen2.5 1.5B (~1.5–2 GB, not measured: ollama.com unreachable here) + OS/Nginx
(~0.5 GB) fits in 8 GB with browser speech recognition (default). Add ~0.3 GB for Whisper `base` if recognition runs
on the host. On 2 cores, a full line takes ~6 s, but the employee hears the first sentence after ~0.8 s and the rest
is made while she speaks.

## 3. Earlier problems found by testing (fixed)

* Unpinned install chose transformers 5.x → Kokoro failed ("CustomAlbert requires PyTorch >= 2.6"): versions pinned.
* Roman Hinglish to Kokoro gave English phonemes (`hai` → /hI/): Hinglish → Devanagari layer.
* A 742-character request hit the 30 s timeout on 2 cores: the app now speaks sentence by sentence; timeout 60 s.
* RSS grew to 2.4 GB over ten replies: `malloc_trim` + `inference_mode`.
* `/health` could show `loaded` before `load_ms` was set: the model is published only when fully ready.
* Scenario gaps (hold-on, noise tags, informal spelling, stop phrasing, nearby work, another employee's data):
  HR-CONVERSATION-SCENARIOS.md.

## 4. Not tested (needs the real environment or people)

| Item | Why not | How to finish |
|---|---|---|
| **How natural Kokoro's Hindi voices sound** (the production default decision) | needs human listeners; the author grades both Hindi voices "C" | rate `listening-sheet.csv` from the benchmark with ≥ 3 Hindi speakers (KOKORO-TTS-SETUP.md §7) |
| Numbers on the actual 8 GB office machine | not provided | run `benchmark_tts.py --spawn` there; set thresholds from it (suggested: time to first sound ≤ 1.5 s, p95 full line ≤ 10 s, peak RSS ≤ 2.8 GB) |
| Ollama / Qwen in the same box at the same time | ollama.com blocked here | run the benchmark while a conversation uses `/llm/classify` |
| STT with real Hindi/Hinglish speech, noise, short/long audio | no recordings; `/stt` tested with a fake Whisper only | record consenting volunteers; compare transcripts |
| Frontend playback on real phones (Android Chrome, iPhone Safari), mobile layout, interrupt on device | no devices here | manual check per DEPLOYMENT.md; the call screen's sentence chaining is covered by typecheck and integration tests, not a browser test |
| Python 3.10 (Ubuntu 22.04) | only 3.12 available | run `install.sh` on 22.04 |
| Nginx/HTTPS on the host, Vercel → host over the internet | no host | DEPLOYMENT.md §2 |
