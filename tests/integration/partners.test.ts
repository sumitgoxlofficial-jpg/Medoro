import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { getStaff, type Staff } from "@/staff/auth";
import { completeGooglePartner, partnerFromGoogle, setEmployeeStatus, signIn, signup } from "@/staff/people";
import { sendSignupCode, verifySignupCode } from "@/domain/identity/signup-email";
import { leaderboard, partnerLeaderboard, partnerOverview, payWithRazorpay, payoutBankDetails, payoutWebhook, periodStarts, recordBankTransfer, shortName } from "@/staff/partners";
import { referredPharmacies, referrer, salesList, saveBank } from "@/staff/sales";
import { confirmCheckout, createOrder } from "@/domain/system/razorpay";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const SECRET = "test_secret_123";
const sig = (s: string) => createHmac("sha256", SECRET).update(s).digest("hex");
const asStaff = async (email: string): Promise<Staff> => {
  const u = await db.staffUser.findFirstOrThrow({ where: { email }, orderBy: { createdAt: "asc" } });
  return { id: u.id, empNo: u.empNo, name: u.name, email: u.email, role: u.role, referralCode: u.referralCode, sessionId: "test" };
};
/** Partners who joined with a personal email before sign-up was limited to Medoro employees. Their profiles keep working. */
async function existingPartner(name: string, email: string, phone: string, password: string) {
  const n = (await db.staffUser.count()) + 100;
  return db.staffUser.create({ data: { empNo: `MS-${n}`, name, email, kind: "partner", phone, team: "", role: "partner", status: "active", passwordHash: await hashPassword(password), referralCode: `${name.split(" ")[0].toUpperCase()}${n}` } });
}
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

  it("only Medoro employees can sign up; partners who joined earlier with any email still sign in with a password", async () => {
    await expect(signup({ name: "Ravi MR", email: "ravi.mr@gmail.com", phone: "9822010050", role: "sales", password: "ravi password 1" })).rejects.toThrow(/Only Medoro employees/);
    await expect(signup({ name: "Ravi Kulkarni", email: "ravi.mr@gmail.com", phone: "9822010050", role: "partner", password: "ravi password 1" })).rejects.toThrow(/Only Medoro employees/);
    await existingPartner("Ravi Kulkarni", "ravi.mr@gmail.com", "9822010050", "ravi password 1");
    const ravi = await db.staffUser.findFirstOrThrow({ where: { email: "ravi.mr@gmail.com" } });
    expect(ravi).toMatchObject({ role: "partner", status: "active", team: "" });
    expect(ravi.referralCode).toMatch(/^[A-Z0-9-]{4,}$/);
    // Sales profiles still wait for a super admin.
    await signup({ name: "Neha Sales", email: "neha@medoro.in", phone: "9822010051", role: "sales", password: "neha password 1" });
    await expect(signIn("neha@medoro.in", "neha password 1")).rejects.toThrow(/approval/);
    expect(await signIn("ravi.mr@gmail.com", "ravi password 1", "partner")).toMatchObject({ next: "done" });
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
    await existingPartner("Meena Joshi", "meena@yahoo.in", "9822010060", "meena password 1");
    const meena = await db.staffUser.findFirstOrThrow({ where: { email: "meena@yahoo.in" } });
    expect(await salesList(await asStaff("meena@yahoo.in"))).toEqual([]);
    expect(await referredPharmacies(await asStaff("meena@yahoo.in"))).toEqual([]);
    expect((await salesList(await asStaff("aarti@medoro.in"))).length).toBe(2); // admin sees all
    await saveBank(await asStaff("meena@yahoo.in"), { holder: "Meena Joshi", account: "123456789012", account2: "123456789012", ifsc: "HDFC0001234", type: "Savings", pan: "ABCDE1234F", consent: true });
    expect((await db.staffBank.findUniqueOrThrow({ where: { staffId: meena.id } })).status).toBe("pending");
  });

  it("Google never makes a new profile; partners who already exist can still use it", async () => {
    expect(await partnerFromGoogle({ sub: "g-111", email: "sunil.mr@gmail.com", name: "Sunil Patil" })).toBe("/staff/login?google=nouser");
    expect(await getStaff()).toBeNull();
    await expect(completeGooglePartner({ name: "Sunil Patil", phone: "98220 10070", team: "" })).rejects.toThrow(/Only Medoro employees/);
    expect(await db.staffUser.count({ where: { email: "sunil.mr@gmail.com" } })).toBe(0);
    // An existing password partner links Google on first use; a different Google account for the same email is refused.
    expect(await partnerFromGoogle({ sub: "g-222", email: "ravi.mr@gmail.com", name: "Ravi" })).toBe("/staff/login?google=ok");
    expect(await getStaff()).toMatchObject({ email: "ravi.mr@gmail.com" });
    expect(await partnerFromGoogle({ sub: "g-999", email: "ravi.mr@gmail.com", name: "Ravi" })).toBe("/staff/login?google=mismatch");
    jar.clear();
    // Google never opens a Medoro team profile.
    expect(await partnerFromGoogle({ sub: "g-333", email: "aarti@medoro.in", name: "Aarti" })).toBe("/staff/login?google=nouser");
    expect(await getStaff()).toBeNull();
    const ravi = await db.staffUser.findFirstOrThrow({ where: { email: "ravi.mr@gmail.com" } });
    await setEmployeeStatus(await asStaff("aarti@medoro.in"), ravi.id, "deactivate");
    expect(await partnerFromGoogle({ sub: "g-222", email: "ravi.mr@gmail.com", name: "Ravi" })).toBe("/staff/login?google=deactivated");
    await setEmployeeStatus(await asStaff("aarti@medoro.in"), ravi.id, "reactivate");
  });

  it("ranks partners today, this week and this month; partners see short names and no one else's earnings", async () => {
    expect(periodStarts("2026-11-05")).toEqual({ today: "2026-11-05", week: "2026-11-02", month: "2026-11-01" });
    expect(periodStarts("2026-11-01")).toEqual({ today: "2026-11-01", week: "2026-10-26", month: "2026-11-01" });
    expect(shortName("Ravi Kulkarni")).toBe("Ravi K."); expect(shortName("Meena")).toBe("Meena");
    const b = await leaderboard();
    expect(b.month[0]).toMatchObject({ name: "Ravi Kulkarni", sales: 2, signups: 1 });
    expect(b.month[0].earnedPaise).toBeGreaterThan(0);
    const mine = await partnerLeaderboard(await asStaff("meena@yahoo.in"));
    expect(mine.month.top[0]).toEqual({ rank: 1, me: false, name: "Ravi K.", area: "", sales: 2, signups: 1 });
    expect(mine.month.myRank).toBeNull();
    expect((await partnerLeaderboard(await asStaff("ravi.mr@gmail.com"))).today).toMatchObject({ myRank: 1, top: [{ name: "You", me: true }] });
  });

  it("super admin pays a partner with RazorpayX; the webhook confirms it; failures return the commission", async () => {
    const admin = await asStaff("aarti@medoro.in"), ravi = await asStaff("ravi.mr@gmail.com");
    vi.stubEnv("RAZORPAYX_ACCOUNT_NUMBER", "2323230000000001");
    let row = (await partnerOverview(admin)).find((r) => r.id === ravi.id)!;
    expect(row).toMatchObject({ signups: 1, paying: 1, paidPaise: 0 });
    expect(row.readyPaise).toBeGreaterThan(0);
    await expect(payWithRazorpay(ravi, ravi.id)).rejects.toThrow();
    await expect(payWithRazorpay(admin, ravi.id)).rejects.toThrow(/Verify this person’s bank/);
    await saveBank(ravi, { holder: "Ravi Kulkarni", account: "50100012345678", account2: "50100012345678", ifsc: "HDFC0001234", type: "Savings", pan: "ABCPK1234F", consent: true });
    await db.staffBank.update({ where: { staffId: ravi.id }, data: { status: "verified" } });

    const calls: { url: string; body: Record<string, unknown>; idem: string | null }[] = [];
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ url, body, idem: new Headers(init.headers).get("X-Payout-Idempotency") });
      const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/contacts")) return json({ id: "cont_1" });
      if (url.endsWith("/fund_accounts")) return json({ id: "fa_1" });
      if (url.endsWith("/payouts")) return fail ? json({ error: { description: "Insufficient balance" } }, 400) : json({ id: "pout_1", status: "processing", utr: null });
      return json({}, 404);
    }));
    await expect(payWithRazorpay(admin, ravi.id)).rejects.toThrow(/Insufficient balance/);
    expect((await partnerOverview(admin)).find((r) => r.id === ravi.id)!.readyPaise).toBe(row.readyPaise); // back to ready
    expect(calls.find((c) => c.url.endsWith("/fund_accounts"))!.body).toMatchObject({ contact_id: "cont_1", bank_account: { ifsc: "HDFC0001234", account_number: "50100012345678" } });

    fail = false; calls.length = 0;
    const r = await payWithRazorpay(admin, ravi.id);
    expect(r).toMatchObject({ status: "processing", net: row.readyNetPaise });
    expect(calls.map((c) => c.url.split("/v1")[1])).toEqual(["/payouts"]); // fund account reused
    expect(calls[0].body).toMatchObject({ account_number: "2323230000000001", fund_account_id: "fa_1", amount: row.readyNetPaise, currency: "INR", purpose: "payout" });
    expect(calls[0].idem).toBe(r.ref);
    row = (await partnerOverview(admin)).find((x) => x.id === ravi.id)!;
    expect(row).toMatchObject({ readyPaise: 0 });
    expect((await salesList(ravi)).every((x) => x.status === "processing")).toBe(true);
    await expect(payWithRazorpay(admin, ravi.id)).rejects.toThrow(/Nothing ready/);

    expect(await payoutWebhook("payout.processed", { id: "pout_1", status: "processed", utr: "UTR123456" })).toBe("payout paid");
    expect((await salesList(ravi)).every((x) => x.status === "paid")).toBe(true);
    expect(await db.staffPayout.findUniqueOrThrow({ where: { rzpPayoutId: "pout_1" } })).toMatchObject({ status: "paid", utr: "UTR123456", method: "razorpay" });
    expect(await payoutWebhook("payout.reversed", { id: "pout_1", status: "reversed" })).toBe("payout failed"); // already settled: no change
    expect((await salesList(ravi)).every((x) => x.status === "paid")).toBe(true);
  });

  it("records a bank transfer when Razorpay payouts aren't used", async () => {
    const admin = await asStaff("aarti@medoro.in"), ravi = await asStaff("ravi.mr@gmail.com");
    const sale = (await salesList(ravi))[0];
    await db.cpSale.update({ where: { id: sale.id }, data: { status: "verified", payoutRef: null } });
    await expect(recordBankTransfer(admin, ravi.id, "123")).rejects.toThrow(/UTR/);
    await expect(payWithRazorpay(admin, ravi.id)).rejects.toThrow(/aren’t set up/);
    const r = await recordBankTransfer(admin, ravi.id, "UPI-998877");
    expect(await db.staffPayout.findUniqueOrThrow({ where: { ref: r.ref } })).toMatchObject({ status: "paid", method: "manual", utr: "UPI-998877" });
    expect((await salesList(ravi)).find((x) => x.id === sale.id)!.status).toBe("paid");
  });

  it("one email can be a Medoro team member and a reference partner; each sign-in opens only its own panel", async () => {
    jar.clear();
    // Aarti (super admin) also joins as a partner with the same email.
    expect(await signup({ name: "Aarti Menon", email: "aarti@medoro.in", phone: "9822010001", role: "partner", password: "aarti partner pw1" })).toMatchObject({ active: true, bootstrap: false, role: "partner" });
    await expect(signup({ name: "Aarti Menon", email: "aarti@medoro.in", phone: "9822010001", role: "partner", password: "aarti partner pw1" })).rejects.toThrow(/already have a partner profile/);
    const rows = await db.staffUser.findMany({ where: { email: "aarti@medoro.in" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.kind, r.role])).toEqual([["team", "super_admin"], ["partner", "partner"]]);

    // Partner tab with the partner password: the partner dashboard, no authenticator.
    expect(await signIn("aarti@medoro.in", "aarti partner pw1", "partner")).toMatchObject({ next: "done" });
    expect(await getStaff()).toMatchObject({ role: "partner", id: rows[1].id });
    // Team tab: the admin profile, which still needs its authenticator. The partner password doesn't open it.
    jar.clear();
    await expect(signIn("aarti@medoro.in", "aarti partner pw1", "team")).rejects.toThrow(/incorrect/);
    expect(await signIn("aarti@medoro.in", "correct horse battery", "team")).toMatchObject({ next: "enroll" });
    expect(await getStaff()).toBeNull(); // not until the authenticator code
    // Google opens only the partner profile.
    jar.clear();
    expect(await partnerFromGoogle({ sub: "g-aarti", email: "aarti@medoro.in", name: "Aarti" })).toBe("/staff/login?google=ok");
    expect(await getStaff()).toMatchObject({ role: "partner", id: rows[1].id });
    // Partner-only emails get a pointer on the team tab, and vice versa.
    await expect(signIn("ravi.mr@gmail.com", "ravi password 1", "team")).rejects.toThrow(/reference partner profile, not a Medoro team profile/);
    await expect(signIn("neha@medoro.in", "neha password 1", "partner")).rejects.toThrow(/Medoro team email/);
  });

  it("shows the admin a verified partner's full bank details for a manual transfer, and logs it", async () => {
    const admin = await asStaff("aarti@medoro.in"), ravi = await asStaff("ravi.mr@gmail.com"), meena = await asStaff("meena@yahoo.in");
    await expect(payoutBankDetails(ravi, ravi.id)).rejects.toThrow();
    await expect(payoutBankDetails(admin, meena.id)).rejects.toThrow(/Verify/); // bank still pending
    expect(await payoutBankDetails(admin, ravi.id)).toMatchObject({ holder: "Ravi Kulkarni", account: "50100012345678", ifsc: "HDFC0001234" });
    expect(await db.staffAudit.count({ where: { action: "Payout bank details viewed", detail: { contains: "Ravi Kulkarni" } } })).toBe(1);
  });

  it("a Medoro employee joining as a partner confirms the email with a code first (when email is set up)", async () => {
    jar.clear();
    vi.stubEnv("MAIL_PROVIDER", "resend"); vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("MAIL_FROM", "Medoro <no-reply@medoro.in>");
    const mails: { to: string[]; text: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { mails.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: "m1" }), { status: 200, headers: { "Content-Type": "application/json" } }); }));
    const join = { name: "Kiran Das", email: "kiran@medoro.in", phone: "9822010090", role: "partner" as const, password: "kiran password 1" };
    await expect(signup(join)).rejects.toThrow(/Confirm your email/);
    await expect(sendSignupCode("aarti@medoro.in", "partner")).rejects.toThrow(/already have a partner profile/);
    await sendSignupCode("kiran@medoro.in", "partner");
    expect(mails.at(-1)).toMatchObject({ to: ["kiran@medoro.in"] });
    const code = /\n(\d{6})\n/.exec(mails.at(-1)!.text)![1];
    await expect(verifySignupCode("kiran@medoro.in", code === "000000" ? "111111" : "000000")).rejects.toThrow(/didn’t match/);
    await verifySignupCode("kiran@medoro.in", code);
    await expect(signup({ ...join, email: "other@medoro.in" })).rejects.toThrow(/Confirm your email/);
    expect(await signup(join)).toMatchObject({ active: true, role: "partner" });
    expect(await signIn("kiran@medoro.in", "kiran password 1", "partner")).toMatchObject({ next: "done" });
  });
});
