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
import { quote, razorpayEnabled, rzpConfirm, rzpKeyId, rzpOrder, type RzpPayment } from "@/domain/system/razorpay";
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
  return { enabled: razorpayEnabled(), name: c.name, code: c.code, plan: c.product, cycle: c.cycle, status: c.status, renewsOn: c.renewsOn ? isoOf(c.renewsOn) : null };
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
  const price = await quote(i);
  const coupon = price.coupon?.code ?? null;
  const base = { customerId: c.id, plan: i.plan, cycle: i.cycle, amountPaise: price.total, gstPaise: price.gst, couponCode: coupon, discountPaise: price.discount };
  if (price.total === 0) {
    const orderId = `free_${randomBytes(12).toString("hex")}`;
    await db.cpOnlinePayment.create({ data: { ...base, orderId } });
    await applyCpPaid(orderId, orderId);
    return { free: true as const };
  }
  const orderId = await rzpOrder(price.total, `${c.code}-${randomBytes(4).toString("hex")}`, { kind: "licence", customer: c.code, plan: i.plan, cycle: i.cycle, ...(coupon ? { coupon } : {}) });
  await db.cpOnlinePayment.create({ data: { ...base, orderId } });
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
  if (p.status === "paid") return { applied: false };
  const paymentId = await rzpConfirm(p.orderId, i.paymentId, i.signature, p.amountPaise);
  return { applied: await applyCpPaid(p.orderId, paymentId) };
}

/**
 * Marks the order paid, once: a verified renewal sale (with the sales person's commission), the customer's plan and
 * paid-until date (after the current period if it hasn't ended), Medoro's invoice, and the coupon's use.
 */
export async function applyCpPaid(orderId: string, paymentId: string) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CpOnlinePayment" WHERE "orderId" = ${orderId} AND "status" = 'created' FOR UPDATE`;
    if (!rows.length) return false;
    const p = await tx.cpOnlinePayment.findUniqueOrThrow({ where: { orderId } });
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
    return true;
  });
}

/** Razorpay's webhook for a licence-server order, or null when the order isn't one. */
export async function cpWebhook(pay: RzpPayment): Promise<string | null> {
  const p = await db.cpOnlinePayment.findUnique({ where: { orderId: pay.order_id } });
  if (!p) return null;
  if (pay.amount !== p.amountPaise) return "amount mismatch";
  return (await applyCpPaid(p.orderId, pay.id)) ? "applied" : "already applied";
}
