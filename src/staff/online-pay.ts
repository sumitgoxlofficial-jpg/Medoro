import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { unseal } from "@/server/vault";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { payLinkBody, requestSignature } from "@/lib/licence";
import { normCode } from "@/domain/system/coupons";
import { RENEW_WINDOW_DAYS, quote, razorpayEnabled, renewal, rzpConfirm, rzpKeyId, rzpOrder, rzpRefund, type RzpPayment } from "@/domain/system/razorpay";
import { product } from "./constants";
import { rateFor } from "./sales";

/**
 * Paying Medoro online from a self-hosted or desktop installation, like FITRON for Windows: the owner presses
 * "Pay online" under Subscription; the app opens Medoro's /pay page with a link signed by its instance token
 * (valid 2 hours). The payment, confirmed by Razorpay's signature and again by its webhook, becomes a verified
 * renewal sale with an invoice and a later paid-until date, which the installation receives at its next check-in.
 */
const CP = "_cp";
const LINK_TTL_MS = 2 * 3600_000;

/** The installation behind a pay link, or a message the owner can act on. */
export async function payCustomer(l: string, s: string, now = Date.now()) {
  const fail = () => new UserError("This payment link has expired or isn’t complete. Open it again from Subscription in your Medoro app.");
  if (!/^[0-9a-f-]{36}$/i.test(String(l ?? ""))) throw fail();
  const [at] = String(s ?? "").split(".");
  if (!/^\d+$/.test(at ?? "") || now - Number(at) > LINK_TTL_MS || Number(at) - now > 5 * 60_000) throw fail();
  const c = await db.cpCustomer.findUnique({ where: { licenceId: l } });
  if (!c?.licenceToken) throw fail();
  const want = requestSignature(unseal(Buffer.from(c.licenceToken, "base64")).toString("utf8"), payLinkBody(l), Number(at));
  if (want.length !== s.length || !timingSafeEqual(Buffer.from(want), Buffer.from(s))) throw fail();
  return c;
}

export async function payPage(l: string, s: string) {
  const c = await payCustomer(l, s);
  const win = renewal(c.renewsOn ? { status: c.status, renewsAt: new Date(isoOf(c.renewsOn) + "T23:59:59+05:30") } : null);
  return { enabled: razorpayEnabled(), name: c.name, code: c.code, plan: c.product, cycle: c.cycle, status: c.status, renewsOn: c.renewsOn ? isoOf(c.renewsOn) : null, renewOpen: win.open, renewOpensOn: win.opensOn ? win.opensOn.toISOString().slice(0, 10) : null };
}

const pick = z.object({ plan: z.enum(["starter", "pro", "multi"]), cycle: z.enum(["m", "y"]), coupon: z.string().max(40).optional().default("") });

export async function cpQuote(l: string, s: string, raw: z.input<typeof pick>) {
  await payCustomer(l, s);
  return quote(pick.parse(raw));
}

/** Starts a payment: a Razorpay order for this installation's customer (a 100% coupon renews straight away). */
export async function cpStart(l: string, s: string, raw: z.input<typeof pick>) {
  const c = await payCustomer(l, s);
  if (!razorpayEnabled()) throw new UserError("Online payments aren’t switched on yet. Pay by UPI or bank transfer from Subscription in your app.");
  const i = pick.parse(raw);
  // Same rule as hosted pharmacies: a paid plan renews only in its last RENEW_WINDOW_DAYS days.
  const ends = c.renewsOn ? new Date(isoOf(c.renewsOn) + "T23:59:59+05:30") : null;
  const win = renewal(ends ? { status: c.status, renewsAt: ends } : null);
  if (!win.open) throw new UserError(`Your plan is paid until ${isoOf(c.renewsOn!)}. You can renew from ${win.opensOn!.toISOString().slice(0, 10)}, ${RENEW_WINDOW_DAYS} days before it ends.`);
  const price = await quote(i);
  const coupon = price.coupon?.code ?? null;
  const base = { customerId: c.id, plan: i.plan, cycle: i.cycle, amountPaise: price.total, gstPaise: price.gst, couponCode: coupon, discountPaise: price.discount };
  if (price.total === 0) {
    const orderId = `free_${randomBytes(12).toString("hex")}`;
    await db.cpOnlinePayment.create({ data: { ...base, orderId } });
    await settleCp(orderId, orderId);
    return { free: true as const };
  }
  // A second tap or tab gets the same open order.
  const open = await db.cpOnlinePayment.findFirst({ where: { customerId: c.id, status: "created", plan: i.plan, cycle: i.cycle, amountPaise: price.total, couponCode: coupon, createdAt: { gt: new Date(Date.now() - 30 * 60_000) }, NOT: { orderId: { startsWith: "free_" } } }, orderBy: { createdAt: "desc" } });
  const orderId = open?.orderId ?? await rzpOrder(price.total, `${c.code}-${randomBytes(4).toString("hex")}`, { kind: "licence", customer: c.code, plan: i.plan, cycle: i.cycle, ...(coupon ? { coupon } : {}) });
  if (!open) await db.cpOnlinePayment.create({ data: { ...base, orderId } });
  return {
    free: false as const, keyId: rzpKeyId(), orderId, amount: price.total, currency: "INR", name: "Medoro",
    description: `${price.name} · ${i.cycle === "y" ? "1 year" : "1 month"}${coupon ? ` · coupon ${coupon}` : ""}`,
    prefill: { name: c.owner || c.name, email: c.email, contact: c.phone }, notes: { pharmacy: `${c.name} (${c.code})` },
  };
}

export async function cpConfirm(l: string, s: string, i: { orderId: string; paymentId: string; signature: string }) {
  const c = await payCustomer(l, s);
  const p = await db.cpOnlinePayment.findUnique({ where: { orderId: String(i.orderId ?? "") } });
  if (!p || p.customerId !== c.id) throw new UserError("Payment not found.");
  if (p.status === "paid") return { applied: false, duplicate: false };
  const paymentId = await rzpConfirm(p.orderId, i.paymentId, i.signature, p.amountPaise);
  const r = await settleCp(p.orderId, paymentId);
  return { applied: r === "applied", duplicate: r === "duplicate" };
}

/** Checkout reported a failed attempt; the order stays open for another try. */
export async function cpFailed(l: string, s: string, i: { orderId: string; reason: string }) {
  const c = await payCustomer(l, s);
  await db.cpOnlinePayment.updateMany({ where: { orderId: String(i.orderId ?? ""), customerId: c.id, status: "created" }, data: { status: "failed", note: String(i.reason ?? "").slice(0, 300) || "Payment failed." } });
}

/** Applies a captured payment and refunds it straight away if it was a duplicate. */
async function settleCp(orderId: string, paymentId: string) {
  const r = await applyCpPaid(orderId, paymentId);
  if (r === "duplicate") {
    const p = await db.cpOnlinePayment.findUniqueOrThrow({ where: { orderId } });
    if (!p.amountPaise || orderId.startsWith("free_")) return r;
    try {
      const refundId = await rzpRefund(paymentId, p.amountPaise, { reason: "duplicate payment", order: orderId });
      await db.cpOnlinePayment.update({ where: { orderId }, data: { refundId } });
    } catch (e) {
      await db.cpOnlinePayment.update({ where: { orderId }, data: { note: `Paid twice. The automatic refund failed (${e instanceof Error ? e.message : "error"}); refund it from Razorpay.` } });
    }
  }
  return r;
}

/**
 * Marks the order paid, once: a verified renewal sale (with the sales person's commission), the customer's plan and
 * paid-until date (after the current period if it hasn't ended), Medoro's invoice, and the coupon's use.
 */
export async function applyCpPaid(orderId: string, paymentId: string): Promise<false | "applied" | "duplicate"> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CpOnlinePayment" WHERE "orderId" = ${orderId} AND "status" IN ('created', 'failed') FOR UPDATE`;
    if (!rows.length) return false;
    const p = await tx.cpOnlinePayment.findUniqueOrThrow({ where: { orderId } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cppay:" + p.customerId}))`;
    // A second payment minutes after the first (two tabs, a double tap) is refunded, not added on.
    const recent = await tx.cpOnlinePayment.findFirst({ where: { customerId: p.customerId, status: "paid", paidAt: { gt: new Date(Date.now() - 15 * 60_000) }, NOT: { id: p.id } } });
    if (recent) {
      await tx.cpOnlinePayment.update({ where: { orderId }, data: { status: "duplicate", paymentId, paidAt: new Date(), note: "Paid twice within minutes. Refunding." } });
      return "duplicate";
    }
    const c = await tx.cpCustomer.findUniqueOrThrow({ where: { id: p.customerId } });
    const today = todayISO();
    const from = c.renewsOn && isoOf(c.renewsOn) > today && c.status !== "cancelled" ? isoOf(c.renewsOn) : today;
    const renews = addDays(from, p.cycle === "y" ? 365 : 30);
    const before = p.amountPaise - p.gstPaise;
    const staffId = c.salesStaffId ?? "";
    const rate = staffId ? await rateFor(staffId, p.plan, "renewal") : 0;
    const free = p.amountPaise === 0;
    const sale = await tx.cpSale.create({
      data: { date: dateOnly(today), pharmacy: c.name, phone: c.phone, city: c.city, customerId: c.id, product: p.plan, cycle: p.cycle, type: "renewal", staffId, status: "verified", amountPaise: before, ratePct: rate, commissionPaise: Math.round((before * rate) / 100), verifiedBy: free ? "Coupon" : "Razorpay", verifiedAt: new Date(), payRef: free ? `coupon ${p.couponCode}` : paymentId },
    });
    await tx.cpCustomer.update({ where: { id: c.id }, data: { product: p.plan, cycle: p.cycle, status: "active", renewsOn: dateOnly(renews) } });
    const n = await nextSeq(tx, CP, "INVOICE");
    await tx.cpBillingEvent.create({
      data: { customerId: c.id, kind: "invoice", status: "done", number: `MED-${today.slice(0, 4)}-${String(n).padStart(5, "0")}`, amountPaise: before, gstPaise: p.gstPaise, reference: free ? null : paymentId, saleId: sale.id, byName: free ? "Coupon" : "Razorpay",
        detail: `${product(p.plan).name} · ${p.cycle === "y" ? "1 year" : "1 month"}, paid until ${renews} · paid online${p.couponCode ? ` · coupon ${p.couponCode}` : ""}` },
    });
    await tx.cpOnlinePayment.update({ where: { orderId }, data: { status: "paid", paymentId, paidAt: new Date(), saleId: sale.id } });
    if (p.couponCode) await tx.coupon.updateMany({ where: { code: normCode(p.couponCode) }, data: { uses: { increment: 1 } } });
    return "applied";
  });
}

/** Razorpay's webhook for a licence-server order, or null when the order isn't one. */
export async function cpWebhook(pay: RzpPayment & { error_description?: string }, event = "payment.captured"): Promise<string | null> {
  const p = await db.cpOnlinePayment.findUnique({ where: { orderId: pay.order_id } });
  if (!p) return null;
  if (event === "payment.failed") {
    await db.cpOnlinePayment.updateMany({ where: { orderId: p.orderId, status: "created" }, data: { status: "failed", note: pay.error_description?.slice(0, 300) || "Payment failed." } });
    return "failed recorded";
  }
  if (pay.status !== "captured") return "not captured";
  if (pay.amount !== p.amountPaise) return "amount mismatch";
  const r = await settleCp(p.orderId, pay.id);
  return r === "applied" ? "applied" : r === "duplicate" ? "duplicate refunded" : "already applied";
}
