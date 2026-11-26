import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, can, loadPerms, need, notify, type Me } from "./auth";
import { RATINGS, hasModule, type HrRoleId } from "./constants";

// Performance appraisals. HR (Reports module) opens a cycle; each active employee writes a self-assessment; their reporting
// manager rates them; HR sets the final rating; the employee sees it and acknowledges it. A person without a reporting
// manager (or whose manager is the super admin and HR) goes straight from self-assessment to HR.

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const rating = z.number().int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5.");
const text = (min: number, msg: string) => z.string().trim().min(min, msg).max(3000);
type R = Awaited<ReturnType<typeof db.hrReview.findFirstOrThrow>> & { cycle?: { name: string; periodFrom: Date; periodTo: Date; selfDue: Date; managerDue: Date; status: string } };

/** Tasks and attendance in the review period: context for the manager and HR (not a score by itself). */
async function facts(staffId: string, from: Date, to: Date) {
  const end = new Date(to.getTime() + 86_400_000);
  const [done, open, days] = await Promise.all([
    db.hrTask.findMany({ where: { assigneeId: staffId, kind: { not: "reminder" }, status: "done", doneAt: { gte: from, lt: end } }, select: { due: true, doneAt: true } }),
    db.hrTask.count({ where: { assigneeId: staffId, kind: { not: "reminder" }, status: "open", due: { lt: end } } }),
    db.hrAttendance.findMany({ where: { staffId, day: { gte: from, lte: to }, inAt: { not: null } }, select: { status: true } }),
  ]);
  const onTime = done.filter((t) => !t.due || !t.doneAt || isoOf(t.doneAt) <= isoOf(t.due)).length;
  return { tasksDone: done.length, onTimePct: done.length ? Math.round((onTime * 100) / done.length) : null, openOverdue: open, daysIn: days.length, lateDays: days.filter((d) => d.status === "late").length };
}

const view = (r: R, names: Map<string, string>) => ({
  id: r.id, cycleId: r.cycleId, cycle: r.cycle?.name ?? "", periodFrom: r.cycle ? isoOf(r.cycle.periodFrom) : "", periodTo: r.cycle ? isoOf(r.cycle.periodTo) : "",
  selfDue: r.cycle ? isoOf(r.cycle.selfDue) : "", managerDue: r.cycle ? isoOf(r.cycle.managerDue) : "", cycleOpen: r.cycle?.status === "open",
  staffId: r.staffId, name: names.get(r.staffId) ?? "", managerId: r.managerId, manager: r.managerId ? names.get(r.managerId) ?? "" : "", status: r.status,
  selfRating: r.selfRating, self: r.self as Record<string, string>, selfAt: r.selfAt?.toISOString() ?? null,
  mgrRating: r.mgrRating, mgr: r.mgr as Record<string, string>, mgrAt: r.mgrAt?.toISOString() ?? null, mgrBy: r.mgrBy,
  finalRating: r.finalRating, hrNote: r.hrNote, finalAt: r.finalAt?.toISOString() ?? null, finalBy: r.finalBy, ackAt: r.ackAt?.toISOString() ?? null,
});
const names = async (ids: (string | null)[]) => new Map((await db.staffUser.findMany({ where: { id: { in: ids.filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
const withCycle = { cycle: { select: { name: true, periodFrom: true, periodTo: true, selfDue: true, managerDue: true, status: true } } } as const;

// ── Employee and manager
/** My Review: my reviews (newest first) and the reviews of people who report to me that wait for me. */
export async function myReviews(me: Me) {
  const [mine, team] = await Promise.all([
    db.hrReview.findMany({ where: { staffId: me.id }, include: withCycle, orderBy: { createdAt: "desc" }, take: 10 }),
    db.hrReview.findMany({ where: { managerId: me.id, status: { in: ["manager", "hr", "done"] }, cycle: { status: "open" } }, include: withCycle, orderBy: { createdAt: "asc" } }),
  ]);
  const n = await names([...mine, ...team].flatMap((r) => [r.staffId, r.managerId]));
  // An employee sees the manager's and HR's assessment only once HR has finished the review.
  const shown = mine.map((r) => { const v = view(r, n); return r.status === "done" ? v : { ...v, mgrRating: null, mgr: {}, finalRating: null, hrNote: "" }; });
  const teamOut = await Promise.all(team.map(async (r) => ({ ...view(r, n), facts: await facts(r.staffId, r.cycle.periodFrom, r.cycle.periodTo) })));
  return { mine: shown, team: teamOut, ratings: RATINGS };
}

const selfSchema = z.object({ rating, achievements: text(20, "Describe your main achievements (a few lines)."), challenges: z.string().trim().max(3000).default(""), goals: text(10, "Write your goals for the next period.") });
export async function submitSelf(me: Me, id: string, raw: z.input<typeof selfSchema>) {
  const i = selfSchema.parse(raw);
  const r = await db.hrReview.findUnique({ where: { id }, include: { cycle: true } });
  if (!r || r.staffId !== me.id) throw new UserError("Review not found.");
  if (r.cycle.status !== "open") throw new UserError("This review cycle is closed.");
  if (r.status !== "self") throw new UserError("You already sent your self-assessment.");
  const next = r.managerId ? "manager" : "hr";
  await db.hrReview.update({ where: { id }, data: { selfRating: i.rating, self: { achievements: i.achievements, challenges: i.challenges, goals: i.goals }, selfAt: new Date(), status: next } });
  if (r.managerId) await notify([r.managerId], `${me.name} sent their self-assessment for ${r.cycle.name}. Please review it under My Review.`, "appraisal");
  else await notify(await reviewers(me.id), `${me.name} sent their self-assessment for ${r.cycle.name}.`, "hrappraisals");
}

const mgrSchema = z.object({ rating, strengths: text(10, "Write what they did well."), improve: text(10, "Write what they should improve."), comments: z.string().trim().max(3000).default("") });
export async function submitManager(me: Me, id: string, raw: z.input<typeof mgrSchema>) {
  const i = mgrSchema.parse(raw);
  const r = await db.hrReview.findUnique({ where: { id }, include: { cycle: true } });
  if (!r || r.managerId !== me.id) throw new UserError("Review not found.");
  if (r.cycle.status !== "open") throw new UserError("This review cycle is closed.");
  if (r.status !== "manager") throw new UserError(r.status === "self" ? "Wait for their self-assessment first." : "You already sent your review.");
  await db.hrReview.update({ where: { id }, data: { mgrRating: i.rating, mgr: { strengths: i.strengths, improve: i.improve, comments: i.comments }, mgrAt: new Date(), mgrBy: me.name, status: "hr" } });
  await notify(await reviewers(me.id), `${me.name} reviewed ${(await names([r.staffId])).get(r.staffId)} for ${r.cycle.name}.`, "hrappraisals");
}

export async function acknowledgeReview(me: Me, id: string) {
  const r = await db.hrReview.findUnique({ where: { id } });
  if (!r || r.staffId !== me.id) throw new UserError("Review not found.");
  if (r.status !== "done") throw new UserError("HR hasn’t finished your review yet.");
  if (!r.ackAt) await db.hrReview.update({ where: { id }, data: { ackAt: new Date() } });
}

// ── HR (Reports module)
async function reviewers(except: string) {
  const [users, perms] = await Promise.all([db.staffUser.findMany({ where: { kind: "team", status: "active" }, select: { id: true, hr: { select: { role: true } } } }), loadPerms()]);
  return users.filter((u) => u.id !== except && u.hr && hasModule(u.hr.role as HrRoleId, perms, "reports")).map((u) => u.id);
}

const cycleSchema = z.object({ name: z.string().trim().min(3, "Name the cycle, e.g. H2 2026.").max(60), periodFrom: iso, periodTo: iso, selfDue: iso, managerDue: iso });
export async function openCycle(me: Me, raw: z.input<typeof cycleSchema>) {
  need(me, "reports");
  const i = cycleSchema.parse(raw);
  if (i.periodTo < i.periodFrom) throw new UserError("The period ends before it starts.");
  if (i.selfDue < todayISO()) throw new UserError("The self-assessment due date has passed.");
  if (i.managerDue < i.selfDue) throw new UserError("Manager reviews are due after self-assessments.");
  if (await db.hrReviewCycle.findFirst({ where: { status: "open" } })) throw new UserError("Close the open review cycle before opening another.");
  const staff = await db.staffUser.findMany({ where: { kind: "team", status: "active", hr: { isNot: null } }, select: { id: true, hr: { select: { role: true, managerId: true } } } });
  const people = staff.filter((u) => u.hr && u.hr.role !== "admin"); // the super admin is not reviewed
  const admins = new Set(staff.filter((u) => u.hr?.role === "admin").map((u) => u.id));
  const c = await db.hrReviewCycle.create({
    data: {
      name: i.name, periodFrom: dateOnly(i.periodFrom), periodTo: dateOnly(i.periodTo), selfDue: dateOnly(i.selfDue), managerDue: dateOnly(i.managerDue), createdBy: me.name,
      // A super-admin manager reviews in the HR step instead (they see every review there).
      reviews: { create: people.map((u) => ({ staffId: u.id, managerId: u.hr!.managerId && !admins.has(u.hr!.managerId) && u.hr!.managerId !== u.id ? u.hr!.managerId : null })) },
    },
  });
  await notify(people.map((u) => u.id).filter((x) => x !== me.id), `Performance review ${i.name} is open. Please write your self-assessment under My Review by ${i.selfDue}.`, "appraisal");
  await audit(me, "Review cycle opened", `${i.name} · ${people.length} people`);
  return c.id;
}

export async function closeCycle(me: Me, id: string) {
  need(me, "reports");
  const c = await db.hrReviewCycle.findUnique({ where: { id } });
  if (!c || c.status !== "open") throw new UserError("This cycle isn’t open.");
  await db.hrReviewCycle.update({ where: { id }, data: { status: "closed" } });
  await audit(me, "Review cycle closed", c.name);
}

const finalSchema = z.object({ rating, note: z.string().trim().max(2000).default("") });
export async function finalizeReview(me: Me, id: string, raw: z.input<typeof finalSchema>) {
  need(me, "reports");
  const i = finalSchema.parse(raw);
  const r = await db.hrReview.findUnique({ where: { id }, include: { cycle: true } });
  if (!r) throw new UserError("Review not found.");
  if (r.staffId === me.id) throw new UserError("Someone else has to finish your own review.");
  if (r.cycle.status !== "open") throw new UserError("This review cycle is closed.");
  if (r.status === "self") throw new UserError("Wait for their self-assessment first.");
  if (r.status === "manager" && me.role !== "admin") throw new UserError("Wait for the reporting manager’s review first.");
  await db.hrReview.update({ where: { id }, data: { finalRating: i.rating, hrNote: i.note, finalAt: new Date(), finalBy: me.name, status: "done" } });
  await notify([r.staffId], `Your ${r.cycle.name} review is complete. See it under My Review.`, "appraisal");
  await audit(me, "Review finalised", `${r.staffId} · ${r.cycle.name} · ${i.rating}/5`);
}

/** HR's Appraisals screen: cycles, and every review of the selected cycle with both assessments and the period facts. */
export async function cycleBoard(me: Me, cycleId?: string) {
  need(me, "reports");
  const cycles = await db.hrReviewCycle.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const pick = cycles.find((c) => c.id === cycleId) ?? cycles.find((c) => c.status === "open") ?? cycles[0];
  if (!pick) return { cycles: [], cycle: null, reviews: [], ratings: RATINGS, canManage: can(me, "reports"), today: todayISO() };
  const rows = await db.hrReview.findMany({ where: { cycleId: pick.id }, include: withCycle, orderBy: { createdAt: "asc" } });
  const n = await names(rows.flatMap((r) => [r.staffId, r.managerId]));
  const reviews = await Promise.all(rows.map(async (r) => ({ ...view(r, n), facts: await facts(r.staffId, pick.periodFrom, pick.periodTo) })));
  reviews.sort((a, b) => a.name.localeCompare(b.name));
  return {
    cycles: cycles.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    cycle: { id: pick.id, name: pick.name, status: pick.status, periodFrom: isoOf(pick.periodFrom), periodTo: isoOf(pick.periodTo), selfDue: isoOf(pick.selfDue), managerDue: isoOf(pick.managerDue), createdBy: pick.createdBy },
    reviews, ratings: RATINGS, canManage: true, today: todayISO(),
  };
}
