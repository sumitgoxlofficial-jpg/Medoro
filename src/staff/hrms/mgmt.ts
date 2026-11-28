import "server-only";
import { db } from "@/server/db";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, can, need, type Me } from "./auth";
import { periodOf } from "./kpi-metrics";
import { MIN_GROUP } from "./surveys";

// Management intelligence: one page of organisation-level numbers, each computed from records with its definition shown
// beside it. People-level detail stays on the screens that own it. Groups smaller than MIN_GROUP are hidden where a number
// could identify someone (department KPI averages, engagement). Payroll cost needs the Payroll module.

const monthsBack = (n: number, today = todayISO()) => {
  const out: string[] = [];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export async function management(me: Me, today = todayISO()) {
  need(me, "reports");
  const ym = today.slice(0, 7), first = dateOnly(`${ym}-01`), yearAgo = dateOnly(addDays(today, -365));
  const staff = await db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] } }, select: { id: true, status: true, deletedAt: true, hr: { select: { dept: true, joinDate: true, exitDate: true, ctc: true } } } });
  const activeIds = staff.filter((s) => s.status === "active" && !s.deletedAt).map((s) => s.id);
  const deptOf = new Map(staff.map((s) => [s.id, s.hr?.dept || "No department"]));

  // Headcount, joins and exits per month for 12 months (from joining and last working days).
  const months = monthsBack(12, today);
  const trend = months.map((m) => {
    const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const joined = staff.filter((s) => s.hr?.joinDate && isoOf(s.hr.joinDate).slice(0, 7) === m).length;
    const left = staff.filter((s) => s.hr?.exitDate && isoOf(s.hr.exitDate).slice(0, 7) === m).length;
    const headcount = staff.filter((s) => s.hr?.joinDate && isoOf(s.hr.joinDate) <= end && (!s.hr.exitDate || isoOf(s.hr.exitDate) >= end)).length;
    return { month: m, headcount, joined, left };
  });
  const exits12 = staff.filter((s) => s.hr?.exitDate && s.hr.exitDate >= yearAgo && isoOf(s.hr.exitDate) <= today).length;
  const avgHead = trend.reduce((a, t) => a + t.headcount, 0) / (trend.length || 1);

  // This month's attendance among active people.
  const att = await db.hrAttendance.findMany({ where: { staffId: { in: activeIds }, day: { gte: first, lte: dateOnly(today) }, inAt: { not: null } }, select: { status: true } });
  const leaves = await db.hrLeave.count({ where: { staffId: { in: activeIds }, status: "approved", fromDay: { lte: dateOnly(today) }, toDay: { gte: first } } });

  // KPIs for the current month: average score per department, hidden under MIN_GROUP people with a score.
  const per = periodOf("month", today);
  const results = await db.hrKpiResult.findMany({ where: { periodStart: dateOnly(per.start), score: { not: null }, staffId: { in: activeIds } }, select: { staffId: true, score: true, weight: true } });
  const byPerson = new Map<string, { s: number; w: number }>();
  for (const r of results) { const x = byPerson.get(r.staffId) ?? { s: 0, w: 0 }; x.s += r.score! * r.weight; x.w += r.weight; byPerson.set(r.staffId, x); }
  const deptKpi = new Map<string, number[]>();
  for (const [id, x] of byPerson) if (x.w) deptKpi.set(deptOf.get(id)!, [...(deptKpi.get(deptOf.get(id)!) ?? []), x.s / x.w]);

  // Learning compliance: required courses completed (and overdue).
  const required = await db.hrCourseEnrolment.findMany({ where: { staffId: { in: activeIds }, course: { mandatory: true, status: "published" } }, select: { completedAt: true, dueOn: true } });

  // Engagement: the latest closed or open survey with an eNPS question and at least MIN_GROUP answers.
  const surveys = await db.hrSurvey.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { responses: { select: { answers: true } } } });
  let engagement: { title: string; enps: number; n: number } | null = null;
  for (const s of surveys) {
    const qi = (s.questions as { kind: string }[]).findIndex((q) => q.kind === "nps");
    if (qi < 0 || s.responses.length < MIN_GROUP) continue;
    const v = s.responses.map((r) => Number((r.answers as unknown[])[qi])).filter(Number.isFinite);
    engagement = { title: s.title, n: v.length, enps: Math.round(((v.filter((x) => x >= 9).length - v.filter((x) => x <= 6).length) / v.length) * 100) };
    break;
  }

  // Operations: approvals waiting / overdue, documents expiring, devices.
  const [approvals, overdueSteps, expiring, devices] = await Promise.all([
    db.hrApproval.count({ where: { status: "pending" } }),
    db.hrApprovalStep.count({ where: { status: "pending", dueAt: { lt: new Date() } } }),
    db.hrDocument.count({ where: { staffId: { in: activeIds }, expiresOn: { lte: dateOnly(addDays(today, 30)) } } }),
    db.hrDevice.count({ where: { revokedAt: null } }),
  ]);

  // Payroll cost by department for the latest processed month (Payroll module only).
  let payroll: { month: string; total: number; depts: { name: string; gross: number; people: number }[] } | null = null;
  if (can(me, "payroll")) {
    const last = await db.hrPayslip.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
    if (last) {
      const slips = await db.hrPayslip.findMany({ where: { month: last.month }, select: { staffId: true, gross: true } });
      const d = new Map<string, { gross: number; people: number }>();
      for (const p of slips) { const k = deptOf.get(p.staffId) ?? "No department"; const x = d.get(k) ?? { gross: 0, people: 0 }; x.gross += p.gross; x.people++; d.set(k, x); }
      payroll = { month: last.month, total: slips.reduce((a, p) => a + p.gross, 0), depts: [...d.entries()].map(([name, x]) => ({ name, ...x })).sort((a, b) => b.gross - a.gross) };
    }
  }
  await audit(me, "Management dashboard opened");
  return {
    asOf: today,
    headcount: activeIds.length,
    trend,
    attrition: { exits12, avgHeadcount: Math.round(avgHead * 10) / 10, ratePct: pct(exits12, avgHead), definition: "Exits with a last working day in the last 12 months ÷ the average month-end headcount over those months." },
    attendance: { days: att.length, latePct: pct(att.filter((a) => a.status === "late").length, att.length), leaves, definition: "Check-ins this month among active people; late share of those check-ins; approved leave requests overlapping this month." },
    kpis: { period: per.label, people: byPerson.size, depts: [...deptKpi.entries()].map(([name, v]) => ({ name, people: v.length, avg: v.length >= MIN_GROUP ? Math.round(v.reduce((a, x) => a + x, 0) / v.length) : null })).sort((a, b) => a.name.localeCompare(b.name)), definition: `Average of each person's weighted KPI total for ${per.label}, per department; hidden below ${MIN_GROUP} people.` },
    learning: { required: required.length, done: required.filter((e) => e.completedAt).length, overdue: required.filter((e) => !e.completedAt && isoOf(e.dueOn) < today).length, compliancePct: pct(required.filter((e) => e.completedAt).length, required.length) },
    engagement,
    operations: { approvals, overdueSteps, expiring, devices },
    payroll,
    depts: [...new Set(staff.filter((s) => activeIds.includes(s.id)).map((s) => deptOf.get(s.id)!))].map((name) => ({ name, people: activeIds.filter((id) => deptOf.get(id) === name).length })).sort((a, b) => b.people - a.people),
  };
}

const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : /^[=+\-@]/.test(s) ? "'" + s : s; };
/** The dashboard as CSV (one section per block), for board packs. */
export async function managementCsv(me: Me) {
  const m = await management(me);
  const rows: unknown[][] = [["Medoro HRMS management report", m.asOf], [], ["Headcount (active)", m.headcount], ["Attrition, last 12 months (%)", m.attrition.ratePct ?? ""], ["Exits, last 12 months", m.attrition.exits12], [], ["Month", "Headcount", "Joined", "Left"], ...m.trend.map((t) => [t.month, t.headcount, t.joined, t.left]), [], ["Department", "People"], ...m.depts.map((d) => [d.name, d.people]), [], [`KPI average ${m.kpis.period}`, "People", "Average"], ...m.kpis.depts.map((d) => [d.name, d.people, d.avg ?? "hidden"]), [], ["Required courses", m.learning.required], ["Completed", m.learning.done], ["Overdue", m.learning.overdue]];
  if (m.payroll) rows.push([], [`Payroll gross ${m.payroll.month}`, m.payroll.total], ["Department", "Gross", "People"], ...m.payroll.depts.map((d) => [d.name, d.gross, d.people]));
  return { name: `medoro-management-${m.asOf}.csv`, text: rows.map((r) => r.map(esc).join(",")).join("\n") };
}
