# Enterprise HRMS 2.0 — Phase 5: output, KPIs and advisory insights

## Principles (enforced in code)
* **No universal score.** Every KPI is for a department and/or designation; a KPI without either is refused.
* **Output, not activity.** Metrics (`src/staff/hrms/kpi-metrics.ts`) come from work records: tasks completed, tasks done
  on time (%), tasks that missed their due date, sales closed, verified sales value (`CpSale`), leads worked (`LeadLog`),
  days present, late arrivals, or a **manual** value the manager or HR enters with its evidence. Workforce activity
  (programs, idle time) is never an input.
* **Every score is explainable.** Each result stores the value, the target it was scored against, the score, the weight,
  the evidence (the tasks, sales, leads or days counted) and a sentence: what was counted, against which target, the
  score and the formula. Formulas: higher-is-better = value ÷ target × 100 (capped at 100); lower-is-better = 100 within the
  limit, then reduced by the share over it; no value = no score, left out of the weighted total (weighted average of
  the KPIs that have a score). Periods: month or quarter.
* **Advisory suggestions with human review.** Rules flag a drop of 15+ points against the previous month, a rise of 15+
  (recognition), any KPI below 50, and manual KPIs without a value. Each suggestion carries its evidence, goes to the
  manager (and HR), and reaches the employee **only** if a reviewer marks it reviewed **and** shares it, with their note.
  Dismissing needs a reason. Nobody reviews suggestions about themselves.

## Who sees what
The person: their own results and shared notes. Reporting manager: direct reports' results; enters manual values for
them (never their own). HR (Reports module): defines KPIs, computes, sees everyone.

## Files and API
New: `kpi-metrics.ts` (+ unit test), `kpi.ts`, `_ui/screens-kpi.tsx` (screen *KPIs*), migration
`20261213000000_hrms_kpis` (`HrKpi`, `HrKpiResult` with FKs, `HrInsight`), `tests/integration/hrms-kpi.test.ts`.
Actions: `saveKpi`, `setKpiActive`, `computeKpis`, `enterKpiValue`, `kpiFor`, `reviewInsight`. Scheduled daily:
`kpiTick` (recompute this period + suggestions). Changed: `constants.ts`, `screens.ts`, `actions.ts`, `_ui/screens.tsx`,
`cron.ts`, `restore.ts`, `rls-readiness.test.ts`.

## Tests (actual)
Unit (5): both score rules incl. edge cases, weighting without missing values, period names, explanation text.
Integration (5): company-wide and non-HR KPIs refused; computed only for matching people (6 results; manager and HR
none); on-time 2 of 4 = 50% → 56/100 with all four tasks as evidence; sales closed excludes rejected and other months;
value counts verified + paid only; manual value needs manager/HR and evidence, not self, survives recomputation;
weighted total; visibility (colleague refused, manager sees reports, HR everyone); suggestions generated once, no
suggestion where scores are fine, hidden from the employee until reviewed and shared, review rules, no double review.
Full suite: 227 files / 1,388 tests pass; lint and typecheck pass.
