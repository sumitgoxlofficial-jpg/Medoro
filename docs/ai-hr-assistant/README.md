# Medoro AI HR Assistant

An AI assistant inside the Medoro HRMS that notices attendance exceptions (late, absent, missing check-out) and
overtime requests, talks to the employee in Hinglish, Hindi or English (text, or turn-based voice with Kokoro-82M's female Hindi
voice from a self-hosted AI service), records a validated outcome, and hands decisions and escalations to HR.

| Document | What it covers |
|---|---|
| [MASTER-ARCHITECTURE.md](MASTER-ARCHITECTURE.md) | **Start here.** Components, voice pipeline (Kokoro-82M), API contracts, HR brain, resource plan |
| [KOKORO-TTS-SETUP.md](KOKORO-TTS-SETUP.md) | Installing and configuring Naina's self-hosted voice; choosing hf_alpha / hf_beta |
| [HINGLISH-PRONUNCIATION.md](HINGLISH-PRONUNCIATION.md) | Display text vs speech text, numbers/dates/IDs, the 796-term dictionary, override file |
| [HR-CONVERSATION-SCENARIOS.md](HR-CONVERSATION-SCENARIOS.md) | The 1,060-scenario library, format, coverage of the brief's 45 categories |
| [SECURITY.md](SECURITY.md) | Access control, privacy (DPDP), AI host hardening, **licence verification** |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Voice, app and conversation problems |
| [TEST-REPORT.md](TEST-REPORT.md) | What was tested, measured RAM/CPU/latency, what wasn't |
| [AUDIT.md](AUDIT.md) | Phase 1 repository and HRMS audit, requirement classification |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data model, why rules lead and the model assists, security and privacy |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Infrastructure status, install, environment variables, restart, rollback, monitoring, troubleshooting |
| [HANDOVER.md](HANDOVER.md) | The 32-point delivery report with evidence and per-feature status |
| [SCENARIO_REPORT.md](SCENARIO_REPORT.md) | Generated: library validation and evaluation of all 1,060 scenarios |

Code: `src/staff/hrms/ai-hr/` (engine, knowledge, scenarios, service), `src/app/staff/hrms/_ui/screens-aihr.tsx`
(HR), `_ui/screens-aicall.tsx` (employee), `ai-service/` (FastAPI AI host), `scripts/ai-hr/`.

Commands:
```bash
pnpm tsx scripts/ai-hr/evaluate.ts            # run all scenarios, regenerate SCENARIO_REPORT.md
pnpm tsx scripts/ai-hr/show.ts traffic-03      # print one scenario's conversation
pnpm tsx scripts/ai-hr/build-knowledge.ts      # re-extract product knowledge from docs and screens
pnpm vitest run src/staff/hrms/ai-hr tests/integration/ai-hr.test.ts
pnpm tsx scripts/ai-hr/export-voice-lines.ts   # Naina's real lines -> ai-service/tests/data/naina_lines.json
cd ai-service && python -m pytest -q          # voice service + Hinglish layer (no model needed)
python scripts/benchmark_tts.py --spawn        # real Kokoro benchmark on the AI host
```
