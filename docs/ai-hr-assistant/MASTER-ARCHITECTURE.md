# AI HR Assistant (Naina): master architecture

Status date: 2026-11-28. This document describes the system as it is in the code, including the Kokoro-82M voice
added in this change. Older detail: [ARCHITECTURE.md](ARCHITECTURE.md) (data model, rule engine), [AUDIT.md](AUDIT.md).

## 1. What runs where

```
 Employee's browser (HRMS)                Medoro app (Vercel, Next.js 16)                 AI host (Ubuntu, 8 GB, CPU)
 ─────────────────────────                ───────────────────────────────                 ──────────────────────────
 Chats → Naina / call screen  ──server──▶ service.ts (auth, RBAC, rate limit)   ──HTTPS──▶ Nginx :443 (TLS, rate limit)
  · captions (display text)     actions   engine.ts  rules + memory + slots     bearer         │
  · mic only after a tap                  nlu.ts     intents, entities, lang     token          ▼
  · browser STT (default)                 knowledge.ts approved KB + live facts           uvicorn 127.0.0.1:8090 (1 worker)
  · plays WAV, sentence by                output.ts  validated outcome (zod)              app/main.py
    sentence; Interrupt stops             ai-client.ts ── /tts /stt /llm/classify ──▶      ├─ /tts  → app/tts.py (Kokoro-82M)
  · device voice / text-only              AiHr* tables in Supabase PostgreSQL              │         app/speech/ (Hinglish layer)
    fallback                              (sealed transcripts, audit, retention)           ├─ /stt  → Faster-Whisper (int8)
                                                                                           ├─ /llm/classify → Ollama 127.0.0.1:11434
                                                                                           └─ /health
```

* **The rule engine decides; models assist.** `engine.ts` is a deterministic state machine (permission → main
  question → follow-ups → close). The local LLM (Ollama, Qwen2.5 1.5B as `medoro-hr`) may only pick one of the
  engine's own intents for an utterance the rules couldn't place (`MODEL_INTENTS`, validated by zod and again by the
  AI host). Safety intents (stop, human, harassment, accident, emergency) are rules only. No model can call an API,
  change a record or approve anything.
* **Speech is optional.** Every conversation works as text. Voice degrades in order: Kokoro (server) → the device's own
  voice → captions only. STT: browser recognition (default) → in-browser Whisper → AI host Whisper → typing.

## 2. Naina's voice (this change)

| Step | Where | What |
|---|---|---|
| 1 | `engine.ts` `speechFor()` | Each reply has a **display** text (Roman Hinglish / Hindi / English, shown as captions) and a **speech** text (Devanagari for Hindi and Hinglish conversations, English for English ones), built from the same phrase choice. |
| 2 | `service.ts` `maybeSpeak()` | Only the first sentence is synthesised now; the rest is returned as `rest`. `speakRest()` repeats this, so a long reply is made **sentence by sentence while she speaks** (`naina-call.tsx` chains the pieces; Interrupt stops the chain). Voice and speed come from Settings. |
| 3 | `ai-client.ts` `speak()` | `POST /tts {text, voice?, speed?}` with the bearer token, 30 s timeout. The extra fields are optional; older AI hosts ignore them. |
| 4 | `app/speech/normalize.py` | Speech text → Kokoro text: source tags removed; emails, URLs, money, dates, times, phone numbers, employee IDs, percentages and numbers spoken in Hindi; every Latin word turned into Devanagari (phrases → Hinglish words → HR terms → names → acronyms spelled → rule-based transliteration). |
| 5 | `app/tts.py` | Sentence chunks (≤ `TTS_CHUNK_CHARS`), Kokoro `KPipeline('h')` with `hf_alpha` (default) or `hf_beta`, trimmed and joined with punctuation-aware pauses, peak-limited, 16-bit mono WAV 24 kHz. The model is loaded once at start-up and shared. |
| 6 | `app/main.py` | One synthesis at a time (`TTS_CONCURRENCY`), at most `TTS_QUEUE_MAX` waiting (then 503), `TTS_TIMEOUT_S` per request (then 504), LRU cache bounded by entries and MB, warm-up of common lines, `malloc_trim` after each reply, automatic engine reload after 3 failures in a row. |

Engines (`TTS_ENGINE`): `kokoro` (default), `piper` (rollback only, needs an explicitly licensed voice), `off`.
External TTS (Google Cloud) stays in the code for existing installs but is **off unless the deployment sets
`AI_HR_ALLOW_EXTERNAL_TTS=1`**, and the Settings screen only offers it then.

## 3. API contracts (unchanged, extended compatibly)

| Endpoint | Request | Response | Change |
|---|---|---|---|
| `POST /tts` | `{text}` (1–1200 chars) + optional `voice` (`hf_alpha`/`hf_beta`), `speed` (0.7–1.3), `lang` (`auto`/`hi`/`hinglish`/`en`) | `{audio_b64, mime:"audio/wav", ms, cached}` + optional `engine, voice, lang, chunks, duration_ms, sample_rate` | additive only |
| `POST /stt` | multipart `audio` | `{text, language, no_speech, ms}` | none |
| `POST /llm/classify` | `{utterance, call_reason, question, intents[]}` | `{intent, eta, ms}` | none |
| `GET /health` | — | `{ok, llm, stt, tts, memory, cpu, version}`; `tts` adds `engine, voices, loaded, load_ms, avg_ms, last_ok_at, errors, recoveries, cache, queue, lexicon` | additive only |

Errors: 401 (token), 413 (audio too long), 422 (invalid or nothing to say), 503 (voice off/unavailable/busy),
504 (timed out). The app treats any TTS error as "no server audio" and continues with the device voice or captions.

## 4. HR brain: what the assistant knows and may do

* **Modules it understands** (from the actual screens and tables, see AUDIT.md): attendance and corrections, shifts and
  roster, leave and holidays, payroll and payslips, documents and KYC, letters and e-sign, policies, appraisals and
  KPIs, training/academy, exits, approvals, chat. Recruitment is limited to what the HRMS has (careers page, referrals,
  candidate records for HR); candidate decisions are HR's.
* **Static knowledge**: `knowledge-seed.json` + HR-approved, versioned knowledge entries (draft → second-person
  approval → publish, rollback), answered with the source shown. **Dynamic knowledge**: the employee's own attendance,
  shift, leave, overtime request, read at request time by `service.ts` for the authenticated employee only. Nothing
  private is put in prompts or used for training.
* **What it may do**: record the employee's answer as a validated outcome (`output.ts`), propose a leave draft or an
  attendance correction for **HR/manager approval** (approval runs the HRMS's own leave rules), record a stop-calls
  preference, escalate to HR (urgent for safety). It never approves, edits attendance or pay, or deletes anything.
* **Unknown answers**: "I don't have that information" + routed to HR (`question_for_hr`), never invented.

## 5. Identity and access

The employee is the signed-in `StaffUser` (cookie session, `hrRun()` re-reads permissions each action). A conversation
is loaded only through `ownCall(me, id)` (the employee whose call it is) or HR with the Attendance module. Text from
other employees is never in scope. Details: [SECURITY.md](SECURITY.md).

## 6. Resource plan on an 8 GB CPU-only host (measured, see TEST-REPORT.md)

| Component | Resident memory | Notes |
|---|---|---|
| Kokoro-82M service | ~1.05 GB loaded, ~1.4 GB settled, transient peaks ~2.0 GB per line (2.3–2.7 GB on a 740-char request) | 2 threads; one synthesis at a time; systemd caps 2.8 G soft / 3 G hard |
| Faster-Whisper base int8 | ~0.3 GB more, only when recognition runs on the host | browsers recognise by default |
| Ollama + Qwen2.5 1.5B | ~1.5–2 GB while loaded (Ollama's figure; not measured here) | unloads after 5 min idle |
| OS + Nginx | ~0.5 GB | |

Under memory pressure, in this order: keep recognition in the browser (default), use Whisper `base` (default) or
`tiny`, keep `TTS_CONCURRENCY=1`, lower Ollama `num_ctx`, turn `llmAssist` off. Kokoro stays.
