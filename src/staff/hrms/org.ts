import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { can, need, type Me } from "./auth";
import { ADMIN_LABEL, hideAdmin, visibleTo } from "./visibility";

// Organisation hierarchy and employment history.
//  * A reporting line must point at an active colleague, never at the person themself or at anyone below them
//    (that would make a loop). Every change of manager is checked here before it is saved.
//  * HrEmploymentEvent keeps what changed, when and by whom; the table is append-only in the database.

type Tx = Prisma.TransactionClient | typeof db;
/** The longest reporting chain walked before giving up (a loop in old data must not hang a request). */
const MAX_DEPTH = 64;

/** The chain of managers above a person, nearest first. Stops at a loop already in the data. */
export async function managersAbove(staffId: string, tx: Tx = db): Promise<string[]> {
  const chain: string[] = [];
  let at: string | null = staffId;
  const seen = new Set<string>([staffId]);
  for (let i = 0; i < MAX_DEPTH && at; i++) {
    const row: { managerId: string | null } | null = await tx.hrProfile.findUnique({ where: { staffId: at }, select: { managerId: true } });
    const next: string | null = row?.managerId ?? null;
    if (!next || seen.has(next)) break;
    chain.push(next); seen.add(next); at = next;
  }
  return chain;
}

/**
 * Checks a new reporting manager for `staffId` (null = a new employee, who can't be anyone's manager yet). Returns the
 * manager id to save (null for none).
 */
export async function checkManager(staffId: string | null, managerId: string | null | undefined, tx: Tx = db): Promise<string | null> {
  const m = managerId || null;
  if (!m) return null;
  if (m === staffId) throw new UserError("A person can’t report to themselves.");
  const u = await tx.staffUser.findUnique({ where: { id: m }, select: { kind: true, role: true, status: true, deletedAt: true } });
  if (!u || u.kind !== "team" || u.role === "partner" || u.deletedAt) throw new UserError("Choose the reporting manager from the employee list.");
  if (u.status !== "active") throw new UserError("The reporting manager must be an active employee.");
  if (staffId && (await managersAbove(m, tx)).includes(staffId)) throw new UserError("That manager reports (directly or further up) to this person. Choose someone above them instead.");
  return m;
}

export type EventType = "joined" | "updated" | "manager" | "transfer" | "promotion" | "pay" | "exit" | "reactivated";
/** Fields whose before/after values are pay: shown only to Payroll holders and the person. */
export const PAY_FIELDS = ["ctc", "incentivePct"] as const;

/** Keeps the fields that really changed, as {field: [before, after]}. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] instanceof Date ? isoOf(before[k] as Date) : before[k] ?? null, b = after[k] instanceof Date ? isoOf(after[k] as Date) : after[k] ?? null;
    if (String(a) !== String(b)) out[k] = [a, b];
  }
  return out;
}
/** The event type that best describes a set of changes. */
export function typeOf(changes: Record<string, unknown>): EventType {
  if ("dept" in changes) return "transfer";
  if ("managerId" in changes && Object.keys(changes).length === 1) return "manager";
  if (Object.keys(changes).every((k) => (PAY_FIELDS as readonly string[]).includes(k))) return "pay";
  return "updated";
}

export async function recordEvent(e: { staffId: string; type: EventType; changes?: Record<string, unknown>; note?: string; byId: string | null; effective?: string }, tx: Tx = db) {
  await tx.hrEmploymentEvent.create({ data: { staffId: e.staffId, type: e.type, changes: (e.changes ?? {}) as Prisma.InputJsonValue, note: (e.note ?? "").slice(0, 300), byId: e.byId, effective: dateOnly(e.effective ?? todayISO()) } });
}

/** A person's employment history, newest first: for the person, and for HR (Employees module). Pay changes need Payroll. */
export async function timeline(me: Me, staffId: string) {
  if (staffId !== me.id) need(me, "employees");
  const pay = staffId === me.id || can(me, "payroll");
  const rows = await db.hrEmploymentEvent.findMany({ where: { staffId }, orderBy: [{ at: "desc" }], take: 200 });
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.byId) ids.add(r.byId);
    const mc = (r.changes as Record<string, [unknown, unknown]>).managerId;
    if (mc) for (const v of mc) if (typeof v === "string") ids.add(v);
  }
  const people = await db.staffUser.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, role: true } });
  const nameOf = (id: unknown) => { const p = people.find((x) => x.id === id); return !p ? (id ? "—" : "") : hideAdmin(me) && p.role === "super_admin" ? ADMIN_LABEL : p.name; };
  return rows.map((r) => {
    const changes: Record<string, [unknown, unknown]> = {};
    let hiddenPay = false;
    for (const [k, v] of Object.entries(r.changes as Record<string, [unknown, unknown]>)) {
      if ((PAY_FIELDS as readonly string[]).includes(k) && !pay) { hiddenPay = true; continue; }
      changes[k] = k === "managerId" ? [nameOf(v[0]) || "none", nameOf(v[1]) || "none"] : v;
    }
    return { id: r.id, type: r.type, effective: isoOf(r.effective), at: r.at.toISOString(), changes, hiddenPay, note: r.note, by: r.byId ? nameOf(r.byId) : "System" };
  });
}

export type OrgNode = { id: string; name: string; empNo: string; designation: string; dept: string; managerId: string | null; photo: string | null; reports: number };

/**
 * The organisation chart this viewer may see. HR and the super admin see everyone; anyone else sees the people the
 * visibility rules allow (their department, manager, reports and HR). The super admin is left out for everyone else,
 * and a person whose manager is hidden shows at the top.
 */
export async function orgChart(me: Me) {
  const staff = await db.staffUser.findMany({ where: { kind: "team", role: { not: "partner" }, status: "active", deletedAt: null }, select: { id: true, name: true, empNo: true, hr: { select: { designation: true, dept: true, managerId: true, photo: true } } }, orderBy: { name: "asc" } });
  const allowed = new Set(await visibleTo(me, staff.map((s) => s.id)));
  const shown = staff.filter((s) => allowed.has(s.id));
  const count = new Map<string, number>();
  for (const s of staff) if (s.hr?.managerId) count.set(s.hr.managerId, (count.get(s.hr.managerId) ?? 0) + 1);
  const nodes: OrgNode[] = shown.map((s) => ({
    id: s.id, name: s.name, empNo: s.empNo, designation: s.hr?.designation ?? "", dept: s.hr?.dept ?? "", photo: s.hr?.photo ?? null, reports: count.get(s.id) ?? 0,
    managerId: s.hr?.managerId && allowed.has(s.hr.managerId) ? s.hr.managerId : null,
  }));
  return { nodes, me: me.id };
}

/** Thresholds for the organisation health card. */
export const WIDE_SPAN = 12;

/**
 * Organisation health for HR: headcount per department, managers and their span of control, people with no reporting
 * manager, managers with more than WIDE_SPAN direct reports, and reporting lines that point at someone who has left.
 */
export async function orgHealth(me: Me) {
  need(me, "employees");
  const staff = await db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, deletedAt: null }, select: { id: true, name: true, empNo: true, status: true, hr: { select: { dept: true, managerId: true } } } });
  const active = staff.filter((s) => s.status === "active");
  const byId = new Map(staff.map((s) => [s.id, s]));
  const depts = new Map<string, number>();
  for (const s of active) depts.set(s.hr?.dept || "No department", (depts.get(s.hr?.dept || "No department") ?? 0) + 1);
  const spans = new Map<string, number>();
  for (const s of active) if (s.hr?.managerId) spans.set(s.hr.managerId, (spans.get(s.hr.managerId) ?? 0) + 1);
  const managers = [...spans.entries()].map(([id, n]) => ({ id, name: byId.get(id)?.name ?? "Admin", n }));
  const pick = (s: (typeof staff)[number]) => ({ id: s.id, name: s.name, empNo: s.empNo });
  return {
    headcount: active.length,
    depts: [...depts.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    managers: managers.length,
    avgSpan: managers.length ? Math.round((managers.reduce((a, m) => a + m.n, 0) / managers.length) * 10) / 10 : 0,
    wide: managers.filter((m) => m.n > WIDE_SPAN).sort((a, b) => b.n - a.n),
    noManager: active.filter((s) => !s.hr?.managerId).map(pick),
    // A manager who has left (deactivated or deleted) but still has active reports.
    orphaned: active.filter((s) => s.hr?.managerId && byId.has(s.hr.managerId) && byId.get(s.hr.managerId)!.status !== "active").map((s) => ({ ...pick(s), manager: byId.get(s.hr!.managerId!)!.name })),
  };
}
