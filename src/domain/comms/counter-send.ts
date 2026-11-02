import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { enforce } from "@/server/ratelimit";
import { authorize, requireSubscription, type Ctx } from "@/server/context";
import { MOBILE_RE, normPhone } from "@/domain/identity/contracts";
import { invoicePdf } from "@/domain/sales/pdf";
import { invoiceGrievance } from "@/domain/system/privacy";
import { driveModeOn } from "@/domain/system/drive-mode";
import { activeAccount, isPhone, markDisconnected, sendPhoneText, sendTemplate } from "./delivery";
import { GraphError } from "./graph";
import { clearOptOut, optedOut } from "./opt-outs";

/**
 * WhatsApp for Drive mode counters. The bill lives only on the counter, so the counter sends it here; Medoro makes
 * the invoice PDF, sends it through the pharmacy's WhatsApp (its linked phone, or the Meta Cloud API with the
 * approved invoice template) and keeps nothing: no message row, no PDF, no phone number. The counter is told at once
 * whether WhatsApp took it.
 */

const paise = z.number().int().min(-1_000_000_00).max(1_000_000_000_00);
export const counterBillSchema = z.object({
  /** One per press of Send: pressing again sends again; a retry of the same press doesn't. */
  sendId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  phone: z.string().trim().max(20),
  customerName: z.string().trim().max(80).default(""),
  customerGstin: z.string().trim().max(15).nullable().default(null),
  invoiceNo: z.string().trim().min(1).max(40),
  at: z.string().datetime(),
  lines: z.array(z.object({
    name: z.string().trim().min(1).max(120), batchNo: z.string().trim().max(40), expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    qtyText: z.string().trim().max(40), mrp: paise, discount: paise, gstRate: z.number().int().min(0).max(28), amount: paise,
  })).min(1).max(300),
  totals: z.object({ mrp: paise, discount: paise, taxable: paise, cgst: paise, sgst: paise, igst: paise, roundOff: paise, total: paise }),
  payments: z.array(z.object({ mode: z.string().trim().min(1).max(20) })).max(10),
});
export type CounterBill = z.input<typeof counterBillSchema>;

/** Whether a counter can send bills through the pharmacy's WhatsApp, and how. */
export async function counterWhatsAppState(ctx: Ctx) {
  const w = await activeAccount(ctx.tenantId);
  return w ? { connected: true as const, via: isPhone(w.cfg) ? ("phone" as const) : ("meta" as const), number: w.cfg.displayPhone ?? null } : { connected: false as const, via: null, number: null };
}

export async function sendCounterBill(ctx: Ctx, raw: CounterBill) {
  if (ctx.readOnly) throw new UserError("Medoro support access is read-only.");
  if (ctx.locked) throw new UserError("Subscription expired — renew from Plan to send messages.");
  if (!ctx.perms.includes("sale")) throw new UserError("Your role can’t send bills.");
  if (!(await driveModeOn(ctx.tenantId))) throw new UserError("Bills on Medoro’s server are sent from Billing, not from a counter.");
  const b = counterBillSchema.parse(raw);
  const phone = normPhone(b.phone);
  if (!MOBILE_RE.test(phone)) throw new UserError("Enter a valid 10-digit Indian mobile number.");
  await enforce("waSend", `${ctx.tenantId}:${ctx.userId}`);
  const w = await activeAccount(ctx.tenantId);
  if (!w) throw new UserError("WhatsApp isn’t connected for this pharmacy. Connect it under WhatsApp, or use Share on WhatsApp.");

  const [tenant, branch] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    db.branch.findFirst({ where: { id: ctx.branchId, tenantId: ctx.tenantId } }),
  ]);
  const pdf = {
    bytes: await invoicePdf({
      invoiceNo: b.invoiceNo, at: b.at, totals: b.totals, payments: b.payments, lines: b.lines,
      pharmacy: { name: tenant.name, legalName: tenant.legalName, address: branch?.address ?? null, gstin: branch?.gstin ?? tenant.gstin, dl: branch?.drugLicence ?? null, grievance: invoiceGrievance(tenant) as string | undefined },
      customer: b.customerName || b.customerGstin ? { name: b.customerName || "Customer", gstin: b.customerGstin } : null,
    }),
    filename: `${b.invoiceNo.replace(/[^A-Za-z0-9_-]/g, "-")}.pdf`,
  };
  const vars = [b.customerName || "Customer", b.invoiceNo, (b.totals.total / 100).toFixed(2)];
  try {
    if (isPhone(w.cfg)) await sendPhoneText(ctx.tenantId, { phone, ref: "counter", vars, key: `counter:${ctx.tenantId}:${b.sendId}`, pdf });
    else await sendTemplate(w, phone, { template: w.cfg.invoiceTemplate || "invoice_share", vars, n: 3, pdf });
  } catch (e) {
    // GraphError is a UserError too, so it is checked first.
    if (e instanceof GraphError) {
      // Meta revoked the token or the phone was signed out: pause and alert the owner, as for any other send.
      if (e.kind === "auth") await markDisconnected(ctx.tenantId, e.reason);
      throw new UserError(e.kind === "invalid" ? "This number isn’t on WhatsApp." : e.reason);
    }
    throw e;
  }
  return { sent: true as const, via: isPhone(w.cfg) ? ("phone" as const) : ("meta" as const) };
}

// ───────────── Store updates (campaigns) from a counter ─────────────

export const CAMPAIGN_BATCH_MAX = 25;
export const counterCampaignSchema = z.object({
  campaignId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** The first batch of a campaign counts as a campaign start (5 an hour, as on the server). */
  first: z.boolean().default(false),
  message: z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(3, "Write the update.").max(300, "Keep the update under 300 characters.")),
  recipients: z.array(z.object({
    id: z.string().min(1).max(64), name: z.string().trim().max(80), phone: z.string().trim().max(20),
    /** When the customer agreed to offers on WhatsApp (recorded on the counter). */
    consentAt: z.string().datetime(),
  })).min(1).max(CAMPAIGN_BATCH_MAX),
});
export type CounterCampaignBatch = z.input<typeof counterCampaignSchema>;
export type RecipientResult = { id: string; status: "sent" | "failed" | "opted_out" | "not_on_whatsapp"; error?: string };

/**
 * One batch of a store update from a Drive counter. The counter chooses the recipients (customers who agreed to offers
 * on WhatsApp, recorded on the counter) and keeps the campaign; Medoro checks the opt-out list, sends each message
 * through the pharmacy's WhatsApp and answers with each recipient's result. Nothing is stored.
 */
export async function sendCounterCampaign(ctx: Ctx, raw: CounterCampaignBatch): Promise<{ results: RecipientResult[] }> {
  if (ctx.readOnly) throw new UserError("Medoro support access is read-only.");
  requireSubscription(ctx);
  authorize(ctx, "integrations");
  if (!(await driveModeOn(ctx.tenantId))) throw new UserError("Send store updates from Customer messaging.");
  const c = counterCampaignSchema.parse(raw);
  if (c.first) await enforce("campaign", `${ctx.tenantId}:${ctx.userId}`);
  await enforce("campaignBatch", ctx.tenantId);
  const w = await activeAccount(ctx.tenantId);
  if (!w) throw new UserError("WhatsApp isn’t connected for this pharmacy. Connect it under WhatsApp first.");

  const people = c.recipients.map((r) => ({ ...r, phone: normPhone(r.phone) }));
  const out = await optedOut(ctx.tenantId, people.filter((p) => MOBILE_RE.test(p.phone)).map((p) => p.phone));
  const results: RecipientResult[] = [];
  for (const p of people) {
    if (!MOBILE_RE.test(p.phone)) { results.push({ id: p.id, status: "failed", error: "Not a valid mobile number" }); continue; }
    const stopAt = out.get(p.phone);
    if (stopAt) {
      // Consent given again at the counter after the STOP is the customer's latest choice.
      if (Date.parse(p.consentAt) <= stopAt.getTime()) { results.push({ id: p.id, status: "opted_out" }); continue; }
      await clearOptOut(ctx.tenantId, p.phone);
    }
    const vars = [p.name.split(" ")[0] || "Customer", c.message];
    try {
      if (isPhone(w.cfg)) await sendPhoneText(ctx.tenantId, { phone: p.phone, ref: `campaign:${c.campaignId}`, vars, key: `camp:${ctx.tenantId}:${c.campaignId}:${p.id}` });
      else await sendTemplate(w, p.phone, { template: "store_update", vars, n: 2 });
      results.push({ id: p.id, status: "sent" });
    } catch (e) {
      // A plain UserError (e.g. the store_update template isn't approved) fails every recipient the same way: stop and
      // say so. GraphError extends UserError, so it is told apart first.
      if (!(e instanceof GraphError)) throw e;
      if (e.kind === "auth") {
        // The token or the phone link is gone: stop here; the counter resumes the rest after a reconnect.
        await markDisconnected(ctx.tenantId, e.reason);
        results.push({ id: p.id, status: "failed", error: e.reason });
        break;
      }
      results.push({ id: p.id, status: e.kind === "invalid" ? "not_on_whatsapp" : /\bSTOP\b/.test(e.reason) ? "opted_out" : "failed", error: e.reason.slice(0, 160) });
    }
  }
  return { results };
}
