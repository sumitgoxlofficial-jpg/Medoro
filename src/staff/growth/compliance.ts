import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import { activity, findLead, gaudit, need, setting, saveSetting, type Actor } from "./access";
import { CHANNELS, LAWFUL_BASES, SUPPRESSION_CHANNELS } from "./constants";
import { maskEmail, maskPhone, normEmail, toE164 } from "./normalize";

type Db = Tx | typeof db;

// ── Contact policy (admin setting)
export type Policy = {
  /** dnc_only: calls are blocked only for suppressed numbers. authorized_only: a call also needs a phone consent or the Contact authorised stage. */
  callPolicy: "dnc_only" | "authorized_only";
  /** Leads with no activity for this many months are offered for deletion (0 = off). */
  retentionMonths: number;
  /** Most recipients a campaign may message in a day. */
  campaignDailyCap: number;
};
export const DEFAULT_POLICY: Policy = { callPolicy: "dnc_only", retentionMonths: 24, campaignDailyCap: 200 };
export const policy = () => setting<Policy>("policy", DEFAULT_POLICY);
export const policySchema = z.object({
  callPolicy: z.enum(["dnc_only", "authorized_only"]),
  retentionMonths: z.coerce.number<string | number>().int().min(0).max(120),
  campaignDailyCap: z.coerce.number<string | number>().int().min(1).max(5000),
});
export async function savePolicy(a: Actor, raw: z.input<typeof policySchema>) {
  need(a, "settings.manage");
  const p = policySchema.parse(raw);
  await saveSetting("policy", p);
  await gaudit(a, "Contact policy saved", "settings", null, JSON.stringify(p));
  return p;
}

// ── Suppression (do-not-contact). Keyed by a hash so it outlives an erased lead.
export const valueHash = (kind: "phone" | "email", value: string) => createHash("sha256").update(`medoro-growth:${kind}:${value}`).digest("hex");
function keyOf(value: string): { kind: "phone" | "email"; v: string; hint: string } {
  const p = toE164(value);
  if (p) return { kind: "phone", v: p, hint: maskPhone(p) };
  const e = normEmail(value);
  if (e) return { kind: "email", v: e, hint: maskEmail(e) };
  throw new UserError("Enter a valid Indian phone number or email.");
}

/** Active suppression for any of the lead's addresses on this channel (or on all channels). */
export async function suppressionFor(lead: { phone: string | null; email: string }, channel: "phone" | "whatsapp" | "email" | "sms", tx: Db = db) {
  const hashes = [lead.phone ? valueHash("phone", lead.phone) : null, lead.email ? valueHash("email", lead.email) : null].filter(Boolean) as string[];
  if (!hashes.length) return null;
  return tx.suppressionRecord.findFirst({ where: { valueHash: { in: hashes }, liftedAt: null, channel: { in: ["all", channel] } } });
}

export async function addSuppression(by: { id: string; name: string }, input: { value: string; channel: string; reason: string; leadId?: string | null }, tx: Db = db) {
  const k = keyOf(input.value);
  const channel = z.enum(SUPPRESSION_CHANNELS).parse(input.channel);
  const valueH = valueHash(k.kind, k.v);
  const existing = await tx.suppressionRecord.findFirst({ where: { valueHash: valueH, channel, liftedAt: null } });
  if (existing) return existing;
  const r = await tx.suppressionRecord.create({ data: { channel, valueHash: valueH, hint: k.hint, reason: input.reason.slice(0, 40), leadId: input.leadId ?? null, createdBy: by.id } });
  if (input.leadId) await activity(tx, input.leadId, "consent", `Added to do-not-contact (${channel}): ${input.reason}`, by, r.id);
  return r;
}

export const suppressionSchema = z.object({ value: z.string().min(3).max(200), channel: z.enum(SUPPRESSION_CHANNELS), reason: z.string().trim().min(2).max(40), leadId: z.string().uuid().optional() });
export async function suppress(a: Actor, raw: z.input<typeof suppressionSchema>) {
  need(a, "consent.record");
  const i = suppressionSchema.parse(raw);
  if (i.leadId) await findLead(a, i.leadId);
  const r = await db.$transaction(async (tx) => {
    const r = await addSuppression(a, i, tx);
    // Revoke any consent on the suppressed channel(s) for that lead.
    if (i.leadId) await tx.contactConsent.updateMany({ where: { leadId: i.leadId, revokedAt: null, ...(i.channel === "all" ? {} : { channel: i.channel }) }, data: { revokedAt: new Date(), revokedBy: a.id, revokeNote: "Do-not-contact: " + i.reason } });
    return r;
  });
  await gaudit(a, "Suppression added", "suppression", r.id, `${r.hint} · ${r.channel} · ${r.reason}`);
  return r.id;
}

export async function liftSuppression(a: Actor, id: string, note: string) {
  need(a, "compliance.manage");
  const n = z.string().trim().min(5, "Say why the do-not-contact entry is lifted (e.g. written consent received).").max(300).parse(note);
  const r = await db.suppressionRecord.updateMany({ where: { id, liftedAt: null }, data: { liftedAt: new Date(), liftedBy: a.id, liftNote: n } });
  if (!r.count) throw new UserError("That entry is already lifted.");
  await gaudit(a, "Suppression lifted", "suppression", id, n);
}

// ── Consent
export const consentSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(CHANNELS),
  purpose: z.enum(["marketing", "service"]),
  scope: z.string().trim().max(300).default(""),
  lawfulBasis: z.enum(LAWFUL_BASES.map((b) => b[0]) as ["consent", "legitimate_use"]),
  evidence: z.string().trim().min(5, "Describe how consent was given (e.g. “Owner agreed on call 6 Nov to WhatsApp updates”).").max(500),
  source: z.enum(["call", "form", "inbound", "email", "visit", "other"]).default("call"),
});
export async function recordConsent(a: Actor, raw: z.input<typeof consentSchema>) {
  need(a, "consent.record");
  const i = consentSchema.parse(raw);
  const lead = await findLead(a, i.leadId);
  const sup = await suppressionFor(lead, i.channel);
  if (sup) throw new UserError(`This contact is on the do-not-contact list (${sup.reason}). A compliance admin must lift it first, with a reason.`);
  const c = await db.$transaction(async (tx) => {
    const c = await tx.contactConsent.create({ data: { ...i, recordedBy: a.id } });
    await activity(tx, lead.id, "consent", `Consent recorded: ${i.channel} · ${i.purpose} (${i.lawfulBasis}). ${i.evidence}`, a, c.id);
    if (i.channel === "phone" && i.purpose === "marketing" && lead.stage === "CONTACT_PERMISSION_PENDING") await tx.pharmacyLead.update({ where: { id: lead.id }, data: { stage: "CONTACT_AUTHORIZED" } });
    return c;
  });
  await gaudit(a, "Consent recorded", "consent", c.id, `${lead.code} · ${i.channel}/${i.purpose}`);
  return c.id;
}

export async function revokeConsent(a: Actor, id: string, note: string) {
  need(a, "consent.record");
  const c = await db.contactConsent.findUnique({ where: { id } });
  if (!c || c.revokedAt) throw new UserError("Consent not found or already revoked.");
  await findLead(a, c.leadId);
  await db.$transaction(async (tx) => {
    await tx.contactConsent.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: a.id, revokeNote: note.trim().slice(0, 300) || "Revoked" } });
    await activity(tx, c.leadId, "consent", `Consent revoked: ${c.channel} · ${c.purpose}. ${note}`, a, id);
  });
  await gaudit(a, "Consent revoked", "consent", id, note);
}

export async function hasConsent(leadId: string, channel: string, purpose = "marketing", tx: Db = db) {
  return !!(await tx.contactConsent.findFirst({ where: { leadId, channel, purpose, revokedAt: null } }));
}

/** Why a call to this lead isn't allowed right now, or null. */
export async function callBlocker(lead: { id: string; phone: string | null; email: string; stage: string }, tx: Db = db): Promise<string | null> {
  if (lead.stage === "DO_NOT_CONTACT") return "This pharmacy asked not to be contacted.";
  if (!lead.phone) return "This lead has no valid phone number.";
  if (await suppressionFor(lead, "phone", tx)) return "This number is on the do-not-contact list.";
  const p = await policy();
  if (p.callPolicy === "authorized_only" && lead.stage !== "CONTACT_AUTHORIZED" && !(await hasConsent(lead.id, "phone", "marketing", tx))) return "Calls need recorded permission first (contact policy: authorised contacts only).";
  return null;
}

/** Why a marketing message on this channel isn't allowed, or null. Promotional messages always need consent. */
export async function messageBlocker(lead: { id: string; phone: string | null; email: string; stage: string; erasedAt?: Date | null }, channel: "whatsapp" | "email", tx: Db = db) {
  if (lead.erasedAt) return "erased";
  if (lead.stage === "DO_NOT_CONTACT") return "do not contact";
  if (channel === "whatsapp" && !lead.phone) return "no phone";
  if (channel === "email" && !lead.email) return "no email";
  if (await suppressionFor(lead, channel, tx)) return "suppressed";
  if (!(await hasConsent(lead.id, channel, "marketing", tx))) return "no consent";
  return null;
}

// ── Erasure (DPDP right to erasure) and retention
export async function eraseLead(a: Actor, id: string, reason: string) {
  need(a, "compliance.manage");
  const why = z.string().trim().min(5, "Give the reason (e.g. erasure request received by email on 6 Nov).").max(300).parse(reason);
  const lead = await findLead(a, id);
  if (lead.erasedAt) throw new UserError("This lead is already erased.");
  await db.$transaction(async (tx) => {
    // Keep a do-not-contact entry (hash only) so the pharmacy isn't re-imported and contacted again.
    if (lead.phone) await addSuppression(a, { value: lead.phone, channel: "all", reason: "erasure", leadId: null }, tx);
    if (lead.email) await addSuppression(a, { value: lead.email, channel: "all", reason: "erasure", leadId: null }, tx);
    await tx.pharmacyLead.update({ where: { id }, data: { name: "Erased lead", nameKey: "", ownerName: "", phone: null, phoneRaw: "", email: "", website: "", domain: "", address: "", lat: null, lng: null, sourceUrl: "", erasedAt: new Date(), deletedAt: new Date(), stage: "DO_NOT_CONTACT", assignedStaffId: null } });
    await tx.pharmacyContact.updateMany({ where: { leadId: id }, data: { name: "Erased", phone: null, email: "", deletedAt: new Date() } });
    await tx.leadNote.updateMany({ where: { leadId: id }, data: { text: "[erased]", deletedAt: new Date() } });
    await tx.callSession.updateMany({ where: { leadId: id }, data: { notes: "[erased]", phone: "erased" } });
    await tx.leadAssignment.updateMany({ where: { leadId: id, active: true }, data: { active: false, activeLeadKey: null, endedAt: new Date(), endedById: a.id, endReason: "erased" } });
    await tx.followUpTask.updateMany({ where: { leadId: id, status: "open" }, data: { status: "cancelled" } });
    const convs = await tx.messageConversation.findMany({ where: { leadId: id }, select: { id: true } });
    await tx.messageEvent.updateMany({ where: { conversationId: { in: convs.map((c) => c.id) } }, data: { body: "[erased]" } });
    await tx.messageConversation.updateMany({ where: { leadId: id }, data: { address: "erased:" + id, leadId: null } });
    await activity(tx, id, "erased", "Personal data erased on request. Activity counts are kept without contact details.", a);
  });
  await gaudit(a, "Lead erased", "lead", id, `${lead.code} · ${why}`);
}

/** Leads past the retention period: no activity, not converted, not assigned. */
export async function retentionCandidates(now = new Date()) {
  const p = await policy();
  if (!p.retentionMonths) return { months: 0, leads: [] as { id: string; code: string; name: string; updatedAt: Date }[] };
  const cutoff = new Date(now.getTime() - p.retentionMonths * 30 * 86_400_000);
  const leads = await db.pharmacyLead.findMany({
    where: { deletedAt: null, erasedAt: null, assignedStaffId: null, stage: { notIn: ["CONVERTED", "TRIAL_STARTED", "NEGOTIATION"] }, updatedAt: { lt: cutoff }, activities: { none: { at: { gte: cutoff } } } },
    select: { id: true, code: true, name: true, updatedAt: true }, take: 500, orderBy: { updatedAt: "asc" },
  });
  return { months: p.retentionMonths, leads };
}
export async function runRetention(a: Actor) {
  need(a, "compliance.manage");
  const { leads } = await retentionCandidates();
  for (const l of leads) await eraseLead(a, l.id, `Retention policy: no activity for the retention period`);
  return leads.length;
}

/** Compliance centre: recent consents, the do-not-contact list and the audit trail. */
export async function complianceOverview(a: Actor) {
  need(a, "compliance.view");
  const [consents, suppressions, audit, counts, p, retention] = await Promise.all([
    db.contactConsent.findMany({ orderBy: { grantedAt: "desc" }, take: 100 }),
    db.suppressionRecord.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.growthAuditLog.findMany({ orderBy: { at: "desc" }, take: 150 }),
    db.contactConsent.groupBy({ by: ["channel"], where: { revokedAt: null }, _count: true }),
    policy(),
    retentionCandidates(),
  ]);
  const leads = await db.pharmacyLead.findMany({ where: { id: { in: [...new Set([...consents.map((c) => c.leadId), ...suppressions.map((s) => s.leadId).filter(Boolean) as string[]])] } }, select: { id: true, code: true, name: true } });
  return { consents, suppressions, audit, activeConsents: Object.fromEntries(counts.map((c) => [c.channel, c._count])), policy: p, retention: { months: retention.months, count: retention.leads.length, sample: retention.leads.slice(0, 20) }, leads: Object.fromEntries(leads.map((l) => [l.id, l])) };
}
