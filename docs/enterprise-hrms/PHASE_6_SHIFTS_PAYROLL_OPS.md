# Enterprise HRMS 2.0 — Phase 6: attendance, shifts, payroll and workforce operations

Attendance, leave, corrections, claims, payroll (pay cycles, LOP, PF/ESI/PT/TDS, final settlement, bank file, returns)
already existed and are tested; Phase 6 adds what was missing for shift-based operations, without changing how pay is
computed.

## Features
* **Shifts** (`HrShift`): name, start, end (may cross midnight), grace, break; expected work = length − break.
* **Roster** (`HrShiftAssignment`, deletes blocked): people on a shift from a day, until a day or open-ended. A new entry
  cuts older overlapping entries short (history kept); the newest entry covering a day wins. Each person is notified.
  A shift with people still rostered can't be archived.
* **Lateness from the roster**: check-in is late after the rostered shift's start + grace; otherwise the person's own
  shift start (Edit employee), otherwise Settings (`time.ts` → `lateAfterFor`). My day shows the rostered start.
* **Overtime report** per month: worked time (check-out − check-in − breaks taken inside it) beyond the day's expected
  time (rostered shift, else Settings' work hours), per person and day. Days closed automatically after a missed check-out
  are left out (no real end time). Overtime is **reported, not paid automatically**.
* **Payroll readiness** (Payroll module) for a month before processing: *blocks* (no CTC; bank account missing, no
  holder, or holder name not matching and not confirmed) and *checks* (pending leave or corrections in the month, missed
  check-outs, waiting claims, no PAN where TDS is likely, no UAN where PF applies).
* Screen *Shifts & roster* (Attendance module).

## Files
New: `src/staff/hrms/shifts.ts`, `_ui/screens-shifts.tsx`, migration `20261214000000_hrms_shifts`,
`tests/integration/hrms-shifts.test.ts`. Changed: `time.ts` (lateness, My day start), `constants.ts`, `screens.ts`,
`actions.ts` (`saveShift`, `archiveShift`, `assignShift`), `_ui/screens.tsx`, `restore.ts`, `rls-readiness.test.ts`.

## Tests (actual)
`hrms-shifts.test.ts` (6): shift length incl. overnight, month ends; only Attendance manages shifts, invalid shifts
refused; roster newest-wins with the older entry cut to the day before and undeletable, archive refused while rostered,
inactive people refused; check-in 08:10 on an 08:00 + 15 min shift is present, 08:20 late, an unrostered person keeps the
company time; overtime 90 min (570 worked − 480 expected) with the missed-check-out day excluded, refused for employees;
readiness blocks (no CTC, no bank) and checks (pending leave, missed check-out), refused for employees.
Full suite 228 files / 1,394 tests pass; lint and typecheck pass.
