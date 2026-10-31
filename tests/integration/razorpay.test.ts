import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { accessFor } from "@/domain/system/access";
import { applyPaid, checkoutSignatureOk, confirmCheckout, createOrder, extendPeriod, handleWebhook, planPrice, webhookSignatureOk } from "@/domain/system/razorpay";
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
    expect(planPrice("starter", "m")).toEqual({ name: "Starter", total: 99_900, gst: 99_900 - Math.round(99_900 / 1.18) });
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
    expect(await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") })).toEqual({ applied: true });
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
