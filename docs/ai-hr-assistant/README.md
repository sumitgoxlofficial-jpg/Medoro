# Medoro AI HR Assistant

An AI assistant inside the Medoro HRMS that notices attendance exceptions (late, absent, missing check-out) and
overtime requests, talks to the employee in Hinglish, Hindi or English (text, or turn-based voice with a Hindi female
voice from a self-hosted AI service), records a validated outcome, and hands decisions and escalations to HR.

| Document | What it covers |
|---|---|
| [AUDIT.md](AUDIT.md) | Phase 1 repository and HRMS audit, requirement classification |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data model, why rules lead and the model assists, security and privacy |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Infrastructure status, install, environment variables, restart, rollback, monitoring, troubleshooting |
| [HANDOVER.md](HANDOVER.md) | The 32-point delivery report with evidence and per-feature status |
| [SCENARIO_REPORT.md](SCENARIO_REPORT.md) | Generated: library validation and evaluation of all 1,000 scenarios |

Code: `src/staff/hrms/ai-hr/` (engine, knowledge, scenarios, service), `src/app/staff/hrms/_ui/screens-aihr.tsx`
(HR), `_ui/screens-aicall.tsx` (employee), `ai-service/` (FastAPI AI host), `scripts/ai-hr/`.

Commands:
```bash
pnpm tsx scripts/ai-hr/evaluate.ts            # run all scenarios, regenerate SCENARIO_REPORT.md
pnpm tsx scripts/ai-hr/show.ts traffic-03      # print one scenario's conversation
pnpm tsx scripts/ai-hr/build-knowledge.ts      # re-extract product knowledge from docs and screens
pnpm vitest run src/staff/hrms/ai-hr tests/integration/ai-hr.test.ts
```
