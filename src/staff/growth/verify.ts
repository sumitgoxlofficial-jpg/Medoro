import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { activity, findLead, gaudit, leadScope, need, type Actor } from "./access";
import { nameKey } from "./normalize";
import { rescore, syncVerification } from "./leads";
import { safeFetchText, UnsafeUrl } from "./safe-fetch";

const KIND_FIELD = { business: "businessVerifiedAt", phone: "phoneVerifiedAt", email: "emailVerifiedAt", website: "websiteVerifiedAt", location: "locationVerifiedAt" } as const;
export type VerifyKind = keyof typeof KIND_FIELD;
export const METHODS = {
  business: [["document", "Drug licence / GST number checked"], ["field_visit", "Field visit"], ["call_confirmed", "Owner confirmed on a call"], ["manual_review", "Official record reviewed"]],
  phone: [["call_confirmed", "Called; the pharmacy answered"]],
  email: [["email_reply", "Reply received from this address"], ["manual_review", "Address published on the pharmacy’s own site"]],
  website: [["manual_review", "Opened and checked by hand"]],
  location: [["field_visit", "Field visit"], ["call_confirmed", "Address confirmed on a call"], ["manual_review", "Map / official record reviewed"]],
} as const;

export const verifySchema = z.object({
  kind: z.enum(["business", "phone", "email", "website", "location"]),
  method: z.string().max(40),
  detail: z.string().trim().min(10, "Describe the evidence (at least 10 characters): what was checked and what it showed.").max(500),
  url: z.string().trim().max(500).default(""),
});

/** Records a verification with its evidence. Without evidence nothing is marked verified. */
export async function verifyLead(a: Actor, leadId: string, raw: z.input<typeof verifySchema>) {
  need(a, "leads.verify");
  const i = verifySchema.parse(raw);
  if (!(METHODS[i.kind] as readonly (readonly string[])[]).some((m) => m[0] === i.method)) throw new UserError("Choose how this was verified.");
  const l = await findLead(a, leadId);
  if (i.kind === "phone" && !l.phone) throw new UserError("This lead has no valid phone number to verify.");
  if (i.kind === "email" && !l.email) throw new UserError("This lead has no email to verify.");
  if (i.kind === "website" && !l.website) throw new UserError("This lead has no website to verify.");
  await db.$transaction(async (tx) => {
    await tx.leadEvidence.create({ data: { leadId, kind: i.kind, method: i.method, result: "verified", detail: i.detail, url: i.url, byStaffId: a.id } });
    await tx.pharmacyLead.update({ where: { id: leadId }, data: { [KIND_FIELD[i.kind]]: new Date() } });
    await activity(tx, leadId, "verified", `${i.kind[0].toUpperCase() + i.kind.slice(1)} verified (${i.method.replace(/_/g, " ")}): ${i.detail}`, a);
    await syncVerification(tx, leadId);
    await rescore(tx, leadId);
  });
  await gaudit(a, "Lead verified", "lead", leadId, `${l.code} · ${i.kind} · ${i.method}`);
}

export async function withdrawVerification(a: Actor, leadId: string, kind: VerifyKind, reason: string) {
  need(a, "leads.verify");
  const why = z.string().trim().min(5).max(300).parse(reason);
  const l = await findLead(a, leadId);
  await db.$transaction(async (tx) => {
    await tx.leadEvidence.create({ data: { leadId, kind, method: "manual_review", result: "withdrawn", detail: why, byStaffId: a.id } });
    await tx.pharmacyLead.update({ where: { id: leadId }, data: { [KIND_FIELD[kind]]: null } });
    await activity(tx, leadId, "verified", `${kind} verification withdrawn: ${why}`, a);
    await syncVerification(tx, leadId);
    await rescore(tx, leadId);
  });
  await gaudit(a, "Verification withdrawn", "lead", leadId, `${l.code} · ${kind}`);
}

/**
 * Fetches the lead's website (SSRF-safe) and marks it verified only if it answers and the page names the pharmacy or shows
 * its phone number. Records the result as evidence either way.
 */
export async function checkWebsite(a: Actor, leadId: string, opts: Parameters<typeof safeFetchText>[1] = {}) {
  need(a, "leads.verify");
  const l = await findLead(a, leadId);
  if (!l.website) throw new UserError("This lead has no website.");
  let verified = false, detail: string;
  try {
    const r = await safeFetchText(l.website, opts);
    const text = r.text.toLowerCase().replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
    const key = nameKey(l.name);
    const words = l.name.toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w.length >= 4 && !/^(medical|medicals|store|stores|pharmacy|chemist|chemists|general)$/.test(w));
    const squashed = text.replace(/[^a-z0-9ऀ-ॿ]/g, "");
    const nameHit = (key.length >= 4 && squashed.includes(key)) || (words.length > 0 && words.every((w) => text.includes(w)));
    const phoneHit = !!l.phone && squashed.includes(l.phone.slice(-8));
    if (r.status < 200 || r.status >= 300) detail = `Website answered HTTP ${r.status}.`;
    else if (nameHit || phoneHit) { verified = true; detail = `Website answered and shows ${nameHit ? "the pharmacy name" : ""}${nameHit && phoneHit ? " and " : ""}${phoneHit ? "its phone number" : ""}.`; }
    else detail = "Website answered, but the page doesn’t mention this pharmacy’s name or phone.";
  } catch (e) {
    detail = e instanceof UnsafeUrl ? e.message : "The website couldn’t be reached.";
  }
  await db.$transaction(async (tx) => {
    await tx.leadEvidence.create({ data: { leadId, kind: "website", method: "website_fetch", result: verified ? "verified" : "failed", detail, url: l.website, byStaffId: a.id } });
    if (verified) await tx.pharmacyLead.update({ where: { id: leadId }, data: { websiteVerifiedAt: new Date() } });
    await activity(tx, leadId, "verified", `Website check: ${detail}`, a);
    await syncVerification(tx, leadId);
    await rescore(tx, leadId);
  });
  await gaudit(a, "Website checked", "lead", leadId, `${l.code} · ${verified ? "verified" : "not verified"}`);
  return { verified, detail };
}

export async function markInvalid(a: Actor, leadId: string, reason: string | null) {
  need(a, "leads.verify");
  const l = await findLead(a, leadId);
  const why = reason === null ? null : z.string().trim().min(5, "Say why the lead is invalid.").max(300).parse(reason);
  await db.$transaction(async (tx) => {
    await tx.pharmacyLead.update({ where: { id: leadId }, data: { invalidReason: why } });
    await tx.leadEvidence.create({ data: { leadId, kind: "business", method: "manual_review", result: why ? "failed" : "info", detail: why ? `Marked invalid: ${why}` : "Invalid mark cleared", byStaffId: a.id } });
    await activity(tx, leadId, "verified", why ? `Marked invalid: ${why}` : "Invalid mark cleared", a);
    await syncVerification(tx, leadId);
  });
  await gaudit(a, why ? "Lead marked invalid" : "Lead invalid mark cleared", "lead", leadId, l.code);
}

// ── Verification queue and duplicate review
export async function verificationQueue(a: Actor) {
  need(a, "leads.verify");
  const scope = leadScope(a);
  const [unverified, dupes, counts] = await Promise.all([
    db.pharmacyLead.findMany({ where: { AND: [scope, { verification: { in: ["UNVERIFIED", "PARTIALLY_VERIFIED", "PHONE_VERIFIED", "EMAIL_VERIFIED", "WEBSITE_VERIFIED"] }, businessVerifiedAt: null }] }, orderBy: [{ score: "desc" }, { createdAt: "asc" }], take: 100 }),
    db.leadDuplicateCandidate.findMany({ where: { status: "open" }, orderBy: [{ score: "desc" }, { createdAt: "asc" }], take: 100 }),
    db.pharmacyLead.groupBy({ by: ["verification"], where: scope, _count: true }),
  ]);
  const ids = [...new Set(dupes.flatMap((d) => [d.leadId, d.matchId]))];
  const leads = await db.pharmacyLead.findMany({ where: { AND: [{ id: { in: ids } }, scope] } });
  const byId = new Map(leads.map((l) => [l.id, l]));
  return {
    unverified,
    duplicates: dupes.filter((d) => byId.has(d.leadId) && byId.has(d.matchId)).map((d) => ({ ...d, lead: byId.get(d.leadId)!, match: byId.get(d.matchId)! })),
    counts: Object.fromEntries(counts.map((c) => [c.verification, c._count])),
  };
}

export async function dismissDuplicate(a: Actor, candidateId: string) {
  need(a, "leads.merge");
  const c = await db.leadDuplicateCandidate.findUnique({ where: { id: candidateId } });
  if (!c || c.status !== "open") throw new UserError("This match was already reviewed.");
  await findLead(a, c.leadId); await findLead(a, c.matchId);
  await db.$transaction(async (tx) => {
    await tx.leadDuplicateCandidate.update({ where: { id: c.id }, data: { status: "dismissed", decidedBy: a.id, decidedAt: new Date() } });
    const left = await tx.leadDuplicateCandidate.count({ where: { OR: [{ leadId: c.leadId }, { matchId: c.leadId }], status: "open" } });
    if (!left) await tx.pharmacyLead.update({ where: { id: c.leadId }, data: { possibleDuplicate: false } });
    await activity(tx, c.leadId, "merged", "Reviewed: not a duplicate", a);
  });
  await gaudit(a, "Duplicate dismissed", "lead", c.leadId, c.reason);
}

/**
 * Safe merge: `keepId` stays; the other record is kept as history (marked DUPLICATE, hidden from lists, its evidence and
 * timeline untouched). Only blank fields of the kept record are filled. Contacts, notes, calls, follow-ups, demos, consents
 * and conversations move to the kept record; call reports keep the employee who made them.
 */
export async function mergeDuplicate(a: Actor, candidateId: string, keepId: string) {
  need(a, "leads.merge");
  const c = await db.leadDuplicateCandidate.findUnique({ where: { id: candidateId } });
  if (!c || c.status !== "open") throw new UserError("This match was already reviewed.");
  if (keepId !== c.leadId && keepId !== c.matchId) throw new UserError("Keep one of the two records.");
  const dropId = keepId === c.leadId ? c.matchId : c.leadId;
  const keep = await findLead(a, keepId), drop = await findLead(a, dropId);
  await db.$transaction(async (tx) => {
    const fill: Prisma.PharmacyLeadUpdateInput = {};
    for (const k of ["ownerName", "phoneRaw", "email", "website", "domain", "address", "state", "district", "city", "pin", "sourceUrl"] as const) if (!keep[k] && drop[k]) (fill as Record<string, unknown>)[k] = drop[k];
    if (!keep.phone && drop.phone) fill.phone = drop.phone;
    if (keep.lat === null && drop.lat !== null) { fill.lat = drop.lat; fill.lng = drop.lng; }
    for (const k of ["businessVerifiedAt", "phoneVerifiedAt", "emailVerifiedAt", "websiteVerifiedAt", "locationVerifiedAt"] as const) {
      // A verification carries over only for a fact the kept record now has from the other one, or the same fact.
      const same = k === "phoneVerifiedAt" ? (fill.phone ?? keep.phone) === drop.phone : k === "emailVerifiedAt" ? (fill.email ?? keep.email) === drop.email : k === "websiteVerifiedAt" ? (fill.website ?? keep.website) === drop.website : true;
      if (!keep[k] && drop[k] && same) { (fill as Record<string, unknown>)[k] = drop[k]; await tx.leadEvidence.create({ data: { leadId: keepId, kind: k.replace("VerifiedAt", ""), method: "manual_review", result: "verified", detail: `Carried over from merged record ${drop.code}`, byStaffId: a.id } }); }
    }
    if (!keep.softwareStatus && drop.softwareStatus) fill.softwareStatus = drop.softwareStatus;
    if (!keep.lastContactedAt || (drop.lastContactedAt && drop.lastContactedAt > keep.lastContactedAt)) fill.lastContactedAt = drop.lastContactedAt;

    await tx.pharmacyContact.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    await tx.leadNote.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    await tx.callSession.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    await tx.followUpTask.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    await tx.demoBooking.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    await tx.contactConsent.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    await tx.messageConversation.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });
    if (!(await tx.conversionRecord.findUnique({ where: { leadId: keepId } }))) await tx.conversionRecord.updateMany({ where: { leadId: dropId }, data: { leadId: keepId } });

    // Assignment: the kept record keeps its assignee; if it has none it takes the other's.
    const dropAsg = await tx.leadAssignment.findFirst({ where: { leadId: dropId, active: true } });
    if (dropAsg) {
      await tx.leadAssignment.update({ where: { id: dropAsg.id }, data: { active: false, activeLeadKey: null, endedAt: new Date(), endedById: a.id, endReason: `merged into ${keep.code}` } });
      await tx.leadAssignmentHistory.create({ data: { leadId: dropId, action: "withdrawn", fromStaffId: dropAsg.staffId, byStaffId: a.id, reason: `merged into ${keep.code}` } });
      if (!keep.assignedStaffId) {
        await tx.leadAssignment.create({ data: { leadId: keepId, staffId: dropAsg.staffId, activeLeadKey: keepId, assignedById: a.id, dueAt: dropAsg.dueAt } });
        await tx.leadAssignmentHistory.create({ data: { leadId: keepId, action: "assigned", toStaffId: dropAsg.staffId, byStaffId: a.id, reason: `carried over from ${drop.code}` } });
        fill.assignedStaffId = dropAsg.staffId;
      }
    }
    await tx.pharmacyLead.update({ where: { id: keepId }, data: fill });
    await tx.pharmacyLead.update({ where: { id: dropId }, data: { duplicateOfId: keepId, verification: "DUPLICATE", deletedAt: new Date(), assignedStaffId: null, possibleDuplicate: false } });
    await tx.leadDuplicateCandidate.update({ where: { id: c.id }, data: { status: "merged", decidedBy: a.id, decidedAt: new Date() } });
    await tx.leadDuplicateCandidate.updateMany({ where: { status: "open", OR: [{ leadId: dropId }, { matchId: dropId }] }, data: { status: "dismissed", decidedBy: a.id, decidedAt: new Date() } });
    const left = await tx.leadDuplicateCandidate.count({ where: { OR: [{ leadId: keepId }, { matchId: keepId }], status: "open" } });
    if (!left) await tx.pharmacyLead.update({ where: { id: keepId }, data: { possibleDuplicate: false } });
    await activity(tx, keepId, "merged", `Merged ${drop.code} into this record (${c.reason}). Its history stays on ${drop.code}.`, a, dropId);
    await activity(tx, dropId, "merged", `Merged into ${keep.code}; kept as history.`, a, keepId);
    await syncVerification(tx, keepId);
    await rescore(tx, keepId);
  });
  await gaudit(a, "Duplicates merged", "lead", keepId, `${drop.code} → ${keep.code}`);
  return { keptCode: keep.code };
}


