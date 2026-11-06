import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import { assignableStaff, gaudit, leadScope, need, type Actor } from "./access";
import { filterSchema, filterWhere, staffNames, type LeadFilter } from "./leads";

const EARLY = ["NEW_LEAD", "RESEARCH_PENDING", "QUALIFIED"] as const;
const MAX_BULK = 5000;

export type AssignResult = { assigned: number; skipped: { code: string; reason: string }[]; byStaff: Record<string, number> };

/** Leads to act on: explicit ids, or a filter over what the actor can see. */
async function resolveLeads(a: Actor, sel: { leadIds?: string[]; filter?: LeadFilter }) {
  const where: Prisma.PharmacyLeadWhereInput = sel.leadIds?.length
    ? { AND: [leadScope(a), { id: { in: sel.leadIds.slice(0, MAX_BULK) } }] }
    : sel.filter ? filterWhere(a, filterSchema.parse({ ...sel.filter, page: 1, pageSize: 200 })) : { id: "none" };
  return db.pharmacyLead.findMany({ where, select: { id: true, code: true, stage: true, assignedStaffId: true, erasedAt: true, duplicateOfId: true, state: true, district: true, pin: true }, orderBy: [{ state: "asc" }, { district: "asc" }, { pin: "asc" }, { createdAt: "asc" }], take: MAX_BULK });
}

async function checkStaff(a: Actor, staffIds: string[]) {
  const ok = new Set((await assignableStaff(a)).map((s) => s.id));
  for (const id of staffIds) if (!ok.has(id)) throw new UserError("One of the chosen employees can’t receive leads (not an active Growth sales employee, or not in your team).");
}

/**
 * The core write, set-based so thousands of leads go in one transaction: ends replaced assignments, opens new ones, logs
 * history and moves open follow-ups to the new owner. The unique key on active assignments makes a concurrent assignment
 * fail the whole transaction instead of leaving a lead with two owners.
 */
async function applyPlan(tx: Tx, a: Actor, plan: Map<string, { id: string; code: string; stage: string; assignedStaffId: string | null }[]>, opts: { dueAt: Date | null; reason: string }) {
  const now = new Date();
  for (const [staffId, leads] of plan) {
    if (!leads.length) continue;
    const ids = leads.map((l) => l.id);
    const moving = leads.filter((l) => l.assignedStaffId && l.assignedStaffId !== staffId);
    if (moving.length) {
      await tx.leadAssignment.updateMany({ where: { leadId: { in: moving.map((l) => l.id) }, active: true }, data: { active: false, activeLeadKey: null, endedAt: now, endedById: a.id, endReason: opts.reason || "reassigned" } });
    }
    await tx.leadAssignment.createMany({ data: ids.map((leadId) => ({ leadId, staffId, activeLeadKey: leadId, assignedById: a.id, dueAt: opts.dueAt, assignedAt: now })) });
    await tx.leadAssignmentHistory.createMany({ data: leads.map((l) => ({ leadId: l.id, action: l.assignedStaffId ? "reassigned" : "assigned", fromStaffId: l.assignedStaffId, toStaffId: staffId, byStaffId: a.id, reason: opts.reason, at: now })) });
    await tx.pharmacyLead.updateMany({ where: { id: { in: ids } }, data: { assignedStaffId: staffId } });
    await tx.pharmacyLead.updateMany({ where: { id: { in: ids }, stage: { in: [...EARLY] } }, data: { stage: "ASSIGNED" } });
    if (moving.length) await tx.followUpTask.updateMany({ where: { leadId: { in: moving.map((l) => l.id) }, status: "open" }, data: { staffId } });
    await tx.leadActivity.createMany({ data: leads.map((l) => ({ leadId: l.id, kind: "assigned", text: `${l.assignedStaffId ? "Reassigned" : "Assigned"} by ${a.name}${opts.dueAt ? `, deadline ${opts.dueAt.toISOString().slice(0, 10)}` : ""}${opts.reason ? ` · ${opts.reason}` : ""}`, staffId: a.id, staffName: a.name, at: now })) });
  }
}

function eligible(leads: Awaited<ReturnType<typeof resolveLeads>>, reassign: boolean, skipped: AssignResult["skipped"], targetStaff?: string) {
  return leads.filter((l) => {
    if (l.erasedAt || l.duplicateOfId) { skipped.push({ code: l.code, reason: "erased or merged" }); return false; }
    if (l.stage === "DO_NOT_CONTACT") { skipped.push({ code: l.code, reason: "do not contact" }); return false; }
    if (targetStaff && l.assignedStaffId === targetStaff) { skipped.push({ code: l.code, reason: "already assigned to this employee" }); return false; }
    if (l.assignedStaffId && !reassign) { skipped.push({ code: l.code, reason: "already assigned (tick “Reassign” to move it)" }); return false; }
    return true;
  });
}

async function commit(a: Actor, plan: Map<string, { id: string; code: string; stage: string; assignedStaffId: string | null }[]>, skipped: AssignResult["skipped"], opts: { dueAt: Date | null; reason: string }, what: string): Promise<AssignResult> {
  try {
    await db.$transaction((tx) => applyPlan(tx, a, plan, opts), { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") throw new UserError("Some of these leads were assigned by someone else just now. Nothing was changed; reload and try again.");
    throw e;
  }
  const byStaff: Record<string, number> = {};
  for (const [s, l] of plan) if (l.length) byStaff[s] = l.length;
  const assigned = Object.values(byStaff).reduce((x, y) => x + y, 0);
  const names = await staffNames(Object.keys(byStaff));
  await gaudit(a, what, "assignment", null, `${assigned} leads: ${Object.entries(byStaff).map(([s, n]) => `${names.get(s) ?? s} ${n}`).join(", ")}${skipped.length ? ` · ${skipped.length} skipped` : ""}`);
  return { assigned, skipped, byStaff };
}

export const assignSchema = z.object({
  leadIds: z.array(z.string().uuid()).max(MAX_BULK).optional(), filter: z.record(z.string(), z.unknown()).optional(),
  staffId: z.string().uuid(), dueAt: z.string().datetime({ offset: true }).nullable().optional(), reassign: z.boolean().default(false), reason: z.string().trim().max(200).default(""),
});
export async function assignLeads(a: Actor, raw: z.input<typeof assignSchema>) {
  need(a, "assign");
  const i = assignSchema.parse(raw);
  await checkStaff(a, [i.staffId]);
  const skipped: AssignResult["skipped"] = [];
  const leads = eligible(await resolveLeads(a, { leadIds: i.leadIds, filter: i.filter as LeadFilter }), i.reassign, skipped, i.staffId);
  return commit(a, new Map([[i.staffId, leads]]), skipped, { dueAt: i.dueAt ? new Date(i.dueAt) : null, reason: i.reason }, "Leads assigned");
}

/**
 * Equal split: leads sorted by state, district and PIN are cut into contiguous blocks so each employee gets a compact area;
 * the first (n mod k) employees get one extra. "balance" instead tops up whoever holds the fewest active leads.
 */
export function splitPlan<T>(leads: T[], staffIds: string[], mode: "equal" | "balance" = "equal", load: Record<string, number> = {}): Map<string, T[]> {
  const plan = new Map(staffIds.map((s) => [s, [] as T[]]));
  if (!staffIds.length) return plan;
  if (mode === "equal") {
    const base = Math.floor(leads.length / staffIds.length), extra = leads.length % staffIds.length;
    let i = 0;
    staffIds.forEach((s, k) => { const n = base + (k < extra ? 1 : 0); plan.set(s, leads.slice(i, i + n)); i += n; });
    return plan;
  }
  const held = new Map(staffIds.map((s) => [s, load[s] ?? 0]));
  for (const l of leads) {
    const s = [...held.entries()].sort((x, y) => x[1] - y[1] || staffIds.indexOf(x[0]) - staffIds.indexOf(y[0]))[0][0];
    plan.get(s)!.push(l);
    held.set(s, held.get(s)! + 1);
  }
  return plan;
}

export const distributeSchema = z.object({
  leadIds: z.array(z.string().uuid()).max(MAX_BULK).optional(), filter: z.record(z.string(), z.unknown()).optional(),
  staffIds: z.array(z.string().uuid()).min(1, "Choose at least one employee.").max(100), mode: z.enum(["equal", "balance"]).default("equal"),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(), reassign: z.boolean().default(false), reason: z.string().trim().max(200).default(""),
});
export async function distribute(a: Actor, raw: z.input<typeof distributeSchema>) {
  need(a, "assign");
  const i = distributeSchema.parse(raw);
  const staffIds = [...new Set(i.staffIds)];
  await checkStaff(a, staffIds);
  const skipped: AssignResult["skipped"] = [];
  const leads = eligible(await resolveLeads(a, { leadIds: i.leadIds, filter: i.filter as LeadFilter }), i.reassign, skipped);
  const load = Object.fromEntries((await db.leadAssignment.groupBy({ by: ["staffId"], where: { active: true, staffId: { in: staffIds } }, _count: true })).map((r) => [r.staffId, r._count]));
  const plan = splitPlan(leads, staffIds, i.mode, load);
  // A lead already with one of the chosen employees stays with them.
  for (const [s, ls] of plan) plan.set(s, ls.filter((l) => l.assignedStaffId !== s || (skipped.push({ code: l.code, reason: "already with this employee" }), false)));
  return commit(a, plan, skipped, { dueAt: i.dueAt ? new Date(i.dueAt) : null, reason: i.reason }, i.mode === "equal" ? "Leads distributed equally" : "Leads distributed by load");
}

/** Unassigned leads go to the employee whose territory matches most specifically (PIN, then district, then state). */
export async function assignByTerritory(a: Actor, raw: { state?: string; dueAt?: string | null }) {
  need(a, "assign");
  const staff = await assignableStaff(a);
  const terr = await db.employeeTerritory.findMany({ where: { staffId: { in: staff.map((s) => s.id) }, ...(raw.state ? { state: raw.state } : {}) } });
  if (!terr.length) throw new UserError("No territories set. Add territories under My employees first.");
  const leads = await db.pharmacyLead.findMany({ where: { AND: [leadScope(a), { assignedStaffId: null, erasedAt: null, duplicateOfId: null, stage: { not: "DO_NOT_CONTACT" }, state: { in: [...new Set(terr.map((t) => t.state))] } }] }, select: { id: true, code: true, stage: true, assignedStaffId: true, state: true, district: true, pin: true }, orderBy: [{ pin: "asc" }, { createdAt: "asc" }], take: MAX_BULK });
  const groups = new Map<string, typeof leads>();
  for (const l of leads) {
    const byPin = terr.filter((t) => t.pin && t.pin === l.pin);
    const byDistrict = terr.filter((t) => !t.pin && t.district && t.state === l.state && t.district.toLowerCase() === l.district.toLowerCase());
    const byState = terr.filter((t) => !t.pin && !t.district && t.state === l.state);
    const who = (byPin.length ? byPin : byDistrict.length ? byDistrict : byState).map((t) => t.staffId);
    if (!who.length) continue;
    const key = [...new Set(who)].sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const plan = new Map<string, typeof leads>();
  for (const [key, ls] of groups) for (const [s, part] of splitPlan(ls, key.split(","))) plan.set(s, [...(plan.get(s) ?? []), ...part]);
  return commit(a, plan, [], { dueAt: raw.dueAt ? new Date(raw.dueAt) : null, reason: "territory" }, "Leads assigned by territory");
}

export async function withdraw(a: Actor, leadIds: string[], reason: string) {
  need(a, "assign");
  const why = z.string().trim().min(3, "Give a reason for withdrawing.").max(200).parse(reason);
  const leads = (await resolveLeads(a, { leadIds })).filter((l) => l.assignedStaffId);
  if (!leads.length) throw new UserError("None of these leads is assigned.");
  const ids = leads.map((l) => l.id), now = new Date();
  await db.$transaction(async (tx) => {
    await tx.leadAssignment.updateMany({ where: { leadId: { in: ids }, active: true }, data: { active: false, activeLeadKey: null, endedAt: now, endedById: a.id, endReason: why } });
    await tx.leadAssignmentHistory.createMany({ data: leads.map((l) => ({ leadId: l.id, action: "withdrawn", fromStaffId: l.assignedStaffId, byStaffId: a.id, reason: why })) });
    await tx.pharmacyLead.updateMany({ where: { id: { in: ids } }, data: { assignedStaffId: null } });
    await tx.followUpTask.updateMany({ where: { leadId: { in: ids }, status: "open" }, data: { status: "cancelled" } });
    await tx.leadActivity.createMany({ data: leads.map((l) => ({ leadId: l.id, kind: "assigned", text: `Assignment withdrawn by ${a.name}: ${why}`, staffId: a.id, staffName: a.name })) });
  }, { timeout: 60_000 });
  await gaudit(a, "Assignments withdrawn", "assignment", null, `${leads.length} leads · ${why}`);
  return leads.length;
}

/** Moves every active lead of an employee (e.g. one who left) to others, split equally. History and call reports stay. */
export async function reassignFrom(a: Actor, fromStaffId: string, toStaffIds: string[]) {
  need(a, "assign");
  if (toStaffIds.includes(fromStaffId)) throw new UserError("Choose other employees to take the leads.");
  const ids = (await db.leadAssignment.findMany({ where: { staffId: fromStaffId, active: true }, select: { leadId: true } })).map((x) => x.leadId);
  if (!ids.length) throw new UserError("This employee has no active leads.");
  return distribute(a, { leadIds: ids, staffIds: toStaffIds, mode: "balance", reassign: true, reason: "employee unavailable" });
}

/** PATCH an assignment: change the deadline, withdraw it, or move it to someone else. */
export const patchSchema = z.object({ dueAt: z.string().datetime({ offset: true }).nullable().optional(), action: z.enum(["deadline", "withdraw", "reassign"]), staffId: z.string().uuid().optional(), reason: z.string().max(200).default("") });
export async function patchAssignment(a: Actor, id: string, raw: z.input<typeof patchSchema>) {
  need(a, "assign");
  const i = patchSchema.parse(raw);
  const asg = await db.leadAssignment.findUnique({ where: { id } });
  if (!asg || !asg.active) throw new UserError("This assignment has ended.");
  const lead = await db.pharmacyLead.findFirst({ where: { AND: [{ id: asg.leadId }, leadScope(a)] } });
  if (!lead) throw new UserError("Lead not found.");
  if (i.action === "withdraw") return withdraw(a, [asg.leadId], i.reason || "withdrawn");
  if (i.action === "reassign") { if (!i.staffId) throw new UserError("Choose the employee."); return assignLeads(a, { leadIds: [asg.leadId], staffId: i.staffId, reassign: true, reason: i.reason, dueAt: i.dueAt ?? null }); }
  await db.$transaction(async (tx) => {
    await tx.leadAssignment.update({ where: { id }, data: { dueAt: i.dueAt ? new Date(i.dueAt) : null } });
    await tx.leadAssignmentHistory.create({ data: { leadId: asg.leadId, action: "deadline", toStaffId: asg.staffId, byStaffId: a.id, reason: i.dueAt ? `deadline ${i.dueAt.slice(0, 10)}` : "deadline removed" } });
  });
  await gaudit(a, "Assignment deadline changed", "assignment", id, i.dueAt ?? "none");
}

export async function distributionOverview(a: Actor, now = new Date()) {
  need(a, "assign");
  const staff = await assignableStaff(a);
  const ids = staff.map((s) => s.id);
  const scope = leadScope(a);
  const [active, neverCalled, overdueFu, overdueDeadline, unassigned, inactive] = await Promise.all([
    db.leadAssignment.groupBy({ by: ["staffId"], where: { active: true, staffId: { in: ids } }, _count: true }),
    db.leadAssignment.groupBy({ by: ["staffId"], where: { active: true, staffId: { in: ids }, lead: { calls: { none: {} } } }, _count: true }),
    db.followUpTask.groupBy({ by: ["staffId"], where: { status: "open", dueAt: { lt: now }, staffId: { in: ids } }, _count: true }),
    db.leadAssignment.groupBy({ by: ["staffId"], where: { active: true, dueAt: { lt: now }, staffId: { in: ids }, lead: { lastContactedAt: null } }, _count: true }),
    db.pharmacyLead.count({ where: { AND: [scope, { assignedStaffId: null, stage: { not: "DO_NOT_CONTACT" }, erasedAt: null }] } }),
    // Leads held by people who can no longer work them.
    db.leadAssignment.groupBy({ by: ["staffId"], where: { active: true, OR: [{ staff: { status: { not: "active" } } }, { staff: { role: { not: "super_admin" }, growthMember: { is: null } } }, { staff: { role: { not: "super_admin" }, growthMember: { active: false } } }] }, _count: true }),
  ]);
  const n = (rows: { staffId: string; _count: number }[], id: string) => rows.find((r) => r.staffId === id)?._count ?? 0;
  const inactiveNames = await staffNames(inactive.map((r) => r.staffId));
  return {
    unassigned,
    employees: staff.map((s) => ({ ...s, active: n(active, s.id), pending: n(neverCalled, s.id), overdueFollowUps: n(overdueFu, s.id), overdueDeadlines: n(overdueDeadline, s.id) })),
    inactive: a.growthRole === "admin" ? inactive.map((r) => ({ staffId: r.staffId, name: inactiveNames.get(r.staffId) ?? "", leads: r._count })) : [],
  };
}

export async function assignmentHistory(a: Actor, opts: { leadId?: string; staffId?: string; take?: number } = {}) {
  need(a, "assign");
  const where: Prisma.LeadAssignmentHistoryWhereInput = {};
  if (opts.leadId) where.leadId = opts.leadId;
  if (opts.staffId) where.OR = [{ fromStaffId: opts.staffId }, { toStaffId: opts.staffId }];
  if (a.growthRole === "manager") where.AND = [{ OR: [{ fromStaffId: { in: a.teamStaffIds } }, { toStaffId: { in: a.teamStaffIds } }, { byStaffId: a.id }] }];
  const rows = await db.leadAssignmentHistory.findMany({ where, orderBy: { at: "desc" }, take: opts.take ?? 100 });
  const names = await staffNames(rows.flatMap((r) => [r.fromStaffId, r.toStaffId, r.byStaffId]));
  const leads = await db.pharmacyLead.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.leadId))] } }, select: { id: true, code: true, name: true } });
  const byLead = new Map(leads.map((l) => [l.id, l]));
  return rows.map((r) => ({ ...r, lead: byLead.get(r.leadId), from: r.fromStaffId ? names.get(r.fromStaffId) ?? "" : "", to: r.toStaffId ? names.get(r.toStaffId) ?? "" : "", by: names.get(r.byStaffId) ?? "" }));
}
