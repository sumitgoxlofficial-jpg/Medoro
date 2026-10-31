import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { seal } from "@/server/vault";
import { addDays, isoOf, todayISO } from "@/lib/dates";
import { payOnlineLink } from "@/domain/system/licence";
import { handleWebhook } from "@/domain/system/razorpay";
import { applyCpPaid, cpConfirm, cpQuote, cpStart, cpWebhook, payCustomer, payPage } from "@/staff/online-pay";
import { createCoupon } from "@/staff/coupons";
import { licenceDoc } from "@/staff/licence";
import type { Staff } from "@/staff/auth";
import { makePharmacy, resetDb } from "./helpers";

const SECRET = "test_secret_123", HOOK = "hook_secret_456";
const sig = (s: string, key = SECRET) => createHmac("sha256", key).update(s).digest("hex");
const admin: Staff = { id: "s1", empNo: "M-1", name: "Admin", email: "a@medoro.in", role: "super_admin", referralCode: null, sessionId: "x" };

function fakeRazorpay(payments: Record<string, { order_id: string; amount: number; status: string }> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/orders")) return json({ id: `order_${++n}`, amount: body.amount });
    const m = url.match(/\/payments\/([^/]+)$/);
    if (m && payments[m[1]]) return json({ id: m[1], currency: "INR", ...payments[m[1]] });
    return json({ error: { description: "not found" } }, 404);
  }));
  return calls;
}

let link: { l: string; s: string };
let customerId: string;

beforeEach(async () => {
  await resetDb();
  await makePharmacy();
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
  vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", HOOK);
  vi.stubEnv("LICENSE_SERVER_URL", "https://medoro.test");
  // The installation and its customer record on the licence server share the instance token.
  const licenceId = randomUUID(), token = randomBytes(32).toString("base64url"), sealed = seal(token).toString("base64");
  const tenant = await db.tenant.findFirstOrThrow();
  await db.subscriptionMeta.update({ where: { tenantId: tenant.id }, data: { licenceId, licenceToken: sealed } });
  const c = await db.cpCustomer.create({ data: { code: "T-1001", name: "Test Medical Store", owner: "Owner Person", phone: "9822000001", email: "owner@test.in", product: "pro", addons: [], cycle: "m", status: "trial", since: new Date(todayISO() + "T00:00:00Z"), renewsOn: new Date(addDays(todayISO(), 10) + "T00:00:00Z"), licenceId, licenceToken: sealed } });
  customerId = c.id;
  const u = new URL(await payOnlineLink(tenant.id));
  expect(u.origin + u.pathname).toBe("https://medoro.test/pay");
  link = { l: u.searchParams.get("l")!, s: u.searchParams.get("s")! };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("paying Medoro online from a self-hosted or desktop installation", () => {
  it("accepts only the installation's own, recent link", async () => {
    expect((await payCustomer(link.l, link.s)).id).toBe(customerId);
    expect(await payPage(link.l, link.s)).toMatchObject({ enabled: true, code: "T-1001", plan: "pro", status: "trial" });
    await expect(payCustomer(link.l, link.s.slice(0, -2) + "00")).rejects.toThrow(/expired or isn’t complete/);
    await expect(payCustomer(randomUUID(), link.s)).rejects.toThrow(/expired or isn’t complete/);
    await expect(payCustomer(link.l, link.s, Date.now() + 3 * 3600_000)).rejects.toThrow(/expired or isn’t complete/);
  });

  it("pays through Checkout: a verified sale, an invoice, and the trial's days kept", async () => {
    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    const calls = fakeRazorpay(payments);
    const o = await cpStart(link.l, link.s, { plan: "multi", cycle: "y" });
    expect(o).toMatchObject({ free: false, orderId: "order_1", amount: 4_499_000, keyId: "rzp_test_abc" });
    expect(calls[0].body).toMatchObject({ notes: { kind: "licence", customer: "T-1001", plan: "multi", cycle: "y" } });
    payments.pay_1 = { order_id: "order_1", amount: 4_499_000, status: "captured" };
    await expect(cpConfirm(link.l, link.s, { orderId: "order_1", paymentId: "pay_1", signature: "bad" })).rejects.toThrow(/couldn’t be verified/);
    expect(await cpConfirm(link.l, link.s, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") })).toEqual({ applied: true });

    const c = await db.cpCustomer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c).toMatchObject({ product: "multi", cycle: "y", status: "active" });
    expect(isoOf(c.renewsOn!)).toBe(addDays(addDays(todayISO(), 10), 365));
    const sale = await db.cpSale.findFirstOrThrow({ where: { customerId } });
    expect(sale).toMatchObject({ status: "verified", type: "renewal", payRef: "pay_1", verifiedBy: "Razorpay", amountPaise: 4_499_000 - (4_499_000 - Math.round(4_499_000 / 1.18)) });
    const doc = await licenceDoc(customerId);
    expect(doc).toMatchObject({ plan: "multi", status: "active", endsOn: isoOf(c.renewsOn!) });
    expect(doc.invoices).toHaveLength(1);
    expect(doc.invoices[0]).toMatchObject({ reference: "pay_1" });

    // The webhook for the same payment changes nothing.
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 4_499_000, status: "captured" } } } });
    expect(await handleWebhook(body, sig(body, HOOK), cpWebhook)).toEqual({ status: 200, note: "already applied" });
    expect(await db.cpSale.count()).toBe(1);
  });

  it("confirms through the webhook when the browser closed", async () => {
    fakeRazorpay();
    await cpStart(link.l, link.s, { plan: "starter", cycle: "m" });
    const ev = (amount: number) => JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: "pay_w", order_id: "order_1", amount, status: "captured" } } } });
    expect(await handleWebhook(ev(1), sig(ev(1), HOOK), cpWebhook)).toEqual({ status: 200, note: "amount mismatch" });
    expect(await handleWebhook(ev(99_900), sig(ev(99_900), HOOK), cpWebhook)).toEqual({ status: 200, note: "applied" });
    expect(await db.cpCustomer.findUniqueOrThrow({ where: { id: customerId } })).toMatchObject({ product: "starter", status: "active" });
    expect(await applyCpPaid("order_1", "pay_w")).toBe(false);
  });

  it("takes coupons, and renews without Razorpay for a 100% coupon", async () => {
    const calls = fakeRazorpay();
    await createCoupon(admin, { code: "HALF", percentOff: 50 });
    await createCoupon(admin, { code: "FREE", percentOff: 100, plans: ["pro"] });
    expect(await cpQuote(link.l, link.s, { plan: "pro", cycle: "m", coupon: "half" })).toMatchObject({ total: 124_950, coupon: { code: "HALF" } });
    await expect(cpQuote(link.l, link.s, { plan: "starter", cycle: "m", coupon: "FREE" })).rejects.toThrow(/doesn’t apply/);
    expect(await cpStart(link.l, link.s, { plan: "pro", cycle: "m", coupon: "FREE" })).toEqual({ free: true });
    expect(calls).toHaveLength(0);
    expect(await db.cpCustomer.findUniqueOrThrow({ where: { id: customerId } })).toMatchObject({ status: "active" });
    expect(await db.cpSale.findFirstOrThrow({ where: { customerId } })).toMatchObject({ amountPaise: 0, payRef: "coupon FREE", verifiedBy: "Coupon" });
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "FREE" } })).uses).toBe(1);
  });
});
