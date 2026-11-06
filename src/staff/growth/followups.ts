import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import { activity, findLead, gaudit, need, outbox, type Actor } from "./access";
import { staffNames } from "./leads";

type Db = Tx | typeof db;
export const ESCALATE_AFTER_MS = 24 * 3600_000;

function staffWhere(a: Actor, staffId?: string): Prisma.FollowUpTaskWhereInput {
  if (a.growthRole === "sales") return { staffId: a.id };
  if (a.growthRole === "manager") return { staffId: staffId && a.teamStaffIds.includes(staffId) ? staffId : { in: a.teamStaffIds } };
  if (a.growthRole === "admin") return staffId ? { staffId } : {};
  return { staffId: "none" };
}

export async function syncNextFollowUp(tx: Db, leadId: string) {
  const n = await tx.followUpTask.findFirst({ where: { leadId, status: "open" }, orderBy: { dueAt: "asc" } });
  await tx.pharmacyLead.update({ where: { id: leadId }, data: { nextFollowUpAt: n?.dueAt ?? null } });
}

export const listSchema = z.object({ view: z.enum(["today", "upcoming", "overdue", "done", "all"]).default("today"), staffId: z.string().uuid().optional() });
export async function listFollowUps(a: Actor, raw: z.input<typeof listSchema>, now = new Date()) {
  need(a, "calls.make");
  const f = listSchema.parse(raw);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  const when: Prisma.FollowUpTaskWhereInput =
    f.view === "today" ? { status: "open", dueAt: { gte: start, lt: end } }
    : f.view === "upcoming" ? { status: "open", dueAt: { gte: end } }
    : f.view === "overdue" ? { status: "open", dueAt: { lt: now } }
    : f.view === "done" ? { status: "done" } : {};
  const rows = await db.followUpTask.findMany({ where: { AND: [staffWhere(a, f.staffId), when, { lead: { deletedAt: null } }] }, orderBy: { dueAt: f.view === "done" ? "desc" : "asc" }, take: 300, include: { lead: { select: { id: true, code: true, name: true, phone: true, city: true, stage: true } } } });
  const names = await staffNames(rows.map((r) => r.staffId));
  const counts = await db.followUpTask.groupBy({ by: ["status"], where: { AND: [staffWhere(a, f.staffId), { status: "open", dueAt: { lt: now } }] }, _count: true });
  return { overdue: counts[0]?._count ?? 0, rows: rows.map((r) => ({ id: r.id, lead: r.lead, staffId: r.staffId, staffName: names.get(r.staffId) ?? "", dueAt: r.dueAt.toISOString(), note: r.note, status: r.status, escalatedAt: r.escalatedAt?.toISOString() ?? null, overdue: r.status === "open" && r.dueAt < now })) };
}

export async function calendar(a: Actor, month: string, staffId?: string) {
  need(a, "calls.make");
  const m = z.string().regex(/^\d{4}-\d{2}$/).parse(month);
  const from = new Date(m + "-01T00:00:00+05:30");
  const to = new Date(from); to.setMonth(to.getMonth() + 1);
  const [tasks, demos] = await Promise.all([
    db.followUpTask.findMany({ where: { AND: [staffWhere(a, staffId), { dueAt: { gte: from, lt: to }, status: { in: ["open", "done"] } }] }, select: { id: true, dueAt: true, status: true, lead: { select: { id: true, name: true } } }, orderBy: { dueAt: "asc" }, take: 2000 }),
    db.demoBooking.findMany({ where: { at: { gte: from, lt: to }, status: { not: "cancelled" }, ...(a.growthRole === "sales" ? { staffId: a.id } : a.growthRole === "manager" ? { staffId: { in: a.teamStaffIds } } : staffId ? { staffId } : {}) }, select: { id: true, at: true, status: true, leadId: true }, take: 500 }),
  ]);
  return { month: m, tasks: tasks.map((t) => ({ id: t.id, at: t.dueAt.toISOString(), status: t.status, lead: t.lead })), demos: demos.map((d) => ({ ...d, at: d.at.toISOString() })) };
}

export const createSchema = z.object({ leadId: z.string().uuid(), dueAt: z.string().datetime({ offset: true }), note: z.string().trim().max(300).default(""), staffId: z.string().uuid().optional() });
export async function createFollowUp(a: Actor, raw: z.input<typeof createSchema>) {
  need(a, "calls.make");
  const i = createSchema.parse(raw);
  const lead = await findLead(a, i.leadId);
  if (lead.stage === "DO_NOT_CONTACT") throw new UserError("This pharmacy asked not to be contacted.");
  const owner = i.staffId ?? lead.assignedStaffId ?? a.id;
  if (a.growthRole === "sales" && owner !== a.id) throw new UserError("You can only schedule your own follow-ups.");
  if (owner !== lead.assignedStaffId) throw new UserError("Follow-ups go to the employee the lead is assigned to. Assign the lead first.");
  if (new Date(i.dueAt).getTime() < Date.now() - 5 * 60_000) throw new UserError("Pick a time in the future.");
  const t = await db.$transaction(async (tx) => {
    const t = await tx.followUpTask.create({ data: { leadId: lead.id, staffId: owner, dueAt: new Date(i.dueAt), note: i.note, createdById: a.id } });
    await activity(tx, lead.id, "follow_up", `Follow-up scheduled for ${i.dueAt.slice(0, 16).replace("T", " ")}${i.note ? ": " + i.note : ""}`, a, t.id);
    await syncNextFollowUp(tx, lead.id);
    return t;
  });
  return t.id;
}

export const updateSchema = z.object({ action: z.enum(["complete", "reschedule", "cancel"]), dueAt: z.string().datetime({ offset: true }).optional(), note: z.string().trim().max(300).optional() });
export async function updateFollowUp(a: Actor, id: string, raw: z.input<typeof updateSchema>) {
  need(a, "calls.make");
  const i = updateSchema.parse(raw);
  const t = await db.followUpTask.findFirst({ where: { AND: [{ id }, staffWhere(a)] } });
  if (!t) throw new UserError("Follow-up not found.");
  if (t.status !== "open") throw new UserError("This follow-up is already closed.");
  if (i.action === "reschedule" && (!i.dueAt || new Date(i.dueAt).getTime() < Date.now() - 5 * 60_000)) throw new UserError("Pick a new time in the future.");
  await db.$transaction(async (tx) => {
    await tx.followUpTask.update({ where: { id }, data: i.action === "complete" ? { status: "done", doneAt: new Date(), note: i.note ?? t.note } : i.action === "cancel" ? { status: "cancelled", note: i.note ?? t.note } : { dueAt: new Date(i.dueAt!), escalatedAt: null, note: i.note ?? t.note } });
    await activity(tx, t.leadId, "follow_up", i.action === "complete" ? `Follow-up marked done${i.note ? ": " + i.note : ""}` : i.action === "cancel" ? "Follow-up cancelled" : `Follow-up moved to ${i.dueAt!.slice(0, 16).replace("T", " ")}`, a, id);
    await syncNextFollowUp(tx, t.leadId);
  });
}

/** Overdue by more than a day: marked escalated once, and an event tells the team's manager (see workers.ts). */
export async function escalateOverdue(now = new Date()) {
  const rows = await db.followUpTask.findMany({ where: { status: "open", escalatedAt: null, dueAt: { lt: new Date(now.getTime() - ESCALATE_AFTER_MS) } }, take: 500 });
  for (const t of rows) {
    await db.$transaction(async (tx) => {
      const u = await tx.followUpTask.updateMany({ where: { id: t.id, escalatedAt: null }, data: { escalatedAt: now } });
      if (!u.count) return;
      await activity(tx, t.leadId, "follow_up", `Follow-up overdue since ${t.dueAt.toISOString().slice(0, 10)}; escalated to the manager`, null, t.id);
      await outbox(tx, "followup.escalated", { followUpId: t.id, staffId: t.staffId, leadId: t.leadId, dueAt: t.dueAt.toISOString() });
    });
  }
  if (rows.length) await gaudit({ id: null, name: "Scheduler" }, "Follow-ups escalated", "follow_up", null, `${rows.length}`);
  return rows.length;
}
