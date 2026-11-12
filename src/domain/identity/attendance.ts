import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { dateOnly, isoOf, istDate, todayISO } from "@/lib/dates";

// Attendance of the pharmacy's own staff: each person punches in and out at their branch (once a day, India time).
// A manager (Users & branches) sees the team and can fix or add a day with a reason; every fix is audited.

const IST = 330 * 60_000;
const clock = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(11, 16);
const atIst = (day: string, hhmm: string) => new Date(new Date(`${day}T${hhmm}:00.000Z`).getTime() - IST);
const mins = (a: { inAt: Date | null; outAt: Date | null }) => (a.inAt && a.outAt ? Math.max(0, Math.round((a.outAt.getTime() - a.inAt.getTime()) / 60_000)) : 0);

export async function punchIn(ctx: Ctx) {
  if (ctx.readOnly) throw new UserError("Medoro support access is read-only.");
  const day = todayISO(), now = new Date();
  const have = await db.staffAttendance.findUnique({ where: { tenantId_userId_day: { tenantId: ctx.tenantId, userId: ctx.userId, day: dateOnly(day) } } });
  if (have?.inAt) throw new UserError("You have already punched in today.");
  await db.staffAttendance.upsert({
    where: { tenantId_userId_day: { tenantId: ctx.tenantId, userId: ctx.userId, day: dateOnly(day) } },
    update: { inAt: now, branchId: ctx.branchId }, create: { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, day: dateOnly(day), inAt: now },
  });
  return { at: now.toISOString() };
}
export async function punchOut(ctx: Ctx) {
  if (ctx.readOnly) throw new UserError("Medoro support access is read-only.");
  const a = await db.staffAttendance.findUnique({ where: { tenantId_userId_day: { tenantId: ctx.tenantId, userId: ctx.userId, day: dateOnly(todayISO()) } } });
  if (!a?.inAt) throw new UserError("Punch in first.");
  if (a.outAt) throw new UserError("You have already punched out today.");
  const now = new Date();
  await db.staffAttendance.update({ where: { id: a.id }, data: { outAt: now } });
  return { at: now.toISOString(), minutes: mins({ inAt: a.inAt, outAt: now }) };
}

const ymRe = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month.");
const bounds = (ym: string) => { const first = `${ym}-01`, last = isoOf(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0))); return { first, last }; };

/** One person's days in a month. Anyone sees their own; a manager can ask for someone else's. */
export async function monthOf(ctx: Ctx, ymRaw: string, userId = ctx.userId) {
  const ym = ymRe.parse(ymRaw), { first, last } = bounds(ym);
  if (userId !== ctx.userId) authorize(ctx, "users");
  const rows = await db.staffAttendance.findMany({ where: { tenantId: ctx.tenantId, userId, day: { gte: dateOnly(first), lte: dateOnly(last) } }, orderBy: { day: "asc" } });
  const days = rows.map((r) => ({ day: isoOf(r.day), in: r.inAt ? clock(r.inAt) : "", out: r.outAt ? clock(r.outAt) : "", minutes: mins(r), note: r.note, edited: !!r.editedBy }));
  return { ym, days, present: days.filter((d) => d.in).length, minutes: days.reduce((a, d) => a + d.minutes, 0) };
}
export async function today(ctx: Ctx) {
  const a = await db.staffAttendance.findUnique({ where: { tenantId_userId_day: { tenantId: ctx.tenantId, userId: ctx.userId, day: dateOnly(todayISO()) } } });
  return { in: a?.inAt?.toISOString() ?? null, out: a?.outAt?.toISOString() ?? null };
}

/** The team's month at one branch (or every branch the manager can open): days present and hours per person. */
export async function teamMonth(ctx: Ctx, ymRaw: string, branchId: string | "all" = ctx.branchId) {
  authorize(ctx, "users");
  const ym = ymRe.parse(ymRaw), { first, last } = bounds(ym);
  const mine = ctx.branches.map((b) => b.id);
  if (branchId !== "all" && !mine.includes(branchId)) throw new UserError("You don’t have access to that branch.");
  const branches = branchId === "all" ? mine : [branchId];
  const [rows, users] = await Promise.all([
    db.staffAttendance.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: branches }, day: { gte: dateOnly(first), lte: dateOnly(last) } } }),
    db.user.findMany({ where: { tenantId: ctx.tenantId, active: true, isSupport: false }, select: { id: true, name: true, employeeNo: true, branchIds: true } }),
  ]);
  const todayDay = todayISO();
  const people = users.filter((u) => rows.some((r) => r.userId === u.id) || u.branchIds.length === 0 || u.branchIds.some((b) => branches.includes(b)));
  return people.map((u) => {
    const mineRows = rows.filter((r) => r.userId === u.id);
    const t = mineRows.find((r) => isoOf(r.day) === todayDay);
    return { userId: u.id, name: u.name, employeeNo: u.employeeNo ?? "", present: mineRows.filter((r) => r.inAt).length, minutes: mineRows.reduce((a, r) => a + mins(r), 0), today: t?.inAt ? (t.outAt ? `${clock(t.inAt)}–${clock(t.outAt)}` : `In ${clock(t.inAt)}`) : "" };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const fixSchema = z.object({
  userId: z.string().min(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  in: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the in time as HH:MM."), out: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Enter the out time as HH:MM.").default(""),
  reason: z.string().trim().min(3, "Say why, in a few words.").max(200),
});
/** A manager sets or corrects someone's day. In and out times are India time. */
export async function fixDay(ctx: Ctx, raw: z.input<typeof fixSchema>) {
  authorize(ctx, "users");
  const i = fixSchema.parse(raw);
  if (i.day > todayISO()) throw new UserError("You can’t set attendance for a day that hasn’t come.");
  if (i.out && i.out <= i.in) throw new UserError("Out time must be after the in time.");
  const u = await db.user.findFirst({ where: { id: i.userId, tenantId: ctx.tenantId } });
  if (!u) throw new UserError("Staff member not found.");
  const data = { inAt: atIst(i.day, i.in), outAt: i.out ? atIst(i.day, i.out) : null, note: `Set by manager: ${i.reason}`, editedBy: ctx.userId };
  await db.$transaction(async (tx) => {
    await tx.staffAttendance.upsert({ where: { tenantId_userId_day: { tenantId: ctx.tenantId, userId: u.id, day: dateOnly(i.day) } }, update: { ...data, branchId: ctx.branchId }, create: { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: u.id, day: dateOnly(i.day), ...data } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Staff attendance set", entity: "user", entityId: u.id, detail: `${u.name} · ${i.day} · ${i.in}${i.out ? `–${i.out}` : ""} · ${i.reason.slice(0, 80)}` });
  });
}

/** CSV rows for the staff-attendance report: one line per person per day, for the period. */
export async function attendanceRows(tenantId: string, branchId: string, from: Date, to: Date) {
  const [rows, users] = await Promise.all([
    db.staffAttendance.findMany({ where: { tenantId, branchId, day: { gte: dateOnly(istDate(from)), lt: dateOnly(istDate(to)) } }, orderBy: [{ day: "asc" }] }),
    db.user.findMany({ where: { tenantId }, select: { id: true, name: true, employeeNo: true } }),
  ]);
  return [["Date", "Name", "Employee no.", "In", "Out", "Hours", "Note"],
    ...rows.map((r) => { const u = users.find((x) => x.id === r.userId); return [isoOf(r.day), u?.name ?? "", u?.employeeNo ?? "", r.inAt ? clock(r.inAt) : "", r.outAt ? clock(r.outAt) : "", (mins(r) / 60).toFixed(2), r.note]; })];
}
export const canSeeTeam = (ctx: Ctx) => can(ctx, "users");
