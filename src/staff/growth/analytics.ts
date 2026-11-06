import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { dateOnly, todayISO } from "@/lib/dates";
import { leadScope, need, type Actor } from "./access";
import { CONNECTED_OUTCOMES, INTERESTED_OUTCOMES, STAGES } from "./constants";
import { latestTargets, targetsFor } from "./team";
import { listLeads } from "./leads";

/**
 * Every number here is counted from database rows. A dialer launch (CallSession created) is never counted as a call;
 * a reported call is the employee's report, not carrier data.
 */

const IST = 330 * 60_000;
/** Start of today in India (UTC instant). */
export const istDayStart = (now = new Date()) => { const d = new Date(now.getTime() + IST); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - IST); };
/** Monday 00:00 IST of this week. */
export const istWeekStart = (now = new Date()) => { const s = istDayStart(now); const dow = (new Date(s.getTime() + IST).getUTCDay() + 6) % 7; return new Date(s.getTime() - dow * 86_400_000); };
export const istMonthStart = (now = new Date()) => { const d = new Date(now.getTime() + IST); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST); };

export const rangeSchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), staffId: z.string().uuid().optional() });
function range(raw: z.input<typeof rangeSchema>, now = new Date()) {
  const r = rangeSchema.parse(raw);
  const to = r.to ? new Date(new Date(r.to + "T00:00:00+05:30").getTime() + 86_400_000) : new Date(istDayStart(now).getTime() + 86_400_000);
  const from = r.from ? new Date(r.from + "T00:00:00+05:30") : new Date(to.getTime() - 30 * 86_400_000);
  return { from, to, staffId: r.staffId };
}

function staffFilter(a: Actor, staffId?: string): string[] | undefined {
  if (a.growthRole === "manager") return staffId && a.teamStaffIds.includes(staffId) ? [staffId] : a.teamStaffIds;
  if (a.growthRole === "sales") return [a.id];
  return staffId ? [staffId] : undefined;
}
const inStaff = (ids?: string[]) => (ids ? { staffId: { in: ids } } : {});
const count = (rows: { staffId: string | null; _count: number }[], id: string) => rows.find((r) => r.staffId === id)?._count ?? 0;

/** EMPLOYEE PERFORMANCE: one row per employee for the date range. */
export async function employeePerformance(a: Actor, raw: z.input<typeof rangeSchema>, now = new Date()) {
  need(a, "performance.view");
  const { from, to, staffId } = range(raw, now);
  const ids = staffFilter(a, staffId);
  const people = await db.staffUser.findMany({ where: { kind: "team", ...(ids ? { id: { in: ids } } : {}), OR: [{ role: "super_admin" }, { growthMember: { role: { in: ["sales", "manager"] } } }, { leadAssignments: { some: {} } }] }, select: { id: true, name: true, empNo: true, status: true }, orderBy: { name: "asc" } });
  const pid = people.map((p) => p.id);
  const S = { staffId: { in: pid } };
  const day = istDayStart(now), week = istWeekStart(now), month = istMonthStart(now);
  const reportedIn = (gte: Date, lt: Date, outcomes?: string[]) => db.callSession.groupBy({ by: ["staffId"], where: { ...S, reportedAt: { gte, lt }, outcome: outcomes ? { in: outcomes as never } : { not: "NOT_CALLED" } }, _count: true });
  const [assigned, launches, reported, connected, interested, demos, demosDone, trials, conversions, pending, overdue, today, thisWeek, monthConv, monthConnectedLeads, targets] = await Promise.all([
    db.leadAssignment.groupBy({ by: ["staffId"], where: { ...S, active: true }, _count: true }),
    db.callSession.groupBy({ by: ["staffId"], where: { ...S, launchedAt: { gte: from, lt: to } }, _count: true }),
    reportedIn(from, to),
    reportedIn(from, to, CONNECTED_OUTCOMES),
    reportedIn(from, to, INTERESTED_OUTCOMES),
    db.demoBooking.groupBy({ by: ["staffId"], where: { ...S, createdAt: { gte: from, lt: to } }, _count: true }),
    db.demoBooking.groupBy({ by: ["staffId"], where: { ...S, status: "completed", completedAt: { gte: from, lt: to } }, _count: true }),
    db.leadActivity.groupBy({ by: ["staffId"], where: { staffId: { in: pid }, kind: "stage", at: { gte: from, lt: to }, OR: [{ text: { contains: "→ TRIAL_STARTED" } }, { text: { startsWith: "Trial started" } }] }, _count: true }),
    db.conversionRecord.groupBy({ by: ["staffId"], where: { ...S, at: { gte: from, lt: to } }, _count: true, _sum: { amountPaise: true } }),
    db.followUpTask.groupBy({ by: ["staffId"], where: { ...S, status: "open", dueAt: { gte: now } }, _count: true }),
    db.followUpTask.groupBy({ by: ["staffId"], where: { ...S, status: "open", dueAt: { lt: now } }, _count: true }),
    reportedIn(day, new Date(day.getTime() + 86_400_000)),
    reportedIn(week, new Date(week.getTime() + 7 * 86_400_000)),
    db.conversionRecord.groupBy({ by: ["staffId"], where: { ...S, at: { gte: month } }, _count: true }),
    db.callSession.findMany({ where: { ...S, reportedAt: { gte: month }, outcome: { in: CONNECTED_OUTCOMES as never } }, distinct: ["staffId", "leadId"], select: { staffId: true } }),
    db.employeeCallingTarget.findMany({ where: S, orderBy: { effectiveFrom: "desc" } }),
  ]);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
  return {
    from: from.toISOString(), to: to.toISOString(),
    rows: people.map((p) => {
      const t = latestTargets(targets.filter((x) => x.staffId === p.id), todayISO(now));
      const mc = count(monthConv, p.id), ml = monthConnectedLeads.filter((x) => x.staffId === p.id).length;
      const conv = conversions.find((c) => c.staffId === p.id);
      return {
        id: p.id, name: p.name, empNo: p.empNo, status: p.status,
        assigned: count(assigned, p.id), launches: count(launches, p.id), reported: count(reported, p.id), connected: count(connected, p.id), interested: count(interested, p.id),
        demosScheduled: count(demos, p.id), demosCompleted: count(demosDone, p.id), trials: count(trials, p.id), conversions: conv?._count ?? 0, revenuePaise: conv?._sum.amountPaise ?? 0,
        pendingFollowUps: count(pending, p.id), overdueFollowUps: count(overdue, p.id),
        today: count(today, p.id), dailyTarget: t.daily?.calls ?? null, dailyPct: t.daily ? pct(count(today, p.id), t.daily.calls) : null,
        week: count(thisWeek, p.id), weeklyTarget: t.weekly?.calls ?? null, weeklyPct: t.weekly ? pct(count(thisWeek, p.id), t.weekly.calls) : null,
        monthConversions: mc, monthConnectedLeads: ml, monthConversionRate: pct(mc, ml),
      };
    }),
  };
}

/** MY WORK: the signed-in employee's own numbers. */
export async function myDashboard(a: Actor, now = new Date()) {
  need(a, "calls.make");
  const day = istDayStart(now), dayEnd = new Date(day.getTime() + 86_400_000), week = istWeekStart(now);
  const mine = { assignedStaffId: a.id, deletedAt: null };
  const [assigned, todayLeads, attemptedToday, connectedToday, interested, dueToday, overdue, demos, trials, conversions, week_, targets] = await Promise.all([
    db.pharmacyLead.count({ where: mine }),
    db.leadAssignment.count({ where: { staffId: a.id, active: true, assignedAt: { gte: day } } }),
    db.callSession.count({ where: { staffId: a.id, reportedAt: { gte: day, lt: dayEnd }, outcome: { not: "NOT_CALLED" } } }),
    db.callSession.count({ where: { staffId: a.id, reportedAt: { gte: day, lt: dayEnd }, outcome: { in: CONNECTED_OUTCOMES as never } } }),
    db.pharmacyLead.count({ where: { ...mine, stage: { in: ["INTERESTED", "DEMO_SCHEDULED", "DEMO_COMPLETED", "NEGOTIATION"] } } }),
    db.followUpTask.count({ where: { staffId: a.id, status: "open", dueAt: { gte: now, lt: dayEnd } } }),
    db.followUpTask.count({ where: { staffId: a.id, status: "open", dueAt: { lt: now } } }),
    db.demoBooking.count({ where: { staffId: a.id, status: "scheduled", at: { gte: day } } }),
    db.pharmacyLead.count({ where: { ...mine, stage: "TRIAL_STARTED" } }),
    db.conversionRecord.count({ where: { staffId: a.id } }),
    db.callSession.count({ where: { staffId: a.id, reportedAt: { gte: week }, outcome: { not: "NOT_CALLED" } } }),
    targetsFor(a.id, todayISO(now)),
  ]);
  return { assigned, todayLeads, attemptedToday, connectedToday, interested, dueToday, overdue, demos, trials, conversions, weekCalls: week_, targets };
}
export const myLeads = (a: Actor, raw: Parameters<typeof listLeads>[1]) => listLeads(a, { ...raw, staffId: a.id, sort: raw.sort ?? "followup" });

/** Overview dashboard and Analytics. Lead numbers follow what the actor may see; staff numbers follow their team. */
export async function dashboard(a: Actor, raw: z.input<typeof rangeSchema> = {}, now = new Date()) {
  need(a, "analytics.view");
  const { from, to } = range(raw, now);
  const ids = staffFilter(a, rangeSchema.parse(raw).staffId);
  const scope = a.growthRole === "analyst" ? { deletedAt: null } : leadScope(a);
  const S = inStaff(ids);
  const [total, newLeads, verified, assigned, launches, reported, connected, interested, demos, trials, conversions, revenue, byState, bySource, byStage] = await Promise.all([
    db.pharmacyLead.count({ where: scope }),
    db.pharmacyLead.count({ where: { AND: [scope, { createdAt: { gte: from, lt: to } }] } }),
    db.pharmacyLead.count({ where: { AND: [scope, { verification: { in: ["BUSINESS_VERIFIED", "PHONE_VERIFIED", "EMAIL_VERIFIED", "WEBSITE_VERIFIED", "PARTIALLY_VERIFIED"] } }] } }),
    db.pharmacyLead.count({ where: { AND: [scope, { assignedStaffId: { not: null } }] } }),
    db.callSession.count({ where: { ...S, launchedAt: { gte: from, lt: to } } }),
    db.callSession.count({ where: { ...S, reportedAt: { gte: from, lt: to }, outcome: { not: "NOT_CALLED" } } }),
    db.callSession.count({ where: { ...S, reportedAt: { gte: from, lt: to }, outcome: { in: CONNECTED_OUTCOMES as never } } }),
    db.callSession.count({ where: { ...S, reportedAt: { gte: from, lt: to }, outcome: { in: INTERESTED_OUTCOMES as never } } }),
    db.demoBooking.count({ where: { ...S, createdAt: { gte: from, lt: to } } }),
    db.leadActivity.count({ where: { ...(ids ? { staffId: { in: ids } } : {}), kind: "stage", at: { gte: from, lt: to }, OR: [{ text: { contains: "→ TRIAL_STARTED" } }, { text: { startsWith: "Trial started" } }] } }),
    db.conversionRecord.count({ where: { ...S, at: { gte: from, lt: to } } }),
    db.conversionRecord.aggregate({ where: { ...S, at: { gte: from, lt: to } }, _sum: { amountPaise: true } }),
    db.pharmacyLead.groupBy({ by: ["state"], where: scope, _count: true, orderBy: { _count: { state: "desc" } }, take: 15 }),
    db.pharmacyLead.groupBy({ by: ["sourceId"], where: scope, _count: true }),
    db.pharmacyLead.groupBy({ by: ["stage"], where: { AND: [scope, { erasedAt: null }] }, _count: true }),
  ]);
  const sources = await db.leadSource.findMany({ select: { id: true, name: true } });
  return {
    from: from.toISOString(), to: to.toISOString(),
    kpi: { total, newLeads, verified, assigned, launches, reported, connected, interested, demos, trials, conversions, revenuePaise: revenue._sum.amountPaise ?? 0 },
    byState: byState.map((s) => ({ name: s.state || "Unknown", n: s._count })),
    bySource: bySource.map((s) => ({ name: sources.find((x) => x.id === s.sourceId)?.name ?? "Unknown", n: s._count })).sort((x, y) => y.n - x.n),
    callingFunnel: [["Dialer opened", launches], ["Calls reported", reported], ["Connected", connected], ["Interested", interested], ["Demos booked", demos], ["Converted", conversions]].map(([name, n]) => ({ name: name as string, n: n as number })),
    salesFunnel: STAGES.map(([id, label]) => ({ id, name: label, n: byStage.find((s) => s.stage === id)?._count ?? 0 })),
  };
}

/** Charts over time (weekly leads, monthly revenue, districts in a state, campaigns). */
export async function trends(a: Actor, opts: { state?: string } = {}, now = new Date()) {
  need(a, "analytics.view");
  const ids = staffFilter(a);
  const since = new Date(now.getTime() - 12 * 7 * 86_400_000);
  const staffSql = ids ? Prisma.sql`AND "staffId" IN (${Prisma.join(ids)})` : Prisma.empty;
  // Manager/sales lead scope as SQL: unassigned or with their people.
  const leadSql = a.growthRole === "manager" ? Prisma.sql`AND ("assignedStaffId" IS NULL OR "assignedStaffId" IN (${Prisma.join(a.teamStaffIds)}))` : a.growthRole === "sales" ? Prisma.sql`AND "assignedStaffId" = ${a.id}` : Prisma.empty;
  const [weekly, monthly, districts, camp] = await Promise.all([
    db.$queryRaw<{ wk: Date; n: bigint }[]>`SELECT date_trunc('week', "createdAt" + interval '330 minutes') AS wk, count(*) AS n FROM "PharmacyLead" WHERE "deletedAt" IS NULL AND "createdAt" >= ${since} ${leadSql} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ m: Date; paise: bigint; n: bigint }[]>`SELECT date_trunc('month', "at" + interval '330 minutes') AS m, COALESCE(sum("amountPaise"), 0) AS paise, count(*) AS n FROM "ConversionRecord" WHERE "at" >= ${new Date(now.getTime() - 365 * 86_400_000)} ${staffSql} GROUP BY 1 ORDER BY 1`,
    opts.state ? db.pharmacyLead.groupBy({ by: ["district"], where: { AND: [a.growthRole === "analyst" ? { deletedAt: null } : leadScope(a), { state: opts.state }] }, _count: true, orderBy: { _count: { district: "desc" } }, take: 20 }) : Promise.resolve([]),
    a.growthRole === "analyst" || a.perms.includes("campaigns.manage") ? db.campaignRecipient.groupBy({ by: ["campaignId", "status"], _count: true }) : Promise.resolve([]),
  ]);
  const camps = await db.salesCampaign.findMany({ where: { id: { in: [...new Set(camp.map((c) => c.campaignId))] } }, select: { id: true, code: true, name: true } });
  return {
    weeklyLeads: weekly.map((w) => ({ week: w.wk.toISOString().slice(0, 10), n: Number(w.n) })),
    monthlyRevenue: monthly.map((m) => ({ month: m.m.toISOString().slice(0, 7), rupees: Math.round(Number(m.paise) / 100), n: Number(m.n) })),
    districts: districts.map((d) => ({ name: d.district || "Unknown", n: d._count })),
    campaigns: camps.map((c) => { const s = Object.fromEntries(camp.filter((x) => x.campaignId === c.id).map((x) => [x.status, x._count])); return { name: `${c.code} ${c.name}`, sent: (s.sent ?? 0) + (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0), delivered: (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0), read: (s.read ?? 0) + (s.replied ?? 0), replied: s.replied ?? 0, failed: s.failed ?? 0, skipped: s.skipped ?? 0 }; }),
  };
}

/** Daily roll-up for EmployeeDailyPerformance (history for charts; dashboards read live rows). */
export async function rollupDay(dayIso: string) {
  const from = new Date(dayIso + "T00:00:00+05:30"), to = new Date(from.getTime() + 86_400_000);
  const g = (where: Prisma.CallSessionWhereInput) => db.callSession.groupBy({ by: ["staffId"], where, _count: true });
  const [launch, rep, con, int, demos, conv] = await Promise.all([
    g({ launchedAt: { gte: from, lt: to } }), g({ reportedAt: { gte: from, lt: to }, outcome: { not: "NOT_CALLED" } }),
    g({ reportedAt: { gte: from, lt: to }, outcome: { in: CONNECTED_OUTCOMES as never } }), g({ reportedAt: { gte: from, lt: to }, outcome: { in: INTERESTED_OUTCOMES as never } }),
    db.demoBooking.groupBy({ by: ["staffId"], where: { createdAt: { gte: from, lt: to } }, _count: true }),
    db.conversionRecord.groupBy({ by: ["staffId"], where: { at: { gte: from, lt: to } }, _count: true }),
  ]);
  const ids = new Set([launch, rep, con, int, demos, conv].flatMap((x) => x.map((r) => r.staffId)));
  for (const id of ids) {
    const data = { launches: count(launch, id), reported: count(rep, id), connected: count(con, id), interested: count(int, id), demos: count(demos, id), conversions: count(conv, id) };
    await db.employeeDailyPerformance.upsert({ where: { staffId_day: { staffId: id, day: dateOnly(dayIso) } }, create: { staffId: id, day: dateOnly(dayIso), ...data }, update: data });
  }
  return ids.size;
}


