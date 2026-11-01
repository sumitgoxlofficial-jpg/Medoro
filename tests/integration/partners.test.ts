import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { getStaff, type Staff } from "@/staff/auth";
import { setEmployeeStatus, signIn, signup } from "@/staff/people";
import { referredPharmacies, referrer, salesList, saveBank } from "@/staff/sales";
import { confirmCheckout, createOrder } from "@/domain/system/razorpay";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const SECRET = "test_secret_123";
const sig = (s: string) => createHmac("sha256", SECRET).update(s).digest("hex");
const asStaff = async (email: string): Promise<Staff> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { email } });
  return { id: u.id, empNo: u.empNo, name: u.name, email: u.email, role: u.role, referralCode: u.referralCode, sessionId: "test" };
};
function fakeRazorpay(payments: Record<string, { order_id: string; amount: number; status: string }>) {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/orders")) return json({ id: `order_${++n}`, amount: body.amount, currency: "INR" });
    const m = url.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (m && payments[m[1]]) { if (m[2]) payments[m[1]].status = "captured"; return json({ id: m[1], currency: "INR", ...payments[m[1]] }); }
    return json({ error: { description: "not found" } }, 404);
  }));
}

describe("reference partners", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.STAFF_BOOTSTRAP_EMAIL = "aarti@medoro.in";
    await signup({ name: "Aarti Menon", email: "aarti@medoro.in", phone: "9822010001", role: "sales", password: "correct horse battery" });
  });
  beforeEach(() => { jar.clear(); vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc"); vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("an MR joins with any email, waits for approval, then signs in with a password only", async () => {
    // Sales and care still need a work email; partners don't.
    await expect(signup({ name: "Ravi MR", email: "ravi.mr@gmail.com", phone: "9822010050", role: "sales", password: "ravi password 1" })).rejects.toThrow(/Choose Reference partner/);
    expect(await signup({ name: "Ravi Kulkarni", email: "ravi.mr@gmail.com", phone: "9822010050", role: "partner", password: "ravi password 1" })).toMatchObject({ bootstrap: false });
    const ravi = await db.staffUser.findUniqueOrThrow({ where: { email: "ravi.mr@gmail.com" } });
    expect(ravi).toMatchObject({ role: "partner", status: "pending" });
    expect(ravi.referralCode).toMatch(/^[A-Z0-9-]{4,}$/);
    await expect(signIn("ravi.mr@gmail.com", "ravi password 1")).rejects.toThrow(/approval/);
    expect(await referrer(ravi.referralCode!)).toBeNull(); // not active yet

    await setEmployeeStatus(await asStaff("aarti@medoro.in"), ravi.id, "approve");
    expect(await signIn("ravi.mr@gmail.com", "ravi password 1")).toMatchObject({ next: "done" });
    expect(await getStaff()).toMatchObject({ role: "partner", email: "ravi.mr@gmail.com" });
    expect(await referrer(ravi.referralCode!.toLowerCase())).toMatchObject({ id: ravi.id });
  });

  it("a referred pharmacy's online payments earn the partner commission, once per payment", async () => {
    const ravi = await asStaff("ravi.mr@gmail.com");
    await makePharmacy();
    const ctx = await ctxFor();
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    await db.tenant.update({ where: { id: t.id }, data: { settings: { ...((t.settings as object) ?? {}), referral: { code: ravi.referralCode, staffId: ravi.id, at: new Date().toISOString() } } } });
    expect(await referredPharmacies(ravi)).toMatchObject([{ name: "Test Medical Store", status: "trial" }]);

    const payments: Record<string, { order_id: string; amount: number; status: string }> = {};
    fakeRazorpay(payments);
    await createOrder(ctx, { plan: "pro", cycle: "m" });
    payments.pay_1 = { order_id: "order_1", amount: 249_900, status: "authorized" };
    await confirmCheckout(ctx, { orderId: "order_1", paymentId: "pay_1", signature: sig("order_1|pay_1") });

    let mine = await salesList(ravi);
    expect(mine).toHaveLength(1);
    const before = Math.round(249_900 / 1.18);
    expect(mine[0]).toMatchObject({ pharmacy: "Test Medical Store", product: "pro", cycle: "m", type: "new", status: "verified" });
    expect(mine[0].commission).toBeGreaterThan(0);
    expect(Math.abs(mine[0].amount - before)).toBeLessThanOrEqual(1);

    // Second payment, inside the renewal window, counts as a renewal.
    await db.subscriptionMeta.update({ where: { tenantId: ctx.tenantId }, data: { renewsAt: new Date(Date.now() + 3 * 86400_000) } });
    await db.onlinePayment.update({ where: { orderId: "order_1" }, data: { paidAt: new Date(Date.now() - 27 * 86400_000) } });
    await createOrder(ctx, { plan: "pro", cycle: "m" });
    payments.pay_2 = { order_id: "order_2", amount: 249_900, status: "authorized" };
    await confirmCheckout(ctx, { orderId: "order_2", paymentId: "pay_2", signature: sig("order_2|pay_2") });
    mine = await salesList(ravi);
    expect(mine.map((x) => x.type).sort()).toEqual(["new", "renewal"]);
    expect(await referredPharmacies(ravi)).toMatchObject([{ status: "active" }]);
  });

  it("partners see only their own earnings and can add a bank account", async () => {
    await signup({ name: "Meena Joshi", email: "meena@yahoo.in", phone: "9822010060", role: "partner", password: "meena password 1" });
    const meena = await db.staffUser.findUniqueOrThrow({ where: { email: "meena@yahoo.in" } });
    await setEmployeeStatus(await asStaff("aarti@medoro.in"), meena.id, "approve");
    expect(await salesList(await asStaff("meena@yahoo.in"))).toEqual([]);
    expect(await referredPharmacies(await asStaff("meena@yahoo.in"))).toEqual([]);
    expect((await salesList(await asStaff("aarti@medoro.in"))).length).toBe(2); // admin sees all
    await saveBank(await asStaff("meena@yahoo.in"), { holder: "Meena Joshi", account: "123456789012", account2: "123456789012", ifsc: "HDFC0001234", type: "Savings", pan: "ABCDE1234F", consent: true });
    expect((await db.staffBank.findUniqueOrThrow({ where: { staffId: meena.id } })).status).toBe("pending");
  });
});
