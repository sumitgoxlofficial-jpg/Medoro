import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { accessFor } from "@/domain/system/access";
import { applyPaid, billingState, checkoutSignatureOk, confirmCheckout, createOrder, extendPeriod, handleWebhook, markFailed, planPrice, quote, resumeSubscription, webhookSignatureOk } from "@/domain/system/razorpay";
import { createCoupon, setCouponActive } from "@/staff/coupons";
import type { Staff } from "@/staff/auth";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const SECRET = "test_secret_123", HOOK = "hook_secret_456";
const sig = (s: string, key = SECRET) => createHmac("sha256", key).update(s).digest("hex");

/** A fake Razorpay API: orders get sequential ids; payments are looked up in `payments`. */
function fakeRazorpay(payments: Record<string, { order_id: string; amount: number; status: string }> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/orders")) return json({ id: `order_${++n}`, amount: body.amount, currency: "INR" });
    const rf = url.match(/\/payments\/([^/]+)\/refund$/);
    if (rf) return json({ id: `rfnd_${rf[1]}`, amount: body.amount, status: "processed" });
    const m = url.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (m && payments[m[1]]) {
      if (m[2]) payments[m[1]].status = "captured";
      return json({ id: m[1], currency: "INR", ...payments[m[1]] });
    }
    return json({ error: { description: "not found" } }, 404);
  }));
  return calls;
}

beforeEach(async () => {
  await resetDb();
  await makePharmacy();
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
  vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", HOOK);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Razorpay subscription payments", () => {
  it("prices plans with GST included and yearly as 10 months", () => {
    expect(planPrice("starter", "m")).toEqual({ name: "Starter", list: 99_900, discount: 0, total: 99_900, gst: 99_900 - Math.round(99_900 / 1.18) });
    expect(planPrice("pro", "m", 20)).toMatchObject({ list: 249_900, discount: 49_980, total: 199_920 });
    expect(planPrice("pro", "y").total).toBe(2_499_000);
  });

  it("extends from today, or after a period that is still running", () => {
    const now = new Date("2026-11-10T06:00:00Z");
    expect(extendPeriod(null, "m", now).to.toISOString()).toBe("2026-12-10T06:00:00.000Z");
    expect(extendPeriod(new Date("2026-11-01T00:00:00Z"), "y", now).to.toISOString()).toBe("2027-11-10T06:00:00.000Z");
    expect(extendPeriod(new Date("2026-11-20T00:00:00Z"), "m", now)).toEqual({ from: new Date("2026-11-20T00:00:00Z"), to: new Date("2026-12-20T00:00:00Z") });
  });

  it("checks Checkout and webhook signatures", () => {
    expect(checkoutSignatureOk("order_1", "pay_1", sig("order_1|pay_1"))).toBe(true);
    expect(checkoutSignatureOk("order_1", "pay_2", sig("order_1|pay_1"))).toBe(false);
    expect(webhookSignatureOk("{}", sig("{}", HOOK))).toBe(true);
    expect(webhookSignatureOk("{}", sig("{}"))).toBe(false);
    expect(webhookSignatureOk("{}", null)).toBe(false);
  });

  it("creates an order, confirms the Checkout payment once and extends the trial by a month", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    const calls = fakeRazorpay(payments);
    const o = await createOrder(ctx, { plan: "pro", cycle: "m" });
    expect(o).toMatchObject({ keyId: "rzp_test_abc", orderId: "order_1", amount: 249_900, currency: "INR" });
    expect(calls[0].body).toMatchObject({ amount: 249_900, currency: "INR", notes: { plan: "pro", cycle: "m" } });
    const trialEnd = (await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).renewsAt!;

    payments.pay_1 = { order_id: "order_1", amount: 249_900, status: "authorized" };
    await expect(confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: "bad" })).rejects.toThrow(/couldn’t be verified/);
    expect(await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") })).toEqual({ applied: true, duplicate: false });
    expect(calls.some((c) => c.url.endsWith("/payments/pay_1/capture") && c.method === "POST")).toBe(true);

    const m = await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    expect(m).toMatchObject({ plan: "Professional", status: "active" });
    expect(m.renewsAt!.toISOString()).toBe(extendPeriod(trialEnd, "m", new Date(0)).to.toISOString());
    const p = await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_1" } });
    expect(p).toMatchObject({ status: "paid", paymentId: "pay_1", amountPaise: 249_900 });

    // The webhook for the same payment arrives later: nothing changes.
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 249_900, status: "captured" } } } });
    expect(await handleWebhook(body, sig(body, HOOK))).toEqual({ status: 200, note: "already applied" });
    expect((await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).renewsAt).toEqual(m.renewsAt);
    expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "Subscription paid" } })).toBe(1);
  });

  it("refuses a payment for another order or amount", async () => {
    const ctx = await ctxFor();
    fakeRazorpay({ pay_9: { order_id: "order_other", amount: 99_900, status: "captured" } });
    await createOrder(ctx, { plan: "starter", cycle: "m" });
    await expect(confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_9", signature: sig("order_1|pay_9") })).rejects.toThrow(/doesn’t match/);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_1" } })).status).toBe("created");
  });

  it("confirms through the webhook when the browser closed, and ignores bad or unknown events", async () => {
    const ctx = await ctxFor();
    fakeRazorpay();
    await createOrder(ctx, { plan: "starter", cycle: "y" });
    const ev = (amount: number, order = "order_1") => JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: "pay_w", order_id: order, amount, status: "captured" } } } });
    expect((await handleWebhook(ev(999_000), "nope")).status).toBe(401);
    expect(await handleWebhook(ev(999_000, "order_x"), sig(ev(999_000, "order_x"), HOOK))).toEqual({ status: 200, note: "unknown order" });
    expect(await handleWebhook(ev(1), sig(ev(1), HOOK))).toEqual({ status: 200, note: "amount mismatch" });
    expect(await handleWebhook(ev(999_000), sig(ev(999_000), HOOK))).toEqual({ status: 200, note: "applied" });
    expect(await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).toMatchObject({ plan: "Starter", status: "active" });
    expect(await applyPaid("order_1", "pay_w", "test")).toBe(false);
  });

  it("enforces the trial and paid-until dates only when Razorpay is set up", async () => {
    const ctx = await ctxFor();
    await db.subscriptionMeta.update({ where: { tenantId: ctx.tenantId }, data: { renewsAt: new Date(Date.now() - 30 * 86400_000) } });
    expect((await accessFor(ctx.tenantId)).phase).toBe("expired");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    expect((await accessFor(ctx.tenantId)).phase).toBe("unlicensed");
  });
});

describe("subscription coupons", () => {
  const admin: Staff = { id: "s1", empNo: "M-1", name: "Admin", email: "a@medoro.in", role: "super_admin", referralCode: null, sessionId: "x" };
  const sales: Staff = { ...admin, id: "s2", role: "sales" };

  it("only super admins create coupons, codes are unique and normalised", async () => {
    await expect(createCoupon(sales, { code: "X20", percentOff: 20 })).rejects.toThrow(/staff role/);
    expect(await createCoupon(admin, { code: " launch 20 ", percentOff: 20 })).toBe("LAUNCH20");
    await expect(createCoupon(admin, { code: "LAUNCH20", percentOff: 10 })).rejects.toThrow(/already exists/);
    await expect(createCoupon(admin, { code: "BIG", percentOff: 101 })).rejects.toThrow(/At most 100%/);
  });

  it("checks the code before showing the price", async () => {
    await createCoupon(admin, { code: "PRO10", percentOff: 10, plans: ["pro"], maxUses: 1 });
    await createCoupon(admin, { code: "OLD", percentOff: 10, expiresOn: "2020-01-01" });
    expect(await quote({ plan: "pro", cycle: "y", coupon: "pro10" })).toMatchObject({ list: 2_499_000, discount: 249_900, total: 2_249_100, coupon: { code: "PRO10", percentOff: 10 } });
    await expect(quote({ plan: "starter", cycle: "m", coupon: "PRO10" })).rejects.toThrow(/doesn’t apply to this plan/);
    await expect(quote({ plan: "pro", cycle: "m", coupon: "OLD" })).rejects.toThrow(/expired/);
    await expect(quote({ plan: "pro", cycle: "m", coupon: "NOPE" })).rejects.toThrow(/isn’t valid/);
    const c = await db.coupon.findUniqueOrThrow({ where: { code: "PRO10" } });
    await setCouponActive(admin, c.id, false);
    await expect(quote({ plan: "pro", cycle: "m", coupon: "PRO10" })).rejects.toThrow(/isn’t valid/);
  });

  it("charges the discounted amount and counts the use once paid", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    const calls = fakeRazorpay(payments);
    await createCoupon(admin, { code: "ONCE", percentOff: 50, maxUses: 1 });
    const o = await createOrder(ctx, { plan: "starter", cycle: "m", coupon: "once" });
    expect(o).toMatchObject({ free: false, amount: 49_950 });
    expect(calls[0].body).toMatchObject({ amount: 49_950, notes: { coupon: "ONCE" } });
    expect(await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_1" } })).toMatchObject({ couponCode: "ONCE", discountPaise: 49_950, amountPaise: 49_950 });
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "ONCE" } })).uses).toBe(0);
    payments.pay_1 = { order_id: "order_1", amount: 49_950, status: "captured" };
    await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") });
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "ONCE" } })).uses).toBe(1);
    await expect(quote({ plan: "starter", cycle: "m", coupon: "ONCE" })).rejects.toThrow(/used up/);
  });

  it("a fixed-price coupon charges exactly that, on any plan", async () => {
    const ctx = await ctxFor();
    const calls = fakeRazorpay();
    await expect(createCoupon(admin, { code: "NOTHING" })).rejects.toThrow(/percent off .* or a fixed price/);
    await expect(createCoupon(admin, { code: "HALFRUPEE", payRupees: 0.5 })).rejects.toThrow(/at least ₹1/);
    await createCoupon(admin, { code: "SUMIT99", payRupees: 1, maxUses: 20, note: "₹1 test payments" });
    expect(await db.coupon.findUniqueOrThrow({ where: { code: "SUMIT99" } })).toMatchObject({ percentOff: 0, payPaise: 100 });
    expect(await quote({ plan: "multi", cycle: "y", coupon: "sumit99" })).toMatchObject({ list: 4_499_000, discount: 4_498_900, total: 100, coupon: { code: "SUMIT99", label: "pay ₹1" } });
    const o = await createOrder(ctx, { plan: "pro", cycle: "m", coupon: "SUMIT99" });
    expect(o).toMatchObject({ free: false, amount: 100 });
    expect(calls[0].body).toMatchObject({ amount: 100, notes: { coupon: "SUMIT99" } });
  });

  it("activates the plan without Razorpay for a 100% coupon", async () => {
    const ctx = await ctxFor();
    const calls = fakeRazorpay();
    await createCoupon(admin, { code: "FREEYEAR", percentOff: 100 });
    expect(await createOrder(ctx, { plan: "multi", cycle: "y", coupon: "FREEYEAR" })).toEqual({ free: true });
    expect(calls).toHaveLength(0);
    expect(await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).toMatchObject({ plan: "Multi-branch", status: "active" });
    expect(await db.onlinePayment.findFirstOrThrow({ where: { tenantId: ctx.tenantId } })).toMatchObject({ provider: "coupon", status: "paid", amountPaise: 0, couponCode: "FREEYEAR" });
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "FREEYEAR" } })).uses).toBe(1);
  });
});

describe("real-life payment rules", () => {
  const admin: Staff = { id: "s1", empNo: "M-1", name: "Admin", email: "a@medoro.in", role: "super_admin", referralCode: null, sessionId: "x" };
  const pay = (payments: Record<string, { order_id: string; amount: number; status: string }>, id: string, order: string, amount: number) => { payments[id] = { order_id: order, amount, status: "captured" }; };
  const meta = async () => db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: (await ctxFor()).tenantId } });

  it("a paid plan can't be paid again until its last 30 days", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    fakeRazorpay(payments);
    await createOrder(ctx, { plan: "starter", cycle: "y" });
    pay(payments, "pay_1", "order_1", 999_000);
    await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") });
    expect((await billingState(ctx.tenantId)).renewOpen).toBe(false);
    await expect(createOrder(ctx, { plan: "pro", cycle: "m" })).rejects.toThrow(/You can renew from/);
    await db.subscriptionMeta.update({ where: { tenantId: ctx.tenantId }, data: { renewsAt: new Date(Date.now() + 20 * 86400_000) } });
    expect((await billingState(ctx.tenantId)).renewOpen).toBe(true);
    expect(await createOrder(ctx, { plan: "pro", cycle: "m" })).toMatchObject({ orderId: "order_2" });
  });

  it("a second tap reuses the open order instead of starting another", async () => {
    const ctx = await ctxFor();
    const calls = fakeRazorpay();
    const a = await createOrder(ctx, { plan: "pro", cycle: "m" });
    const b = await createOrder(ctx, { plan: "pro", cycle: "m" });
    expect(a.free === false && b.free === false && a.orderId === b.orderId).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/orders"))).toHaveLength(1);
    expect(await db.onlinePayment.count()).toBe(1);
  });

  it("paying twice within minutes refunds the second payment automatically", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    const calls = fakeRazorpay(payments);
    await createOrder(ctx, { plan: "pro", cycle: "m" });      // tab 1
    await createOrder(ctx, { plan: "starter", cycle: "m" });  // tab 2, before tab 1 is paid
    pay(payments, "pay_a", "order_1", 249_900);
    pay(payments, "pay_b", "order_2", 99_900);
    expect(await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_a", signature: sig("order_1|pay_a") })).toEqual({ applied: true, duplicate: false });
    const once = (await meta()).renewsAt;
    expect(await confirmCheckout(ctx, { orderId: "order_2", paymentId: "pay_b", signature: sig("order_2|pay_b") })).toEqual({ applied: false, duplicate: true });
    expect(calls.some((c) => c.url.endsWith("/payments/pay_b/refund") && (c.body as { amount: number }).amount === 99_900)).toBe(true);
    expect(await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_2" } })).toMatchObject({ status: "duplicate", refundId: "rfnd_pay_b" });
    expect((await meta()).renewsAt).toEqual(once);
    expect(await meta()).toMatchObject({ plan: "Professional" });
  });

  it("a failed attempt is recorded and the order can still be paid", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    fakeRazorpay(payments);
    await createOrder(ctx, { plan: "pro", cycle: "m" });
    await markFailed(ctx, { orderId: "order_1", reason: "Payment failed: UPI request timed out" });
    expect(await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_1" } })).toMatchObject({ status: "failed", note: "Payment failed: UPI request timed out" });
    const failed = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_x", order_id: "order_1", amount: 249_900, status: "failed", error_description: "Bank declined" } } } });
    expect(await handleWebhook(failed, sig(failed, HOOK))).toEqual({ status: 200, note: "failed recorded" });
    pay(payments, "pay_ok", "order_1", 249_900);
    expect(await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_ok", signature: sig("order_1|pay_ok") })).toEqual({ applied: true, duplicate: false });
    expect(await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_1" } })).toMatchObject({ status: "paid", note: null });
  });

  it("a cancelled plan can be undone while its paid period lasts", async () => {
    const ctx = await ctxFor();
    await db.subscriptionMeta.update({ where: { tenantId: ctx.tenantId }, data: { status: "cancelled", renewsAt: new Date(Date.now() + 20 * 86400_000) } });
    expect((await billingState(ctx.tenantId)).renewOpen).toBe(true);
    await resumeSubscription(ctx);
    expect((await meta()).status).toBe("active");
  });

  it("a duplicate refund is what was actually paid after the coupon, not the list price", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    const calls = fakeRazorpay(payments);
    await createCoupon(admin, { code: "THIRDOFF", percentOff: 33 });
    await createOrder(ctx, { plan: "multi", cycle: "m", coupon: "THIRDOFF" });   // tab 1: ₹4,499 list → ₹3,014.33
    await createOrder(ctx, { plan: "pro", cycle: "m", coupon: "THIRDOFF" });     // tab 2
    const paid2 = (await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_2" } })).amountPaise;
    expect(paid2).toBe(249_900 - Math.round(249_900 * 0.33));
    pay(payments, "pay_1", "order_1", (await db.onlinePayment.findUniqueOrThrow({ where: { orderId: "order_1" } })).amountPaise);
    pay(payments, "pay_2", "order_2", paid2);
    await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") });
    expect(await confirmCheckout(ctx, { orderId: "order_2", paymentId: "pay_2", signature: sig("order_2|pay_2") })).toEqual({ applied: false, duplicate: true });
    expect((calls.find((c) => c.url.endsWith("/payments/pay_2/refund"))!.body as { amount: number }).amount).toBe(paid2);
  });

  it("a paid plan has no cancellation or refund, and never renews by itself", async () => {
    const ctx = await ctxFor();
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    const calls = fakeRazorpay(payments);
    await createOrder(ctx, { plan: "pro", cycle: "m" });
    pay(payments, "pay_1", "order_1", 249_900);
    await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") });
    expect(await billingState(ctx.tenantId)).not.toHaveProperty("refund");
    expect(calls.some((c) => c.url.includes("/refund"))).toBe(false);
    expect((await meta()).status).toBe("active");
  });
});

