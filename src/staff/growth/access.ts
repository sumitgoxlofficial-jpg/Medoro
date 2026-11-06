import "server-only";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { clientInfo } from "@/server/auth";
import { UserError, type ActionResult } from "@/server/action";
import { log } from "@/server/log";
import { getStaff, type Staff } from "../auth";
import { ROLE_PERMS, type GrowthRoleId, type Perm } from "./constants";

/** A staff member as Growth Intelligence sees them: their Growth role and, for managers, the people they manage. */
export type Actor = Staff & { growthRole: GrowthRoleId; perms: readonly Perm[]; teamStaffIds: string[] };

/**
 * The Growth role of a staff member. The staff console's super admin is the Growth admin; everyone else needs an active
 * GrowthMember row, which only a Growth admin can create. Reference partners (people outside Medoro) never get one.
 */
export async function actorFor(s: Staff): Promise<Actor | null> {
  if (s.role === "super_admin") return { ...s, growthRole: "admin", perms: ROLE_PERMS.admin, teamStaffIds: [] };
  if (s.role === "partner") return null;
  const m = await db.growthMember.findUnique({ where: { staffId: s.id }, include: { staff: { select: { status: true } } } });
  if (!m || !m.active || m.staff.status !== "active") return null;
  let teamStaffIds: string[] = [];
  if (m.role === "manager") {
    const members = await db.growthMember.findMany({ where: { active: true, team: { managerId: s.id, deletedAt: null } }, select: { staffId: true } });
    teamStaffIds = [...new Set([s.id, ...members.map((x) => x.staffId)])];
  }
  return { ...s, growthRole: m.role, perms: ROLE_PERMS[m.role], teamStaffIds };
}

export const can = (a: Actor, p: Perm) => a.perms.includes(p);
export function need(a: Actor, ...ps: Perm[]) {
  for (const p of ps) if (!can(a, p)) throw new UserError("Your Growth role can’t do that.");
}

/** For pages: the signed-in actor with the permission, or a redirect. */
export async function requireGrowth(p?: Perm): Promise<Actor> {
  const s = await getStaff();
  if (!s) redirect("/staff/login");
  const a = await actorFor(s);
  if (!a) redirect("/staff");
  if (p && !can(a, p)) redirect("/staff/growth");
  return a;
}

/**
 * Which leads an actor may see. Admin: all. Manager: unassigned leads and leads of the people they manage.
 * Sales employee: only leads actively assigned to them. Analyst: none (analytics are aggregates).
 */
export function leadScope(a: Actor): Prisma.PharmacyLeadWhereInput {
  const live = { deletedAt: null } satisfies Prisma.PharmacyLeadWhereInput;
  switch (a.growthRole) {
    case "admin": return live;
    case "manager": return { ...live, OR: [{ assignedStaffId: null }, { assignedStaffId: { in: a.teamStaffIds } }] };
    case "sales": return { ...live, assignedStaffId: a.id };
    default: return { ...live, id: "00000000-0000-0000-0000-000000000000" };
  }
}

/** Staff an actor may hand leads to. */
export async function assignableStaff(a: Actor) {
  const where: Prisma.StaffUserWhereInput = { status: "active", kind: "team", OR: [{ role: "super_admin" }, { growthMember: { active: true, role: { in: ["sales", "manager"] } } }] };
  if (a.growthRole === "manager") where.id = { in: a.teamStaffIds };
  else if (a.growthRole !== "admin") where.id = a.id;
  return db.staffUser.findMany({ where, select: { id: true, name: true, empNo: true, role: true }, orderBy: { name: "asc" } });
}

export async function findLead(a: Actor, id: string, tx: Tx | typeof db = db) {
  const l = await tx.pharmacyLead.findFirst({ where: { AND: [{ id }, leadScope(a)] } });
  if (!l) throw new UserError("Lead not found, or it isn’t assigned to you.");
  return l;
}

export async function gaudit(a: { id: string | null; name: string }, action: string, entity = "", entityId: string | null = null, detail = "", tx: Tx | typeof db = db) {
  const { ip } = await clientInfo().catch(() => ({ ip: null }));
  await tx.growthAuditLog.create({ data: { staffId: a.id, staffName: a.name, action, entity, entityId, detail: detail.slice(0, 1000), ip } });
}

export function activity(tx: Tx | typeof db, leadId: string, kind: string, text: string, by?: { id: string; name: string } | null, refId?: string) {
  return tx.leadActivity.create({ data: { leadId, kind, text: text.slice(0, 1000), staffId: by?.id ?? null, staffName: by?.name ?? "", refId: refId ?? null } });
}

export function outbox(tx: Tx | typeof db, topic: string, payload: Prisma.InputJsonValue) {
  return tx.eventOutbox.create({ data: { topic, payload } });
}

/** Server-action wrapper: needs a staff session and a Growth role; turns expected errors into messages. */
export async function growthRun<T>(fn: (a: Actor) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const s = await getStaff();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  const a = await actorFor(s);
  if (!a) return { ok: false, error: "You don’t have access to Growth Intelligence." };
  try {
    return { ok: true, data: await fn(a), message };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("growth action failed", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const r = await db.growthSetting.findUnique({ where: { key } });
  return r ? ({ ...(fallback as object), ...(r.value as object) } as T) : fallback;
}
export async function saveSetting(key: string, value: Prisma.InputJsonValue) {
  await db.growthSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
