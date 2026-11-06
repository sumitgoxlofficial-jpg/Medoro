# Implementation report

Branch `claude/sharp-tesla-va6ncu`. Growth Intelligence is built into the existing staff console; no existing feature
was rewritten, and no new npm dependency was added.

## Phases

| Phase | Status |
|---|---|
| 1 Repository audit and compatibility | Done: repository-audit.md; stack verified (Next 15.5.28, React 19, Prisma 6.19.3, PostgreSQL 16, Argon2 staff auth) |
| 2 Foundation and migrations | Done: 33 tables, additive migration, RLS, append-only triggers, partial unique index |
| 3 Discovery and imports | Done: OpenStreetMap discovery, CSV/XLSX import with mapping, preview, duplicates, error reports, history |
| 4 Verification and scoring | Done: evidence-only verification, SSRF-safe website check, 100-point score with breakdown |
| 5 Employees and distribution | Done: Growth roles on existing staff, teams, territories, targets, Distribution Centre |
| 6 Personal mobile calling | Done: validated `tel:` launch, call sessions, workspace on phones |
| 7 Call reports and follow-ups | Done: transactional, idempotent reports; follow-up lists, calendar, escalation |
| 8 CRM and pipeline | Done: 16 stages, Kanban/table, demos, trials, conversions, lost reasons, hand-off to the commission pipeline |
| 9 WhatsApp and email | Done in code, **not live-tested** against Meta or a mail provider (no credentials here): Cloud API sending, template sync, signed webhook, STOP; email sender confirmation, templates with approval, unsubscribe, bounce/complaint/reply events; campaigns; unified inbox |
| 10 Analytics and performance | Done: dashboards, funnels, trends, employee performance from live rows |
| 11 Compliance and security | Done: consent, suppression, erasure, retention, audit, export controls; see compliance.md and security.md |
| 12 Testing and deployment | Unit, integration and e2e tests pass; production build passes; deployment guide written. **Not deployed** (staging migration is a step for you) |

## Acceptance criteria

1–13, 16–21 met and tested (see testing.md). 14–15 (WhatsApp/email "work in approved configurations"): implemented and
tested with stubbed providers and real signature checks; needs a live Meta app and mail provider to confirm. 22: deployment
documentation is in deployment.md.

## Files

* New: `src/staff/growth/*` (19 modules + tests), `src/app/staff/(console)/growth/*` (23 screens), `src/app/staff/growth-actions.ts`,
  `src/app/staff/api/growth/*` (25 route files), `src/app/api/growth/*` (3 public routes), `prisma/migrations/20261113000000_growth_intelligence`,
  `tests/integration/growth.test.ts`, `e2e/29-growth.spec.ts`, `docs/growth-engine/*`.
* Modified: `prisma/schema.prisma` (new models; relation fields on `StaffUser`), `src/app/staff/(console)/{layout,shell,nav}.tsx`
  (Growth menu), `src/app/api/cron/tick/route.ts` (runs `growthTick`), `src/domain/system/restore.ts` (Growth tables
  classified global), `README.md`, `.env.example`.

## Decisions that differ from the brief

* **API path**: `/staff/api/growth/*` instead of `/api/growth/*`, because the staff session cookie is scoped to `/staff`.
  Public webhooks and unsubscribe are under `/api/growth/*`.
* **GrowthEmployee / GrowthRole / GrowthPermission**: one `GrowthMember` table + enum + a code-level permission matrix
  (the pattern the pharmacy app uses), instead of three tables.
* **Existing `Lead` pipeline** (commission) is kept as is; Growth leads can be handed off into it.
* **AI**: rule-based by default (no paid API), optional rewording through the existing AI provider settings with a guard
  that rejects output adding numbers, links or contacts.
* **Employee performance** is computed live; `EmployeeDailyPerformance` is a nightly history roll-up.

## Outstanding

1. **Medoro platform Google Drive** for CRM exports and encrypted platform backups is not implemented: Medoro has no
   platform-level Drive credentials today (the existing Drive integration is per pharmacy). Exports download to the
   admin's device; Growth data is protected by the database host's backups. Needs a decision on a platform Google account.
2. **TRAI risk of calls from personal SIMs** (compliance.md): get legal advice; consider the authorised-only policy and
   registered 140/1600-series numbers.
3. Live verification of WhatsApp Cloud API and email providers with real credentials, on staging.
4. Vercel Hobby runs the scheduler daily; campaigns and escalations need a more frequent cron (Pro) or a self-hosted runner.
5. Owner-name verification has no dedicated control yet (owner names from sources stay "not verified"; AI greetings use
   them only when verified).
6. The Growth UI is English only (the staff console is English only today).
7. Duplicate detection compares within the same PIN; fuzzy matches across neighbouring PINs aren't found.
