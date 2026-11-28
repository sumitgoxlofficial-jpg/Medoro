import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, can, need, notify, type Me } from "./auth";
import { KPI_METRICS, METRIC_IDS, PERIODS, explain, periodOf, previousPeriod, scoreOf, weighted, type MetricId, type Period } from "./kpi-metrics";
import { ADMIN_LABEL, hideAdmin } from "./visibility";

// KPIs per department and/or designation (never one universal score). HR (Reports module) defines them; results are
// computed from real records for a period, each with its value, target, score, evidence and an explanation. A manager
// sees and fills in manual values for direct reports only; the person sees their own. Insights are suggestions that
// stay with the manager and HR until a person reviews them, and reach the employee only if that reviewer shares them.

const IST = "T00:00:00+05:30";
const kpiInput = z.object({
  name: z.string().trim().min(3, "Name the KPI.").max(80),
  description: z.string().trim().max(400).default(""),
  dept: z.string().trim().max(60).default(""), designation: z.string().trim().max(80).default(""),
  metric: z.enum(METRIC_IDS), unit: z.string().trim().max(12).default(""),
  better: z.enum(["higher", "lower"]).optional(),
  target: z.coerce.number({ error: "Enter the target." }).min(0).max(1e12),
  period: z.enum(PERIODS).default("month"),
  weight: z.coerce.number().int().min(1, "Weight is 1–100.").max(100, "Weight is 1–100.").default(10),
}).refine((v) => v.dept || v.designation, { message: "Choose the department or designation this KPI is for: Medoro has no company-wide score.", path: ["dept"] });

type Kpi = Prisma.HrKpiGetPayload<object>;
const view = (k: Kpi) => ({ id: k.id, name: k.name, description: k.description, dept: k.dept, designation: k.designation, metric: k.metric as MetricId, unit: k.unit, better: k.better as "higher" | "lower", target: k.target, period: k.period as Period, weight: k.weight, active: k.active, formula: KPI_METRICS[k.metric as MetricId]?.formula ?? "", source: KPI_METRICS[k.metric as MetricId]?.source ?? "" });

export async function saveKpi(me: Me, id: string | null, raw: z.input<typeof kpiInput>) {
  need(me, "reports");
  const i = kpiInput.parse(raw);
  const m = KPI_METRICS[i.metric];
  const data = { ...i, unit: i.metric === "manual" ? i.unit : m.unit, better: i.metric === "manual" ? i.better ?? "higher" : m.better };
  const k = id ? await db.hrKpi.update({ where: { id }, data: { ...data, updatedBy: me.id } }) : await db.hrKpi.create({ data: { ...data, createdBy: me.id, updatedBy: me.id } });
  await audit(me, id ? "KPI changed" : "KPI created", `${k.name} · ${k.metric} · target ${k.target} · ${k.dept || "any department"} / ${k.designation || "any designation"}`);
  return k.id;
}
export async function setKpiActive(me: Me, id: string, active: boolean) {
  need(me, "reports");
  await db.hrKpi.update({ where: { id }, data: { active, updatedBy: me.id } });
  await audit(me, active ? "KPI switched on" : "KPI switched off", id);
}

/** Active KPIs that apply to a person: their department and/or designation matches every field the KPI sets. */
export const applies = (k: Pick<Kpi, "dept" | "designation" | "active">, p: { dept: string; designation: string }) =>
  k.active && (!k.dept || k.dept.toLowerCase() === p.dept.toLowerCase()) && (!k.designation || k.designation.toLowerCase() === p.designation.toLowerCase());

type Evidence = { label: string; detail?: string }[];
/** Measures one metric for one person and period from the records. */
async function measure(metric: MetricId, staffId: string, start: string, end: string): Promise<{ value: number | null; detail: string; evidence: Evidence }> {
  const from = new Date(start + IST), to = new Date(end + IST); to.setUTCDate(to.getUTCDate() + 1); // [from, to)
  const dFrom = dateOnly(start), dTo = dateOnly(end);
  switch (metric) {
    case "tasks_done": {
      const t = await db.hrTask.findMany({ where: { assigneeId: staffId, kind: "task", status: "done", doneAt: { gte: from, lt: to } }, select: { title: true, doneAt: true }, orderBy: { doneAt: "asc" }, take: 500 });
      return { value: t.length, detail: `${t.length} task${t.length === 1 ? "" : "s"} completed`, evidence: t.map((x) => ({ label: x.title, detail: `done ${isoOf(x.doneAt!)}` })) };
    }
    case "tasks_on_time_pct": case "tasks_overdue": {
      const t = await db.hrTask.findMany({ where: { assigneeId: staffId, kind: "task", due: { gte: dFrom, lte: dTo } }, select: { title: true, due: true, doneAt: true }, take: 500 });
      const onTime = (x: (typeof t)[number]) => !!x.doneAt && todayISO(x.doneAt) <= isoOf(x.due!);
      const ok = t.filter(onTime).length, missed = t.length - ok;
      const evidence = t.map((x) => ({ label: x.title, detail: `due ${isoOf(x.due!)} · ${x.doneAt ? `done ${todayISO(x.doneAt)}${onTime(x) ? "" : " (late)"}` : "not done"}` }));
      if (metric === "tasks_overdue") return { value: missed, detail: `${missed} of ${t.length} task${t.length === 1 ? "" : "s"} due were not done by the due date`, evidence };
      return t.length ? { value: Math.round((ok / t.length) * 1000) / 10, detail: `${ok} of ${t.length} tasks due were done on time`, evidence } : { value: null, detail: "No tasks were due in this period.", evidence };
    }
    case "sales_won": case "sales_value": {
      const s = await db.cpSale.findMany({ where: { staffId, date: { gte: dFrom, lte: dTo }, status: metric === "sales_won" ? { not: "rejected" } : { in: ["verified", "paid"] } }, select: { pharmacy: true, date: true, amountPaise: true, status: true }, take: 1000 });
      const evidence = s.map((x) => ({ label: x.pharmacy, detail: `${isoOf(x.date)} · ₹${Math.round(x.amountPaise / 100).toLocaleString("en-IN")} · ${x.status}` }));
      if (metric === "sales_won") return { value: s.length, detail: `${s.length} sale${s.length === 1 ? "" : "s"} logged`, evidence };
      const v = Math.round(s.reduce((a, x) => a + x.amountPaise, 0) / 100);
      return { value: v, detail: `${s.length} verified sale${s.length === 1 ? "" : "s"}`, evidence };
    }
    case "leads_contacted": {
      const logs = await db.leadLog.findMany({ where: { staffId, at: { gte: from, lt: to } }, select: { leadId: true, lead: { select: { name: true } } }, take: 5000 });
      const leads = new Map(logs.map((l) => [l.leadId, l.lead.name]));
      return { value: leads.size, detail: `${leads.size} different lead${leads.size === 1 ? "" : "s"} with a call or note (${logs.length} logs)`, evidence: [...leads.values()].slice(0, 200).map((n) => ({ label: n })) };
    }
    case "attendance_days": case "late_days": {
      const a = await db.hrAttendance.findMany({ where: { staffId, day: { gte: dFrom, lte: dTo }, inAt: { not: null }, ...(metric === "late_days" ? { status: "late" } : {}) }, select: { day: true, status: true }, orderBy: { day: "asc" } });
      return { value: a.length, detail: `${a.length} day${a.length === 1 ? "" : "s"} ${metric === "late_days" ? "marked late" : "checked in"}`, evidence: a.map((x) => ({ label: isoOf(x.day), detail: x.status })) };
    }
    case "manual": return { value: null, detail: "", evidence: [] };
  }
}

/** Active people in scope of KPIs (the super admin has none). */
async function people(ids?: string[]) {
  return db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, name: true, empNo: true, hr: { select: { dept: true, designation: true, managerId: true } } } });
}

/**
 * Computes (or recomputes) every applicable KPI for the period containing `day`, for everyone or the given people.
 * Manual values already entered are kept. Returns how many results were written.
 */
export async function computeKpis(me: Me | null, day = todayISO(), ids?: string[]) {
  if (me) need(me, "reports");
  const kpis = await db.hrKpi.findMany({ where: { active: true } });
  const staff = await people(ids);
  let n = 0;
  for (const p of staff) {
    const prof = { dept: p.hr?.dept ?? "", designation: p.hr?.designation ?? "" };
    for (const k of kpis.filter((x) => applies(x, prof))) {
      const per = periodOf(k.period as Period, day);
      const key = { kpiId_staffId_periodStart: { kpiId: k.id, staffId: p.id, periodStart: dateOnly(per.start) } };
      const old = await db.hrKpiResult.findUnique({ where: key });
      let value: number | null, detail: string, evidence: Evidence;
      if (k.metric === "manual") { value = old?.value ?? null; detail = old?.manualNote ? `entered: ${old.manualNote}` : ""; evidence = (old?.evidence as Evidence) ?? []; }
      else ({ value, detail, evidence } = await measure(k.metric as MetricId, p.id, per.start, per.end));
      const score = scoreOf(k.better as "higher" | "lower", value, k.target);
      const explanation = explain({ metric: k.metric as MetricId, unit: k.unit, target: k.target, better: k.better as "higher" | "lower" }, value, score, detail, k.name);
      const data = { value, target: k.target, score, evidence: evidence as Prisma.InputJsonValue, explanation, computedAt: new Date(), periodEnd: dateOnly(per.end), weight: k.weight };
      await db.hrKpiResult.upsert({ where: key, update: data, create: { kpiId: k.id, staffId: p.id, periodStart: dateOnly(per.start), ...data } });
      n++;
    }
  }
  if (me) await audit(me, "KPIs computed", `${n} results · period containing ${day}`);
  return n;
}

/** The manager (for a direct report) or HR enters a manual KPI's value, with its evidence. */
export async function enterManual(me: Me, raw: { kpiId: string; staffId: string; day: string; value: number; note: string }) {
  const i = z.object({ kpiId: z.string(), staffId: z.string(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.coerce.number().min(-1e12).max(1e12), note: z.string().trim().min(5, "Give the evidence (where the value comes from).").max(500) }).parse(raw);
  if (i.staffId === me.id) throw new UserError("Someone else has to enter your own KPI value.");
  const p = (await people([i.staffId]))[0];
  if (!p) throw new UserError("Employee not found.");
  if (!can(me, "reports") && p.hr?.managerId !== me.id) throw new UserError("Only their manager or HR can enter this value.");
  const k = await db.hrKpi.findUnique({ where: { id: i.kpiId } });
  if (!k || k.metric !== "manual" || !applies(k, { dept: p.hr?.dept ?? "", designation: p.hr?.designation ?? "" })) throw new UserError("That KPI isn’t a manual KPI for this person.");
  const per = periodOf(k.period as Period, i.day);
  const score = scoreOf(k.better as "higher" | "lower", i.value, k.target);
  const evidence = [{ label: `Entered by ${me.name}`, detail: i.note }];
  const explanation = explain({ metric: "manual", unit: k.unit, target: k.target, better: k.better as "higher" | "lower" }, i.value, score, `entered: ${i.note}`, k.name);
  const key = { kpiId_staffId_periodStart: { kpiId: k.id, staffId: i.staffId, periodStart: dateOnly(per.start) } };
  const data = { value: i.value, target: k.target, score, evidence, explanation, manualNote: i.note, enteredBy: me.id, computedAt: new Date(), periodEnd: dateOnly(per.end), weight: k.weight };
  await db.hrKpiResult.upsert({ where: key, update: data, create: { kpiId: k.id, staffId: i.staffId, periodStart: dateOnly(per.start), ...data } });
  await audit(me, "KPI value entered", `${p.empNo} · ${k.name} · ${per.label} · ${i.value}`);
}

type ResultRow = Prisma.HrKpiResultGetPayload<{ include: { kpi: true } }>;
const resultView = (r: ResultRow) => ({ kpiId: r.kpiId, name: r.kpi.name, metric: r.kpi.metric, unit: r.kpi.unit, better: r.kpi.better, period: r.kpi.period, start: isoOf(r.periodStart), end: isoOf(r.periodEnd), value: r.value, target: r.target, score: r.score, weight: r.weight, explanation: r.explanation, evidence: (r.evidence as Evidence) ?? [], manual: r.kpi.metric === "manual", computedAt: r.computedAt.toISOString() });

/** A person's results for the periods containing `day`, with the weighted total of those that have a score. */
export async function resultsFor(staffId: string, day = todayISO()) {
  const rows = await db.hrKpiResult.findMany({ where: { staffId, periodStart: { lte: dateOnly(day) }, periodEnd: { gte: dateOnly(day) } }, include: { kpi: true }, orderBy: { kpi: { name: "asc" } } });
  const items = rows.map(resultView);
  return { items, total: weighted(items), periodLabel: periodOf("month", day).label };
}

/** Who may see whose KPIs: the person, their reporting manager, HR (Reports). */
async function mayView(me: Me, staffId: string) {
  if (staffId === me.id || can(me, "reports")) return true;
  return (await db.hrProfile.findUnique({ where: { staffId }, select: { managerId: true } }))?.managerId === me.id;
}

/** My KPIs, my team's (direct reports), and for HR the definitions. */
export async function kpiScreen(me: Me, day = todayISO()) {
  const mine = await resultsFor(me.id, day);
  const reports = await db.staffUser.findMany({ where: { status: "active", hr: { managerId: me.id } }, select: { id: true, name: true, empNo: true } });
  const team = await Promise.all(reports.map(async (r) => ({ ...r, ...(await resultsFor(r.id, day)) })));
  const hr = can(me, "reports");
  const all = hr ? await db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null }, select: { id: true, name: true, empNo: true, hr: { select: { dept: true, designation: true } } }, orderBy: { name: "asc" } }) : [];
  const everyone = hr ? await Promise.all(all.map(async (r) => ({ id: r.id, name: r.name, empNo: r.empNo, dept: r.hr?.dept ?? "", designation: r.hr?.designation ?? "", ...(await resultsFor(r.id, day)) }))) : [];
  const insights = await insightsFor(me);
  return { day, mine, team, everyone, hr, kpis: hr ? (await db.hrKpi.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] })).map(view) : [], metrics: Object.entries(KPI_METRICS).map(([id, m]) => ({ id, ...m })), insights };
}

export async function kpiFor(me: Me, staffId: string, day = todayISO()) {
  if (!(await mayView(me, staffId))) throw new UserError("You can see the KPIs of your direct reports only.");
  return resultsFor(staffId, day);
}

// ── Insights: rule-based suggestions with their evidence. Never shown to the employee until reviewed and shared.
const INSIGHT_DROP = 15, INSIGHT_LOW = 50;
/** Looks at the period containing `day` against the one before and records suggestions for the manager and HR. */
export async function generateInsights(day = todayISO()) {
  const staff = await people();
  let made = 0;
  for (const p of staff) {
    const now = await resultsFor(p.id, day);
    const prevDay = previousPeriod("month", periodOf("month", day).start).start;
    const before = await resultsFor(p.id, prevDay);
    const out: { kind: string; key: string; text: string; evidence: Evidence }[] = [];
    if (now.total !== null && before.total !== null && before.total - now.total >= INSIGHT_DROP) {
      const worst = now.items.map((r) => ({ r, was: before.items.find((b) => b.kpiId === r.kpiId)?.score ?? null })).filter((x) => x.r.score !== null && x.was !== null).sort((a, b) => (a.r.score! - a.was!) - (b.r.score! - b.was!))[0];
      out.push({ kind: "decline", key: "total", text: `KPI total fell from ${before.total} to ${now.total}.${worst ? ` The biggest change is “${worst.r.name}” (${worst.was} → ${worst.r.score}).` : ""} Worth a conversation about what changed: workload, blockers or support needed.`, evidence: worst ? worst.r.evidence.slice(0, 10) : [] });
    }
    if (now.total !== null && before.total !== null && now.total - before.total >= INSIGHT_DROP) out.push({ kind: "improvement", key: "total", text: `KPI total rose from ${before.total} to ${now.total}. Consider recognising it.`, evidence: [] });
    for (const r of now.items) {
      if (r.score !== null && r.score < INSIGHT_LOW) out.push({ kind: "below_target", key: r.kpiId, text: `“${r.name}” is at ${r.score}/100. ${r.explanation}`, evidence: r.evidence.slice(0, 10) });
      if (r.value === null && r.manual) out.push({ kind: "missing_value", key: r.kpiId, text: `“${r.name}” has no value for ${periodOf(r.period as Period, day).label}. The manager or HR enters it with its evidence.`, evidence: [] });
    }
    const periodStart = dateOnly(periodOf("month", day).start);
    for (const o of out) {
      const res = await db.hrInsight.createMany({ data: [{ staffId: p.id, kind: o.kind, key: `${o.kind}:${o.key}`, periodStart, text: o.text.slice(0, 1000), evidence: o.evidence as Prisma.InputJsonValue }], skipDuplicates: true });
      if (res.count && p.hr?.managerId) await notify([p.hr.managerId], `A KPI suggestion about ${p.name} needs your review.`, "kpis");
      made += res.count;
    }
  }
  return made;
}

/** Suggestions waiting for this person to review (their direct reports, or everyone for HR), and ones shared with them. */
export async function insightsFor(me: Me) {
  const hr = can(me, "reports");
  const reports = (await db.hrProfile.findMany({ where: { managerId: me.id }, select: { staffId: true } })).map((r) => r.staffId);
  const rows = await db.hrInsight.findMany({ where: { OR: [{ staffId: me.id, shared: true }, ...(hr ? [{ status: "pending", staffId: { not: me.id } }] : []), { status: "pending", staffId: { in: reports } }] }, orderBy: { createdAt: "desc" }, take: 200 });
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.staffId, r.reviewedBy ?? ""]))] } }, select: { id: true, name: true, role: true } })).map((u) => [u.id, hideAdmin(me) && u.role === "super_admin" ? ADMIN_LABEL : u.name]));
  return rows.map((r) => ({ id: r.id, staffId: r.staffId, person: names.get(r.staffId) ?? "", kind: r.kind, text: r.text, evidence: (r.evidence as Evidence) ?? [], status: r.status, mine: r.staffId === me.id, reviewedBy: r.reviewedBy ? names.get(r.reviewedBy) ?? "" : "", note: r.reviewNote, period: isoOf(r.periodStart) }));
}

/** A manager (for their reports) or HR reviews a suggestion: act on it (optionally share it with the employee) or dismiss it. */
export async function reviewInsight(me: Me, id: string, decision: "reviewed" | "dismissed", rawNote = "", share = false) {
  const x = await db.hrInsight.findUnique({ where: { id } });
  if (!x || x.status !== "pending") throw new UserError("This suggestion was already reviewed.");
  if (x.staffId === me.id) throw new UserError("Someone else reviews suggestions about you.");
  const mgr = (await db.hrProfile.findUnique({ where: { staffId: x.staffId }, select: { managerId: true } }))?.managerId === me.id;
  if (!mgr && !can(me, "reports")) throw new UserError("Only their manager or HR can review this.");
  const note = String(rawNote ?? "").trim().slice(0, 500);
  if (decision === "dismissed" && note.length < 5) throw new UserError("Say why it doesn’t apply.");
  const { count } = await db.hrInsight.updateMany({ where: { id, status: "pending" }, data: { status: decision, reviewedBy: me.id, reviewedAt: new Date(), reviewNote: note, shared: decision === "reviewed" && share } });
  if (!count) throw new UserError("This suggestion was already reviewed.");
  if (decision === "reviewed" && share) await notify([x.staffId], "Your manager shared a note about your KPIs.", "kpis");
  await audit(me, `KPI suggestion ${decision}${share ? " and shared" : ""}`, `${x.staffId} · ${x.kind}`);
}

/** Scheduled (daily): keep this month's results and suggestions current. */
export async function kpiTick(now = new Date()) {
  if (!(await db.hrKpi.count({ where: { active: true } }))) return 0;
  const n = await computeKpis(null, todayISO(now));
  await generateInsights(todayISO(now));
  return n;
}
