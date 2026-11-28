# Enterprise HRMS 2.0 — Phase 3: granular access, approvals and workflow automation

## Features
* **Individual access** (super admin, *Approvals → Individual access*). Give one person a module their role lacks, or take
  one away, with a reason and an optional last day. A removal always beats a grant; the super admin can't be changed.
  Applied in one place (`effectivePerms`), so actions, screens, menus and "who holds this module" notifications agree.
  Every action re-reads grants (`hrRun`), so ending access takes effect on the person's next click. Grant rows can't be
  deleted (trigger); they are ended (`revokedAt`) and kept.
* **Approvals engine** (`src/staff/hrms/approvals.ts`, screen *Approvals* for everyone). Workflows are declared in code
  with their input schema, who may raise them, the steps and the change to make. Rules enforced on the server:
  nobody decides a request they raised or one about themselves; a manager step without a usable manager is skipped and
  recorded; each step is claimed atomically (two approvers can't both decide it); the change is made in the same
  transaction as the last approval; a rejection needs a reason; the requester can withdraw while pending.
  * **Salary change** (`ctc_change`): HR or Payroll proposes a new CTC with a reason → reporting manager → super admin →
    CTC, salary revision and employment-history event saved together. Not for oneself; one pending request per person.
  * **Temporary access** (`access`): anyone asks for a module for 1–30 days → manager → super admin → an expiring grant.
* **Delegation**: an approver away hands their approvals to a colleague for up to 60 days; both can decide meanwhile.
* **Escalation** (scheduled, `/api/cron/tick`): a step undecided for 48 hours reminds the approver (and delegates) and
  tells the super admins, once.
* **Settings → Security & approvals** (both off by default, so nothing changes until the super admin opts in):
  * *Two-step sign-in for HR, Finance and the super admin*: anyone in those roles without an authenticator gets a
    first-sign-in step (QR code, then a code; attempts rate-limited) before anything else opens; afterwards sign-in asks for
    the code. Turning it on signs the person's other devices out.
  * *Salary changes need approval*: HR can't change a CTC in Edit employee or a promotion; it goes through Approvals.

## Files
New: `src/staff/hrms/access.ts`, `src/staff/hrms/approvals.ts`, `src/app/staff/hrms/_ui/screens-approvals.tsx`,
`src/app/staff/hrms/_ui/mfa.tsx`, `prisma/migrations/20261211000000_hrms_rbac_approvals`, `tests/integration/hrms-approvals.test.ts`,
`scripts/rollback/20261211000000_hrms_rbac_approvals.down.sql`.
Changed: `auth.ts` (grants in `getMe`/`hrRun`/`holders`, MFA set-up), `gate.ts` (step `mfa`), `constants.ts` (settings,
screen), `people.ts` / `promotions.ts` (CTC approval rule; settings schema), `screens.ts`, `actions.ts`, `_ui/frame.tsx`
(MFA step), `_ui/screens-hr.tsx` (settings card), `_ui/screens.tsx`, `src/server/cron.ts` (escalation),
`restore.ts`, `rls-readiness.test.ts`.

## Database
Tables `HrAccessGrant` (FK `StaffUser`, no deletes), `HrApproval` (no deletes), `HrApprovalStep` (FK, cascade with its
approval), `HrDelegation`; column `HrProfile.totpPending` (sealed). RLS enabled on the new tables.

## API (server actions)
`requestApproval`, `decideApproval`, `cancelApproval`, `delegateApprovals`, `cancelDelegation`, `addAccessGrant`,
`revokeAccessGrant`, `mfaStart`, `mfaConfirm`. Screen loader `approvals`.

## Tests
`hrms-approvals.test.ts` (10): super-admin-only grants, reason required, grant/deny/deny-wins/revoke, expiry, no delete,
revocation effective on the next action; access workflow (self-decision refused, admin can't take the manager's step,
grant only after the last step, no double decision, no delete); salary workflow (self and non-HR refused, duplicate
pending refused, rejection needs reason and changes nothing, approval changes CTC + revision + history); skipped manager
step and withdrawal; delegation on/off; escalation exactly once; CTC-needs-approval setting (HR refused, other edits fine,
super admin allowed); MFA required for HR not employees, everything gated until set up, wrong code refused, sign-in then
asks for the code. Full suite 224 files / 1,370 tests pass; lint and typecheck pass.
