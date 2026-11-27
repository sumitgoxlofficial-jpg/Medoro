# Enterprise HRMS 2.0 — Phase 2: employee management and organisation hierarchy

## Features
* **Reporting-line validation** (`src/staff/hrms/org.ts → checkManager`). A manager must be an active colleague, never the
  person themself and never someone below them (no loops). Enforced on New Employee, Edit employee, promotions when
  recorded, and again when a scheduled promotion takes effect (if the planned manager is no longer valid, the current
  line is kept and the rest of the promotion applies). Before this, `managerId` was saved unchecked.
* **Employment history** (`HrEmploymentEvent`, append-only by trigger, FK to `StaffUser`). Joining, edits of role,
  department, designation, type, location, manager, CTC, incentive and shift, transfers, promotions, exits (with notice
  periods) and reactivations, each with before/after values, the effective date and who made it.
  Pay values are shown only to Payroll holders and to the person; others with the Employees module see that a pay change
  happened, not the amounts.
* **Org chart** (new screen *Org chart*, COMPANY menu, everyone). Tree by reporting line, expandable, with search. It
  follows the existing visibility rules: HR and the super admin see everyone; others see their department, manager,
  reports and HR; the super admin is never shown to anyone else. HR can open anyone's history from the chart.
* **Organisation health** (HR): headcount by department, managers and average span of control, people with no manager,
  active people whose manager has left, spans wider than 12.
* **My employment history** for every employee on the same screen.

## Files
New: `src/staff/hrms/org.ts`, `src/app/staff/hrms/_ui/screens-org.tsx`, `prisma/migrations/20261210000000_hrms_org`,
`tests/integration/hrms-org.test.ts`, `scripts/rollback/20261210000000_hrms_org.down.sql`.
Changed: `prisma/schema.prisma` (model + relation), `src/staff/hrms/people.ts` (validation + events on create, edit,
deactivate/reactivate), `src/staff/hrms/promotions.ts` (validation, transactional apply with event),
`src/staff/hrms/constants.ts` / `screens.ts` / `_ui/screens.tsx` (screen), `src/app/staff/hrms/actions.ts`
(`employeeTimeline`), `src/domain/system/restore.ts` and `tests/integration/rls-readiness.test.ts` (new table is
platform data, not part of a pharmacy restore).

## API
New server action `employeeTimeline(staffId)` (self, or Employees module). New screen loader `orgchart`.

## Tests
`hrms-org.test.ts` (7): chain walk; self/loop/unknown/inactive managers refused on create, edit and promotion with
nothing saved; history for join, transfer (with manager names and CTC) and exit; trigger blocks update and delete;
promotion applied by the scheduler records an event and keeps the old manager when the planned one became a loop;
pay hidden from an Employees-only role, shown to Payroll and to the person, refused for a colleague; org chart
visibility (super admin hidden, other department hidden); health lists orphaned lines and people without a manager,
refused for employees. Full suite: 223 files / 1,360 tests pass; lint and typecheck pass; schema vs migrations diff empty.

## Rollback
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/rollback/20261210000000_hrms_org.down.sql` (drops only the new
table; history recorded since the deployment is lost, nothing else).
