import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, loadSettings, need, notify, type Me } from "./auth";
import { bankStatus } from "./pay";

// Shifts, the roster, overtime and payroll readiness.
//  * A shift has a start, an end (it may cross midnight), a grace period and the hours it expects. A roster entry gives a
//    person a shift from a day, optionally until a day; the newest entry covering a day wins.
//  * Late after: the rostered shift's start + grace, else the person's own shift start (Edit employee), else Settings.
//  * Overtime is reported (worked time beyond the shift's hours, breaks taken out); it is not paid automatically:
//    payroll pays it only when HR adds it, so nobody is paid for time no one approved.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time as HH:MM.");
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const shiftInput = z.object({
  name: z.string().trim().min(2, "Name the shift.").max(40),
  start: hhmm, end: hhmm,
  graceMin: z.coerce.number().int().min(0).max(120).default(10),
  breakMin: z.coerce.number().int().min(0).max(180).default(30),
});
/** The last day (YYYY-MM-DD) of a month (YYYY-MM). */
export const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** Length of a shift in minutes (an end before the start means it ends the next day). */
export const shiftMinutes = (start: string, end: string) => { const d = toMin(end) - toMin(start); return d > 0 ? d : d + 1440; };

export async function saveShift(me: Me, id: string | null, raw: z.input<typeof shiftInput>) {
  need(me, "attendance");
  const i = shiftInput.parse(raw);
  if (i.start === i.end) throw new UserError("A shift must end at a different time than it starts.");
  if (shiftMinutes(i.start, i.end) <= i.breakMin) throw new UserError("The break is longer than the shift.");
  const data = { ...i, workMin: shiftMinutes(i.start, i.end) - i.breakMin, overnight: toMin(i.end) <= toMin(i.start) };
  const s = id ? await db.hrShift.update({ where: { id }, data }) : await db.hrShift.create({ data: { ...data, createdBy: me.id } });
  await audit(me, id ? "Shift changed" : "Shift created", `${s.name} ${s.start}–${s.end} · grace ${s.graceMin} min`);
  return s.id;
}
export async function archiveShift(me: Me, id: string) {
  need(me, "attendance");
  if (await db.hrShiftAssignment.count({ where: { shiftId: id, OR: [{ toDay: null }, { toDay: { gte: dateOnly(todayISO()) } }] } })) throw new UserError("People are still rostered on this shift. Move them first.");
  await db.hrShift.update({ where: { id }, data: { archived: true } });
  await audit(me, "Shift archived", id);
}

const rosterInput = z.object({ staffIds: z.array(z.string()).min(1, "Choose who works this shift.").max(500), shiftId: z.string().min(1), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day."), to: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).default("") });
/** Rosters people on a shift from a day (until a day, or open-ended). Overlapping older entries are cut short, never deleted. */
export async function assignShift(me: Me, raw: z.input<typeof rosterInput>) {
  need(me, "attendance");
  const i = rosterInput.parse(raw);
  if (i.to && i.to < i.from) throw new UserError("The last day is before the first day.");
  if (i.from < addDays(todayISO(), -31)) throw new UserError("A roster can start at most a month back.");
  const shift = await db.hrShift.findUnique({ where: { id: i.shiftId } });
  if (!shift || shift.archived) throw new UserError("Choose an active shift.");
  const people = await db.staffUser.findMany({ where: { id: { in: i.staffIds }, kind: "team", status: "active", role: { notIn: ["partner", "super_admin"] } }, select: { id: true } });
  if (people.length !== new Set(i.staffIds).size) throw new UserError("Choose active employees only.");
  await db.$transaction(async (tx) => {
    for (const p of people) {
      // An open-ended or overlapping earlier entry now ends the day before this one starts.
      await tx.hrShiftAssignment.updateMany({ where: { staffId: p.id, fromDay: { lt: dateOnly(i.from) }, OR: [{ toDay: null }, { toDay: { gte: dateOnly(i.from) } }] }, data: { toDay: dateOnly(addDays(i.from, -1)) } });
      await tx.hrShiftAssignment.create({ data: { staffId: p.id, shiftId: shift.id, fromDay: dateOnly(i.from), toDay: i.to ? dateOnly(i.to) : null, byId: me.id } });
    }
  });
  await notify(people.map((p) => p.id), `You are rostered on the ${shift.name} shift (${shift.start}–${shift.end}) from ${i.from}${i.to ? ` to ${i.to}` : ""}.`, "attendance");
  await audit(me, "Roster changed", `${shift.name} · ${people.length} people · from ${i.from}${i.to ? ` to ${i.to}` : ""}`);
  return people.length;
}

/** The shift rostered for a person on a day (newest entry first), or null. */
export async function shiftOn(staffId: string, day: string) {
  const a = await db.hrShiftAssignment.findFirst({ where: { staffId, fromDay: { lte: dateOnly(day) }, OR: [{ toDay: null }, { toDay: { gte: dateOnly(day) } }] }, orderBy: [{ fromDay: "desc" }, { createdAt: "desc" }], include: { shift: true } });
  return a?.shift ?? null;
}

/** The HH:MM after which a check-in on this day is late: the rostered shift + grace, the person's own start, or Settings. */
export async function lateAfterFor(staffId: string, day: string, fallback: { shiftStart?: string | null; lateAfter: string }) {
  const s = await shiftOn(staffId, day);
  if (s) return { lateAfter: clock(toMin(s.start) + s.graceMin), start: s.start, shift: s.name };
  return { lateAfter: fallback.shiftStart || fallback.lateAfter, start: fallback.shiftStart || fallback.lateAfter, shift: "" };
}

/** Rosters: active shifts, and who is on which shift on a day. */
export async function rosterView(me: Me, day = todayISO()) {
  need(me, "attendance");
  const [shifts, staff] = await Promise.all([
    db.hrShift.findMany({ where: { archived: false }, orderBy: { start: "asc" } }),
    db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null }, select: { id: true, name: true, empNo: true, hr: { select: { dept: true, shiftStart: true } } }, orderBy: { name: "asc" } }),
  ]);
  const rows = await db.hrShiftAssignment.findMany({ where: { fromDay: { lte: dateOnly(day) }, OR: [{ toDay: null }, { toDay: { gte: dateOnly(day) } }] }, orderBy: [{ fromDay: "desc" }, { createdAt: "desc" }] });
  const on = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!on.has(r.staffId)) on.set(r.staffId, r);
  return {
    day,
    shifts: shifts.map((s) => ({ id: s.id, name: s.name, start: s.start, end: s.end, graceMin: s.graceMin, breakMin: s.breakMin, workMin: s.workMin, overnight: s.overnight, people: [...on.values()].filter((r) => r.shiftId === s.id).length })),
    people: staff.map((p) => { const r = on.get(p.id); return { id: p.id, name: p.name, empNo: p.empNo, dept: p.hr?.dept ?? "", shiftId: r?.shiftId ?? null, from: r ? isoOf(r.fromDay) : null, to: r?.toDay ? isoOf(r.toDay) : null, ownStart: p.hr?.shiftStart ?? "" }; }),
  };
}

/**
 * Overtime for a month: for every day with a check-in and a check-out, worked minutes (check-out − check-in − breaks)
 * beyond the day's expected minutes (the rostered shift's, else Settings' work hours). Days with a missed check-out are
 * left out (they were closed automatically, so there is no real end time).
 */
export async function overtimeReport(me: Me, ym: string) {
  need(me, "attendance");
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month.").parse(ym);
  const s = await loadSettings();
  const first = `${m}-01`, end = monthEnd(m);
  const [att, breaks, staff, assigns] = await Promise.all([
    db.hrAttendance.findMany({ where: { day: { gte: dateOnly(first), lte: dateOnly(end) }, inAt: { not: null }, outAt: { not: null } } }),
    db.hrBreak.findMany({ where: { startAt: { gte: new Date(first + "T00:00:00+05:30"), lt: new Date(addDays(end, 2) + "T00:00:00+05:30") }, endAt: { not: null } } }),
    db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] } }, select: { id: true, name: true, empNo: true } }),
    db.hrShiftAssignment.findMany({ where: { fromDay: { lte: dateOnly(end) }, OR: [{ toDay: null }, { toDay: { gte: dateOnly(first) } }] }, include: { shift: true }, orderBy: [{ fromDay: "desc" }, { createdAt: "desc" }] }),
  ]);
  const expected = (staffId: string, day: string) => assigns.find((a) => a.staffId === staffId && isoOf(a.fromDay) <= day && (!a.toDay || isoOf(a.toDay) >= day))?.shift.workMin ?? Math.round(s.workHours * 60);
  const names = new Map(staff.map((x) => [x.id, x]));
  const per = new Map<string, { days: number; overtimeMin: number; lines: { day: string; workedMin: number; expectedMin: number; overtimeMin: number }[] }>();
  for (const a of att) {
    if (/missed|closed/i.test(a.note) || !names.has(a.staffId)) continue;
    const day = isoOf(a.day);
    const brk = breaks.filter((b) => b.staffId === a.staffId && b.startAt >= a.inAt! && b.endAt! <= a.outAt!).reduce((x, b) => x + (b.endAt!.getTime() - b.startAt.getTime()) / 60_000, 0);
    const worked = Math.round((a.outAt!.getTime() - a.inAt!.getTime()) / 60_000 - brk);
    const exp = expected(a.staffId, day), ot = Math.max(0, worked - exp);
    const row = per.get(a.staffId) ?? { days: 0, overtimeMin: 0, lines: [] };
    row.days++; row.overtimeMin += ot; if (ot > 0) row.lines.push({ day, workedMin: worked, expectedMin: exp, overtimeMin: ot });
    per.set(a.staffId, row);
  }
  return { month: m, rule: "Worked time (check-out − check-in − breaks) beyond the day’s expected time (rostered shift, else Settings). Days closed automatically after a missed check-out are left out. Overtime is not paid automatically.", people: [...per.entries()].map(([id, r]) => ({ id, name: names.get(id)!.name, empNo: names.get(id)!.empNo, ...r })).sort((a, b) => b.overtimeMin - a.overtimeMin) };
}

/**
 * What would hold up a payroll run for a month, before HR presses Process: problems that stop someone being paid
 * (no CTC, bank account missing or not matching), and open items that could change pay (pending leave, corrections and
 * claims in the period, missed check-outs not corrected, missing PAN for people with TDS, missing UAN with PF).
 */
export async function payrollReadiness(me: Me, ym: string) {
  need(me, "payroll");
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month.").parse(ym);
  const first = dateOnly(`${m}-01`), next = dateOnly(addDays(monthEnd(m), 1));
  const staff = await db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null }, include: { hr: true }, orderBy: { name: "asc" } });
  const ids = staff.map((s) => s.id);
  const [leaves, corrections, claims, missed] = await Promise.all([
    db.hrLeave.groupBy({ by: ["staffId"], where: { staffId: { in: ids }, status: "pending", fromDay: { lt: next }, toDay: { gte: first } }, _count: true }),
    db.hrCorrection.groupBy({ by: ["staffId"], where: { staffId: { in: ids }, status: "pending", day: { gte: first, lt: next } }, _count: true }),
    db.hrClaim.groupBy({ by: ["staffId"], where: { staffId: { in: ids }, status: { in: ["pending_hr", "pending_admin"] } }, _count: true }),
    db.hrAttendance.groupBy({ by: ["staffId"], where: { staffId: { in: ids }, day: { gte: first, lt: next }, note: { contains: "missed", mode: "insensitive" } }, _count: true }),
  ]);
  const count = (rows: { staffId: string; _count: number }[], id: string) => rows.find((r) => r.staffId === id)?._count ?? 0;
  const items: { staffId: string; name: string; empNo: string; level: "block" | "check"; issue: string }[] = [];
  for (const u of staff) {
    const h = u.hr, add = (level: "block" | "check", issue: string) => items.push({ staffId: u.id, name: u.name, empNo: u.empNo, level, issue });
    if (!h || !h.ctc) add("block", "No annual CTC on the profile.");
    const b = bankStatus(h, u.name);
    if (!b.ok) add("block", b.issue);
    if (h && h.ctc >= 1_200_000 && !h.panMasked) add("check", "No PAN, but the CTC may attract TDS.");
    if (h && h.ctc / 12 * 0.5 <= 15_000 && !h.uan) add("check", "No UAN: the PF return leaves this person out.");
    if (count(leaves, u.id)) add("check", `${count(leaves, u.id)} leave request(s) in the month still pending: approve or reject so loss of pay is right.`);
    if (count(corrections, u.id)) add("check", `${count(corrections, u.id)} attendance correction(s) pending.`);
    if (count(missed, u.id)) add("check", `${count(missed, u.id)} missed check-out(s) counted as half days unless corrected.`);
    if (count(claims, u.id)) add("check", `${count(claims, u.id)} reimbursement claim(s) waiting: only approved claims are paid.`);
  }
  return { month: m, ready: !items.some((i) => i.level === "block"), blocks: items.filter((i) => i.level === "block").length, checks: items.filter((i) => i.level === "check").length, items, people: staff.length };
}
