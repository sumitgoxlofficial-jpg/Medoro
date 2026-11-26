import "server-only";
import { db } from "@/server/db";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { loadSettings, type Me } from "./auth";
import { leaveLabel, PRIORITIES } from "./constants";
import { fmtTime, teamRequests, weekend } from "./time";

// My Team: what a reporting manager (anyone with direct reports, any role) sees about the people who report to them.
// Only direct reports, and only work information (attendance, leave, tasks): no pay, bank, KYC or chat.

export async function directReports(meId: string) {
  return db.hrProfile.findMany({ where: { managerId: meId, staff: { status: "active", kind: "team" } }, select: { staffId: true, designation: true, dept: true, staff: { select: { name: true, empNo: true } } } });
}
export const reportCount = (meId: string) => db.hrProfile.count({ where: { managerId: meId, staff: { status: "active", kind: "team" } } });
export async function isDirectReport(meId: string, staffId: string) {
  return !!(await db.hrProfile.findFirst({ where: { staffId, managerId: meId, staff: { status: "active" } }, select: { staffId: true } }));
}

export async function myTeam(me: Me) {
  const reports = await directReports(me.id);
  const ids = reports.map((r) => r.staffId);
  const empty = { people: [], requests: [], out: [], tasks: [], month: todayISO().slice(0, 7), priorities: PRIORITIES };
  if (!ids.length) return empty;
  const today = todayISO(), month = today.slice(0, 7), first = month + "-01", soon = addDays(today, 14);
  const s = await loadSettings();
  const [att, monthAtt, leaves, tasks, requests, holiday] = await Promise.all([
    db.hrAttendance.findMany({ where: { staffId: { in: ids }, day: dateOnly(today) } }),
    db.hrAttendance.findMany({ where: { staffId: { in: ids }, day: { gte: dateOnly(first), lte: dateOnly(today) } } }),
    db.hrLeave.findMany({ where: { staffId: { in: ids }, status: "approved", fromDay: { lte: dateOnly(soon) }, toDay: { gte: dateOnly(first) } }, orderBy: { fromDay: "asc" } }),
    db.hrTask.findMany({ where: { assigneeId: { in: ids }, kind: { not: "reminder" }, OR: [{ status: "open" }, { doneAt: { gte: new Date(first + "T00:00:00+05:30") } }] }, orderBy: [{ status: "desc" }, { due: "asc" }] }),
    teamRequests(me),
    db.hrHoliday.findUnique({ where: { day: dateOnly(today) } }),
  ]);
  const off = !!holiday || weekend(today, s.weekOff);
  const name = new Map(reports.map((r) => [r.staffId, r.staff.name]));
  const people = reports.map((r) => {
    const a = att.find((x) => x.staffId === r.staffId);
    const onLeave = leaves.some((l) => l.staffId === r.staffId && isoOf(l.fromDay) <= today && isoOf(l.toDay) >= today);
    const mine = tasks.filter((t) => t.assigneeId === r.staffId);
    const done = mine.filter((t) => t.status === "done"), open = mine.filter((t) => t.status !== "done");
    const onTime = done.filter((t) => !t.due || !t.doneAt || isoOf(t.doneAt) <= isoOf(t.due)).length;
    const days = monthAtt.filter((x) => x.staffId === r.staffId && x.inAt);
    return {
      id: r.staffId, name: r.staff.name, empNo: r.staff.empNo, designation: r.designation, dept: r.dept,
      today: a?.inAt ? (a.outAt ? "Checked out" : a.status === "late" ? "Late" : "Present") : onLeave ? "On leave" : off ? "Day off" : "Not in yet",
      inAt: a?.inAt ? fmtTime(a.inAt) : "", outAt: a?.outAt ? fmtTime(a.outAt) : "",
      presentDays: days.length, lateDays: days.filter((x) => x.status === "late").length,
      tasksOpen: open.length, tasksOverdue: open.filter((t) => t.due && isoOf(t.due) < today).length, tasksDone: done.length, onTimePct: done.length ? Math.round((onTime * 100) / done.length) : null,
    };
  });
  return {
    people, requests, month, priorities: PRIORITIES,
    out: leaves.filter((l) => isoOf(l.toDay) >= today).map((l) => ({ id: l.id, name: name.get(l.staffId) ?? "", from: isoOf(l.fromDay), to: isoOf(l.toDay), type: leaveLabel(l.type), half: l.half })),
    tasks: tasks.filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, who: name.get(t.assigneeId) ?? "", due: t.due ? isoOf(t.due) : null, priority: t.priority, overdue: !!t.due && isoOf(t.due) < today })),
  };
}
