# AI HR Assistant — technical handover

Date: 2026-11-28 · Branch: `claude/compassionate-brahmagupta-7ryrlt` · Status legend: **Implemented** (code exists) ·
**Tested** (automated tests ran and passed here) · **Deployed** (running in production) · **Blocked** · **Not implemented**.

> Nothing is deployed. Production needs (1) the owner's approval to merge to `main`, and (2) a persistent 8 GB AI host,
> which does not exist yet. Every number below was produced by running code in this build sandbox (4 vCPU, 15 GB, no
> internet access to Hugging Face or ollama.com).

## 1. Initial architecture audit
See [AUDIT.md](AUDIT.md): Next.js 16.4 + Prisma 6.19 + PostgreSQL/Supabase on Vercel; single-organisation HRMS with
mature attendance/shift/leave/payroll modules; existing Ally assistant and an Ollama client; no persistent host.

## 2. Existing features reused
Attendance (`HrAttendance`), shifts and roster (`HrShift`, `HrShiftAssignment`, own `shiftStart`), Settings
(`lateAfter`, `weekOff`, `checkin`, work hours, lunch), holidays, approved leave, joining/exit dates, `notify()` with
WhatsApp opt-in, `holders()`, RBAC (`need`, `needAdmin`, module grants), `hrRun()` gate and fresh permissions, `audit()`
(append-only `StaffAudit`), `HOST_KEY` vault sealing, Postgres rate limiter, scheduler `tick()`, `hostClass()`, the
policy passage splitter, the HRMS UI kit and screen registry, and `HrSetting` for configuration.

## 3. New features implemented
Attendance detection (late / absent / missing check-out) and overtime/manual requests; durable dispatch with retries,
calling hours, expiry and automatic cancellation; employee conversation screen (text + turn-based voice, barge-in,
mic-denied fallback); Hinglish/Hindi/English conversation engine with memory, safety interrupts and varied phrasing;
validated structured outcomes; HR escalation/approval board; stop-call consent; versioned knowledge base with drafts,
second-person approval, rollback, live organisation facts and retrieval testing; 1,000-scenario library, validator,
evaluator, HR custom scenarios, stored evaluation runs; playground; model status; retention sweep and transcript
deletion; signed idempotent telephony webhook and disabled SIP adapter; the FastAPI AI service with deployment files.

## 4–5. Modified and new files
Modified: `prisma/schema.prisma`, `src/server/cron.ts`, `src/server/ratelimit.ts`, `src/staff/hrms/constants.ts`,
`src/staff/hrms/screens.ts`, `src/app/staff/hrms/actions.ts`, `src/app/staff/hrms/_ui/screens.tsx`,
`src/domain/system/restore.ts`, `tests/integration/rls-readiness.test.ts`, `.env.example`, `README.md`, `docs/HRMS.md`.

New: `prisma/migrations/20270105000000_hrms_ai_hr_assistant/`, `scripts/rollback/20270105000000_hrms_ai_hr_assistant.down.sql`,
`src/staff/hrms/ai-hr/{nlu,engine,phrases,output,knowledge,knowledge-faq,evaluate,service,ai-client,telephony}.ts`,
`knowledge-seed.json`, `scenarios/{types,index,lib-1..lib-5}.ts`, `engine.test.ts`,
`src/app/staff/hrms/_ui/{screens-aihr,screens-aicall}.tsx`, `src/app/api/webhooks/ai-hr/call-events/route.ts`,
`tests/integration/ai-hr.test.ts`, `scripts/ai-hr/{build-knowledge,evaluate,show}.ts`, `ai-service/**`, `docs/ai-hr-assistant/**`.

## 6–7. Database schema changes and migration
Ten new tables (see ARCHITECTURE.md), no change to any existing table or row except two back-relations on `StaffUser`
(no column). Delete-blocking triggers on `AiHrCallAttempt` and `AiHrAction`; RLS on all ten. Migration applied to a
database with all 60+ earlier migrations; rollback script run in one transaction; re-applied; `prisma migrate status`:
up to date. Configuration is a new `HrSetting` key (`aiHr`).

## 8–9. Installed AI models and licences
| Component | Choice | Licence | Installed here? |
|---|---|---|---|
| LLM | Qwen2.5 1.5B Instruct via Ollama, as `medoro-hr` (`ai-service/Modelfile`) | Apache-2.0 (as published for the 1.5B size; re-check the model card at install) | **No** — ollama.com/registry blocked in this sandbox |
| Ollama | runtime | MIT | No (same reason) |
| STT | faster-whisper 1.1.1 (+ CTranslate2 4.9.1), model `small`, int8, CPU | MIT (code); Whisper weights MIT | Package **yes**, model **no** (huggingface.co blocked) |
| TTS | piper-tts 1.3.0 + onnxruntime 1.32 | **piper-tts 1.3.0 is GPL-3.0-or-later**; onnxruntime MIT | Package **yes** |
| Voice | `hi_IN-priyamvada-medium` | **Unverified** — read its `MODEL_CARD` (downloaded by install.sh) before commercial use | No (huggingface.co blocked) |
| API | FastAPI 0.115.6, uvicorn 0.34, httpx 0.28 | MIT / BSD | Yes |

GPL note: running piper-tts as a separate service on your own server is generally not "distribution", but have counsel
confirm. MIT alternative: `piper-tts==1.2.0` (MIT; needs `piper-phonemize`, whose wheels cover Python ≤ 3.11, i.e.
Ubuntu 22.04).

## 10–13. Server RAM, CPU, disk, latency
**Not measured — Blocked.** No AI host exists, and this sandbox can't download the models. Expected on an 8 GB / 4-core
CPU host (planning figures from the components' own documentation, *not measurements*): Qwen2.5-1.5B Q4 ≈ 1.1–1.5 GB
RAM, Whisper small int8 ≈ 0.5–1 GB, Piper medium ≈ 0.1–0.2 GB, service ≈ 0.3 GB. Record real values from `/health`,
`free -m`, `df -h` and the per-turn ms stored on each transcript line after installing (DEPLOYMENT.md §2).
Measured here: the rule engine runs all 1,000 scenarios (≈ 2,400 turns) in about one second, i.e. < 1 ms per turn.

## 14–16. Hindi, Hinglish and English results
Conversation engine (text, measured): 157/157 language-match checks pass; Hindi-only, English-only, Hinglish and
language-switching categories are in SCENARIO_REPORT.md. **Voice quality (pronunciation of Hinglish, names, dates,
numbers) — Not tested (Blocked: no voice model).** Known risk: the Piper Hindi voice is trained on Devanagari Hindi; romanised Hinglish
replies may be mispronounced. Mitigation built in: `speakable()` normalises times and acronyms; if quality is
insufficient, render replies in Devanagari for TTS (the engine already has full Hindi phrasing) or evaluate another
licence-compatible voice.

## 17. WebRTC / browser voice
Implemented: `getUserMedia` with noise suppression/echo cancellation, Opus recording, end-of-speech detection, 15 s cap,
barge-in, mic-denied and network-drop messages, text fallback. **Not tested in a browser** (no e2e for the microphone;
requires a real device and the AI host). It is turn-based voice, not live streaming and not a phone call.

## 18. Automatic attendance trigger test result
**Tested** (`tests/integration/ai-hr.test.ts`, real PostgreSQL): late after start + 10 min; absent after + 30 min with
own shift start; approved leave, holiday and weekly-off exclusions; missing check-out at end + 15 min; duplicate runs
create one call; check-in meanwhile cancels; three attempts then HR follow-up; off switch respected.

## 19. HR approval test result
**Tested**: approval and rejection (reason required), no self-decision, no double decision, rows can't be deleted, the
employee is notified, and a rejected leave draft writes no `HrLeave` row.

## 20. Knowledge base record count
234 product records in the version-controlled seed (42 code-verified FAQs/procedures + 192 extracted from
`docs/HRMS.md`, Enterprise HRMS reports and the 68-screen catalogue), loaded into `AiHrKnowledgeDoc` as approved v1 on
first use; plus live organisation facts (hours, weekly offs, leave policy, holidays) and every published company policy.

## 21–22. Conversation scenarios and pass/fail
1,000 scenarios in 100 categories × 10, all structurally valid, 0 duplicates. Evaluation (rule engine, deterministic):
**966/1,000 pass (96.6%)** — tuning split 781/800 (97.6%), held-out 185/200 (92.5%). Per-check: structured output 100%,
intent 96.9%, escalation 99.5%, stop compliance 100% (18/18), no false stops 100%, AI disclosure 100%, one question
per reply 100%, language match 100%, knowledge grounded 99.1%. Full list of the 34 failures in SCENARIO_REPORT.md.
Honesty notes: the held-out scenarios were written by the same author as the rest; in the final tuning round the
held-out failures were visible, and two fixes touched behaviour they exercise (a Devanagari time-modifier bug and the
safety-escalation summary). Treat held-out as indicative.

## 23. Security test report
**Tested**: employee can't open another employee's conversation or send turns into it; employees can't open the HR
side or transcripts; HR can't change settings (super admin only); transcript deletion super-admin only; transcripts
sealed at rest (raw bytes don't contain the text); webhook off without config, rejects missing/wrong/expired
signatures, ignores duplicates; AI service rejects missing/wrong tokens on every endpoint and exposes no docs;
model output accepted only from a closed intent list. Cross-organisation: **N/A** (single-organisation HRMS).

## 24–28. Commands
Install, deploy, environment variables, restart and rollback: [DEPLOYMENT.md](DEPLOYMENT.md).

## 29. Troubleshooting
DEPLOYMENT.md §6.

## 30. Additional monthly operating cost
AI API subscriptions: **₹0** (none used). The AI host itself is not free unless an existing server is used: an 8 GB /
4 vCPU VPS typically costs roughly ₹1,500–4,000 a month in India (provider-dependent; not purchased). Phone calling,
if ever enabled, is billed by the telecom provider. WhatsApp alerts use the existing Cloud API set-up.

## 31. Remaining limitations
* No AI host → no voice or local-model assist in production yet; text conversations work.
* Voice and Hinglish pronunciation untested; latency/RAM unmeasured.
* Turn-based voice, one session at a time on 8 GB; not real-time streaming.
* Real phone calls not implemented beyond a disabled adapter and webhook.
* Single-organisation only, like the rest of the HRMS.
* Vercel Hobby runs the daily cron only: minute-level detection needs the external minute scheduler (`/api/cron/minute`).
* Approving a leave draft records HR's decision; the leave itself is still entered in Leave Management.
* No fine-tuning; rule engine coverage is bounded by its lexicon (34 known scenario failures).
* Legal review (DPDP consent text, employment, TRAI/DLT) not done.

## 32. Production readiness
| Feature | Implemented | Tested | Deployed | Notes |
|---|---|---|---|---|
| Repository audit | yes | — | — | AUDIT.md |
| Database schema + migration + rollback | yes | yes | no | |
| Attendance detection & dispatch | yes | yes | no | needs the minute scheduler |
| Conversation engine (3 languages) | yes | yes | no | 96.6% of 1,000 scenarios |
| Structured outcomes | yes | yes | no | |
| HR approval & escalation | yes | yes | no | |
| Stop-call consent | yes | yes | no | |
| Knowledge base & RAG | yes | yes | no | |
| Scenario library & evaluation | yes | yes | no | |
| HR UI / employee UI | yes | typecheck + lint only | no | no browser e2e yet |
| Browser voice | yes | no | no | needs AI host + device test |
| AI service (FastAPI) | yes | API tests with fake models (9/9) | no | **Blocked**: no host, models not downloadable here |
| Local LLM assist | yes | no (model not installed) | no | Blocked |
| Mobile calling (SIP/PSTN) | adapter + webhook only | webhook yes | no | Not implemented / needs provider |
| Fine-tuning | — | — | — | Not done (not justified yet) |

**Readiness: not production-ready for voice.** Ready for a preview deployment with text conversations once reviewed,
switched on deliberately, with a minute scheduler; voice follows the AI host.

## Test runs (this sandbox, PostgreSQL 16, Node 22)
| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (0 problems) |
| `pnpm test` (whole repository, unit + integration) | **233 files, 1,446 tests, all pass** (before this work the last recorded run was 230 files / 1,403) |
| `pnpm vitest run src/staff/hrms/ai-hr` (engine, knowledge, library, evaluation thresholds) | 21/21 pass |
| `tests/integration/ai-hr.test.ts` (services on PostgreSQL) | 19/19 pass |
| `pnpm build` (production) | pass; route `/api/webhooks/ai-hr/call-events` built |
| `ai-service` pytest (fake models) | 9/9 pass |
| Migration apply → rollback → re-apply → `migrate status` | up to date |
| `pnpm tsx scripts/ai-hr/evaluate.ts` | 966/1,000 scenarios pass |

Not run: Playwright e2e for the new screens, any test with the real STT/TTS/LLM models, browser microphone tests,
load tests of the AI host.
