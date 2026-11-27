import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { log } from "@/server/log";
import { audit, can, needAdmin, notify, type Me } from "./auth";
import { MODULES, type ModuleId } from "./constants";
import { checkGrantTarget, grantInput } from "./access";
import { recordEvent } from "./org";
import { ADMIN_LABEL, hideAdmin } from "./visibility";

// Multi-step approvals. A request names a workflow; the workflow lists its steps (the subject's reporting manager, then
// the super admin, …). Each step is decided by exactly one person: the first allowed approver to act claims it. Rules:
//  * nobody decides a request they made or one about themselves;
//  * a manager step with no manager (or whose manager made the request) is skipped and recorded as skipped;
//  * a manager away can hand their approvals to a colleague for a period (delegation); both can then decide;
//  * a step left undecided past its deadline is escalated: the approver is reminded and the super admins are told;
//  * the change itself is made only after the last approval, in the same transaction as that decision.

type Tx = Prisma.TransactionClient;
export const STEP_HOURS = 48;
type StepDef = { kind: "manager" | "admin"; label: string };
const moduleIds = MODULES.map((m) => m.id) as [ModuleId, ...ModuleId[]];

const ctcInput = z.object({
  staffId: z.string().min(1, "Choose the employee."),
  toCtc: z.coerce.number({ error: "Enter the new annual CTC." }).int("Enter the CTC in whole rupees.").min(0).max(100_000_000),
  reason: z.string().trim().min(10, "Give the reason (at least a sentence).").max(500),
});
const accessInput = z.object({
  module: z.enum(moduleIds, { error: "Choose the module you need." }),
  days: z.coerce.number().int().min(1, "Ask for at least one day.").max(30, "Ask for at most 30 days; ask again later if needed."),
  reason: z.string().trim().min(10, "Say what you need it for (at least a sentence).").max(500),
});

type Wf<I> = {
  label: string;
  input: z.ZodType<I>;
  /** Who may raise it and what it is about (the subject). Throws when not allowed. */
  open: (me: Me, i: I) => Promise<{ subjectId: string; title: string }>;
  steps: StepDef[];
  apply: (tx: Tx, a: { id: string; requesterId: string; subjectId: string }, i: I) => Promise<string>;
};

const WORKFLOWS = {
  /** HR or Payroll proposes a new annual CTC outside a promotion; the manager and the super admin approve it. */
  ctc_change: {
    label: "Salary change",
    input: ctcInput,
    async open(me, i) {
      if (!can(me, "payroll") && !can(me, "employees")) throw new UserError("Only HR or Payroll can propose a salary change.");
      if (i.staffId === me.id) throw new UserError("Someone else has to propose a change to your own salary.");
      const u = await db.staffUser.findFirst({ where: { id: i.staffId, kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null }, include: { hr: true } });
      if (!u?.hr) throw new UserError("Choose an active employee.");
      if (u.hr.ctc === i.toCtc) throw new UserError("That is their current CTC.");
      if (await db.hrApproval.findFirst({ where: { kind: "ctc_change", subjectId: i.staffId, status: "pending" } })) throw new UserError("A salary change for this person is already waiting for approval.");
      return { subjectId: u.id, title: `${u.name}: CTC ₹${u.hr.ctc.toLocaleString("en-IN")} → ₹${i.toCtc.toLocaleString("en-IN")}` };
    },
    steps: [{ kind: "manager", label: "Reporting manager" }, { kind: "admin", label: "Super admin" }],
    async apply(tx, a, i) {
      const h = await tx.hrProfile.findUnique({ where: { staffId: a.subjectId } });
      const u = await tx.staffUser.findUnique({ where: { id: a.subjectId }, select: { status: true } });
      if (!h || u?.status !== "active") throw new UserError("This person is no longer active, so the change can’t be made.");
      await tx.hrProfile.update({ where: { staffId: a.subjectId }, data: { ctc: i.toCtc } });
      await tx.hrSalaryRevision.create({ data: { staffId: a.subjectId, fromCtc: h.ctc, toCtc: i.toCtc, byId: a.requesterId } });
      await recordEvent({ staffId: a.subjectId, type: "pay", byId: a.requesterId, changes: { ctc: [h.ctc, i.toCtc] }, note: `Approved salary change (request ${a.id.slice(0, 8)})` }, tx);
      return `CTC ${h.ctc} → ${i.toCtc}`;
    },
  } satisfies Wf<z.output<typeof ctcInput>>,
  /** Anyone asks for a module for a few days (cover for a colleague, a one-off report); manager, then super admin. */
  access: {
    label: "Temporary access",
    input: accessInput,
    async open(me, i) {
      if (me.role === "admin") throw new UserError("The super admin already has every module.");
      if (can(me, i.module)) throw new UserError("You already have that module.");
      if (await db.hrApproval.findFirst({ where: { kind: "access", requesterId: me.id, status: "pending" } })) throw new UserError("You have an access request waiting already.");
      return { subjectId: me.id, title: `${me.name}: ${MODULES.find((m) => m.id === i.module)!.label} for ${i.days} day${i.days === 1 ? "" : "s"}` };
    },
    steps: [{ kind: "manager", label: "Reporting manager" }, { kind: "admin", label: "Super admin" }],
    async apply(tx, a, i) {
      await checkGrantTarget(a.subjectId);
      await tx.hrAccessGrant.create({ data: { staffId: a.subjectId, module: i.module, effect: "grant", reason: `Approved request ${a.id.slice(0, 8)}: ${i.reason}`.slice(0, 300), expiresAt: new Date(`${addDays(todayISO(), i.days)}T00:00:00+05:30`), byId: a.requesterId } });
      return `${i.module} for ${i.days} days`;
    },
  } satisfies Wf<z.output<typeof accessInput>>,
} as const;
export type WorkflowId = keyof typeof WORKFLOWS;
export const WORKFLOW_IDS = Object.keys(WORKFLOWS) as WorkflowId[];
const wf = (k: string) => {
  const w = (WORKFLOWS as Record<string, Wf<unknown>>)[k];
  if (!w) throw new UserError("Unknown request type.");
  return w;
};

const activeDelegates = async (fromId: string, tx: Tx | typeof db = db) => {
  const today = dateOnly(todayISO());
  return (await tx.hrDelegation.findMany({ where: { fromId, cancelledAt: null, fromDay: { lte: today }, toDay: { gte: today } }, select: { toId: true } })).map((d) => d.toId);
};
const superAdmins = async () => (await db.staffUser.findMany({ where: { role: "super_admin", status: "active" }, select: { id: true } })).map((u) => u.id);

/** Makes the next waiting step pending (skipping manager steps nobody can take). Returns who to tell, or null when none is left. */
async function activateNext(tx: Tx, approvalId: string): Promise<{ notify: string[] | "admins" } | null> {
  const a = await tx.hrApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { steps: { orderBy: { seq: "asc" } } } });
  for (const s of a.steps.filter((x) => x.status === "waiting")) {
    if (s.kind === "manager") {
      const mgr = (await tx.hrProfile.findUnique({ where: { staffId: a.subjectId }, select: { managerId: true } }))?.managerId ?? null;
      const mu = mgr ? await tx.staffUser.findUnique({ where: { id: mgr }, select: { status: true, role: true } }) : null;
      if (!mgr || mgr === a.requesterId || mgr === a.subjectId || mu?.status !== "active" || mu.role === "super_admin") {
        await tx.hrApprovalStep.update({ where: { id: s.id }, data: { status: "skipped", comment: !mgr ? "No reporting manager" : mgr === a.requesterId ? "The manager made the request" : "Manager not available", decidedAt: new Date() } });
        continue; // a super admin manager decides at the super admin step anyway
      }
      await tx.hrApprovalStep.update({ where: { id: s.id }, data: { status: "pending", approverId: mgr, dueAt: new Date(Date.now() + STEP_HOURS * 3600_000) } });
      return { notify: [mgr, ...(await activeDelegates(mgr, tx))] };
    }
    await tx.hrApprovalStep.update({ where: { id: s.id }, data: { status: "pending", dueAt: new Date(Date.now() + STEP_HOURS * 3600_000) } });
    return { notify: "admins" };
  }
  return null;
}

async function tell(who: string[] | "admins", text: string) {
  await notify(who === "admins" ? await superAdmins() : who, text, "approvals");
}

/** Raises a request. Returns its id. */
export async function requestApproval(me: Me, kind: string, raw: unknown) {
  const w = wf(kind);
  const input = w.input.parse(raw);
  const { subjectId, title } = await w.open(me, input);
  const { id, next } = await db.$transaction(async (tx) => {
    const a = await tx.hrApproval.create({ data: { kind, subjectId, requesterId: me.id, title: title.slice(0, 200), payload: input as Prisma.InputJsonValue, steps: { create: w.steps.map((s, i) => ({ seq: i + 1, kind: s.kind, label: s.label })) } } });
    return { id: a.id, next: await activateNext(tx, a.id) };
  });
  if (next) await tell(next.notify, `Approval needed: ${w.label}. ${title}`);
  await audit(me, `Approval requested · ${w.label}`, title);
  return id;
}

type StepRow = { id: string; kind: string; approverId: string | null; status: string };
/** Whether this person may decide this pending step. */
async function mayDecide(me: Me, a: { requesterId: string; subjectId: string }, s: StepRow) {
  if (s.status !== "pending" || me.id === a.requesterId || me.id === a.subjectId) return false;
  if (s.kind === "admin") return me.role === "admin";
  return !!s.approverId && (me.id === s.approverId || (await activeDelegates(s.approverId)).includes(me.id));
}

/** Approves or rejects the step waiting on this person. The last approval makes the change in the same transaction. */
export async function decideApproval(me: Me, approvalId: string, approve: boolean, rawComment = "") {
  const comment = String(rawComment ?? "").trim().slice(0, 500);
  if (!approve && comment.length < 5) throw new UserError("Say why you are rejecting it.");
  const a = await db.hrApproval.findUnique({ where: { id: approvalId }, include: { steps: { orderBy: { seq: "asc" } } } });
  if (!a || a.status !== "pending") throw new UserError("This request was already decided.");
  const step = a.steps.find((s) => s.status === "pending");
  if (!step || !(await mayDecide(me, a, step))) throw new UserError(a.requesterId === me.id || a.subjectId === me.id ? "Someone else has to decide a request you made or one about you." : "This request isn’t waiting for you.");
  const w = wf(a.kind);
  // Filled in by the transaction (an object, so the type checker doesn't narrow it before the callback runs).
  const st: { outcome: "rejected" | "next" | "applied"; next: Awaited<ReturnType<typeof activateNext>>; result: string } = { outcome: "next", next: null, result: "" };
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.hrApprovalStep.updateMany({ where: { id: step.id, status: "pending" }, data: { status: approve ? "approved" : "rejected", decidedBy: me.id, decidedAt: new Date(), comment } });
      if (!claimed.count) throw new UserError("Someone decided this step a moment ago.");
      if (!approve) { st.outcome = "rejected"; await tx.hrApproval.update({ where: { id: a.id }, data: { status: "rejected", decidedAt: new Date() } }); return; }
      st.next = await activateNext(tx, a.id);
      if (st.next) return;
      st.result = await w.apply(tx, a, w.input.parse(a.payload));
      st.outcome = "applied";
      await tx.hrApproval.update({ where: { id: a.id }, data: { status: "applied", decidedAt: new Date(), appliedAt: new Date(), result: st.result } });
    });
  } catch (e) {
    if (e instanceof UserError) throw e;
    log.error("approval decision failed", { err: e, approvalId });
    throw e;
  }
  if (st.outcome === "rejected") await notify([a.requesterId], `Your request was rejected: ${a.title}. Reason: ${comment}`, "approvals");
  else if (st.outcome === "applied") await notify([...new Set([a.requesterId, a.subjectId])], `Approved and done: ${a.title}.`, "approvals");
  else if (st.next) await tell(st.next.notify, `Approval needed: ${w.label}. ${a.title}`);
  await audit(me, `Approval ${approve ? "approved" : "rejected"} · ${w.label}`, `${a.title}${comment ? ` · ${comment}` : ""}${st.result ? ` · applied: ${st.result}` : ""}`);
  return st.outcome;
}

/** The person who asked can withdraw a request until it is decided. */
export async function cancelApproval(me: Me, approvalId: string) {
  const { count } = await db.hrApproval.updateMany({ where: { id: approvalId, requesterId: me.id, status: "pending" }, data: { status: "cancelled", decidedAt: new Date() } });
  if (!count) throw new UserError("Only a request you made and that is still waiting can be withdrawn.");
  await db.hrApprovalStep.updateMany({ where: { approvalId, status: { in: ["pending", "waiting"] } }, data: { status: "skipped", comment: "Withdrawn" } });
  await audit(me, "Approval withdrawn", approvalId);
}

/** What waits on me, what I asked for, and (for the super admin) everything open. */
export async function approvalsFor(me: Me) {
  const delegatedFrom = (await db.hrDelegation.findMany({ where: { toId: me.id, cancelledAt: null, fromDay: { lte: dateOnly(todayISO()) }, toDay: { gte: dateOnly(todayISO()) } }, select: { fromId: true } })).map((d) => d.fromId);
  const pending = await db.hrApproval.findMany({
    where: { status: "pending", requesterId: { not: me.id }, subjectId: { not: me.id }, steps: { some: { status: "pending", OR: [...(me.role === "admin" ? [{ kind: "admin" }] : []), { approverId: { in: [me.id, ...delegatedFrom] } }] } } },
    include: { steps: { orderBy: { seq: "asc" } } }, orderBy: { createdAt: "asc" }, take: 200,
  });
  const mine = await db.hrApproval.findMany({ where: { requesterId: me.id }, include: { steps: { orderBy: { seq: "asc" } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const people = await db.staffUser.findMany({ where: { id: { in: [...new Set([...pending, ...mine].flatMap((a) => [a.requesterId, ...a.steps.flatMap((s) => [s.approverId, s.decidedBy])]).filter((x): x is string => !!x))] } }, select: { id: true, name: true, role: true } });
  const nm = (id: string | null) => { if (!id) return ""; const p = people.find((x) => x.id === id); return !p ? "—" : hideAdmin(me) && p.role === "super_admin" ? ADMIN_LABEL : p.name; };
  const view = (a: (typeof mine)[number]) => ({
    id: a.id, kind: a.kind, label: wf(a.kind).label, title: a.title, status: a.status, at: a.createdAt.toISOString(), by: nm(a.requesterId), result: a.result,
    reason: String((a.payload as { reason?: string }).reason ?? ""),
    steps: a.steps.map((s) => ({ seq: s.seq, label: s.label, status: s.status, by: nm(s.decidedBy) || (s.status === "pending" ? (s.kind === "admin" ? "Super admin" : nm(s.approverId)) : ""), at: s.decidedAt?.toISOString() ?? null, comment: s.comment, overdue: s.status === "pending" && !!s.dueAt && s.dueAt < new Date() })),
  });
  return { waiting: pending.map(view), mine: mine.map(view) };
}

// ── Delegation
const delegationInput = z.object({
  toId: z.string().min(1, "Choose who approves for you."),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day."), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the last day."),
  reason: z.string().trim().max(200).default(""),
});
/** A manager going on leave hands their approvals to a colleague for a period (at most 60 days). */
export async function delegate(me: Me, raw: z.input<typeof delegationInput>) {
  const i = delegationInput.parse(raw);
  if (i.toId === me.id) throw new UserError("Choose someone other than yourself.");
  if (i.to < i.from) throw new UserError("The last day is before the first day.");
  if (i.from < todayISO()) throw new UserError("Start today or later.");
  if (i.to > addDays(i.from, 60)) throw new UserError("Delegate for at most 60 days at a time.");
  const to = await db.staffUser.findFirst({ where: { id: i.toId, kind: "team", status: "active", deletedAt: null, role: { not: "partner" } } });
  if (!to) throw new UserError("Choose an active colleague.");
  const row = await db.hrDelegation.create({ data: { fromId: me.id, toId: i.toId, fromDay: dateOnly(i.from), toDay: dateOnly(i.to), reason: i.reason } });
  await notify([i.toId], `${me.name} asked you to decide their approvals from ${i.from} to ${i.to}.`, "approvals");
  await audit(me, "Approvals delegated", `to ${to.name} · ${i.from} to ${i.to}`);
  return row.id;
}
export async function cancelDelegation(me: Me, id: string) {
  const { count } = await db.hrDelegation.updateMany({ where: { id, fromId: me.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
  if (!count) throw new UserError("Delegation not found.");
  await audit(me, "Delegation cancelled", id);
}
export async function myDelegations(me: Me) {
  const rows = await db.hrDelegation.findMany({ where: { OR: [{ fromId: me.id }, { toId: me.id }], cancelledAt: null, toDay: { gte: dateOnly(todayISO()) } }, orderBy: { fromDay: "asc" } });
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: rows.flatMap((r) => [r.fromId, r.toId]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, mine: r.fromId === me.id, from: names.get(r.fromId) ?? "", to: names.get(r.toId) ?? "", fromDay: isoOf(r.fromDay), toDay: isoOf(r.toDay), reason: r.reason }));
}

/** Scheduled: steps past their deadline remind the approver once and tell the super admins. Returns how many were escalated. */
export async function escalationTick(now = new Date()) {
  const due = await db.hrApprovalStep.findMany({ where: { status: "pending", dueAt: { lt: now }, escalatedAt: null }, include: { approval: true }, take: 100 });
  let n = 0;
  for (const s of due) {
    const { count } = await db.hrApprovalStep.updateMany({ where: { id: s.id, escalatedAt: null }, data: { escalatedAt: now } });
    if (!count) continue;
    const text = `Overdue approval (over ${STEP_HOURS} hours): ${s.approval.title}`;
    await notify([...(s.approverId ? [s.approverId, ...(await activeDelegates(s.approverId))] : []), ...(await superAdmins())], text, "approvals");
    n++;
  }
  return n;
}

// ── Individual access (super admin)
/** Every grant and denial still in force or ended in the last 90 days, newest first. */
export async function accessGrants(me: Me) {
  needAdmin(me);
  const since = new Date(Date.now() - 90 * 86400_000);
  const rows = await db.hrAccessGrant.findMany({ where: { OR: [{ revokedAt: null }, { revokedAt: { gt: since } }] }, include: { staff: { select: { name: true, empNo: true } } }, orderBy: { createdAt: "desc" }, take: 300 });
  const now = new Date();
  return rows.map((r) => ({ id: r.id, staffId: r.staffId, name: r.staff.name, empNo: r.staff.empNo, module: r.module, effect: r.effect, reason: r.reason, until: r.expiresAt?.toISOString() ?? null, at: r.createdAt.toISOString(), live: !r.revokedAt && (!r.expiresAt || r.expiresAt > now), revoked: !!r.revokedAt }));
}
export async function addGrant(me: Me, raw: unknown) {
  needAdmin(me);
  const i = grantInput.parse(raw);
  await checkGrantTarget(i.staffId);
  if (i.until && i.until < todayISO()) throw new UserError("The end date has passed.");
  const row = await db.hrAccessGrant.create({ data: { staffId: i.staffId, module: i.module, effect: i.effect, reason: i.reason, expiresAt: i.until ? new Date(`${addDays(i.until, 1)}T00:00:00+05:30`) : null, byId: me.id } });
  const label = MODULES.find((m) => m.id === i.module)!.label;
  await notify([i.staffId], i.effect === "grant" ? `You now have ${label}${i.until ? ` until ${i.until}` : ""}.` : `Your access to ${label} was removed.`, "home");
  await audit(me, `Access ${i.effect === "grant" ? "granted" : "denied"} to one person`, `${i.staffId} · ${i.module}${i.until ? ` · until ${i.until}` : ""} · ${i.reason}`);
  return row.id;
}
export async function revokeGrant(me: Me, id: string) {
  needAdmin(me);
  const r = await db.hrAccessGrant.findUnique({ where: { id } });
  if (!r || r.revokedAt) throw new UserError("That access change is not in force.");
  await db.hrAccessGrant.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: me.id } });
  await audit(me, "Individual access ended", `${r.staffId} · ${r.effect} ${r.module}`);
}
