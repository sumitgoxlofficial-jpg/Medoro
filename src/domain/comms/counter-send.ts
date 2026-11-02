import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { enforce } from "@/server/ratelimit";
import type { Ctx } from "@/server/context";
import { MOBILE_RE, normPhone } from "@/domain/identity/contracts";
import { invoicePdf } from "@/domain/sales/pdf";
import { invoiceGrievance } from "@/domain/system/privacy";
import { driveModeOn } from "@/domain/system/drive-mode";
import { activeAccount, isPhone, markDisconnected, sendPhoneText, sendTemplate } from "./delivery";
import { GraphError } from "./graph";

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
    if (e instanceof UserError) throw e;
    if (e instanceof GraphError) {
      // Meta revoked the token or the phone was signed out: pause and alert the owner, as for any other send.
      if (e.kind === "auth") await markDisconnected(ctx.tenantId, e.reason);
      throw new UserError(e.kind === "invalid" ? "This number isn’t on WhatsApp." : e.reason);
    }
    throw e;
  }
  return { sent: true as const, via: isPhone(w.cfg) ? ("phone" as const) : ("meta" as const) };
}
