import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { PRODUCTS, amountPaise } from "@/staff/constants";

/**
 * Subscription payments on a hosted server (Medoro's own), with Razorpay Checkout: the owner picks a plan,
 * pays in Razorpay's window, and the paid period starts right away (or after the current one ends).
 * The browser's success callback and Razorpay's webhook both confirm the same order; whichever is first wins.
 */
const API = "https://api.razorpay.com/v1";
const cfg = () => ({
  keyId: process.env.RAZORPAY_KEY_ID?.trim() ?? "",
  secret: process.env.RAZORPAY_KEY_SECRET?.trim() ?? "",
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
});
export const razorpayEnabled = () => { const c = cfg(); return !!(c.keyId && c.secret); };

export const PAY_PLANS = ["starter", "pro", "multi"] as const;
export const orderSchema = z.object({ plan: z.enum(PAY_PLANS), cycle: z.enum(["m", "y"]) });

/** List price including 18% GST, in paise, and the GST in it. Yearly is 10 months. */
export function planPrice(plan: (typeof PAY_PLANS)[number], cycle: "m" | "y") {
  const p = PRODUCTS.find((x) => x.id === plan)!;
  const total = (cycle === "y" ? p.m * 10 : p.m) * 100;
  return { name: p.name, total, gst: total - amountPaise(plan, cycle) };
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

/** Starts a payment: a Razorpay order for the chosen plan, and what the browser needs to open Checkout. */
export async function createOrder(ctx: Ctx, raw: z.input<typeof orderSchema>) {
  if (!razorpayEnabled()) throw new UserError("Online payments aren’t set up on this server.");
  const { plan, cycle } = orderSchema.parse(raw);
  const price = planPrice(plan, cycle);
  const [tenant, user] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true, name: true } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, email: true, phone: true } }),
  ]);
  const order = await api<{ id: string; amount: number }>("/orders", {
    method: "POST",
    body: { amount: price.total, currency: "INR", receipt: `${tenant.code}-${randomBytes(4).toString("hex")}`.slice(0, 40), notes: { tenantId: ctx.tenantId, pharmacy: tenant.code, plan, cycle } },
  });
  if (order.amount !== price.total) throw new UserError("Razorpay returned a different amount. Nothing was charged.");
  await db.onlinePayment.create({ data: { tenantId: ctx.tenantId, orderId: order.id, plan, cycle, amountPaise: price.total, gstPaise: price.gst, createdBy: ctx.userName } });
  return {
    keyId: cfg().keyId, orderId: order.id, amount: price.total, currency: "INR",
    name: "Medoro", description: `${price.name} · ${cycle === "y" ? "1 year" : "1 month"}`,
    prefill: { name: user.name, email: user.email ?? "", contact: user.phone ?? "" }, notes: { pharmacy: `${tenant.name} (${tenant.code})` },
  };
}

/** Marks the order paid and extends the plan, once. Returns false when it was already applied. */
export async function applyPaid(orderId: string, paymentId: string, by: string) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OnlinePayment" WHERE "orderId" = ${orderId} AND "status" = 'created' FOR UPDATE`;
    if (!rows.length) return false;
    const p = await tx.onlinePayment.findUniqueOrThrow({ where: { orderId } });
    const meta = await tx.subscriptionMeta.findUnique({ where: { tenantId: p.tenantId } });
    // A trial or plan that is still running keeps its remaining days; a cancelled plan restarts today.
    const { from, to } = extendPeriod(meta && meta.status !== "cancelled" ? meta.renewsAt : null, p.cycle as "m" | "y");
    const name = PRODUCTS.find((x) => x.id === p.plan)!.name;
    await tx.onlinePayment.update({ where: { orderId }, data: { status: "paid", paymentId, paidAt: new Date(), periodFrom: from, periodTo: to } });
    await tx.subscriptionMeta.upsert({
      where: { tenantId: p.tenantId },
      create: { tenantId: p.tenantId, plan: name, addons: [], status: "active", renewsAt: to },
      update: { plan: name, status: "active", renewsAt: to, graceUntil: null },
    });
    await writeAudit(tx, { tenantId: p.tenantId, userName: by, action: "Subscription paid", entity: "subscription", entityId: p.id, detail: `${name} · ${p.cycle === "y" ? "1 year" : "1 month"} · ₹${(p.amountPaise / 100).toLocaleString("en-IN")} · Razorpay ${paymentId} · paid until ${to.toISOString().slice(0, 10)}` });
    return true;
  });
}

type RzpPayment = { id: string; order_id: string; amount: number; currency: string; status: string };

/** The browser's Checkout success callback: verify the signature, make sure the money is captured, then apply. */
export async function confirmCheckout(ctx: Ctx, i: { orderId: string; paymentId: string; signature: string }) {
  const p = await db.onlinePayment.findUnique({ where: { orderId: String(i.orderId ?? "") } });
  if (!p || p.tenantId !== ctx.tenantId) throw new UserError("Payment not found.");
  if (p.status === "paid") return { applied: false };
  if (!checkoutSignatureOk(p.orderId, i.paymentId, i.signature)) throw new UserError("The payment couldn’t be verified. If money was taken, it is confirmed automatically within a few minutes.");
  let pay = await api<RzpPayment>(`/payments/${encodeURIComponent(i.paymentId)}`);
  if (pay.order_id !== p.orderId || pay.amount !== p.amountPaise) throw new UserError("This payment doesn’t match the order.");
  if (pay.status === "authorized") pay = await api<RzpPayment>(`/payments/${encodeURIComponent(i.paymentId)}/capture`, { method: "POST", body: { amount: p.amountPaise, currency: "INR" } });
  if (pay.status !== "captured") throw new UserError("Razorpay hasn’t completed this payment yet. It is confirmed automatically once it does.");
  return { applied: await applyPaid(p.orderId, pay.id, ctx.userName) };
}

/** Razorpay webhook (payment.captured / order.paid): confirms orders whose browser window closed early. */
export async function handleWebhook(body: string, signature: string | null): Promise<{ status: number; note: string }> {
  if (!webhookSignatureOk(body, signature)) return { status: 401, note: "bad signature" };
  const e = JSON.parse(body) as { event?: string; payload?: { payment?: { entity?: RzpPayment } } };
  if (e.event !== "payment.captured" && e.event !== "order.paid") return { status: 200, note: "ignored" };
  const pay = e.payload?.payment?.entity;
  if (!pay?.order_id || pay.status !== "captured") return { status: 200, note: "not captured" };
  const p = await db.onlinePayment.findUnique({ where: { orderId: pay.order_id } });
  if (!p) return { status: 200, note: "unknown order" };
  if (pay.amount !== p.amountPaise) return { status: 200, note: "amount mismatch" };
  return { status: 200, note: (await applyPaid(p.orderId, pay.id, "Razorpay")) ? "applied" : "already applied" };
}

export async function onlinePayments(tenantId: string) {
  const rows = await db.onlinePayment.findMany({ where: { tenantId, status: "paid" }, orderBy: { paidAt: "desc" }, take: 24 });
  return rows.map((r) => ({ id: r.id, plan: PRODUCTS.find((x) => x.id === r.plan)?.name ?? r.plan, cycle: r.cycle, amountPaise: r.amountPaise, gstPaise: r.gstPaise, paymentId: r.paymentId, paidAt: r.paidAt!.toISOString(), periodTo: r.periodTo!.toISOString() }));
}
