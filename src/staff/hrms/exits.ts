import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, holders, need, notify, type Me } from "./auth";
import { CLEARANCE_ITEMS, EXIT_QUESTIONS, EXIT_REASONS, NOTICE_DAYS, type ClearanceId } from "./constants";
import { setEmployeeActive } from "./people";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
/** An exit that is still going ahead: asked for, accepted, or recorded by HR. */
const OPEN = ["requested", "accepted", "recorded"];
type Row = Awaited<ReturnType<typeof db.hrExit.findFirstOrThrow>>;
type Tick = { by: string; at: string };

const view = (r: Row) => ({
  id: r.id, status: r.status, reason: r.reason, proposedLastDay: r.proposedLastDay ? isoOf(r.proposedLastDay) : null, lastDay: r.lastDay ? isoOf(r.lastDay) : null,
  decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(),
  interview: r.interview as Record<string, string | number>, interviewAt: r.interviewAt?.toISOString() ?? null, clearance: r.clearance as Record<string, Tick>,
});
export type ExitView = ReturnType<typeof view>;

const openRow = (staffId: string) => db.hrExit.findFirst({ where: { staffId, status: { in: OPEN } }, orderBy: { createdAt: "desc" } });

/** The row clearance and the interview hang on. HR may have recorded the exit directly, with no resignation: then one is made. */
async function exitRow(staffId: string) {
  const open = await openRow(staffId);
  if (open && open.status !== "requested") return open;
  const p = await db.hrProfile.findUnique({ where: { staffId }, select: { exitDate: true } });
  if (!p?.exitDate) throw new UserError("No exit is recorded for this person.");
  return db.hrExit.create({ data: { staffId, status: "recorded", lastDay: p.exitDate } });
}

/** What the employee sees on My profile. */
export async function myExit(me: Me) {
  const [row, p] = await Promise.all([
    db.hrExit.findFirst({ where: { staffId: me.id }, orderBy: { createdAt: "desc" } }),
    db.hrProfile.findUnique({ where: { staffId: me.id }, select: { exitDate: true } }),
  ]);
  const exitDate = p?.exitDate ? isoOf(p.exitDate) : null;
  const open = !!row && OPEN.includes(row.status);
  return {
    exit: row ? view(row) : null, exitDate, noticeDays: NOTICE_DAYS, suggested: addDays(todayISO(), NOTICE_DAYS), today: todayISO(),
    canResign: me.role !== "admin" && !exitDate && !open,
    interviewOpen: !!exitDate && !(row && open && row.interviewAt),
    questions: EXIT_QUESTIONS, reasons: EXIT_REASONS,
  };
}

const resignSchema = z.object({ reason: z.string().trim().min(10, "Tell HR a little about why you are leaving.").max(1000), lastDay: iso });
export async function resign(me: Me, raw: z.input<typeof resignSchema>) {
  const i = resignSchema.parse(raw);
  if (me.role === "admin") throw new UserError("The super admin can’t resign here.");
  const p = await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { exitDate: true, joinDate: true, managerId: true } });
  if (p?.exitDate) throw new UserError("Your last working day is already recorded.");
  if (await openRow(me.id)) throw new UserError("You already have a resignation with HR.");
  if (i.lastDay < todayISO()) throw new UserError("Your last working day can’t be in the past.");
  if (i.lastDay > addDays(todayISO(), 180)) throw new UserError("The last working day can be at most 180 days ahead.");
  if (p?.joinDate && i.lastDay < isoOf(p.joinDate)) throw new UserError("The last working day can’t be before your joining date.");
  await db.hrExit.create({ data: { staffId: me.id, status: "requested", reason: i.reason, proposedLastDay: dateOnly(i.lastDay) } });
  const short = i.lastDay < addDays(todayISO(), NOTICE_DAYS) ? ` (shorter than the ${NOTICE_DAYS}-day notice period)` : "";
  const to = new Set([...(await holders("employees")), ...(p?.managerId ? [p.managerId] : [])]); to.delete(me.id);
  await notify([...to], `${me.name} resigned. Asked-for last working day: ${i.lastDay}${short}.`, "hrexits");
  await audit(me, "Resigned", `last working day asked ${i.lastDay}`);
}

export async function withdrawResignation(me: Me) {
  const row = await db.hrExit.findFirst({ where: { staffId: me.id, status: "requested" } });
  if (!row) throw new UserError("There is no resignation waiting with HR to withdraw.");
  await db.hrExit.update({ where: { id: row.id }, data: { status: "withdrawn" } });
  await notify((await holders("employees")).filter((x) => x !== me.id), `${me.name} withdrew their resignation.`, "hrexits");
  await audit(me, "Resignation withdrawn", "");
}

const decideSchema = z.object({ accept: z.boolean(), lastDay: iso.optional(), note: z.string().trim().max(500).default("") });
/** Accepting records the exit (Employees → Record exit) with the last working day; declining needs a reason. */
export async function decideResignation(me: Me, id: string, raw: z.input<typeof decideSchema>) {
  need(me, "employees");
  const i = decideSchema.parse(raw);
  const row = await db.hrExit.findUnique({ where: { id } });
  if (!row || row.status !== "requested") throw new UserError("This resignation was already decided or withdrawn.");
  if (row.staffId === me.id) throw new UserError("Someone else has to decide your own resignation.");
  if (i.accept) {
    const lastDay = i.lastDay ?? (row.proposedLastDay ? isoOf(row.proposedLastDay) : todayISO());
    await setEmployeeActive(me, row.staffId, false, lastDay); // validates the date and handles the notice period and deactivation
    await db.hrExit.update({ where: { id }, data: { status: "accepted", lastDay: dateOnly(lastDay), decidedBy: me.name, decidedAt: new Date(), decisionNote: i.note } });
    await notify([row.staffId], `Your resignation was accepted. Last working day: ${lastDay}.${i.note ? ` HR: ${i.note}` : ""} Please fill in the exit interview on My profile.`, "profile");
    await audit(me, "Resignation accepted", `${row.staffId} · last working day ${lastDay}`);
  } else {
    if (i.note.length < 5) throw new UserError("Say why the resignation isn’t accepted, so the employee knows.");
    await db.hrExit.update({ where: { id }, data: { status: "declined", decidedBy: me.name, decidedAt: new Date(), decisionNote: i.note } });
    await notify([row.staffId], `HR didn’t accept your resignation: ${i.note}`, "profile");
    await audit(me, "Resignation declined", row.staffId);
  }
}

const answer = z.union([z.string().trim().max(1500), z.number().int().min(1).max(5)]);
export async function saveInterview(me: Me, raw: Record<string, unknown>) {
  const p = await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { exitDate: true } });
  if (!p?.exitDate) throw new UserError("The exit interview opens once your last working day is recorded.");
  const answers: Record<string, string | number> = {};
  for (const q of EXIT_QUESTIONS) {
    const v = answer.optional().parse(raw[q.id]);
    if (v === undefined || v === "") continue;
    if (q.kind === "choice" && !(q.options as readonly string[]).includes(String(v))) throw new UserError(`Pick an answer for “${q.label}”.`);
    if (q.kind === "rating" && typeof v !== "number") throw new UserError(`Rate “${q.label}” from 1 to 5.`);
    answers[q.id] = v;
  }
  if (!answers.reason) throw new UserError("Pick your main reason for leaving.");
  const row = await exitRow(me.id);
  if (row.interviewAt) throw new UserError("You already sent your exit interview. Thank you!");
  await db.hrExit.update({ where: { id: row.id }, data: { interview: answers, interviewAt: new Date() } });
  await notify((await holders("employees")).filter((x) => x !== me.id), `${me.name} filled in their exit interview.`, "hrexits");
}

export async function tickClearance(me: Me, staffId: string, item: string, done: boolean) {
  need(me, "employees");
  const id = z.enum(CLEARANCE_ITEMS.map((c) => c.id) as [ClearanceId, ...ClearanceId[]]).parse(item);
  const row = await exitRow(staffId);
  const c = { ...(row.clearance as Record<string, Tick>) };
  if (done) c[id] = { by: me.name, at: new Date().toISOString() }; else delete c[id];
  await db.hrExit.update({ where: { id: row.id }, data: { clearance: c } });
}

/** HR's Exits screen: resignations waiting, and everyone leaving or who left in the last 30 days. */
export async function exitsBoard(me: Me) {
  need(me, "employees");
  const since = addDays(todayISO(), -30);
  const [requests, leaving] = await Promise.all([
    db.hrExit.findMany({ where: { status: "requested" }, orderBy: { createdAt: "asc" } }),
    db.hrProfile.findMany({ where: { exitDate: { gte: dateOnly(since) } }, select: { staffId: true, exitDate: true, dept: true, designation: true, managerId: true }, orderBy: { exitDate: "asc" } }),
  ]);
  const ids = [...new Set([...requests.map((r) => r.staffId), ...leaving.map((p) => p.staffId)])];
  const [users, profiles, rows, assets] = await Promise.all([
    db.staffUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, empNo: true, status: true } }),
    db.hrProfile.findMany({ where: { staffId: { in: ids } }, select: { staffId: true, dept: true, designation: true } }),
    db.hrExit.findMany({ where: { staffId: { in: ids }, status: { in: ["accepted", "recorded"] } }, orderBy: { createdAt: "desc" } }),
    db.hrAsset.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids } }, _count: true }),
  ]);
  const u = new Map(users.map((x) => [x.id, x])), pr = new Map(profiles.map((x) => [x.staffId, x]));
  const latest = new Map<string, Row>(); for (const r of rows) if (!latest.has(r.staffId)) latest.set(r.staffId, r);
  const out = new Map(assets.map((a) => [a.assigneeId, a._count]));
  const who = (id: string) => ({ staffId: id, name: u.get(id)?.name ?? "", empNo: u.get(id)?.empNo ?? "", dept: pr.get(id)?.dept ?? "", designation: pr.get(id)?.designation ?? "" });
  return {
    requests: requests.map((r) => ({ ...who(r.staffId), ...view(r), short: !!r.proposedLastDay && isoOf(r.proposedLastDay) < addDays(isoOf(r.createdAt), NOTICE_DAYS) })),
    leaving: leaving.map((p) => {
      const r = latest.get(p.staffId);
      return { ...who(p.staffId), exitDate: isoOf(p.exitDate!), left: u.get(p.staffId)?.status === "deactivated", assetsOut: out.get(p.staffId) ?? 0, resigned: r?.status === "accepted", reason: r?.reason ?? "", clearance: (r?.clearance ?? {}) as Record<string, Tick>, interview: (r?.interview ?? {}) as Record<string, string | number>, interviewAt: r?.interviewAt?.toISOString() ?? null };
    }),
    items: CLEARANCE_ITEMS, questions: EXIT_QUESTIONS, today: todayISO(),
  };
}
