# Enterprise HRMS 2.0 — Phase 8: management dashboards, testing, optimisation and deployment

## Management dashboard (screen *Management*, Reports module)
`src/staff/hrms/mgmt.ts`: active headcount; 12-month headcount/joins/exits from joining and last working days;
attrition (exits in 12 months ÷ average month-end headcount); this month's check-ins and late share; approved leave;
KPI average per department for the current month (**hidden below 5 people**); required-course completion and overdue;
the latest eNPS from a survey with at least 5 answers; approvals waiting/overdue, expiring documents, enrolled PCs;
payroll gross by department for the latest processed month (**Payroll module only**). Every block shows its definition;
opening the page is audited; **CSV export** for board packs. Workforce activity is not part of any number.

## Testing done in this phase (actual results)
| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint` | pass |
| `pnpm test` (unit + integration, PostgreSQL 16) | **231 files, 1,406 tests, all pass** (Phase 1 baseline: 221 / 1,344) |
| `pnpm build` (production) | pass; 8 Turbopack "dynamic filesystem access" warnings, identical to the baseline build |
| Playwright on the production build | setup, `30-hrms` (new-joiner onboarding through the server-side gate), `31-hrms-chat-bubble`, `34-sales-academy`, new `40-enterprise-hrms` (every new screen; shift, KPI + compute, course publish, survey; PC enrolment code from the UI; agent API over HTTP: enrol, tracking-off → policy → not-checked-in → ok, event accepted, extra field refused with 400, revoked device 401). First run: `34-sales-academy` failed once ("Score" button not stable while animating) and `40` failed on an ambiguous selector (fixed). Re-run on a fresh database: **all pass**. The Sales Academy failure did not reproduce; treat it as intermittent. |
| Agent (`dotnet test`) | **23 / 23** |
| Agent core ↔ real server (`Medoro.Agent.E2E` against `next start`) | enrolled, status ok, 300 s sampled and stored as 3 process spans, queue empty |
| Windows tray host | `dotnet publish -r win-x64` builds with warnings as errors |
| Migrations | schema vs migrations diff empty; apply all 7 on a database with existing payslips/history → roll all 7 back newest-first (241 → 220 tables, existing rows intact, 7 pending) → re-apply (241, rows intact, append-only trigger active again, diff empty) |

Roles exercised across the phase tests: super admin, HR (two, for "someone else" rules), Finance/Payroll, reporting
manager, delegate, ordinary employee (several departments), salesperson, new joiner with a temporary password,
an unenrolled/revoked device.

## Optimisation
Indexes for every new query path (audit log by time and person, reporting lines, approvals by status/approver/due,
work events by person+day and day, KPI results by person+period, roster by person+day, enrolments by person); permissions
and settings keep their short per-instance cache, while every action re-reads permissions and grants. Agent uploads are
batched (≤500 spans), idempotent and rate-limited. The management page runs a bounded set of aggregate queries.

## Not executed (and why)
* On Windows: agent installation, start at sign-in, the Win32 sampler and lock events, DPAPI, tray UI, msiexec update.
  No Windows machine here; `.github/workflows/agent.yml` builds and tests on `windows-latest`.
* An MSI installer and code signing for the agent: not built.
* Other Playwright specs (pharmacy, distribution, growth), the Docker job, `pnpm audit`, gitleaks: outside the HRMS; CI runs them.
* Load testing of the agent ingest at production volume.
* Running the integrity report or any migration against production: needs the owner's approval and access.

See `DEPLOYMENT.md` for deployment, backup, retention and rollback.
