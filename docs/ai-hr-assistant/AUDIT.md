# AI HR Assistant — Phase 1 architecture audit

Date: 2026-11-28. Scope: the whole repository, with depth on the HRMS (`src/staff/hrms`, `src/app/staff/hrms`, the `Hr*`
tables in `prisma/schema.prisma`), the existing AI code (`src/domain/ai`, `src/staff/hrms/ally*.ts`), the scheduler
(`src/server/cron.ts`) and the deployment set-up (`vercel.json`, `scripts/vercel-build.sh`, `Dockerfile`, `deploy/`).

## 1. What the repository actually is

| Area | Finding |
|---|---|
| Framework | Next.js **16.4.6** App Router (`src/proxy.ts`), React 19, TypeScript strict, Tailwind 4, Zod 4. |
| Data | PostgreSQL 16 (Supabase in production) through **Prisma 6.19.3**; `pg` for NOTIFY. Append-only triggers (`medoro_block_delete`, `medoro_append_only`), RLS enabled on every HR table so the hosted data API can't reach them. |
| Products in one codebase | Pharmacy SaaS (`/app`), Distribution ERP (`/dist`, `/portal`), the staff console (`/staff`), Growth (`/staff/growth`) and the **Medoro HRMS** (`/staff/hrms`). |
| HRMS organisation model | **Single organisation** (Medoro's own team). No tenant column on HR tables; pharmacy `Tenant` rows never touch HR data. Decision recorded in docs/enterprise-hrms (Phase 1 §6) and still open. |
| Identity & auth | `StaffUser` + `HrProfile` (1:1); employee ID / email + Argon2id; optional TOTP; `medoro_staff` cookie (`SameSite=Strict`, path `/staff`); `hrRun()` wraps every server action, re-reads permissions and enforces the first-sign-in gate. |
| RBAC | Role × module matrix (`DEFAULT_PERMS`, editable), per-person grants/denies (`access.ts`), `need()` / `needAdmin()` / `can()` in services; reporting managers get team rights. |
| Roles & dashboards | Employee, Sales, HR Admin, Finance, Super Admin dashboards; My Team for managers; 69 screens in `SCREENS`. |
| Attendance | `HrAttendance` (one row per person per day: `inAt`, `outAt`, `status`), `HrBreak`, `HrCorrection`, `HrSelfie`, `HrIdle`; check-in/out, lateness (`lateAfterFor`), automatic close of missed check-outs (half-day LOP). |
| Shifts | `HrShift`, `HrShiftAssignment` (roster, newest wins), per-person `shiftStart`, company `lateAfter`, overtime **report** (not paid automatically). |
| Leave & holidays | `HrLeave` (types, half day, unpaid, manager or HR decides), balances, carry forward, `HrHoliday` calendar, weekly offs in Settings. |
| Payroll | `HrPayslip` (append-only), salary revisions, PF/ESI/PT/TDS, bank file, final settlement. |
| Other HR | Onboarding, letters, documents/KYC, policies (versioned, acknowledged), exits, appraisals, KPIs, learning, surveys, approvals/delegation, assets, workforce agent, chat, careers, Sales Academy. |
| Notifications | `notify()` → `HrNotification` + optional WhatsApp Cloud API copy (`HrWaMessage`, opt-in). |
| Background jobs | `tick()` in `src/server/cron.ts`: `/api/cron/tick` (Vercel daily) and `/api/cron/minute` (external minute scheduler), or an in-process scheduler when self-hosted. Jobs are idempotent DB-driven loops. |
| Existing AI | **Pharmacy AI assistant** (`src/domain/ai`: rule planner, Ollama/remote providers, tool registry, confirmation protocol). **Ally** HR assistant (`ally.ts`): answers from the person's own records and published policies, optional local Ollama, never remote for HR data. `hostClass()` classifies model hosts. |
| Deployment | Vercel (`vercel.json`, region `bom1`, only `main` deploys; migrations run in `vercel-build.sh`). Confirmed through the Vercel connector: project `medoro` exists. Docker Compose for self-hosting. |
| Monitoring | JSON logs with redaction, `/api/health`, `/api/ready`, Prometheus `/api/metrics`, `SystemHeartbeat`. |
| Tests | Vitest unit + integration against real PostgreSQL (230+ files), Playwright e2e, CodeQL, gitleaks. |

## 2. Requirement classification (before this work)

| Requirement | Status before | Notes |
|---|---|---|
| HRMS modules (attendance, shifts, leave, holidays, payroll, documents, policies…) | **Already implemented** | Reused as-is; nothing duplicated. |
| Role-based permissions | **Already implemented** | AI screens use the `attendance` module (operations) and `employees` (knowledge); settings are super-admin only. |
| Notifications (in-app + WhatsApp opt-in) | **Already implemented** | Reused for "the assistant wants a word". |
| Durable background jobs | **Already implemented** | AI detection/dispatch added as one more job in `tick()`. |
| Local LLM client (Ollama) | **Partially implemented** | `src/domain/ai/llm.ts` talks to Ollama on the app host; a separate authenticated AI host was missing. |
| HR assistant (text Q&A) | **Partially implemented** | Ally answers questions; no outbound conversations, no voice, no structured outcomes. |
| Policy retrieval | **Partially implemented** | Keyword retrieval over published policies (`ally-knowledge.ts`); no versioned, approved knowledge base for the product. |
| Attendance exception detection & AI conversations | **Missing** | Built. |
| Speech to text / text to speech / browser voice | **Missing** | Built (AI service + turn-based browser voice). |
| Structured conversation outcomes, HR approval of AI proposals | **Missing** | Built. |
| Scenario library and evaluation | **Missing** | Built (1,000 scenarios, evaluator). |
| Multi-organisation isolation for HR data | **Requires a product decision** | HRMS is single-organisation; AI tables follow it. Isolation implemented and tested is *between employees* (and HR vs employee). |
| Persistent 8 GB AI host | **Blocked by infrastructure** | The app runs on Vercel serverless; no persistent server was found or provided. |
| Real mobile (PSTN) calling | **Blocked by infrastructure / commercial** | Needs a licensed SIP/PSTN provider; adapter interface built and disabled. |

No broken features were found in the parts this work touches.
