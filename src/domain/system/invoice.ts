import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { mailEnabled, sendMail } from "@/server/mail";
import { compose } from "@/server/mail-template";
import { biller } from "@/lib/biller";
import { PRODUCTS } from "@/staff/constants";
import { subscriptionInvoicePdf, rs, type SubscriptionInvoice } from "./invoice-pdf";

/** Subscription invoices: one per paid payment, numbered MED-2026-00001, with no GST (none is charged). */

const eligible = (p: { status: string; amountPaise: number; provider: string }) => ["paid", "refunded"].includes(p.status) && p.amountPaise > 0 && p.provider !== "coupon";

/** Gives a paid payment its invoice number (once; the sequence never reuses a number). */
export async function ensureInvoiceNo(paymentRowId: string): Promise<string | null> {
  await db.$executeRaw`
    UPDATE "OnlinePayment" SET "invoiceNo" = 'MED-' || to_char(COALESCE("paidAt", now()) AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('"OnlinePayment_invoice_seq"')::text, 5, '0')
    WHERE id = ${paymentRowId} AND "invoiceNo" IS NULL AND status IN ('paid', 'refunded') AND "amountPaise" > 0`;
  return (await db.onlinePayment.findUnique({ where: { id: paymentRowId }, select: { invoiceNo: true } }))?.invoiceNo ?? null;
}

/** Who gets the invoice: the person who paid, else the pharmacy's owner. */
async function buyerEmail(tenantId: string, saved: string | null) {
  if (saved) return saved;
  const owner = await db.user.findFirst({ where: { tenantId, email: { not: null }, role: { name: "Owner" } }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return owner?.email ?? null;
}

/** The invoice for one of this pharmacy's payments, or null if it has none (unpaid, free or a coupon-only order). */
export async function invoiceOf(tenantId: string, id: string): Promise<(SubscriptionInvoice & { rowId: string; invoiceSentAt: string | null }) | null> {
  const p = await db.onlinePayment.findFirst({ where: { id, tenantId } });
  if (!p || !eligible(p)) return null;
  const invoiceNo = p.invoiceNo ?? (await ensureInvoiceNo(p.id));
  if (!invoiceNo) return null;
  const [tenant, branch, email] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, legalName: true, gstin: true, phone: true } }),
    db.branch.findFirst({ where: { tenantId, address: { not: null } }, orderBy: { createdAt: "asc" }, select: { address: true } }),
    buyerEmail(tenantId, p.buyerEmail),
  ]);
  const product = PRODUCTS.find((x) => x.id === p.plan)?.name ?? p.plan;
  return {
    rowId: p.id, invoiceSentAt: p.invoiceSentAt?.toISOString() ?? null,
    invoiceNo, paidAt: (p.paidAt ?? p.createdAt).toISOString(), status: p.refundedAt || p.status === "refunded" ? "refunded" : "paid", refundedAt: p.refundedAt?.toISOString() ?? null,
    buyer: { pharmacy: tenant.name, legalName: tenant.legalName, address: branch?.address ?? null, gstin: tenant.gstin, phone: tenant.phone, name: p.createdBy, email },
    item: `Medoro ${product}${p.plan === "ai" ? "" : " plan"} · ${p.cycle === "y" ? "1 year" : "1 month"}`,
    periodFrom: p.periodFrom?.toISOString() ?? null, periodTo: p.periodTo?.toISOString() ?? null,
    listPaise: p.amountPaise + p.discountPaise, discountPaise: p.discountPaise, couponCode: p.couponCode, totalPaise: p.amountPaise,
    paymentId: p.paymentId, orderId: p.orderId, method: "Online (Razorpay)",
  };
}

export async function invoicePdfOf(tenantId: string, id: string) {
  const inv = await invoiceOf(tenantId, id);
  if (!inv) return null;
  return { inv, pdf: Buffer.from(await subscriptionInvoicePdf(inv, biller())) };
}

/** Emails the invoice with the PDF attached. `to` overrides the buyer's address (the person asking for a copy). */
export async function emailInvoice(tenantId: string, id: string, to?: string): Promise<{ to: string }> {
  if (!mailEnabled()) throw new UserError("Email isn’t set up on this server, so the invoice can’t be sent. Download the PDF instead.");
  const made = await invoicePdfOf(tenantId, id);
  if (!made) throw new UserError("There is no invoice for this payment.");
  const { inv, pdf } = made;
  const dest = to?.trim() || inv.buyer.email;
  if (!dest) throw new UserError("There is no email address on file for this payment. Add one to the owner’s profile and try again.");
  const from = biller();
  const subject = `Your Medoro invoice ${inv.invoiceNo}`;
  const m = compose({
    greeting: `Dear ${inv.buyer.name.split(/\s+/)[0] || "customer"},`,
    blocks: [
      { p: `Thank you for choosing Medoro. We have received your payment for ${inv.buyer.pharmacy}, and your invoice is attached to this email as a PDF.` },
      { facts: [["Invoice", inv.invoiceNo], ["For", inv.item], ...(inv.periodFrom && inv.periodTo ? [["Subscription period", `${new Date(inv.periodFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} to ${new Date(inv.periodTo).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}`]] as [string, string][] : []), ["Amount paid", rs(inv.totalPaise)], ["GST", "Not charged"]] },
      { p: `If anything on the invoice looks wrong, reply to this email or write to ${from.email}, and we will fix it quickly.` },
    ],
    signoff: { name: "Team Medoro" },
  }, subject);
  await sendMail({ to: dest, subject, ...m, attachments: [{ filename: `Invoice-${inv.invoiceNo}.pdf`, content: pdf, contentType: "application/pdf" }] });
  await db.onlinePayment.update({ where: { id: inv.rowId }, data: { invoiceSentAt: new Date() } });
  return { to: dest };
}

/** After a payment goes through: send the invoice, without ever failing the payment if email is down. */
export async function sendInvoiceQuietly(orderId: string) {
  try {
    if (!mailEnabled()) return;
    const p = await db.onlinePayment.findUnique({ where: { orderId }, select: { id: true, tenantId: true, invoiceSentAt: true, status: true, amountPaise: true, provider: true } });
    if (!p || p.invoiceSentAt || !eligible(p)) return;
    await emailInvoice(p.tenantId, p.id);
  } catch (e) {
    log.warn("subscription invoice email failed", { orderId, err: e });
  }
}
