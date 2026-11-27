// Shared by the server and the screens (no server imports): the KPI metrics Medoro can measure, how a value becomes a
// score, and how a period is named. Every metric measures output or an outcome from real records; none is a measure of
// time spent at the computer (workforce activity is context only and is never a KPI input).

export const KPI_METRICS = {
  tasks_done: { label: "Tasks completed", unit: "tasks", better: "higher", source: "Tasks assigned to the person and marked done in the period.", formula: "count of the person’s tasks with a done date in the period" },
  tasks_on_time_pct: { label: "Tasks done on time", unit: "%", better: "higher", source: "Tasks due in the period.", formula: "tasks due in the period and done on or before their due date ÷ all tasks due in the period × 100" },
  tasks_overdue: { label: "Tasks missed their due date", unit: "tasks", better: "lower", source: "Tasks due in the period.", formula: "tasks due in the period not done by their due date" },
  sales_won: { label: "Sales closed", unit: "sales", better: "higher", source: "Sales logged by the person in the period (not rejected).", formula: "count of the person’s logged sales dated in the period, excluding rejected ones" },
  sales_value: { label: "Verified sales value", unit: "₹", better: "higher", source: "Sales verified or paid in the period.", formula: "sum of the before-GST amount of the person’s sales dated in the period with status verified or paid" },
  leads_contacted: { label: "Leads worked", unit: "leads", better: "higher", source: "Call and follow-up logs on leads.", formula: "number of different leads the person logged a call or note on in the period" },
  attendance_days: { label: "Days present", unit: "days", better: "higher", source: "Attendance check-ins.", formula: "days in the period with a check-in" },
  late_days: { label: "Late arrivals", unit: "days", better: "lower", source: "Attendance marked late.", formula: "days in the period with attendance marked late" },
  manual: { label: "Entered by the manager", unit: "", better: "higher", source: "A value the manager or HR enters with its evidence (for example customer satisfaction, audit score, revenue from another system).", formula: "the value entered for the period" },
} as const;
export type MetricId = keyof typeof KPI_METRICS;
export const METRIC_IDS = Object.keys(KPI_METRICS) as [MetricId, ...MetricId[]];
export const PERIODS = ["month", "quarter"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * Score 0–100 against the target.
 *  * Higher is better: value ÷ target × 100, capped at 100 (a target of 0 scores 100).
 *  * Lower is better: 100 when value ≤ target; otherwise 100 − (value − target) ÷ max(target, 1) × 100, not below 0.
 * No value (nothing to measure, or a manual value not entered yet) has no score and is left out of the weighted total.
 */
export function scoreOf(better: "higher" | "lower", value: number | null, target: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (better === "higher") return target <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((value / target) * 100)));
  if (value <= target) return 100;
  return Math.max(0, Math.round(100 - ((value - target) / Math.max(target, 1)) * 100));
}

/** Weighted average of the KPIs that have a score; null when none has. */
export function weighted(rows: { score: number | null; weight: number }[]): number | null {
  const s = rows.filter((r) => r.score !== null && r.weight > 0);
  const w = s.reduce((a, r) => a + r.weight, 0);
  return w ? Math.round(s.reduce((a, r) => a + r.score! * r.weight, 0) / w) : null;
}

/** The period containing a date (YYYY-MM-DD): first and last day, and a label. */
export function periodOf(period: Period, day: string): { start: string; end: string; label: string } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const first = period === "month" ? m : Math.floor((m - 1) / 3) * 3 + 1;
  const months = period === "month" ? 1 : 3;
  const start = `${y}-${String(first).padStart(2, "0")}-01`;
  const endD = new Date(Date.UTC(y, first - 1 + months, 0));
  const end = endD.toISOString().slice(0, 10);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { start, end, label: period === "month" ? `${names[first - 1]} ${y}` : `Q${(first + 2) / 3} ${y} (${names[first - 1]}–${names[first + 1]})` };
}
/** The period before this one. */
export function previousPeriod(period: Period, start: string) {
  const d = new Date(start + "T00:00:00Z");
  d.setUTCDate(0); // the day before the start
  return periodOf(period, d.toISOString().slice(0, 10));
}

export const fmtValue = (unit: string, v: number | null) => (v === null ? "no data" : unit === "₹" ? `₹${Math.round(v).toLocaleString("en-IN")}` : unit === "%" ? `${Math.round(v)}%` : `${Math.round(v * 100) / 100}${unit ? " " + unit : ""}`);

/** The sentence shown with every result: what was counted, against which target, and the score. */
export function explain(k: { metric: MetricId; unit: string; target: number; better: "higher" | "lower" }, value: number | null, score: number | null, detail: string, label: string) {
  const m = KPI_METRICS[k.metric];
  if (value === null) return `${label}: no value yet. ${k.metric === "manual" ? "The manager or HR enters it with its evidence." : detail || "Nothing to measure in this period."}`;
  const rule = k.better === "higher" ? `${fmtValue(k.unit, value)} against a target of ${fmtValue(k.unit, k.target)} (higher is better)` : `${fmtValue(k.unit, value)} against a limit of ${fmtValue(k.unit, k.target)} (lower is better)`;
  return `${label}: ${detail ? detail + " = " : ""}${rule} → score ${score}/100. Formula: ${m.formula}.`;
}
