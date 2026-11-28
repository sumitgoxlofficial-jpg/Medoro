# AI HR Assistant — architecture

```
             Medoro app (Vercel, existing)                                   AI host (persistent Linux, 8 GB) — to be provisioned
 ┌───────────────────────────────────────────────────────────┐        ┌──────────────────────────────────────────────┐
 │ cron tick (every minute) ─▶ detect() ─▶ AiHrCall (unique   │        │ Nginx :443 (HTTPS, rate limit, 4 MB bodies)  │
 │   eventKey)  ─▶ dispatch() ─▶ notify() (HRMS + WhatsApp     │        │   └▶ medoro-ai (FastAPI, 127.0.0.1:8090)     │
 │   opt-in), retries, expiry, "checked in meanwhile" cancel   │ HTTPS  │       /stt  Faster-Whisper small int8 (CPU)  │
 │                                                           │ bearer │       /tts  Piper hi_IN-priyamvada-medium    │
 │ Employee: AI conversations screen (browser mic, turn-based)│──────▶│       /llm/classify ─▶ Ollama 127.0.0.1:11434 │
 │   server action ─▶ sendTurn(): STT? ─▶ rule NLU ─▶ (LLM     │        │                        qwen2.5:1.5b (medoro-hr)│
 │   classify if unknown) ─▶ dialog engine ─▶ TTS? ─▶ reply    │        │       /health  engines, RAM, CPU             │
 │   transcript sealed (HOST_KEY) in AiHrTurn                 │        └──────────────────────────────────────────────┘
 │ finish(): zod-validated outcome ─▶ AiHrCallResponse,       │
 │   AiHrAction proposals, consent, HR notifications          │        Optional Mode B: licensed SIP/PSTN provider ─▶
 │ HR: AI HR Assistant screen (overview, calls, escalations,  │        signed webhook /api/webhooks/ai-hr/call-events
 │   knowledge, scenarios, playground, status, settings)      │        (disabled until configured)
 └───────────────────────────────────────────────────────────┘
```

## Components (Part 15 service boundaries)

| Service | Where |
|---|---|
| Attendance event detector, calling rule engine | `service.ts` `detect()` — uses Settings (`lateAfter`, `weekOff`, `checkin`, work hours, lunch), `HrHoliday`, approved `HrLeave`, roster (`HrShiftAssignment`/`HrShift`), own `shiftStart`, joining/exit dates, consent. |
| Durable job scheduler | `dispatch()` + `aiHrTick()` in `src/server/cron.ts`. All state is in rows; a failed tick is retried by the next. |
| Call orchestrator / voice session manager | `beginCall`, `sendTurn`, `endCall`, `finish` (`service.ts`); conversation memory in `AiHrCall.state`. |
| STT / LLM / TTS | `ai-service/app/main.py`, client `ai-client.ts` (timeouts, https-or-private-network only, no paid fallback). |
| WebRTC / browser voice | `_ui/screens-aicall.tsx`: `getUserMedia` (noise suppression, echo cancellation), `MediaRecorder` Opus, end-of-speech detection (RMS, 1.2 s silence, 15 s cap), barge-in (playback stops when the person speaks). Turn-based: **not** continuous streaming and **not** a phone call. |
| Telephony adapter | `telephony.ts` interface + `NotConfigured`; HMAC-signed, idempotent webhook route. |
| Conversation engine | `nlu.ts` (Hindi/English/Hinglish understanding, times), `engine.ts` (state machine, slot memory, safety interrupts), `phrases.ts` (three languages, varied wording), `output.ts` (strict schema). |
| Knowledge ingestion & RAG | `scripts/ai-hr/build-knowledge.ts` → `knowledge-seed.json`; `knowledge-faq.ts`; `knowledge.ts` (BM25 + Hinglish term map + coverage threshold); `AiHrKnowledgeDoc` versions; live organisation facts (`organisationDocs()`). |
| Scenario manager & evaluation | `scenarios/*`, `evaluate.ts`, `scripts/ai-hr/evaluate.ts`, `AiHrScenario`, `AiHrEvalRun`. |
| HR action processor | `AiHrAction` + `decideAction()` (no self-decisions; approval never writes leave/attendance/pay rows). |
| Notifications | existing `notify()`. |
| Audit & monitoring | existing `StaffAudit` via `audit()`; AI service `/health`; per-turn STT/LLM/TTS latency stored on `AiHrTurn`. |

## Why rules drive the conversation and the model only assists

A 1.5B-parameter model on CPU is too slow and too unreliable to own an HR conversation (it invents facts, drifts in
Hinglish, and can't be trusted with stop/safety requests). The engine is deterministic, measurable on 1,000 scenarios,
and instantly fast; the local model is used only to place an utterance the rules don't understand into one of the
engine's own intents, validated against a closed list. Safety, stop and escalation never depend on the model.
"Training" in this system means: extracted knowledge + retrieval + rules + scenario evaluation. **No fine-tuning was
done**, and none is justified until real conversation failures show a pattern the rules can't cover.

## Data model (migration `20270105000000_hrms_ai_hr_assistant`)

`AiHrCall` (event, unique `eventKey`, status, attempts, next attempt, context, conversation state, retention) ·
`AiHrCallAttempt` (append-only) · `AiHrTurn` (sealed text, language, intent, STT/LLM/TTS ms) · `AiHrCallResponse`
(Part 13 fields; `said` / `inferred` / `recommended` kept apart) · `AiHrAction` (proposals; no deletes) · `AiHrConsent`
(stop preference) · `AiHrKnowledgeDoc` (versioned, approved) · `AiHrScenario` · `AiHrEvalRun` · `AiHrWebhookEvent`
(idempotency). Configuration lives in the existing `HrSetting` table (key `aiHr`). All tables have RLS enabled, are
excluded from pharmacy restores, and have foreign keys to `StaffUser` where they reference people.

## Security and privacy

* Employee data: the assistant reads only the call's facts (shift times, overtime request) and the knowledge index.
  An employee can only open their own conversations; HR (Attendance module) can open transcripts, each opening audited.
* Transcripts sealed with `HOST_KEY`; audio never stored (browser → app → AI host memory/temp file → deleted).
  Retention configurable (default 90 days), daily sweep; super admin can delete a transcript at once.
* AI disclosure in every opening line; stop requests end the call and are stored as a preference that blocks future
  detection, dispatch, overtime and manual requests; silence never counts as consent (overtime needs an explicit yes
  and a confirmation).
* No AI decision: approval of a proposal records HR's decision and notifies; leave, corrections and pay are applied in
  their own screens with their own rules.
* AI host: bearer token (constant-time compare), localhost-only engines, Nginx HTTPS + rate limit, no docs endpoints,
  no access logs, systemd hardening (`MemoryMax`, `ProtectSystem`, `NoNewPrivileges`). App refuses a plain-http AI URL
  on a public host.
* Webhook: HMAC-SHA256 over `timestamp.body`, 5-minute window, duplicate event ids ignored.
* Rate limits: 120 turns per person per 10 minutes (`aiHrTurn`), plus Nginx on the AI host.
* India: DPDP Act (consent, purpose limitation, retention), employment-law review of automated contact, and TRAI/DLT
  rules before any phone calling must be verified by the company's counsel before production.
