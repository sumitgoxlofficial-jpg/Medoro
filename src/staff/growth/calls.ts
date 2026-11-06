import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import { hit } from "@/server/ratelimit";
import { clientInfo } from "@/server/auth";
import { activity, findLead, gaudit, need, outbox, type Actor } from "./access";
import { CONNECTED_OUTCOMES, INTEREST_LEVELS, OUTCOME_IDS, isAttempt, type Stage } from "./constants";
import { telUri, toE164 } from "./normalize";
import { addSuppression, callBlocker } from "./compliance";
import { rescore, staffNames, syncVerification } from "./leads";

/**
 * Employees call from their own phone and SIM. Medoro only records that the dialer was opened (a CallSession) and what the
 * employee reports afterwards. A dialer launch is not a call, and a reported call is not carrier-verified: Medoro never
 * reads call logs, phone state or audio, and never invents a duration.
 */

const REUSE_MS = 30 * 60_000;

export async function launchCall(a: Actor, leadId: string) {
  need(a, "calls.make");
  const lead = await findLead(a, leadId);
  const asg = await db.leadAssignment.findFirst({ where: { leadId, staffId: a.id, active: true } });
  if (!asg) throw new UserError("You can only call leads assigned to you.");
  const phone = toE164(lead.phone);
  if (!phone || phone !== lead.phone) throw new UserError("This lead has no valid Indian phone number. Fix the number first.");
  const blocked = await callBlocker(lead);
  if (blocked) throw new UserError(blocked);
  // A second tap within 30 minutes reuses the open session instead of counting another launch.
  const open = await db.callSession.findFirst({ where: { leadId, staffId: a.id, status: "launched", launchedAt: { gte: new Date(Date.now() - REUSE_MS) } }, orderBy: { launchedAt: "desc" } });
  if (open) return { success: true as const, callSessionId: open.id, phone, dialerUri: telUri(phone), reused: true };
  const rl = await hit({ name: "growthDial", limit: 150, windowSec: 3600, what: "calls started" }, a.id);
  if (!rl.ok) throw new UserError("Too many calls started this hour. Report your open calls first.");
  const { userAgent } = await clientInfo().catch(() => ({ userAgent: null }));
  const s = await db.$transaction(async (tx) => {
    const s = await tx.callSession.create({ data: { leadId, staffId: a.id, assignmentId: asg.id, phone, userAgent: (userAgent ?? "").slice(0, 200) } });
    await activity(tx, leadId, "call_launched", `${a.name} opened the phone dialer`, a, s.id);
    return s;
  });
  return { success: true as const, callSessionId: s.id, phone, dialerUri: telUri(phone), reused: false };
}

export const reportSchema = z.object({
  outcome: z.enum(OUTCOME_IDS),
  interestLevel: z.enum(INTEREST_LEVELS),
  notes: z.string().trim().min(3, "Write what was discussed (or why the call didn’t happen).").max(3000),
  followUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  numberConfirmed: z.boolean().default(false),
  softwareStatus: z.enum(["", "none", "paper", "other_unhappy", "other_happy"]).default(""),
  demoRequested: z.boolean().default(false),
  demo: z.object({ at: z.string().datetime({ offset: true }), mode: z.enum(["phone", "video", "visit"]).default("phone") }).optional(),
  conversion: z.object({ product: z.enum(["starter", "pro", "multi"]), cycle: z.enum(["m", "y"]), amountRupees: z.coerce.number<string | number>().min(0).max(10_000_000), reference: z.string().trim().max(120).default("") }).optional(),
  consentChannels: z.array(z.enum(["phone", "whatsapp", "email"])).default([]),
  idempotencyKey: z.string().min(8).max(80).optional(),
}).superRefine((r, ctx) => {
  const need = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if ((r.outcome === "FOLLOW_UP_REQUIRED" || r.outcome === "INTERESTED") && !r.followUpAt) need("followUpAt", "Set the next follow-up date.");
  if (r.outcome === "DEMO_SCHEDULED" && !r.demo) need("demo", "Set the demo date and time.");
  if (r.outcome === "CONVERTED" && !r.conversion) need("conversion", "Enter the plan and amount for the conversion.");
  if (r.followUpAt && new Date(r.followUpAt).getTime() < Date.now() - 5 * 60_000) need("followUpAt", "The follow-up date is in the past.");
  if (r.numberConfirmed && !CONNECTED_OUTCOMES.includes(r.outcome)) need("numberConfirmed", "A number can only be confirmed on a call someone answered.");
});

const PROGRESS: Stage[] = ["NEW_LEAD", "RESEARCH_PENDING", "QUALIFIED", "ASSIGNED", "CONTACT_PERMISSION_PENDING", "CONTACT_AUTHORIZED", "FIRST_CONTACT", "INTERESTED", "DEMO_SCHEDULED", "DEMO_COMPLETED", "TRIAL_STARTED", "NEGOTIATION", "CONVERTED"];
/** The stage a report moves the lead to; progress stages only move forward. */
export function nextStage(current: Stage, outcome: string, hasFollowUp: boolean): Stage {
  const forward = (s: Stage) => (PROGRESS.indexOf(s) > PROGRESS.indexOf(current) || !PROGRESS.includes(current) ? s : current);
  switch (outcome) {
    case "CONNECTED": case "FOLLOW_UP_REQUIRED": return current === "LOST" || current === "FOLLOW_UP_LATER" ? "FIRST_CONTACT" : forward("FIRST_CONTACT");
    case "INTERESTED": return forward("INTERESTED");
    case "DEMO_SCHEDULED": return forward("DEMO_SCHEDULED");
    case "CONVERTED": return "CONVERTED";
    case "NOT_INTERESTED": return current === "CONVERTED" ? current : hasFollowUp ? "FOLLOW_UP_LATER" : "LOST";
    case "WRONG_NUMBER": return current === "CONVERTED" ? current : "RESEARCH_PENDING";
    case "DO_NOT_CONTACT": return "DO_NOT_CONTACT";
    default: return current;
  }
}

/**
 * Submits the report for a call session, once. Everything (session, lead, follow-up, demo, conversion, evidence, timeline)
 * commits in one transaction; the conditional update on the session makes a double submit fail instead of counting twice.
 */
export async function reportCall(a: Actor, sessionId: string, raw: z.input<typeof reportSchema>) {
  need(a, "calls.make");
  const r = reportSchema.parse(raw);
  if (r.idempotencyKey) {
    const prior = await db.callSession.findUnique({ where: { reportKey: r.idempotencyKey } });
    if (prior) { if (prior.id !== sessionId || prior.staffId !== a.id) throw new UserError("This report key was already used."); return { duplicate: true, callSessionId: prior.id, stage: null }; }
  }
  const s = await db.callSession.findUnique({ where: { id: sessionId } });
  if (!s || s.staffId !== a.id) throw new UserError("Call not found. You can only report calls you started.");
  if (s.status === "reported") throw new UserError("This call was already reported.");
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const done = await tx.callSession.updateMany({
      where: { id: sessionId, staffId: a.id, status: "launched" },
      data: { status: "reported", reportedAt: now, outcome: r.outcome, interestLevel: r.interestLevel, notes: r.notes, numberConfirmed: r.numberConfirmed, softwareStatus: r.softwareStatus, demoRequested: r.demoRequested || r.outcome === "DEMO_SCHEDULED", followUpAt: r.followUpAt ? new Date(r.followUpAt) : null, reportKey: r.idempotencyKey ?? null },
    });
    if (!done.count) throw new UserError("This call was already reported.");
    const lead = await tx.pharmacyLead.findUniqueOrThrow({ where: { id: s.leadId } });
    const data: Prisma.PharmacyLeadUpdateInput = {};
    const attempt = isAttempt(r.outcome);
    if (attempt) data.lastContactedAt = now;
    const stage = nextStage(lead.stage as Stage, r.outcome, !!r.followUpAt);
    if (stage !== lead.stage) { data.stage = stage; if (stage === "LOST") data.lostReason = "Not interested"; }
    if (r.softwareStatus) {
      data.softwareStatus = r.softwareStatus;
      await tx.leadEvidence.create({ data: { leadId: lead.id, kind: "software", method: "call_report", result: "info", detail: `Told on a call to ${a.name}: ${r.softwareStatus.replace(/_/g, " ")}`, byStaffId: a.id } });
    }
    if (r.numberConfirmed && lead.phone === s.phone) {
      data.phoneVerifiedAt = now;
      await tx.leadEvidence.create({ data: { leadId: lead.id, kind: "phone", method: "call_confirmed", result: "verified", detail: `${a.name} called ${s.phone} and the person who answered confirmed it is ${lead.name}`, byStaffId: a.id } });
    }
    if (r.outcome === "WRONG_NUMBER") {
      data.phoneVerifiedAt = null;
      await tx.leadEvidence.create({ data: { leadId: lead.id, kind: "phone", method: "call_report", result: "failed", detail: `${s.phone} is a wrong number (reported by ${a.name})`, byStaffId: a.id } });
      await addSuppression(a, { value: s.phone, channel: "phone", reason: "wrong_number", leadId: lead.id }, tx);
    }
    if (r.outcome === "DO_NOT_CONTACT") {
      await addSuppression(a, { value: s.phone, channel: "all", reason: "dnc_request", leadId: lead.id }, tx);
      if (lead.email) await addSuppression(a, { value: lead.email, channel: "all", reason: "dnc_request", leadId: lead.id }, tx);
      await tx.contactConsent.updateMany({ where: { leadId: lead.id, revokedAt: null }, data: { revokedAt: now, revokedBy: a.id, revokeNote: "Asked not to be contacted on a call" } });
    }
    // Consent the owner gave on this call, recorded with the call as evidence.
    if (CONNECTED_OUTCOMES.includes(r.outcome) && r.outcome !== "DO_NOT_CONTACT") {
      for (const ch of r.consentChannels) await tx.contactConsent.create({ data: { leadId: lead.id, channel: ch, purpose: "marketing", lawfulBasis: "consent", scope: `Product information about Medoro by ${ch}`, evidence: `Agreed on a call with ${a.name} on ${now.toISOString().slice(0, 10)}: ${r.notes.slice(0, 200)}`, source: "call", recordedBy: a.id } });
    }

    // Follow-ups: an attempt closes this employee's open follow-ups for the lead; a new date opens the next one.
    if (attempt) await tx.followUpTask.updateMany({ where: { leadId: lead.id, staffId: a.id, status: "open" }, data: { status: "done", doneAt: now, callId: sessionId } });
    if (r.outcome === "DO_NOT_CONTACT") await tx.followUpTask.updateMany({ where: { leadId: lead.id, status: "open" }, data: { status: "cancelled" } });
    else if (r.followUpAt) await tx.followUpTask.create({ data: { leadId: lead.id, staffId: a.id, dueAt: new Date(r.followUpAt), note: r.notes.slice(0, 300), callId: sessionId, createdById: a.id } });
    const nextFu = await tx.followUpTask.findFirst({ where: { leadId: lead.id, status: "open" }, orderBy: { dueAt: "asc" } });
    data.nextFollowUpAt = nextFu?.dueAt ?? null;

    if (r.outcome === "DEMO_SCHEDULED" && r.demo) {
      const d = await tx.demoBooking.create({ data: { leadId: lead.id, staffId: a.id, at: new Date(r.demo.at), mode: r.demo.mode, notes: r.notes.slice(0, 500) } });
      await activity(tx, lead.id, "demo", `Demo booked for ${r.demo.at.slice(0, 16).replace("T", " ")} (${r.demo.mode})`, a, d.id);
    }
    if (r.outcome === "CONVERTED" && r.conversion) await recordConversion(tx, a, lead.id, { ...r.conversion, notes: r.notes, callId: sessionId });

    await tx.pharmacyLead.update({ where: { id: lead.id }, data });
    await activity(tx, lead.id, "call_reported", `Call reported by ${a.name}: ${r.outcome.replace(/_/g, " ").toLowerCase()} · interest ${r.interestLevel}${r.followUpAt ? ` · follow-up ${r.followUpAt.slice(0, 10)}` : ""} — ${r.notes.slice(0, 300)}`, a, sessionId);
    if (stage !== lead.stage) await activity(tx, lead.id, "stage", `Stage: ${lead.stage} → ${stage}`, a);
    await outbox(tx, "call.reported", { sessionId, leadId: lead.id, staffId: a.id, outcome: r.outcome });
    await syncVerification(tx, lead.id);
    await rescore(tx, lead.id);
    return { stage };
  }, { timeout: 30_000 });
  await gaudit(a, "Call reported", "call", sessionId, r.outcome);
  return { duplicate: false, callSessionId: sessionId, stage: result.stage };
}

export async function recordConversion(tx: Tx, a: { id: string; name: string }, leadId: string, c: { product: string; cycle: string; amountRupees: number; reference: string; notes?: string; callId?: string }) {
  if (await tx.conversionRecord.findUnique({ where: { leadId } })) throw new UserError("This lead is already converted.");
  const amountPaise = Math.round(c.amountRupees * 100);
  const conv = await tx.conversionRecord.create({ data: { leadId, staffId: a.id, product: c.product, cycle: c.cycle, amountPaise, reference: c.reference, notes: (c.notes ?? "").slice(0, 500), callId: c.callId ?? null } });
  await tx.salesDeal.upsert({ where: { leadId }, create: { leadId, staffId: a.id, product: c.product, cycle: c.cycle, amountPaise, status: "won" }, update: { status: "won", product: c.product, cycle: c.cycle, amountPaise } });
  await tx.pharmacyLead.update({ where: { id: leadId }, data: { stage: "CONVERTED" } });
  await activity(tx, leadId, "conversion", `Converted by ${a.name}: ${c.product} (${c.cycle === "y" ? "yearly" : "monthly"}) ₹${c.amountRupees.toLocaleString("en-IN")}${c.reference ? ` · ref ${c.reference}` : ""}`, a, conv.id);
  await outbox(tx, "lead.converted", { leadId, staffId: a.id, amountPaise, product: c.product });
  return conv;
}

export const historySchema = z.object({ staffId: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional(), outcome: z.string().optional(), leadId: z.string().uuid().optional(), page: z.coerce.number<string | number>().int().min(1).default(1) });
export async function callHistory(a: Actor, raw: z.input<typeof historySchema>) {
  need(a, "calls.make");
  const f = historySchema.parse(raw);
  const where: Prisma.CallSessionWhereInput = {};
  if (a.growthRole === "sales") where.staffId = a.id;
  else if (a.growthRole === "manager") where.staffId = f.staffId && a.teamStaffIds.includes(f.staffId) ? f.staffId : { in: a.teamStaffIds };
  else if (f.staffId) where.staffId = f.staffId;
  if (f.from || f.to) where.launchedAt = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lt: new Date(new Date(f.to).getTime() + 86_400_000) } : {}) };
  if (f.outcome === "unreported") where.status = "launched";
  else if (f.outcome && (OUTCOME_IDS as readonly string[]).includes(f.outcome)) where.outcome = f.outcome as never;
  if (f.leadId) where.leadId = f.leadId;
  const [total, rows] = await Promise.all([
    db.callSession.count({ where }),
    db.callSession.findMany({ where, orderBy: { launchedAt: "desc" }, skip: (f.page - 1) * 50, take: 50, include: { lead: { select: { id: true, code: true, name: true, city: true } } } }),
  ]);
  const names = await staffNames(rows.map((r) => r.staffId));
  return { total, page: f.page, rows: rows.map((r) => ({ id: r.id, lead: r.lead, staffName: names.get(r.staffId) ?? "", staffId: r.staffId, phone: r.phone, launchedAt: r.launchedAt.toISOString(), reportedAt: r.reportedAt?.toISOString() ?? null, status: r.status, outcome: r.outcome, interestLevel: r.interestLevel, notes: r.notes, followUpAt: r.followUpAt?.toISOString() ?? null })) };
}

/** Calls the employee started but hasn't reported yet. */
export async function openCalls(a: Actor) {
  return db.callSession.findMany({ where: { staffId: a.id, status: "launched" }, orderBy: { launchedAt: "desc" }, take: 20, include: { lead: { select: { id: true, code: true, name: true } } } });
}

/** The calling workspace's queue: overdue and due follow-ups first, then never-called assigned leads by score. */
export async function nextToCall(a: Actor, now = new Date()) {
  need(a, "calls.make");
  const endOfDay = new Date(now.getTime() + 86_400_000);
  const due = await db.followUpTask.findMany({ where: { staffId: a.id, status: "open", dueAt: { lt: endOfDay }, lead: { assignedStaffId: a.id, deletedAt: null } }, orderBy: { dueAt: "asc" }, take: 20, include: { lead: true } });
  const fresh = await db.pharmacyLead.findMany({ where: { assignedStaffId: a.id, deletedAt: null, lastContactedAt: null, stage: { notIn: ["DO_NOT_CONTACT", "LOST", "CONVERTED"] }, phone: { not: null } }, orderBy: [{ score: "desc" }, { createdAt: "asc" }], take: 20 });
  return { due: due.map((d) => ({ followUp: { id: d.id, dueAt: d.dueAt.toISOString(), note: d.note }, lead: d.lead })), fresh };
}


