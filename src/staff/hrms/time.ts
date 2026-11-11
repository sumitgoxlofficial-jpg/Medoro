import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { ALLOWED, MAX_BYTES, MAX_LABEL, getObject, putObject } from "@/server/storage";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, can, holders, loadSettings, need, needAdmin, notify, type Me } from "./auth";
import { CLAIM_TYPES, LEAVE_IDS, LEAVE_TYPES, leaveLabel, type LeaveTypeId, type Settings } from "./constants";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const IST = 330 * 60_000;
/** "HH:MM" in India time. */
export const istClock = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(11, 16);
const weekend = (day: string) => { const w = dateOnly(day).getUTCDay(); return w === 0 || w === 6; };
const daysBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const monthBounds = (ym: string) => { const first = ym + "-01"; const d = dateOnly(first); const last = isoOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); return { first, last }; };
export const ymOf = (day: string) => day.slice(0, 7);
export const addMonths = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return isoOf(d).slice(0, 7); };

// ── Holidays
export async function holidays(from?: string, to?: string) {
  const rows = await db.hrHoliday.findMany({ where: from && to ? { day: { gte: dateOnly(from), lte: dateOnly(to) } } : {}, orderBy: { day: "asc" } });
  return rows.map((h) => ({ id: h.id, day: isoOf(h.day), name: h.name, kind: h.kind }));
}
export async function addHoliday(me: Me, raw: { day: string; name: string; kind?: string }) {
  need(me, "attendance");
  const i = z.object({ day: iso, name: z.string().trim().min(2, "Enter the holiday name.").max(80), kind: z.string().trim().max(40).default("National holiday") }).parse(raw);
  if (await db.hrHoliday.findUnique({ where: { day: dateOnly(i.day) } })) throw new UserError("There is already a holiday on that date.");
  await db.hrHoliday.create({ data: { day: dateOnly(i.day), name: i.name, kind: i.kind || "National holiday" } });
  await audit(me, "Holiday added", `${i.day} · ${i.name}`);
}
export async function removeHoliday(me: Me, id: string) {
  need(me, "attendance");
  const h = await db.hrHoliday.findUnique({ where: { id } });
  if (!h) throw new UserError("Holiday not found.");
  await db.hrHoliday.delete({ where: { id } });
  await audit(me, "Holiday removed", `${isoOf(h.day)} · ${h.name}`);
}
/** Gazetted holidays that fall on the same date every year. */
const FIXED_HOLIDAYS: [string, string][] = [["01-26", "Republic Day"], ["04-14", "Dr. Ambedkar Jayanti"], ["08-15", "Independence Day"], ["10-02", "Gandhi Jayanti"], ["12-25", "Christmas"]];
/**
 * Festival holidays move with the moon, so they are listed per year (central government gazetted list). They can shift by a
 * day, and states add their own: HR checks them in the calendar and edits what differs. Years without a list get the fixed ones.
 */
const FESTIVAL_HOLIDAYS: Record<number, [string, string][]> = {
  2026: [["03-04", "Holi"], ["03-21", "Id-ul-Fitr"], ["03-26", "Ram Navami"], ["03-31", "Mahavir Jayanti"], ["04-03", "Good Friday"], ["05-01", "Buddha Purnima"], ["05-27", "Id-ul-Zuha (Bakrid)"],
    ["06-26", "Muharram"], ["08-26", "Milad-un-Nabi"], ["09-04", "Janmashtami"], ["10-20", "Dussehra"], ["11-08", "Diwali"], ["11-24", "Guru Nanak Jayanti"]],
};
/** Adds the official holidays of a year (existing dates are left alone). */
export async function addNationalHolidays(me: Me, year: number) {
  need(me, "attendance");
  const y = z.number().int().min(2020).max(2100).parse(year);
  const festivals = FESTIVAL_HOLIDAYS[y];
  const all = [...FIXED_HOLIDAYS, ...(festivals ?? [])];
  const r = await db.hrHoliday.createMany({ data: all.map(([d, name]) => ({ day: dateOnly(`${y}-${d}`), name, kind: "National holiday" })), skipDuplicates: true });
  await audit(me, "Official holidays added", `${y} · ${r.count} new`);
  return { added: r.count, festivals: !!festivals };
}

// ── Attendance
export async function today(me: Me) {
  const a = await db.hrAttendance.findUnique({ where: { staffId_day: { staffId: me.id, day: dateOnly(todayISO()) } } });
  return { inAt: a?.inAt?.toISOString() ?? null, outAt: a?.outAt?.toISOString() ?? null, status: a?.status ?? null };
}
export async function checkIn(me: Me) {
  const day = todayISO(), now = new Date();
  const s = await loadSettings();
  const have = await db.hrAttendance.findUnique({ where: { staffId_day: { staffId: me.id, day: dateOnly(day) } } });
  if (have?.inAt) throw new UserError("You have already checked in today.");
  if (await approvedLeaveOn(me.id, day)) throw new UserError("You are on approved leave today. Ask HR to cancel the leave first.");
  const status = istClock(now) > s.lateAfter ? "late" : "present";
  await db.hrAttendance.upsert({ where: { staffId_day: { staffId: me.id, day: dateOnly(day) } }, update: { inAt: now, status }, create: { staffId: me.id, day: dateOnly(day), inAt: now, status } });
  await db.hrProfile.update({ where: { staffId: me.id }, data: { presence: "active", presenceNote: "", presenceAt: now } });
  await audit(me, "Checked in", istClock(now));
  return { status, at: now.toISOString() };
}
export async function checkOut(me: Me) {
  const a = await db.hrAttendance.findUnique({ where: { staffId_day: { staffId: me.id, day: dateOnly(todayISO()) } } });
  if (!a?.inAt) throw new UserError("Check in first.");
  if (a.outAt) throw new UserError("You have already checked out today.");
  const now = new Date();
  await db.$transaction([
    db.hrAttendance.update({ where: { id: a.id }, data: { outAt: now } }),
    db.hrBreak.updateMany({ where: { staffId: me.id, endAt: null }, data: { endAt: now } }),
    db.hrProfile.update({ where: { staffId: me.id }, data: { presence: "offline", presenceNote: "" } }),
  ]);
  await audit(me, "Checked out", istClock(now));
}

const approvedLeaveOn = (staffId: string, day: string) => db.hrLeave.findFirst({ where: { staffId, status: "approved", fromDay: { lte: dateOnly(day) }, toDay: { gte: dateOnly(day) } } });

export type DayCell = { day: string; kind: "present" | "late" | "absent" | "leave" | "holiday" | "weekend" | "upcoming" | "today" | "before"; label: string; inAt: string | null; outAt: string | null; correctable: boolean };

/** One person's month: a cell per day plus the counts. Absence is only counted when check-in is switched on. */
export async function monthFor(staffId: string, ym: string, s: Settings) {
  const { first, last } = monthBounds(ym);
  const todayDay = todayISO();
  const [att, hols, leaves, profile, corrections] = await Promise.all([
    db.hrAttendance.findMany({ where: { staffId, day: { gte: dateOnly(first), lte: dateOnly(last) } } }),
    holidays(first, last),
    db.hrLeave.findMany({ where: { staffId, status: "approved", fromDay: { lte: dateOnly(last) }, toDay: { gte: dateOnly(first) } } }),
    db.hrProfile.findUnique({ where: { staffId }, select: { joinDate: true, createdAt: true } }),
    db.hrCorrection.findMany({ where: { staffId, status: "pending", day: { gte: dateOnly(first), lte: dateOnly(last) } } }),
  ]);
  const start = profile?.joinDate ? isoOf(profile.joinDate) : profile ? todayISO(profile.createdAt) : first;
  const byDay = new Map(att.map((a) => [isoOf(a.day), a]));
  const holBy = new Map(hols.map((h) => [h.day, h.name]));
  const asked = new Set(corrections.map((c) => isoOf(c.day)));
  const counts = { present: 0, late: 0, absent: 0, leave: 0, holidays: 0, overtimeMin: 0, workDays: 0 };
  const cells: DayCell[] = daysBetween(first, last).map((day) => {
    const a = byDay.get(day), lv = leaves.find((l) => isoOf(l.fromDay) <= day && isoOf(l.toDay) >= day);
    const inAt = a?.inAt?.toISOString() ?? null, outAt = a?.outAt?.toISOString() ?? null;
    const cell = (kind: DayCell["kind"], label: string, correctable = false): DayCell => ({ day, kind, label, inAt, outAt, correctable: correctable && !asked.has(day) });
    const working = !weekend(day) && !holBy.has(day);
    if (working && day >= start && day <= todayDay) counts.workDays++;
    if (a?.inAt) {
      if (a.outAt) counts.overtimeMin += Math.max(0, Math.round((a.outAt.getTime() - a.inAt.getTime()) / 60_000) - a.breakMin - 9 * 60);
      const late = a.status === "late";
      if (late) counts.late++; else counts.present++;
      const text = `${late ? "Late" : "Present"} · in ${fmtTime(a.inAt)}${a.outAt ? ` · out ${fmtTime(a.outAt)}` : ""}${a.note ? ` · ${a.note}` : ""}`;
      return cell(late ? "late" : "present", text, late);
    }
    if (a?.status === "present") { counts.present++; return cell("present", `Present · ${a.note || "marked by HR"}`); }
    if (holBy.has(day)) { if (day <= todayDay) counts.holidays++; return cell("holiday", `Holiday · ${holBy.get(day)}`); }
    if (weekend(day)) return cell("weekend", "Weekend");
    if (lv) { counts.leave++; return cell("leave", `On leave · ${leaveLabel(lv.type)}`); }
    if (day > todayDay) return cell("upcoming", "Upcoming");
    if (day === todayDay) return cell("today", "Today · not checked in yet");
    if (day < start) return cell("before", "Before joining");
    if (!s.checkin) return cell("before", "No record");
    counts.absent++;
    return cell("absent", asked.has(day) ? "Absent · correction requested" : "Absent · no check-in", true);
  });
  return { ym, cells, counts };
}
export const fmtTime = (d: Date) => { const [h, m] = istClock(d).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

export async function requestCorrection(me: Me, raw: { day: string; reason: string }) {
  const i = z.object({ day: iso, reason: z.string().trim().min(5, "Say what happened, in a few words.").max(300) }).parse(raw);
  if (i.day >= todayISO()) throw new UserError("Corrections are for past days.");
  if (i.day < addDays(todayISO(), -45)) throw new UserError("Corrections can be requested for the last 45 days.");
  if (await db.hrCorrection.findFirst({ where: { staffId: me.id, day: dateOnly(i.day), status: "pending" } })) throw new UserError("You already asked for a correction on this day.");
  await db.hrCorrection.create({ data: { staffId: me.id, day: dateOnly(i.day), reason: i.reason } });
  await notify((await holders("attendance")).filter((x) => x !== me.id), `${me.name} asked for an attendance correction on ${i.day}.`, "hrleave");
}
export async function decideCorrection(me: Me, id: string, approve: boolean) {
  need(me, "attendance");
  const c = await db.hrCorrection.findUnique({ where: { id } });
  if (!c || c.status !== "pending") throw new UserError("This request was already decided.");
  if (c.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to decide your own request.");
  await db.$transaction([
    db.hrCorrection.update({ where: { id }, data: { status: approve ? "approved" : "rejected", decidedBy: me.id, decidedAt: new Date() } }),
    ...(approve ? [db.hrAttendance.upsert({ where: { staffId_day: { staffId: c.staffId, day: c.day } }, update: { status: "present", note: "Corrected by HR" }, create: { staffId: c.staffId, day: c.day, status: "present", note: "Corrected by HR" } })] : []),
  ]);
  await notify([c.staffId], `Your attendance correction for ${isoOf(c.day)} was ${approve ? "approved" : "rejected"}.`, "attendance");
  await audit(me, `Attendance correction ${approve ? "approved" : "rejected"}`, isoOf(c.day));
}

/** Everyone's status today, for HR. */
export async function teamToday(me: Me) {
  need(me, "attendance");
  const day = todayISO();
  const [staff, att, leaves] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", role: { not: "partner" }, status: "active" }, select: { id: true, name: true, empNo: true, hr: { select: { dept: true } } }, orderBy: { name: "asc" } }),
    db.hrAttendance.findMany({ where: { day: dateOnly(day) } }),
    db.hrLeave.findMany({ where: { status: "approved", fromDay: { lte: dateOnly(day) }, toDay: { gte: dateOnly(day) } } }),
  ]);
  const off = weekend(day) || !!(await db.hrHoliday.findUnique({ where: { day: dateOnly(day) } }));
  return staff.map((u) => {
    const a = att.find((x) => x.staffId === u.id), onLeave = leaves.some((l) => l.staffId === u.id);
    const status = a?.inAt ? (a.status === "late" ? "Late" : "Present") : onLeave ? "On leave" : off ? "Day off" : "Not in yet";
    return { id: u.id, name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", inAt: a?.inAt ? fmtTime(a.inAt) : "", outAt: a?.outAt ? fmtTime(a.outAt) : "", status };
  });
}

// ── Leave
export async function leaveBalances(staffId: string, s: Settings, year = todayISO().slice(0, 4)) {
  const [p, rows] = await Promise.all([
    db.hrProfile.findUnique({ where: { staffId }, select: { leaveExtra: true } }),
    db.hrLeave.findMany({ where: { staffId, status: { in: ["approved", "pending"] }, fromDay: { gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year}-12-31`) } } }),
  ]);
  const extra = (p?.leaveExtra ?? {}) as Record<string, number>;
  return LEAVE_TYPES.map((l) => {
    const total = s.leave[l.id] + (Number(extra[l.id]) || 0);
    const used = rows.filter((r) => r.type === l.id && r.status === "approved").reduce((a, r) => a + r.days, 0);
    const pending = rows.filter((r) => r.type === l.id && r.status === "pending").reduce((a, r) => a + r.days, 0);
    return { id: l.id, label: l.short, total, used, pending, left: Math.max(0, total - used - pending) };
  });
}
export async function grantLeave(me: Me, staffId: string, type: string, days: number) {
  need(me, "attendance");
  const ty = z.enum(LEAVE_IDS).parse(type), n = z.number().int().min(-30).max(30).parse(days);
  const p = await db.hrProfile.findUnique({ where: { staffId } });
  if (!p) throw new UserError("Employee not found.");
  const old = (p.leaveExtra ?? {}) as Record<string, number>;
  // Rebuilt from the known leave types only, so no other key can be written.
  const extra = Object.fromEntries(LEAVE_IDS.map((k) => [k, (Number(old[k]) || 0) + (k === ty ? n : 0)]));
  await db.hrProfile.update({ where: { staffId }, data: { leaveExtra: extra } });
  await notify([staffId], `${n > 0 ? n + " day(s) added to" : -n + " day(s) removed from"} your ${leaveLabel(ty)} balance.`, "leave");
  await audit(me, "Leave balance adjusted", `${staffId} · ${ty} · ${n > 0 ? "+" : ""}${n}`);
}

export async function applyLeave(me: Me, raw: { type: string; from: string; to: string; reason: string }) {
  const i = z.object({ type: z.enum(LEAVE_IDS), from: iso, to: iso, reason: z.string().trim().max(300).default("") }).parse(raw);
  if (i.to < i.from) throw new UserError("The last day can’t be before the first day.");
  if (i.from < addDays(todayISO(), -30)) throw new UserError("Leave can be applied up to 30 days back.");
  if (i.to > addDays(i.from, 60)) throw new UserError("Apply for at most 60 days at a time.");
  const hol = new Set((await holidays(i.from, i.to)).map((h) => h.day));
  const days = daysBetween(i.from, i.to).filter((d) => !weekend(d) && !hol.has(d)).length;
  if (!days) throw new UserError("Those dates are all weekends or holidays.");
  const clash = await db.hrLeave.findFirst({ where: { staffId: me.id, status: { in: ["pending", "approved"] }, fromDay: { lte: dateOnly(i.to) }, toDay: { gte: dateOnly(i.from) } } });
  if (clash) throw new UserError("You already have leave on some of these dates.");
  const s = await loadSettings();
  const bal = (await leaveBalances(me.id, s, i.from.slice(0, 4))).find((b) => b.id === i.type)!;
  if (bal.left < days) throw new UserError(`You have ${bal.left} ${leaveLabel(i.type)} day${bal.left === 1 ? "" : "s"} left; this request needs ${days}.`);
  await db.hrLeave.create({ data: { staffId: me.id, type: i.type, fromDay: dateOnly(i.from), toDay: dateOnly(i.to), days, reason: i.reason } });
  await notify((await holders("attendance")).filter((x) => x !== me.id), `${me.name} applied for ${days} day${days > 1 ? "s" : ""} of ${leaveLabel(i.type)}.`, "hrleave");
  return days;
}
export async function cancelLeave(me: Me, id: string) {
  const l = await db.hrLeave.findFirst({ where: { id, staffId: me.id } });
  if (!l) throw new UserError("Leave request not found.");
  if (l.status !== "pending" && !(l.status === "approved" && isoOf(l.fromDay) > todayISO())) throw new UserError("Only pending or upcoming leave can be cancelled.");
  await db.hrLeave.update({ where: { id }, data: { status: "cancelled" } });
}
export async function decideLeave(me: Me, id: string, approve: boolean) {
  need(me, "attendance");
  const l = await db.hrLeave.findUnique({ where: { id } });
  if (!l || l.status !== "pending") throw new UserError("This request was already decided.");
  if (l.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to approve your own leave.");
  await db.hrLeave.update({ where: { id }, data: { status: approve ? "approved" : "rejected", decidedBy: me.id, decidedAt: new Date() } });
  await notify([l.staffId], `Your ${leaveLabel(l.type)} (${isoOf(l.fromDay)}${l.days > 1 ? " to " + isoOf(l.toDay) : ""}) was ${approve ? "approved" : "rejected"}.`, "leave");
  await audit(me, `Leave ${approve ? "approved" : "rejected"}`, `${l.staffId} · ${l.type} · ${isoOf(l.fromDay)}`);
}
export async function myLeaves(me: Me) {
  const rows = await db.hrLeave.findMany({ where: { staffId: me.id }, orderBy: { createdAt: "desc" }, take: 40 });
  return rows.map((l) => ({ id: l.id, type: l.type as LeaveTypeId, from: isoOf(l.fromDay), to: isoOf(l.toDay), days: l.days, reason: l.reason, status: l.status, canCancel: l.status === "pending" || (l.status === "approved" && isoOf(l.fromDay) > todayISO()) }));
}
/** Approved leave overlapping the window: who is out. Reasons stay private. */
export async function whosOut(from: string, to: string) {
  const rows = await db.hrLeave.findMany({ where: { status: "approved", fromDay: { lte: dateOnly(to) }, toDay: { gte: dateOnly(from) } }, orderBy: { fromDay: "asc" } });
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: rows.map((r) => r.staffId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((l) => ({ id: l.id, staffId: l.staffId, name: names.get(l.staffId) ?? "", type: l.type, from: isoOf(l.fromDay), to: isoOf(l.toDay), days: l.days }));
}

/** Everything waiting for HR: leave and attendance corrections. */
export async function pendingApprovals(me: Me) {
  if (!can(me, "attendance")) return [];
  const [leaves, corr] = await Promise.all([
    db.hrLeave.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } }),
    db.hrCorrection.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } }),
  ]);
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: [...leaves, ...corr].map((r) => r.staffId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return [
    ...leaves.map((l) => ({ id: l.id, kind: "leave" as const, name: names.get(l.staffId) ?? "", mine: l.staffId === me.id, text: `${leaveLabel(l.type)} · ${isoOf(l.fromDay)}${l.days > 1 ? " to " + isoOf(l.toDay) : ""} · ${l.days} day${l.days > 1 ? "s" : ""}`, note: l.reason })),
    ...corr.map((c) => ({ id: c.id, kind: "correction" as const, name: names.get(c.staffId) ?? "", mine: c.staffId === me.id, text: `Attendance correction · ${isoOf(c.day)}`, note: c.reason })),
  ];
}

// ── Reimbursement claims: the employee submits, HR reviews, the super admin gives the final sign-off, payroll pays.
export async function submitClaim(me: Me, form: FormData) {
  const i = z.object({
    type: z.enum(CLAIM_TYPES), amount: z.coerce.number().int("Enter the amount in whole rupees.").min(1, "Enter the amount.").max(1_000_000), note: z.string().trim().max(200).default(""),
  }).parse({ type: form.get("type"), amount: form.get("amount"), note: form.get("note") ?? "" });
  const file = form.get("bill");
  let billKey: string | null = null, billName = "";
  if (file instanceof File && file.size) {
    const ext = ALLOWED[file.type as keyof typeof ALLOWED];
    if (!ext) throw new UserError("Attach the bill as a PDF, JPG or PNG.");
    if (file.size > MAX_BYTES) throw new UserError(`The bill is too large (limit ${MAX_LABEL}).`);
    billKey = `_hrms/claims/${randomUUID()}.${ext}`;
    billName = file.name.replace(/[^\w.\- ]/g, "").slice(0, 80) || `bill.${ext}`;
    await putObject(billKey, Buffer.from(await file.arrayBuffer()), file.type);
  }
  await db.hrClaim.create({ data: { staffId: me.id, type: i.type, amount: i.amount, note: i.note, billKey, billName } });
  await notify((await holders("attendance")).filter((x) => x !== me.id), `${me.name} submitted a ${i.type} claim for ₹${i.amount.toLocaleString("en-IN")}.`, "hrleave");
}
const claimRow = (c: { id: string; staffId: string; type: string; amount: number; note: string; billKey: string | null; billName: string; status: string; createdAt: Date; paidMonth: string | null }, names: Map<string, string>) =>
  ({ id: c.id, staffId: c.staffId, by: names.get(c.staffId) ?? "", type: c.type, amount: c.amount, note: c.note, hasBill: !!c.billKey, billName: c.billName, status: c.status, at: c.createdAt.toISOString(), paidMonth: c.paidMonth });
export async function claims(where: { staffId?: string; status?: string[] }, take = 60) {
  const rows = await db.hrClaim.findMany({ where: { ...(where.staffId ? { staffId: where.staffId } : {}), ...(where.status ? { status: { in: where.status } } : {}) }, orderBy: { createdAt: "desc" }, take });
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: rows.map((r) => r.staffId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((c) => claimRow(c, names));
}
export async function hrDecideClaim(me: Me, id: string, approve: boolean) {
  need(me, "attendance");
  const c = await db.hrClaim.findUnique({ where: { id } });
  if (!c || c.status !== "pending_hr") throw new UserError("This claim is not waiting for HR.");
  if (c.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to review your own claim.");
  await db.hrClaim.update({ where: { id }, data: { status: approve ? "pending_admin" : "rejected", hrBy: me.id, decidedAt: approve ? null : new Date() } });
  if (approve) await notify((await db.staffUser.findMany({ where: { role: "super_admin", status: "active" }, select: { id: true } })).map((u) => u.id), `A ${c.type} claim for ₹${c.amount.toLocaleString("en-IN")} needs your final sign-off.`, "saapprovals");
  else await notify([c.staffId], `Your ${c.type} claim for ₹${c.amount.toLocaleString("en-IN")} was rejected by HR.`, "leave");
  await audit(me, `Claim ${approve ? "sent to super admin" : "rejected"}`, `${c.type} · ₹${c.amount}`);
}
export async function adminDecideClaim(me: Me, id: string, approve: boolean) {
  needAdmin(me);
  const c = await db.hrClaim.findUnique({ where: { id } });
  if (!c || c.status !== "pending_admin") throw new UserError("This claim is not waiting for the final sign-off.");
  await db.hrClaim.update({ where: { id }, data: { status: approve ? "approved" : "rejected", adminBy: me.id, decidedAt: new Date() } });
  await notify([c.staffId], approve ? `Your ${c.type} claim for ₹${c.amount.toLocaleString("en-IN")} is approved. It is paid with your next salary.` : `Your ${c.type} claim for ₹${c.amount.toLocaleString("en-IN")} was rejected.`, "leave");
  await audit(me, `Claim ${approve ? "approved" : "rejected"}`, `${c.type} · ₹${c.amount}`);
}
/** The uploaded bill, for its owner, HR reviewers and the super admin. */
export async function claimBill(me: Me, id: string) {
  const c = await db.hrClaim.findUnique({ where: { id } });
  if (!c?.billKey || (c.staffId !== me.id && !can(me, "attendance") && !can(me, "payroll"))) return null;
  const bytes = await getObject(c.billKey);
  if (!bytes) return null;
  const ext = c.billKey.split(".").pop()!;
  const type = (Object.entries(ALLOWED).find(([, e]) => e === ext)?.[0]) ?? "application/octet-stream";
  return { bytes, type, name: c.billName || `bill.${ext}` };
}
