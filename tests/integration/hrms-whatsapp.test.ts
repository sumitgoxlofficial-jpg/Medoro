import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, notify, type Me } from "@/staff/hrms/auth";
import { myWaAlerts, saveWaConfig, sendWaTest, setMyWaAlerts, waAdmin, waTick } from "@/staff/hrms/whatsapp";
import { setSender, type Sender } from "@/staff/growth/comms";
import { seal } from "@/server/vault";
import { resetDb } from "./helpers";

let admin: Me, emp: Me, other: Me, nophone: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (empNo: string, name: string, email: string, role: "super_admin" | "employee", hr: "admin" | "employee" | "finance" | "hr", managerId?: string) =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + empNo.slice(-1), role, status: "active", hr: { create: { role: hr, managerId: managerId ?? null, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: name } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin")).id);
  emp = await mkMe((await mk("MS-004", "Esha Employee", "esha@medoro.in", "employee", "employee")).id);
  other = await mkMe((await mk("MS-005", "Omar Other", "omar@medoro.in", "employee", "employee")).id);
  const n = await mk("MS-006", "Nina NoPhone", "nina@medoro.in", "employee", "employee");
  await db.staffUser.update({ where: { id: n.id }, data: { phone: "123" } });
  nophone = await mkMe(n.id);
});
beforeEach(() => jar.clear());

// A fake WhatsApp Cloud API: records what was sent, or fails when told to.
const sent: { to: string; payload: Record<string, unknown> }[] = [];
let failWith = "";
const fake: Sender = {
  whatsapp: async (_c, to, payload) => { if (failWith) throw new Error(failWith); sent.push({ to, payload }); return "wamid." + sent.length; },
  email: async () => null,
};
const CFG = { enabled: true, template: "hrms_alert", lang: "en" };
const msgs = (staffId: string) => db.hrWaMessage.findMany({ where: { staffId }, orderBy: { createdAt: "asc" } });

describe("HRMS alerts on WhatsApp", () => {
  beforeAll(() => setSender(fake));
  afterAll(() => setSender(null));

  it("stays off until the company number is connected and the super admin switches it on", async () => {
    await notify([emp.id], "Your leave was approved.");
    expect(await db.hrWaMessage.count()).toBe(0);
    expect((await myWaAlerts(emp)).available).toBe(false);
    await expect(setMyWaAlerts(emp, true)).rejects.toThrow(/aren’t switched on/);
    await expect(saveWaConfig(emp, CFG)).rejects.toThrow(/super admin/);
    await expect(saveWaConfig(admin, CFG)).rejects.toThrow(/Connect the company WhatsApp/);
    await db.integrationConnection.create({ data: { kind: "whatsapp", status: "connected", config: { phoneNumberId: "1234567890", wabaId: "9876543210", displayNumber: "+91 98200 00000" }, secrets: new Uint8Array(seal(JSON.stringify({ token: "t".repeat(30), appSecret: "s".repeat(20), verifyToken: "v" }))), updatedBy: admin.id } });
    await expect(saveWaConfig(admin, { ...CFG, template: "Bad Name" })).rejects.toThrow(/lowercase/);
    await saveWaConfig(admin, CFG);
    expect((await waAdmin(admin))).toMatchObject({ connected: true, cfg: CFG, optedIn: 0 });
  });

  it("sends a copy only to people who opted in, as the approved template with the alert as its variable", async () => {
    await expect(setMyWaAlerts(nophone, true)).rejects.toThrow(/mobile number/);
    await setMyWaAlerts(emp, true);
    expect(await myWaAlerts(emp)).toMatchObject({ available: true, on: true, phone: "+91•••••004" });
    await notify([emp.id, other.id], "Your leave for\n14 Dec was approved.", "leave");
    expect(await db.hrNotification.count({ where: { staffId: { in: [emp.id, other.id] }, text: { contains: "14 Dec" } } })).toBe(2); // in-app for both
    expect(sent).toHaveLength(1); // WhatsApp only for the one who opted in, sent right away
    expect(sent[0]).toEqual({ to: "+919820000004", payload: { type: "template", template: { name: "hrms_alert", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Your leave for 14 Dec was approved." }] }] } } });
    expect((await msgs(emp.id))[0]).toMatchObject({ status: "sent", waId: "wamid.1", attempts: 1 });
    expect(await db.hrWaMessage.count({ where: { staffId: other.id } })).toBe(0);
  });

  it("retries a failed send on the scheduler and gives up after three tries", async () => {
    failWith = "(#132001) Template name does not exist in the translation";
    await notify([emp.id], "A task was assigned to you.");
    let m = (await msgs(emp.id)).pop()!;
    expect(m).toMatchObject({ status: "pending", attempts: 1 });
    expect(await waTick(new Date())).toBe(0); // not due yet
    const later = new Date(Date.now() + 60 * 60_000);
    await waTick(later); await waTick(later);
    m = (await msgs(emp.id)).pop()!;
    expect(m).toMatchObject({ status: "failed", attempts: 3, error: expect.stringMatching(/Template name/) });
    expect((await waAdmin(admin)).week.failed).toBe(1);
    // A test send fails at once with WhatsApp's reason, so a wrong template shows up immediately.
    await expect(sendWaTest(admin)).rejects.toThrow(/Template name does not exist/);
    failWith = "";
    expect(await sendWaTest(admin)).toBe("Test message sent to +91•••••001.");
  });

  it("switching off stops new messages and drops queued ones", async () => {
    failWith = "temporary outage";
    await notify([emp.id], "Payslip ready.");
    failWith = "";
    await setMyWaAlerts(emp, false);
    expect((await msgs(emp.id)).pop()).toMatchObject({ status: "failed", error: "Switched off by the employee" });
    const before = sent.length;
    await notify([emp.id], "Another alert.");
    expect(sent.length).toBe(before);
    await waTick(new Date(Date.now() + 60 * 60_000));
    expect(sent.length).toBe(before);
  });
});
