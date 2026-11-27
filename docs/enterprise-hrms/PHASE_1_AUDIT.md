# Enterprise HRMS 2.0 — Phase 1: audit, security hardening and foundation

Date: 2026-11-27. Scope: the Medoro HRMS (`/staff/hrms`, `src/staff/hrms`, `src/app/staff/hrms`), its sign-in and
session layer (`src/staff/auth.ts`, `src/staff/hrms/auth.ts`), the HR and staff tables in `prisma/schema.prisma`, and
the test and deployment set-up it depends on. The pharmacy and distribution products in the same repository were
checked only where the HRMS shares code with them (storage, rate limits, audit, triggers).

## 1. What exists today

| Area | Finding |
|---|---|
| Stack | Next.js 16.4 (App Router, `src/proxy.ts`), React 19, TypeScript strict, Prisma 6.19, PostgreSQL 16 (Supabase in production), Zod 4, Vitest 5, Playwright. Vercel deployment with `/api/cron/*`. |
| Scale of the HRMS | 50 service modules (~9k dense lines) in `src/staff/hrms`, 14 file/data route handlers, ~150 server actions in one `actions.ts`, 49 `Hr*`/`Staff*` tables plus the `Tr*` Sales Academy tables, 30 HRMS integration test files. |
| Organisation model | **Single organisation.** The HRMS is for Medoro's own team; there is no tenant/organisation column on any HR table. Pharmacy tenants (`Tenant`) are a separate product and never read HR tables. |
| Identity | `StaffUser` (one table for console staff, HRMS employees and reference partners, `kind` = team/partner) + `HrProfile` (1:1). Soft delete (`deletedAt`, email rewritten, sessions revoked); payroll rows are kept. |
| Authentication | Employee ID or work email + Argon2id password; HR-issued one-time passwords (24 h) and emailed 6-digit codes (10 min, rate-limited); lockout after 5 failures per account and per IP; optional TOTP (required for super admins in the console). Sessions: random 256-bit token, SHA-256 stored, httpOnly, `SameSite=Strict`, `Secure` in production, path `/staff`, 10 h expiry, `tokenVersion` revocation, password change revokes other sessions. HRMS sessions (`kind=hrms`) never open the staff console (sales excepted). |
| Authorisation | Role → module matrix (`DEFAULT_PERMS`, editable by the super admin, audited), checked in services with `need()` / `needAdmin()` / `can()`; actions always re-read permissions (`hrRun`). Object-level checks on every file route (owner or module holder). Visibility rules hide the super admin and limit ordinary employees to their department, manager, reports and HR. |
| Sensitive data | Bank account, PAN, Aadhaar, chat messages and selfies sealed with `HOST_KEY` (`src/server/vault`); masked everywhere; full KYC numbers only through an audited reveal. Bank file download audited. |
| Audit | `StaffAudit`, append-only by database trigger; every HR decision writes a row. |
| Monitoring | Selfie check-in and idle detection are **off by default**, browser-tab only, disclosed on the Attendance screen, 30/90-day retention. No keylogging, screenshots, microphone, camera streaming or other-app tracking. This already matches the privacy rules in the master instruction. |
| Security headers | Per-request nonce CSP, HSTS on HTTPS, Origin checks on server actions (Next.js) and cookie-authenticated API posts, PostgreSQL-backed rate limits, CodeQL, gitleaks, Dependabot, SBOM in CI. |
| Tests | Baseline on this branch's parent commit (`1a68b88`): `pnpm typecheck` pass, `pnpm lint` pass, `pnpm test` **221 files / 1,344 tests pass** (local PostgreSQL 16). |

## 2. Findings

Severity: **High** = exploitable by a signed-in user to gain money, access or data they should not have;
**Medium** = weakens a control; **Low** = hardening / hygiene.

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | High | **The first-sign-in gate was UI-only.** A session with a temporary or one-time password (or with details / KYC / joining documents not done) still received the requested screen's data in the page payload, could call every server action and open every file route. Someone who obtained an OTP email or HR's temporary password got full access without ever setting a password. | **Fixed** |
| F2 | High | **HR could edit their own employment record**, including annual CTC, incentive %, tax regime/declarations, reporting manager and pay cycle (`updateEmployee`). The code already blocked self-promotion, self-approval of leave/claims/corrections and self-verification of documents; this path was missed. A CTC raise flowed straight into the next payroll. | **Fixed** |
| F3 | High | **A payroll holder could change their own loss-of-pay days** in the payroll run (`processPayroll` overrides). Hand overrides were not recorded in the audit trail at all. | **Fixed** (self-override refused; every override audited) |
| F4 | Medium | **HR could add days to their own leave balance** (`grantLeave`). | **Fixed** |
| F5 | Medium | **A payroll holder could confirm their own bank account** as theirs when the holder name doesn't match (`confirmBank`), bypassing the check that salary only goes to the employee's own account. | **Fixed** |
| F6 | Medium | **Employee documents and claim bills trusted the browser's MIME type.** Any bytes labelled `application/pdf` were stored and later served inline. The résumé and training uploads already checked magic bytes; these two did not. | **Fixed** (magic-byte check with the existing `sniff()`) |
| F7 | Medium | **Full Aadhaar/PAN reveals had no throttle.** Each reveal is audited, but an HR account could open every employee's numbers in a loop. | **Fixed** (30 per HR person per hour; refusals audited) |
| F8 | Medium | **Payslips and salary revisions were mutable in the database.** The application only inserts them, but any SQL path (a script, a compromised service key, the Supabase dashboard) could silently change pay history. | **Fixed** (append-only triggers, as on `StaffAudit`) |
| F9 | Low | No index on `StaffAudit` (audit-log screen, per-person history) or on `HrProfile.managerId` / `dept` (My Team, visibility rules, approvals run on every page). | **Fixed** (4 indexes) |
| F10 | Medium | **Almost no foreign keys on HR tables.** 45 of 49 HR/staff tables keep `staffId`, `managerId`, `assigneeId`… as plain text. Orphaned rows are possible and cross-table integrity is enforced only in code. | **Deferred to Phase 2** — adding FKs to production must first prove there are no orphans. Read-only report added: `scripts/hrms-integrity-check.sql`. |
| F11 | Medium | **HR and Finance sign in to the HRMS with a password only.** TOTP exists but is only enforced for super admins in the console. These roles can see salaries, bank files and KYC. | **Open — recommended for Phase 3** (needs an enrolment flow in the HRMS so nobody is locked out; not changed silently). |
| F12 | Low | Permissions are per role × module (about 20 modules). There are no per-action permissions, field-level rules or delegation. | Phase 3 (granular RBAC). |
| F13 | Low | No organisation/tenant scoping on HR tables. Correct for today's single-company HRMS. | Decision needed before Phase 2 (see §6). |
| F14 | Low | `actions.ts` exposes ~150 actions in one file; inputs are validated in the services with Zod, but some actions pass raw objects through `In<>` types without a schema at the boundary. All reviewed services parse their input; no unvalidated write path was found. | No change; keep the convention (parse in services). |

Checked with no issue found: IDOR on all 14 file/data routes (owner-or-module checks everywhere), payslip and tax
statement access, chat membership checks, super-admin protection (can't be edited, deactivated or deleted by HR; last
super admin kept), HR can't grant HR/Finance roles, session fixation/revocation, OTP brute force, CSV formula injection
(`'` prefix in exports), secrets (only `.env.example` in git; gitleaks in CI), AI assistant rate limit and permission scoping.

## 3. Changes made in Phase 1

| File | Change |
|---|---|
| `src/staff/hrms/auth.ts` | `hrRun(fn, message, { during })` refuses every action until the gate is cleared, except those explicitly allowed for the current step; new `getReadyMe(during)` for routes; `GateStep`, `ANY_STEP`, `GATE_MESSAGE`. |
| `src/app/staff/hrms/actions.ts` | Gate steps declared on the 8 actions the onboarding screens use (change password, save details, KYC status/save/skip, upload document, read own letter, accept documents). |
| `src/app/staff/hrms/[[...s]]/page.tsx` | While a gate step is open, no screen data is loaded or serialised. |
| 14 route handlers under `src/app/staff/hrms/**/route.ts` | `getMe()` → `getReadyMe()`; documents and DigiLocker allowed during the KYC step, the person's own letters during the documents step. |
| `src/staff/hrms/people.ts` | No self-edit of the employment record (non-admin); no self bank confirmation. |
| `src/staff/hrms/time.ts` | No self leave-balance grant; claim bills checked by content. |
| `src/staff/hrms/pay.ts` | No self loss-of-pay change (sending your own computed value unchanged is allowed); every changed value is written to the audit trail. |
| `tests/integration/hrms.test.ts` | The exit-settlement test zeroed loss of pay for everyone, including the HR user running payroll; it now leaves the runner's own line alone (what it checks is unchanged). |
| `src/staff/hrms/docs.ts` | Documents checked by content. |
| `src/staff/hrms/kyc.ts` | Reveal throttle + audited refusal. |
| `prisma/schema.prisma`, `prisma/migrations/20261209000000_hrms_hardening` | Append-only triggers on `HrPayslip`, `HrSalaryRevision`; indexes on `StaffAudit(at)`, `StaffAudit(staffId, at)`, `HrProfile(managerId)`, `HrProfile(dept)`. No table, column or row changed. |
| `scripts/rollback/20261209000000_hrms_hardening.down.sql` | Tested rollback. |
| `scripts/hrms-integrity-check.sql` | Read-only orphan/consistency report for production before Phase 2 FKs. |
| `tests/integration/hrms-hardening.test.ts` | 9 integration tests for F1–F8. |
| `docs/HRMS.md` | The new rules under *Rules the code enforces*. |

No API endpoint was added or removed; behaviour changed only for the refused cases above. Database models: no new
model; two `@@index` blocks added.

## 4. Tests

Run locally on PostgreSQL 16 (Node 22), 2026-11-27:

| Check | Before (parent `1a68b88`) | After |
|---|---|---|
| `pnpm typecheck` | pass | pass |
| `pnpm lint` | pass | pass |
| `pnpm test` (unit + integration) | 221 files, 1,344 tests, all pass | 222 files, 1,353 tests, all pass |
| `pnpm build` (production) | — | pass |
| Playwright on the production build: `setup.e2e.ts`, `30-hrms.spec.ts` (new joiner: temporary password → details → Aadhaar & PAN → joining documents → check-in, leave, payroll, exit), `31-hrms-chat-bubble.spec.ts`, `34-sales-academy.spec.ts` | — | 4 / 4 pass |

The first full run on the branch had one failure: the existing exit-settlement test zeroed loss of pay for every
line, including the HR user running payroll, whose own computed loss of pay was not zero — the case F3 now refuses.
The rule was narrowed to "refuse only a change to your own value" (re-sending the computed value is allowed) and the
test now leaves the runner's own line alone.

Not run: the other Playwright specs (pharmacy, distribution, growth; outside the HRMS and not part of CI's HRMS set),
the Docker job, `pnpm audit` and gitleaks (CI runs them on push). The page change in `[[...s]]/page.tsx` (no screen data
while a gate step is open) is covered by the onboarding e2e path, not by a dedicated assertion on the page payload.

* Migration: applied to a database that already had payslip rows; update blocked by the trigger; rollback script run in
  one transaction (triggers and indexes gone, migration pending again, data unchanged); re-applied; `prisma migrate status`
  up to date. Rollback is idempotent.
* Roles exercised by the new tests: super admin, HR (two HR people, to prove "someone else" works), finance/payroll,
  employee, a new joiner with a temporary password.

## 5. Deployment and rollback

Deploy (after review, to a preview first):
1. Back up the production database (Supabase: point-in-time recovery or `pg_dump`) and run
   `psql "$DATABASE_URL" -f scripts/hrms-integrity-check.sql` on a replica; keep the output.
2. **Merging to `main` is a production deployment** (Vercel deploys only `main`, and `scripts/vercel-build.sh` runs
   `prisma migrate deploy` over `DIRECT_URL` for production builds), so it needs the owner's explicit approval. Preview
   builds migrate only a database marked `PREVIEW_DATABASE=1`. The migration only creates two triggers and four indexes
   on small tables; it takes well under a second and needs no downtime.
3. Smoke test: sign in as a new joiner with a temporary password (only the password step works), as HR (can't edit own
   record), and process a payroll month in a preview.

Rollback: redeploy the previous Vercel deployment, then
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/rollback/20261209000000_hrms_hardening.down.sql`.
The code change and the migration are independent: old code runs fine with the new triggers (it never updates payslips).

## 6. Decisions needed before Phase 2

1. **Single company or multi-organisation?** Today the HRMS serves one company (Medoro). If it must also be sold to
   other companies, Phase 2 adds an `Organisation` table and an `orgId` to every HR table (backfilled to Medoro), and
   every query gets scoped. That is a large, cross-cutting change and should be decided now.
2. **MFA for HR and Finance (F11):** enforce at next sign-in with an enrolment step, or make it a super-admin setting?
3. **Foreign keys (F10):** run the integrity report on production and share the counts; orphan handling (attach to a
   placeholder, or leave the FK `NOT VALID` for old rows) depends on what it finds.
