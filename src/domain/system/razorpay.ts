import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { PRODUCTS } from "@/staff/constants";
import { couponLabel, discountOf, normCode, usableCoupon } from "./coupons";

/**
 * Subscription payments on a hosted server (Medoro's own), with Razorpay Checkout: the owner picks a plan,
 * pays in Razorpay's window, and the paid period starts right away (or after the current one ends).
 * The browser's success callback and Razorpay's webhook both confirm the same order; whichever is first wins.
 *
 * Real-life rules: a plan that is paid for can be renewed only in its last RENEW_WINDOW_DAYS; an open order is reused
 * rather than starting a second one; a second payment that lands within minutes of the first (two tabs, a double tap)
 * is refunded automatically, for the amount actually paid; and failed attempts are recorded. There are no
 * change-of-mind refunds or cancellations after paying (the free trial is the try-before-you-buy, and nothing renews on
 * its own); see the Cancellation & refund policy at /legal#refund.
 */
export const RENEW_WINDOW_DAYS = 7;
const DUPLICATE_MS = 15 * 60_000;
const REUSE_ORDER_MS = 30 * 60_000;
const DAY = 86_400_000;
const API = "https://api.razorpay.com/v1";
export type RzpPayment = { id: string; order_id: string; amount: number; currency: string; status: string };
const cfg = () => ({
  keyId: process.env.RAZORPAY_KEY_ID?.trim() ?? "",
  secret: process.env.RAZORPAY_KEY_SECRET?.trim() ?? "",
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
});
export const razorpayEnabled = () => { const c = cfg(); return !!(c.keyId && c.secret); };

/** What can be bought online: the three plans, and the AI Pharmacy Manager add-on ("ai") on top of any of them. */
export const PAY_PLANS = ["starter", "pro", "multi", "ai"] as const;
export const orderSchema = z.object({ plan: z.enum(PAY_PLANS), cycle: z.enum(["m", "y"]), coupon: z.string().max(40).optional().default(""), aiConsent: z.boolean().optional() });
const isAi = (plan: string) => plan === "ai";

/** Whether the AI add-on is on: bought online and still paid for, or included by the licence (no end date). */
export const aiAddonActive = (meta: { addons: string[]; aiUntil: Date | null } | null, now = new Date()) =>
  !!meta && meta.addons.includes("ai") && (!meta.aiUntil || meta.aiUntil > now);

/** Price including 18% GST, in paise: list price, coupon discount, what is charged and the GST in it. Yearly is 10 months. */
export function planPrice(plan: (typeof PAY_PLANS)[number], cycle: "m" | "y", off: number | { percentOff: number; payPaise?: number | null } = 0) {
  const p = PRODUCTS.find((x) => x.id === plan)!;
  const list = (cycle === "y" ? p.m * 10 : p.m) * 100;
  const discount = discountOf(list, typeof off === "number" ? { percentOff: off } : off);
  const total = list - discount;
  return { name: p.name, list, discount, total, gst: total - Math.round(total / 1.18) };
}

/** The price with a coupon applied, for the Subscription page to show before paying. */
export async function quote(raw: z.input<typeof orderSchema>) {
  const { plan, cycle, coupon } = orderSchema.parse(raw);
  const c = coupon ? await usableCoupon(coupon, plan) : null;
  return { ...planPrice(plan, cycle, c ?? 0), coupon: c ? { code: c.code, percentOff: c.percentOff, payPaise: c.payPaise, label: couponLabel(c) } : null };
}

/** The new paid-until: one month or year after today, or after the current period if it runs later. */
export function extendPeriod(current: Date | null, cycle: "m" | "y", now = new Date()) {
  const from = current && current > now ? current : now;
  const to = new Date(from);
  if (cycle === "y") to.setUTCFullYear(to.getUTCFullYear() + 1);
  else to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const checkoutSignatureOk = (orderId: string, paymentId: string, signature: string, secret = cfg().secret) =>
  !!secret && sameHex(createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex"), String(signature ?? ""));
export const webhookSignatureOk = (body: string, signature: string | null, secret = cfg().webhookSecret) =>
  !!secret && !!signature && sameHex(createHmac("sha256", secret).update(body).digest("hex"), signature);

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const c = cfg();
  const res = await fetch(API + path, {
    method: init.method ?? "GET",
    headers: { Authorization: "Basic " + Buffer.from(`${c.keyId}:${c.secret}`).toString("base64"), "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new UserError("Couldn’t reach Razorpay. Check the internet connection and try again."); });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new UserError(`Razorpay: ${j.error?.description ?? `request failed (${res.status})`}`);
  return j;
}

/** A Razorpay order for `amount` paise (GST included). */
export async function rzpOrder(amount: number, receipt: string, notes: Record<string, string>) {
  const order = await api<{ id: string; amount: number }>("/orders", { method: "POST", body: { amount, currency: "INR", receipt: receipt.slice(0, 40), notes } });
  if (order.amount !== amount) throw new UserError("Razorpay returned a different amount. Nothing was charged.");
  return order.id;
}

/** Checkout's success callback, checked: the signature, then the payment itself (captured if only authorised). Returns the payment id. */
export async function rzpConfirm(orderId: string, paymentId: string, signature: string, amount: number) {
  if (!checkoutSignatureOk(orderId, paymentId, signature)) throw new UserError("The payment couldn’t be verified. If money was taken, it is confirmed automatically within a few minutes.");
  let pay = await api<RzpPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  if (pay.order_id !== orderId || pay.amount !== amount) throw new UserError("This payment doesn’t match the order.");
  if (pay.status === "authorized") pay = await api<RzpPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", body: { amount, currency: "INR" } });
  if (pay.status !== "captured") throw new UserError("Razorpay hasn’t completed this payment yet. It is confirmed automatically once it does.");
  return pay.id;
}

export const rzpKeyId = () => cfg().keyId;

/** Refunds a captured payment in full (or `amount` paise). Returns Razorpay's refund id. */
export async function rzpRefund(paymentId: string, amount: number, notes: Record<string, string>) {
  const r = await api<{ id: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: "POST", body: { amount, notes } });
  return r.id;
}

/** Whether a plan can be paid for now: during a trial, once cancelled or ended, or in the last days of a paid period. */
export function renewal(meta: { status: string; renewsAt: Date | null } | null, now = new Date()) {
  if (!meta || !meta.renewsAt || meta.status === "trial" || meta.status === "cancelled") return { open: true, opensOn: null as Date | null };
  const opensOn = new Date(meta.renewsAt.getTime() - RENEW_WINDOW_DAYS * DAY);
  return { open: now >= opensOn, opensOn };
}

const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Starts a payment: a Razorpay order for the chosen plan, and what the browser needs to open Checkout. */
export async function createOrder(ctx: Ctx, raw: z.input<typeof orderSchema>) {
  if (!razorpayEnabled()) throw new UserError("Online payments aren’t set up on this server.");
  const { plan, cycle, aiConsent } = orderSchema.parse(raw);
  const meta = await db.subscriptionMeta.findUnique({ where: { tenantId: ctx.tenantId } });
  if (isAi(plan)) {
    // The add-on rides on a plan, and sends business questions to an outside AI provider, which needs the owner's consent.
    if (!meta || meta.status === "cancelled" || (meta.renewsAt && meta.renewsAt < new Date())) throw new UserError("Your plan has ended. Renew it first, then add the AI add-on.");
    const r = renewal(meta.aiUntil && meta.aiUntil > new Date() ? { status: "active", renewsAt: meta.aiUntil } : null);
    if (!r.open) throw new UserError(`The AI add-on is paid until ${day(meta.aiUntil!)}. You can renew it from ${day(r.opensOn!)}.`);
    if (aiConsent !== true) throw new UserError("Tick the box to allow sending business questions to the AI provider.");
    // Loaded here: privacy → context → access → this module would otherwise be a cycle.
    const { savePrivacy } = await import("./privacy");
    await savePrivacy(ctx, { remoteAi: true });
  } else {
    const r = renewal(meta);
    if (!r.open) throw new UserError(`Your plan is paid until ${day(meta!.renewsAt!)}. You can renew from ${day(r.opensOn!)}, ${RENEW_WINDOW_DAYS} days before it ends.`);
  }
  const price = await quote(raw);
  const coupon = price.coupon?.code ?? null;
  const base = { tenantId: ctx.tenantId, plan, cycle, amountPaise: price.total, gstPaise: price.gst, couponCode: coupon, discountPaise: price.discount, createdBy: ctx.userName };
  if (price.total === 0) {
    // A 100% coupon: nothing to charge, so the plan starts without Razorpay.
    const orderId = `free_${randomBytes(12).toString("hex")}`;
    await db.onlinePayment.create({ data: { ...base, provider: "coupon", orderId } });
    await settle(orderId, orderId, ctx.userName);
    return { free: true as const };
  }
  const [tenant, user] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true, name: true } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, email: true, phone: true } }),
  ]);
  // A second tap or tab gets the same open order, so the pharmacy can't start paying twice.
  const open = await db.onlinePayment.findFirst({
    where: { tenantId: ctx.tenantId, status: "created", provider: "razorpay", plan, cycle, amountPaise: price.total, couponCode: coupon, createdAt: { gt: new Date(Date.now() - REUSE_ORDER_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const orderId = open?.orderId ?? await rzpOrder(price.total, `${tenant.code}-${randomBytes(4).toString("hex")}`, { tenantId: ctx.tenantId, pharmacy: tenant.code, plan, cycle, ...(coupon ? { coupon } : {}) });
  if (!open) await db.onlinePayment.create({ data: { ...base, orderId } });
  return {
    free: false as const, keyId: cfg().keyId, orderId, amount: price.total, currency: "INR",
    name: "Medoro", description: `${price.name} · ${cycle === "y" ? "1 year" : "1 month"}${coupon ? ` · coupon ${coupon}` : ""}`,
    prefill: { name: user.name, email: user.email ?? "", contact: user.phone ?? "" }, notes: { pharmacy: `${tenant.name} (${tenant.code})` },
  };
}

/**
 * Marks the order paid and extends the plan, once. Returns false when it was already applied, and "duplicate" when
 * another payment for this pharmacy went through minutes ago (that money is refunded by `settle`).
 */
export async function applyPaid(orderId: string, paymentId: string, by: string): Promise<false | "applied" | "duplicate"> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OnlinePayment" WHERE "orderId" = ${orderId} AND "status" IN ('created', 'failed') FOR UPDATE`;
    if (!rows.length) return false;
    const p = await tx.onlinePayment.findUniqueOrThrow({ where: { orderId } });
    // Serialise this pharmacy's payments, so two arriving together can't both extend the plan.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"pay:" + p.tenantId}))`;
    // Duplicates are the same kind of purchase (a plan, or the AI add-on) paid twice within minutes.
    const recent = await tx.onlinePayment.findFirst({ where: { tenantId: p.tenantId, status: "paid", paidAt: { gt: new Date(Date.now() - DUPLICATE_MS) }, NOT: { id: p.id }, ...(isAi(p.plan) ? { plan: "ai" } : { plan: { not: "ai" } }) } });
    if (recent) {
      await tx.onlinePayment.update({ where: { orderId }, data: { status: "duplicate", paymentId, paidAt: new Date(), note: `Paid twice: the plan was already paid ${Math.round((Date.now() - recent.paidAt!.getTime()) / 60_000)} min earlier. Refunding.` } });
      await writeAudit(tx, { tenantId: p.tenantId, userName: by, action: "Duplicate payment", entity: "subscription", entityId: p.id, detail: `₹${(p.amountPaise / 100).toLocaleString("en-IN")} · Razorpay ${paymentId} · refunded automatically` });
      return "duplicate";
    }
    const meta = await tx.subscriptionMeta.findUnique({ where: { tenantId: p.tenantId } });
    if (isAi(p.plan)) {
      const { from, to } = extendPeriod(meta?.aiUntil ?? null, p.cycle as "m" | "y");
      await tx.onlinePayment.update({ where: { orderId }, data: { status: "paid", paymentId, paidAt: new Date(), periodFrom: from, periodTo: to, note: null } });
      if (p.couponCode) await tx.coupon.updateMany({ where: { code: normCode(p.couponCode) }, data: { uses: { increment: 1 } } });
      await tx.subscriptionMeta.update({ where: { tenantId: p.tenantId }, data: { aiUntil: to, addons: meta!.addons.includes("ai") ? meta!.addons : [...meta!.addons, "ai"] } });
      await writeAudit(tx, { tenantId: p.tenantId, userName: by, action: "AI add-on paid", entity: "subscription", entityId: p.id, detail: `${p.cycle === "y" ? "1 year" : "1 month"} · ₹${(p.amountPaise / 100).toLocaleString("en-IN")}${p.couponCode ? ` (coupon ${p.couponCode})` : ""} · ${p.provider === "coupon" ? "no payment needed" : `Razorpay ${paymentId}`} · until ${to.toISOString().slice(0, 10)}` });
      await creditReferral(tx, p, paymentId);
      return "applied";
    }
    // A trial or plan that is still running keeps its remaining days; a cancelled plan restarts today.
    const { from, to } = extendPeriod(meta && meta.status !== "cancelled" ? meta.renewsAt : null, p.cycle as "m" | "y");
    const name = PRODUCTS.find((x) => x.id === p.plan)!.name;
    await tx.onlinePayment.update({ where: { orderId }, data: { status: "paid", paymentId, paidAt: new Date(), periodFrom: from, periodTo: to, note: null, prevStatus: meta?.status ?? null, prevRenewsAt: meta?.renewsAt ?? null } });
    if (p.couponCode) await tx.coupon.updateMany({ where: { code: normCode(p.couponCode) }, data: { uses: { increment: 1 } } });
    await tx.subscriptionMeta.upsert({
      where: { tenantId: p.tenantId },
      create: { tenantId: p.tenantId, plan: name, addons: [], status: "active", renewsAt: to },
      update: { plan: name, status: "active", renewsAt: to, graceUntil: null },
    });
    await writeAudit(tx, { tenantId: p.tenantId, userName: by, action: "Subscription paid", entity: "subscription", entityId: p.id, detail: `${name} · ${p.cycle === "y" ? "1 year" : "1 month"} · ₹${(p.amountPaise / 100).toLocaleString("en-IN")}${p.couponCode ? ` (coupon ${p.couponCode})` : ""} · ${p.provider === "coupon" ? "no payment needed" : `Razorpay ${paymentId}`} · paid until ${to.toISOString().slice(0, 10)}` });
    await creditReferral(tx, p, paymentId);
    return "applied";
  });
}

/** A pharmacy that signed up with a referral code: the sales person or reference partner earns commission on what it pays. */
async function creditReferral(tx: Tx, p: { id: string; tenantId: string; plan: string; cycle: string; amountPaise: number; gstPaise: number; provider: string }, paymentId: string) {
  if (p.provider === "coupon" || p.amountPaise <= 0) return;
  const t = await tx.tenant.findUnique({ where: { id: p.tenantId }, select: { name: true, phone: true, settings: true } });
  const ref = (t?.settings as { referral?: { staffId?: string } } | null)?.referral;
  if (!t || !ref?.staffId) return;
  const earlier = await tx.onlinePayment.count({ where: { tenantId: p.tenantId, status: "paid", amountPaise: { gt: 0 }, NOT: { id: p.id }, ...(isAi(p.plan) ? { plan: "ai" } : { plan: { not: "ai" } }) } });
  const { creditReferralTx } = await import("@/staff/sales");
  await creditReferralTx(tx, { staffId: ref.staffId, pharmacy: t.name, phone: t.phone ?? "", product: p.plan, cycle: p.cycle, firstPayment: earlier === 0, amountBeforeGstPaise: p.amountPaise - p.gstPaise, paymentId });
}

/** Applies a captured payment and refunds it straight away if it was a duplicate. */
async function settle(orderId: string, paymentId: string, by: string) {
  const r = await applyPaid(orderId, paymentId, by);
  if (r === "duplicate") {
    const p = await db.onlinePayment.findUniqueOrThrow({ where: { orderId } });
    if (p.provider === "coupon" || !p.amountPaise) return r;
    try {
      const refundId = await rzpRefund(paymentId, p.amountPaise, { reason: "duplicate payment", order: orderId });
      await db.onlinePayment.update({ where: { orderId }, data: { refundId, refundedAt: new Date() } });
    } catch (e) {
      // The money stays in the account until someone refunds it from Razorpay's dashboard; say so on the payment.
      await db.onlinePayment.update({ where: { orderId }, data: { note: `Paid twice. The automatic refund failed (${e instanceof Error ? e.message : "error"}); refund it from Razorpay.` } });
    }
  }
  return r;
}

/** The browser's Checkout success callback: verify the signature, make sure the money is captured, then apply. */
export async function confirmCheckout(ctx: Ctx, i: { orderId: string; paymentId: string; signature: string }) {
  const p = await db.onlinePayment.findUnique({ where: { orderId: String(i.orderId ?? "") } });
  if (!p || p.tenantId !== ctx.tenantId) throw new UserError("Payment not found.");
  if (p.status === "paid") return { applied: false, duplicate: false };
  const paymentId = await rzpConfirm(p.orderId, i.paymentId, i.signature, p.amountPaise);
  const r = await settle(p.orderId, paymentId, ctx.userName);
  return { applied: r === "applied", duplicate: r === "duplicate" };
}

/** Checkout reported a failed attempt (declined card, UPI timeout…). The order stays open for another try. */
export async function markFailed(ctx: Ctx, i: { orderId: string; reason: string }) {
  await db.onlinePayment.updateMany({ where: { orderId: String(i.orderId ?? ""), tenantId: ctx.tenantId, status: "created" }, data: { status: "failed", note: String(i.reason ?? "").slice(0, 300) || "Payment failed." } });
}

/**
 * Razorpay webhook: payment.captured / order.paid confirm orders whose browser window closed early, payment.failed
 * records a failed attempt. Orders that aren't a hosted pharmacy's go to `other` (licence-server payments from
 * self-hosted and desktop installations).
 */
export async function handleWebhook(body: string, signature: string | null, other?: (pay: RzpPayment, event: string) => Promise<string | null>): Promise<{ status: number; note: string }> {
  if (!webhookSignatureOk(body, signature)) return { status: 401, note: "bad signature" };
  const e = JSON.parse(body) as { event?: string; payload?: { payment?: { entity?: RzpPayment & { error_description?: string } } } };
  const event = e.event ?? "";
  if (!["payment.captured", "order.paid", "payment.failed"].includes(event)) return { status: 200, note: "ignored" };
  const pay = e.payload?.payment?.entity;
  if (!pay?.order_id) return { status: 200, note: "no order" };
  const p = await db.onlinePayment.findUnique({ where: { orderId: pay.order_id } });
  if (!p) return { status: 200, note: (other && (await other(pay, event))) || "unknown order" };
  if (event === "payment.failed") {
    await db.onlinePayment.updateMany({ where: { orderId: p.orderId, status: "created" }, data: { status: "failed", note: pay.error_description?.slice(0, 300) || "Payment failed." } });
    return { status: 200, note: "failed recorded" };
  }
  if (pay.status !== "captured") return { status: 200, note: "not captured" };
  if (pay.amount !== p.amountPaise) return { status: 200, note: "amount mismatch" };
  const r = await settle(p.orderId, pay.id, "Razorpay");
  return { status: 200, note: r === "applied" ? "applied" : r === "duplicate" ? "duplicate refunded" : "already applied" };
}

/** What the Subscription page needs: whether paying is open yet. */
export async function billingState(tenantId: string, now = new Date()) {
  const meta = await db.subscriptionMeta.findUnique({ where: { tenantId } });
  const r = renewal(meta, now);
  const aiOn = aiAddonActive(meta, now);
  const aiR = renewal(meta?.aiUntil && meta.aiUntil > now ? { status: "active", renewsAt: meta.aiUntil } : null, now);
  return {
    status: meta?.status ?? null, renewsAt: meta?.renewsAt?.toISOString() ?? null, renewOpen: r.open, renewOpensOn: r.opensOn?.toISOString() ?? null,
    ai: { active: aiOn, until: meta?.aiUntil?.toISOString() ?? null, renewOpen: aiR.open, renewOpensOn: aiR.opensOn?.toISOString() ?? null },
  };
}

/** Undo a cancellation while the paid period is still running. */
export async function resumeSubscription(ctx: Ctx) {
  const meta = await db.subscriptionMeta.findUnique({ where: { tenantId: ctx.tenantId } });
  if (!meta || meta.status !== "cancelled") throw new UserError("The subscription isn’t cancelled.");
  if (!meta.renewsAt || meta.renewsAt <= new Date()) throw new UserError("The paid period has ended. Pay again to continue.");
  await db.subscriptionMeta.update({ where: { tenantId: ctx.tenantId }, data: { status: "active" } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Cancellation undone", entity: "subscription" });
}

/** Payment history for the Subscription page: paid, refunded and duplicate payments, and recent failed attempts. */
export async function onlinePayments(tenantId: string) {
  const rows = await db.onlinePayment.findMany({
    where: { tenantId, OR: [{ status: { in: ["paid", "refunded", "duplicate"] } }, { status: "failed", createdAt: { gt: new Date(Date.now() - 30 * DAY) } }] },
    orderBy: { createdAt: "desc" }, take: 30,
  });
  return rows.map((r) => ({
    id: r.id, status: r.status, plan: PRODUCTS.find((x) => x.id === r.plan)?.name ?? r.plan, cycle: r.cycle, amountPaise: r.amountPaise, gstPaise: r.gstPaise, coupon: r.couponCode,
    paymentId: r.provider === "coupon" ? null : r.paymentId, at: (r.paidAt ?? r.createdAt).toISOString(), periodTo: r.periodTo?.toISOString() ?? null,
    note: r.note, refunded: !!r.refundedAt,
  }));
}
