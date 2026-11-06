import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { activity, findLead, gaudit, leadScope, need, outbox, type Actor } from "./access";
import { LOST_REASONS, STAGE_IDS, STAGES, type Stage } from "./constants";
import { addSuppression } from "./compliance";
import { recordConversion } from "./calls";
import { rescore, staffNames } from "./leads";
import { syncNextFollowUp } from "./followups";
import { isMobile } from "./normalize";

export async function board(a: Actor, opts: { staffId?: string; state?: string } = {}) {
  need(a, "leads.view");
  const where = { AND: [leadScope(a), { erasedAt: null }, ...(opts.staffId ? [{ assignedStaffId: opts.staffId }] : []), ...(opts.state ? [{ state: opts.state }] : [])] };
  const [counts, rows] = await Promise.all([
    db.pharmacyLead.groupBy({ by: ["stage"], where, _count: true }),
    Promise.all(STAGES.map(([s]) => db.pharmacyLead.findMany({ where: { AND: [where, { stage: s }] }, orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { score: "desc" }], take: 40, select: { id: true, code: true, name: true, city: true, score: true, assignedStaffId: true, nextFollowUpAt: true, stage: true, lostReason: true } }))),
  ]);
  const names = await staffNames(rows.flat().map((r) => r.assignedStaffId));
  return STAGES.map(([id, label], i) => ({ id, label, count: counts.find((c) => c.stage === id)?._count ?? 0, leads: rows[i].map((r) => ({ ...r, nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null, assignee: r.assignedStaffId ? names.get(r.assignedStaffId) ?? "" : "" })) }));
}

export const stageSchema = z.object({ stage: z.enum(STAGE_IDS), lostReason: z.enum(LOST_REASONS).optional(), note: z.string().trim().max(500).default("") });
/** Moves a lead to any stage by hand. Converted is reached through a conversion record; Do not contact adds a suppression. */
export async function setStage(a: Actor, leadId: string, raw: z.input<typeof stageSchema>) {
  need(a, "leads.edit");
  const i = stageSchema.parse(raw);
  const lead = await findLead(a, leadId);
  if (i.stage === lead.stage) return;
  if (lead.stage === "DO_NOT_CONTACT" && a.growthRole !== "admin") throw new UserError("Only a super admin can reopen a do-not-contact lead (after lifting the suppression in Compliance).");
  if (i.stage === "CONVERTED") throw new UserError("Record the conversion (plan and amount) to mark a lead converted.");
  if (i.stage === "LOST" && !i.lostReason) throw new UserError("Choose why the lead was lost.");
  if (a.growthRole === "sales" && lead.assignedStaffId !== a.id) throw new UserError("You can only move your own leads.");
  await db.$transaction(async (tx) => {
    await tx.pharmacyLead.update({ where: { id: leadId }, data: { stage: i.stage as Stage, lostReason: i.stage === "LOST" ? i.lostReason : null } });
    if (i.stage === "DO_NOT_CONTACT") {
      if (lead.phone) await addSuppression(a, { value: lead.phone, channel: "all", reason: "dnc_request", leadId }, tx);
      if (lead.email) await addSuppression(a, { value: lead.email, channel: "all", reason: "dnc_request", leadId }, tx);
      await tx.followUpTask.updateMany({ where: { leadId, status: "open" }, data: { status: "cancelled" } });
      await tx.contactConsent.updateMany({ where: { leadId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: a.id, revokeNote: "Do not contact" } });
      await syncNextFollowUp(tx, leadId);
    }
    if (i.stage === "LOST") await tx.salesDeal.updateMany({ where: { leadId, status: "open" }, data: { status: "lost" } });
    await activity(tx, leadId, "stage", `Stage: ${lead.stage} → ${i.stage}${i.lostReason ? ` (${i.lostReason})` : ""}${i.note ? " · " + i.note : ""}`, a);
    await outbox(tx, "lead.stage", { leadId, from: lead.stage, to: i.stage, staffId: a.id });
  });
  await gaudit(a, "Stage changed", "lead", leadId, `${lead.code} ${lead.stage} → ${i.stage}`);
}

export const demoSchema = z.object({ leadId: z.string().uuid(), at: z.string().datetime({ offset: true }), mode: z.enum(["phone", "video", "visit"]), notes: z.string().trim().max(500).default("") });
export async function bookDemo(a: Actor, raw: z.input<typeof demoSchema>) {
  need(a, "leads.edit");
  const i = demoSchema.parse(raw);
  const lead = await findLead(a, i.leadId);
  if (lead.stage === "DO_NOT_CONTACT") throw new UserError("This pharmacy asked not to be contacted.");
  const staffId = lead.assignedStaffId ?? a.id;
  await db.$transaction(async (tx) => {
    const d = await tx.demoBooking.create({ data: { leadId: lead.id, staffId, at: new Date(i.at), mode: i.mode, notes: i.notes } });
    if (["NEW_LEAD", "RESEARCH_PENDING", "QUALIFIED", "ASSIGNED", "CONTACT_PERMISSION_PENDING", "CONTACT_AUTHORIZED", "FIRST_CONTACT", "INTERESTED"].includes(lead.stage)) await tx.pharmacyLead.update({ where: { id: lead.id }, data: { stage: "DEMO_SCHEDULED" } });
    await activity(tx, lead.id, "demo", `Demo booked for ${i.at.slice(0, 16).replace("T", " ")} (${i.mode})`, a, d.id);
    await rescore(tx, lead.id);
  });
}

export async function updateDemo(a: Actor, id: string, status: "completed" | "no_show" | "cancelled", notes = "") {
  need(a, "leads.edit");
  const d = await db.demoBooking.findUnique({ where: { id } });
  if (!d) throw new UserError("Demo not found.");
  const lead = await findLead(a, d.leadId);
  if (d.status !== "scheduled") throw new UserError("This demo is already closed.");
  await db.$transaction(async (tx) => {
    await tx.demoBooking.update({ where: { id }, data: { status, completedAt: status === "completed" ? new Date() : null, notes: notes ? `${d.notes}\n${notes}`.trim() : d.notes } });
    if (status === "completed" && lead.stage === "DEMO_SCHEDULED") await tx.pharmacyLead.update({ where: { id: lead.id }, data: { stage: "DEMO_COMPLETED" } });
    await activity(tx, lead.id, "demo", `Demo ${status.replace("_", "-")}${notes ? ": " + notes : ""}`, a, id);
    await rescore(tx, lead.id);
  });
}

export const conversionSchema = z.object({ product: z.enum(["starter", "pro", "multi"]), cycle: z.enum(["m", "y"]), amountRupees: z.coerce.number<string | number>().min(0).max(10_000_000), reference: z.string().trim().max(120).default(""), notes: z.string().trim().max(500).default("") });
export async function convertLead(a: Actor, leadId: string, raw: z.input<typeof conversionSchema>) {
  need(a, "leads.edit");
  const i = conversionSchema.parse(raw);
  const lead = await findLead(a, leadId);
  if (a.growthRole === "sales" && lead.assignedStaffId !== a.id) throw new UserError("You can only convert your own leads.");
  await db.$transaction(async (tx) => { await recordConversion(tx, a, leadId, i); await rescore(tx, leadId); });
  await gaudit(a, "Lead converted", "lead", leadId, `${lead.code} · ${i.product}/${i.cycle} · ₹${i.amountRupees}`);
}

export async function startTrial(a: Actor, leadId: string) {
  need(a, "leads.edit");
  const lead = await findLead(a, leadId);
  if (["CONVERTED", "DO_NOT_CONTACT"].includes(lead.stage)) throw new UserError("This lead can’t start a trial.");
  await db.$transaction(async (tx) => {
    await tx.pharmacyLead.update({ where: { id: leadId }, data: { stage: "TRIAL_STARTED" } });
    await activity(tx, leadId, "stage", `Trial started (${a.name})`, a);
  });
}

/**
 * Hands a qualified lead to the staff console's own sales pipeline (Lead → won → CpSale → commission), so the existing
 * commission and payment-verification flow applies. Needs a mobile number, which that pipeline is keyed on.
 */
export async function handOffToPipeline(a: Actor, leadId: string, product: "starter" | "pro" | "multi") {
  need(a, "leads.edit");
  const lead = await findLead(a, leadId);
  if (lead.pipelineLeadId) throw new UserError("Already in the sales pipeline.");
  if (!isMobile(lead.phone)) throw new UserError("The sales pipeline needs a mobile number for the pharmacy.");
  const owner = lead.assignedStaffId ?? a.id;
  const ownerUser = await db.staffUser.findUnique({ where: { id: owner } });
  if (!ownerUser || !["sales", "super_admin"].includes(ownerUser.role)) throw new UserError("The assigned employee needs a Sales staff profile to own a pipeline deal.");
  const mobile = lead.phone!.slice(3);
  if (await db.lead.findUnique({ where: { phone: mobile } })) throw new UserError("This mobile is already a lead in the sales pipeline.");
  const pl = await db.$transaction(async (tx) => {
    const n = await nextSeq(tx, "_cp", "LEAD");
    const stage = ["DEMO_SCHEDULED", "DEMO_COMPLETED"].includes(lead.stage) ? "demo" : ["TRIAL_STARTED", "NEGOTIATION"].includes(lead.stage) ? "trial" : "contacted";
    const pl = await tx.lead.create({ data: { code: `L-${n}`, name: lead.name, owner: lead.ownerName || "—", phone: mobile, city: lead.city || "—", source: "Field visit", product, stage, nextOn: dateOnly(addDays(todayISO(), 1)), staffId: owner, email: lead.email } });
    await tx.leadLog.create({ data: { leadId: pl.id, staffId: a.id, text: `From Growth Intelligence ${lead.code} by ${a.name}` } });
    await tx.pharmacyLead.update({ where: { id: leadId }, data: { pipelineLeadId: pl.id } });
    await activity(tx, leadId, "stage", `Handed off to the sales pipeline as ${pl.code}`, a, pl.id);
    return pl;
  });
  await gaudit(a, "Handed off to sales pipeline", "lead", leadId, `${lead.code} → ${pl.code}`);
  return pl.code;
}
