import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOTP, Secret } from "otpauth";

// Minimal request context for cookies()/headers() outside Next.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { openSecret } from "@/server/totp";
import { getStaff, type Staff } from "@/staff/auth";
import { acceptInvite, createEmployee, enrollTotp, resetSignIn, setEmployeeStatus, signIn, signup, verifyTotp } from "@/staff/people";
import { createLead, decideDiscount, logSale, moveLead, payouts, requestDiscount, runPayout, saveBank, saveRates, verifyBank, verifySale } from "@/staff/sales";
import { addNote, createTicket, customerDetail, customers, escalateTicket, replyTicket, requestRemote, ticketDetail } from "@/staff/support";
import { amountPaise } from "@/staff/constants";
import { resetDb } from "./helpers";

const code = (sealed: string) => new TOTP({ secret: Secret.fromBase32(openSecret(sealed)), digits: 6, period: 30 }).generate();
const asStaff = async (email: string): Promise<Staff> => {
  const u = await db.staffUser.findFirstOrThrow({ where: { email } });
  return { id: u.id, empNo: u.empNo, name: u.name, email: u.email, role: u.role, referralCode: u.referralCode, sessionId: "test" };
};

describe("staff console", () => {
  beforeAll(async () => { await resetDb(); process.env.STAFF_BOOTSTRAP_EMAIL = "aarti@medoro.in"; });
  beforeEach(() => jar.clear());

  it("first super admin bootstraps; others wait for approval; sign-in needs an authenticator", async () => {
    await expect(signup({ name: "Aarti Menon", email: "aarti@gmail.com", phone: "9822010001", role: "sales", password: "correct horse battery" })).rejects.toThrow(/@medoro.in/);
    expect(await signup({ name: "Aarti Menon", email: "aarti@medoro.in", phone: "9822010001", role: "sales", password: "correct horse battery" })).toMatchObject({ bootstrap: true, role: "super_admin" });
    expect(await signup({ name: "Karan Shah", email: "karan.s@medoro.in", phone: "9822010014", role: "sales", password: "karan password 1" })).toMatchObject({ bootstrap: false });
    await expect(signIn("karan.s@medoro.in", "karan password 1")).rejects.toThrow(/waiting for approval/);
    await expect(signIn("aarti@medoro.in", "wrong password!!")).rejects.toThrow(/4 attempts left/);

    expect(await signIn("aarti@medoro.in", "correct horse battery")).toMatchObject({ next: "enroll" });
    expect(await getStaff()).toBeNull(); // MFA not passed yet
    await enrollTotp();
    await expect(verifyTotp("000000")).rejects.toThrow(/didn’t match/);
    const u = await db.staffUser.findFirstOrThrow({ where: { email: "aarti@medoro.in" } });
    await verifyTotp(code(u.totpSecret!));
    expect(await getStaff()).toMatchObject({ role: "super_admin", empNo: "MS-001" });
    expect(await db.staffAudit.count({ where: { action: "Signed in" } })).toBe(1);
  });

  it("super admin approves, invites, resets and deactivates; deactivation ends sessions", async () => {
    const admin = await asStaff("aarti@medoro.in");
    const karan = await db.staffUser.findFirstOrThrow({ where: { email: "karan.s@medoro.in" } });
    await setEmployeeStatus(admin, karan.id, "approve");
    expect(await signIn("karan.s@medoro.in", "karan password 1")).toMatchObject({ next: "enroll" });

    const inv = await createEmployee(admin, { name: "Imran Qureshi", email: "imran.q@medoro.in", phone: "98220 10022", role: "care", team: "Support L1" }, "https://medoro.example");
    const token = new URL(inv.link).searchParams.get("invite")!;
    await acceptInvite(token, "imran password 1");
    await expect(acceptInvite(token, "imran password 2")).rejects.toThrow(/expired/);
    expect((await db.staffUser.findFirstOrThrow({ where: { email: "imran.q@medoro.in" } })).status).toBe("active");

    jar.clear();
    await signIn("imran.q@medoro.in", "imran password 1"); await enrollTotp();
    const im = await db.staffUser.findFirstOrThrow({ where: { email: "imran.q@medoro.in" } });
    await verifyTotp(code(im.totpSecret!));
    expect(await getStaff()).toMatchObject({ role: "care" });
    await setEmployeeStatus(admin, im.id, "deactivate");
    expect(await getStaff()).toBeNull();
    await setEmployeeStatus(admin, im.id, "reactivate");
    const r = await resetSignIn(admin, im.id, "https://medoro.example");
    expect(r.link).toContain("invite=");
    await expect(signIn("imran.q@medoro.in", "imran password 1")).rejects.toThrow(/incorrect/);
    await expect(setEmployeeStatus(admin, admin.id, "deactivate")).rejects.toThrow(/your own/);
  });

  it("pipeline → won → sale verified → customer; commission at the rate on the day; payout needs a verified bank", async () => {
    const admin = await asStaff("aarti@medoro.in"), karan = await asStaff("karan.s@medoro.in");
    await saveRates(admin, { starter: { first: 15, renew: 5 }, pro: { first: 20, renew: 7 }, multi: { first: 20, renew: 8 }, ai: { first: 25, renew: 10 }, setup: { first: 10, renew: 0 } }, { [karan.id]: 3 }, 60000);
    await expect(saveRates(admin, { pro: { first: 60, renew: 7 } }, {}, 0)).rejects.toThrow(/finance approval/);

    await createLead(karan, { name: "Shivam Medicals", owner: "Pravin", phone: "98230 55120", city: "Pune", source: "Field visit", product: "pro" });
    await expect(createLead(karan, { name: "Dup", phone: "9823055120", source: "Referral", product: "pro" })).rejects.toThrow(/already a lead/);
    const lead = await db.lead.findFirstOrThrow();
    await moveLead(karan, lead.id, "forward"); await moveLead(karan, lead.id, "forward");
    await requestDiscount(karan, lead.id, 10);
    await moveLead(karan, lead.id, "forward");
    await expect(moveLead(karan, lead.id, "forward")).rejects.toThrow(/approve the discount/);
    await decideDiscount(admin, lead.id, true);
    expect(await moveLead(karan, lead.id, "forward")).toEqual({ won: true });

    const sale = await db.cpSale.findFirstOrThrow({ where: { leadId: lead.id } });
    // ₹2,499 incl. GST, 10% off → ex-GST 2,249.10/1.18 = ₹1,906.02; rate 20% + 3 bonus
    expect(sale.amountPaise).toBe(amountPaise("pro", "m", 10));
    expect(sale.amountPaise).toBe(190602);
    expect(Number(sale.ratePct)).toBe(23);
    expect(sale.commissionPaise).toBe(Math.round(190602 * 0.23));
    await expect(verifySale(karan, sale.id, "verify")).rejects.toThrow(/role/);
    const custCode = await verifySale(admin, sale.id, "verify");
    expect(custCode).toBe("T-1001");
    expect(await customers(karan)).toHaveLength(1);

    // An add-on for a non-customer can't be verified; for the customer it attaches.
    await logSale(karan, { pharmacy: "Other", phone: "9000000001", product: "ai", cycle: "m" });
    const orphan = await db.cpSale.findFirstOrThrow({ where: { phone: "9000000001" } });
    await expect(verifySale(admin, orphan.id, "verify")).rejects.toThrow(/isn’t a customer yet/);
    await verifySale(admin, orphan.id, "reject");
    await logSale(karan, { pharmacy: "Shivam Medicals", phone: "9823055120", product: "ai", cycle: "y" });
    await verifySale(admin, (await db.cpSale.findFirstOrThrow({ where: { product: "ai", status: "pending" } })).id, "verify");
    expect((await db.cpCustomer.findFirstOrThrow()).addons).toEqual(["ai"]);

    expect(await runPayout(admin)).toMatchObject({ paid: 0, held: ["Karan Shah"] });
    await expect(saveBank(karan, { holder: "Karan Shah", account: "50100234914321", account2: "50100234914320", ifsc: "HDFC0001123", pan: "BQRPR4471K", type: "Savings", consent: true })).rejects.toThrow(/do not match/);
    await saveBank(karan, { holder: "Karan Shah", account: "50100234914321", account2: "50100234914321", ifsc: "hdfc0001123", pan: "bqrpr4471k", type: "Savings", consent: true });
    const bank = await db.staffBank.findUniqueOrThrow({ where: { staffId: karan.id } });
    expect(bank).toMatchObject({ last4: "4321", bank: "HDFC Bank", panMasked: "BQ•••••71K", status: "pending" });
    expect(bank.accountSealed).not.toContain("4321");
    await verifyBank(admin, karan.id);
    expect(await runPayout(admin)).toMatchObject({ paid: 2, held: [] });
    const p = (await payouts(karan))[0];
    expect(p).toMatchObject({ status: "paid", n: 2 });
    expect(p.tds).toBe(Math.round(p.gross * 0.02));
  });

  it("support tickets: SLA, replies, internal notes, escalation; remote access is only a request", async () => {
    const admin = await asStaff("aarti@medoro.in"), karan = await asStaff("karan.s@medoro.in");
    await db.staffUser.updateMany({ where: { email: "imran.q@medoro.in" }, data: { status: "active" } });
    const care = await asStaff("imran.q@medoro.in");
    const c = await db.cpCustomer.findFirstOrThrow();
    await expect(createTicket(karan, { customerId: c.id, subject: "Printer cuts", priority: "high", channel: "Phone", category: "Hardware · printer" })).rejects.toThrow(/role/);
    const id = await createTicket(care, { customerId: c.id, subject: "Printer cuts receipt early", message: "Stops halfway since update", priority: "high", channel: "WhatsApp", category: "Hardware · printer" });
    let t = (await ticketDetail(id))!;
    expect(t.code).toBe("TK-1001");
    expect(new Date(t.firstResponseDue).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    await replyTicket(care, id, "Checking with L2", true, false);
    expect((await ticketDetail(id))!.firstResponseAt).toBeNull(); // internal notes don't count
    await replyTicket(care, id, "Please set paper width to 80 mm", false, false);
    expect(await escalateTicket(care, id)).toBe("L2 support");
    await replyTicket(care, id, "", false, true);
    t = (await ticketDetail(id))!;
    expect(t).toMatchObject({ status: "resolved", escalatedTo: "L2 support" });
    expect(t.messages.map((m) => m.internal)).toEqual([false, true, false, true]);
    await expect(db.ticketMessage.deleteMany({ where: { ticketId: id } })).rejects.toThrow(/append-only/);

    await addNote(care, c.id, "Owner prefers WhatsApp");
    await requestRemote(care, c.id, id);
    await expect(requestRemote(admin, c.id)).rejects.toThrow(/Already requested/);
    const d = (await customerDetail(care, c.id))!;
    expect(d.remote?.status).toBe("requested");
    expect(d.notes[0].text).toBe("Owner prefers WhatsApp");
    // Sales only see their own customers.
    expect(await customerDetail({ ...karan, id: "someone-else" }, c.id)).toBeNull();
  });

  it("winning a lead twice at once logs one sale", async () => {
    const karan = await asStaff("karan.s@medoro.in");
    await createLead(karan, { name: "Twin Clicks Pharmacy", phone: "9823055999", source: "Referral", product: "starter" });
    const lead = await db.lead.findFirstOrThrow({ where: { phone: "9823055999" } });
    for (let i = 0; i < 3; i++) await moveLead(karan, lead.id, "forward");
    const r = await Promise.allSettled([moveLead(karan, lead.id, "forward"), moveLead(karan, lead.id, "forward")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.cpSale.count({ where: { leadId: lead.id } })).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("won");
  });
});
