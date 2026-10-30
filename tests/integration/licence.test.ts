import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { addDays, todayISO } from "@/lib/dates";
import { createSession } from "@/server/auth";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { signDoc, requestSignature, LICENCE_HEADER, SIGNATURE_HEADER } from "@/lib/licence";
import { accessFor } from "@/domain/system/access";
import { applyLicence, checkIn, claimPayment, decideRemoteRequest, openTicket, planView, remoteRequests, replyTicket, requestAddon, requestCancel, supportInbox, connectLicenceKey } from "@/domain/system/licence";
import { createMedicine } from "@/domain/inventory/service";
import { fullExport } from "@/domain/system/privacy";
import { draftCampaign } from "@/domain/comms/crm";
import { verifySale } from "@/staff/sales";
import { replyTicket as staffReply, requestRemote, customerDetail } from "@/staff/support";
import { approvedLink, decideBillingRequest, extendTrial, issueLicenceKey, licenceDoc } from "@/staff/licence";
import { websiteLead } from "@/staff/public";
import type { Staff } from "@/staff/auth";
import { POST as registerRoute } from "@/app/api/license/register/route";
import { POST as checkinRoute } from "@/app/api/license/checkin/route";
import { POST as ticketRoute } from "@/app/api/license/ticket/route";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const keys = () => {
  const k = generateKeyPairSync("ed25519");
  return { priv: k.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), pub: k.publicKey.export({ format: "der", type: "spki" }).toString("base64") };
};
const K = keys();
const SERVER = "https://licence.test";
const routes: Record<string, (r: Request) => Promise<Response>> = { "/api/license/register": registerRoute, "/api/license/checkin": checkinRoute, "/api/license/ticket": ticketRoute };
let offline = false;
const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
  if (offline) throw new TypeError("fetch failed");
  const u = new URL(String(url));
  return routes[u.pathname](new Request(u, init));
});
const med = { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet" as const, manufacturer: "Micro", pack: "15", mrp: "33.60", gstRate: 12, schedule: "" as const, reorderLevel: 1, barcode: "", hsn: "3004", rack: "" };

let admin: Staff;
let tenantId: string;
const customer = () => db.cpCustomer.findFirstOrThrow({ where: { licenceId: { not: null } } });
const setEnds = async (iso: string, status = "trial") => db.cpCustomer.update({ where: { id: (await customer()).id }, data: { renewsOn: new Date(iso + "T00:00:00Z"), status } });
const iso = (days: number) => addDays(todayISO(), days);

describe("licensing: pharmacy ↔ staff console", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    tenantId = (await db.tenant.findFirstOrThrow()).id;
    const u = await db.staffUser.create({ data: { empNo: "MS-001", name: "Aarti Menon", email: "aarti@medoro.in", phone: "9822010001", role: "super_admin", status: "active" } });
    admin = { id: u.id, empNo: u.empNo, name: u.name, email: u.email, role: "super_admin", referralCode: null, sessionId: "t" };
    Object.assign(process.env, { LICENSE_SERVER_URL: SERVER, LICENSE_SIGNING_KEY: K.priv, LICENSE_PUBLIC_KEY: K.pub });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    for (const k of ["LICENSE_SERVER_URL", "LICENSE_SIGNING_KEY", "LICENSE_PUBLIC_KEY"]) delete process.env[k];
  });
  beforeEach(() => { jar.clear(); offline = false; });

  it("first check-in registers the installation, starts the trial and reports usage", async () => {
    expect(await checkIn(tenantId)).toEqual({ ok: true });
    const c = await customer();
    expect(c).toMatchObject({ name: "Test Medical Store", phone: "9822000001", status: "trial", product: "multi", branches: 2, devices: 3, appVersion: "0.1.0", deployment: "lan" });
    expect(c.lastCheckIn).toBeTruthy();
    expect(c.licenceToken).not.toMatch(/^[\w-]{43}$/); // sealed, not the raw token
    const m = await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId } });
    expect(m).toMatchObject({ licenceId: c.licenceId, status: "trial", plan: "Multi-branch", checkError: null });
    expect(m.renewsAt?.toISOString().slice(0, 10)).toBe(c.renewsOn?.toISOString().slice(0, 10));
    expect((await accessFor(tenantId)).phase).toBe("trial");
    // Throttled check-ins don't call the server again.
    const calls = fetchMock.mock.calls.length;
    expect(await checkIn(tenantId, { minAgeMs: 3600_000 })).toMatchObject({ skipped: true });
    expect(fetchMock.mock.calls.length).toBe(calls);
    // The staff console now has live data for the health score.
    const d = await customerDetail(admin, c.id);
    expect(d?.lastCheckIn).toBeTruthy();
    expect(d?.health).toBe(62);
  });

  it("rejects unsigned, forged and replayed answers", async () => {
    const c = await customer();
    const body = JSON.stringify({ appVersion: "x" });
    const bad = await checkinRoute(new Request(SERVER + "/api/license/checkin", { method: "POST", body, headers: { [LICENCE_HEADER]: c.licenceId!, [SIGNATURE_HEADER]: requestSignature("wrong-token", body) } }));
    expect(bad.status).toBe(401);
    const doc = await licenceDoc(c.id);
    await expect(applyLicence(tenantId, signDoc({ ...doc, endsOn: "2099-01-01" }, keys().priv))).rejects.toThrow(/signature/);
    await expect(applyLicence(tenantId, signDoc({ ...doc, issuedAt: "2020-01-01T00:00:00.000Z" }, K.priv))).rejects.toThrow(/older/);
    await expect(applyLicence(tenantId, signDoc({ ...doc, licenceId: "00000000-0000-0000-0000-000000000000" }, K.priv))).rejects.toThrow(/another installation/);
  });

  it("after the trial and 7 days' grace the app is read-only for business changes, not for exports or support", async () => {
    await setEnds(iso(-3));
    await checkIn(tenantId);
    expect(await accessFor(tenantId)).toMatchObject({ phase: "grace", readOnly: false });
    await setEnds(iso(-8));
    await checkIn(tenantId);
    expect(await accessFor(tenantId)).toMatchObject({ phase: "expired", readOnly: true });

    const owner = await db.user.findFirstOrThrow({ where: { tenantId, email: "owner@test.in" } });
    await createSession(owner.id, owner.tokenVersion, { mfaPassed: true });
    const ctx = (await getCtx())!;
    expect(ctx.locked).toBe(true);
    await expect(createMedicine(ctx, med)).rejects.toThrow(/Subscription expired — renew/);
    await expect(draftCampaign(ctx, "Diwali", "hello")).rejects.toThrow(/Subscription expired/);
    expect(await run((c) => createMedicine(c, med))).toMatchObject({ ok: false, error: expect.stringMatching(/^Subscription expired/) });
    await expect(fullExport(ctx)).resolves.toMatchObject({ format: "medoro-export-v1" });

    // Offline: the last signed licence keeps applying.
    offline = true;
    expect(await checkIn(tenantId)).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn’t reach/) });
    expect((await accessFor(tenantId)).readOnly).toBe(true);
    offline = false;

    // Staff extend the trial; the next licence lifts the lock.
    const ends = await extendTrial(admin, (await customer()).id, 10);
    expect(ends).toBe(iso(10));
    await checkIn(tenantId);
    expect(await accessFor(tenantId)).toMatchObject({ phase: "trial", readOnly: false });
    expect((await planView(tenantId)).billing[0]).toMatchObject({ kind: "trial_extended", detail: expect.stringMatching(/10 days/) });
  });

  it("“I've paid” creates a payment for verification; verifying extends the licence and sends an invoice", async () => {
    const ctx = await ctxFor();
    await expect(claimPayment(ctx, { product: "multi", cycle: "m", reference: "x", paidOn: iso(0), amountRupees: 4499 })).rejects.toThrow(/UTR/);
    const r = await claimPayment(ctx, { product: "multi", cycle: "m", reference: "UTR412345678", paidOn: iso(0), amountRupees: 4499, payer: "Owner Person" });
    expect(r.sent).toBe(true);
    const sale = await db.cpSale.findFirstOrThrow({ where: { payRef: "UTR412345678" } });
    expect(sale).toMatchObject({ status: "pending", type: "renewal", customerId: (await customer()).id });
    expect((await planView(tenantId)).requests[0]).toMatchObject({ kind: "payment", sent: true, status: "open" });

    const trialEnd = (await customer()).renewsOn!.toISOString().slice(0, 10);
    await verifySale(admin, sale.id, "verify");
    const c = await customer();
    expect(c.status).toBe("active");
    expect(c.renewsOn!.toISOString().slice(0, 10)).toBe(addDays(trialEnd, 30));

    await checkIn(tenantId);
    const p = await planView(tenantId);
    expect(p).toMatchObject({ status: "active", access: { phase: "active" } });
    expect(p.invoices).toHaveLength(1);
    expect(p.invoices[0]).toMatchObject({ number: expect.stringMatching(/^MED-\d{4}-00001$/), amountPaise: sale.amountPaise, reference: "UTR412345678" });
    expect(p.requests[0]).toMatchObject({ kind: "payment", status: "done" });
  });

  it("add-on and cancellation requests reach the console and apply through the next licence", async () => {
    const ctx = await ctxFor();
    await requestAddon(ctx, true);
    await requestAddon(ctx, true); // a second request is a separate one; approving it twice is harmless
    const ev = await db.cpBillingEvent.findMany({ where: { kind: "addon_add", status: "open" } });
    expect(ev).toHaveLength(2);
    await decideBillingRequest(admin, ev[0].id, true);
    await decideBillingRequest(admin, ev[1].id, false);
    await expect(decideBillingRequest(admin, ev[1].id, true)).rejects.toThrow(/No open request/);
    await checkIn(tenantId);
    expect((await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId } })).addons).toEqual(["ai"]);

    await requestCancel(ctx, "Closing the second branch");
    const cancel = await db.cpBillingEvent.findFirstOrThrow({ where: { kind: "cancel" } });
    expect(cancel.detail).toMatch(/Closing the second branch/);
    await decideBillingRequest(admin, cancel.id, true);
    await checkIn(tenantId);
    // Cancelled plans run to the paid date, then go read-only without grace.
    expect(await accessFor(tenantId)).toMatchObject({ phase: "active", cancelled: true, graceEndsOn: null });
  });

  it("tickets from Help reach the console; staff replies come back to the app", async () => {
    const ctx = await ctxFor();
    const t = await openTicket(ctx, { subject: "Printer cuts receipt", message: "The 80 mm printer cuts halfway.", category: "Hardware · printer" });
    expect(t).toMatchObject({ sent: true, code: expect.stringMatching(/^TK-\d+$/) });
    const ticket = await db.ticket.findUniqueOrThrow({ where: { code: t.code! }, include: { messages: true } });
    expect(ticket).toMatchObject({ channel: "App", category: "Hardware · printer", status: "open" });
    expect(ticket.messages[0]).toMatchObject({ fromCustomer: true, byName: "Owner Person" });

    await staffReply(admin, ticket.id, "Set the paper width to 80 mm in your printer driver and print a test invoice.", false, false);
    await staffReply(admin, ticket.id, "Internal: known driver bug", true, false);
    await checkIn(tenantId);
    const inbox = await supportInbox(tenantId);
    expect(inbox.unread).toBe(1);
    expect(inbox.tickets[0].messages.map((m) => m.text)).toEqual(["The 80 mm printer cuts halfway.", "Set the paper width to 80 mm in your printer driver and print a test invoice."]);

    await replyTicket(ctx, t.code!, "Fixed, thanks!");
    await staffReply(admin, ticket.id, "", false, true);
    expect(await db.ticketMessage.count({ where: { ticketId: ticket.id, fromCustomer: true } })).toBe(2);

    // Offline: the ticket waits in the outbox and goes with the next check-in.
    offline = true;
    expect(await openTicket(ctx, { subject: "Backup question", message: "Where are backups kept?" })).toMatchObject({ sent: false, code: null });
    expect((await supportInbox(tenantId)).pending).toHaveLength(1);
    offline = false;
    await checkIn(tenantId);
    expect((await supportInbox(tenantId)).pending).toHaveLength(0);
    expect(await db.ticket.count({ where: { subject: "Backup question" } })).toBe(1);
  });

  it("a remote-access request is approved in the app with a single-use support link", async () => {
    const c = await customer();
    await requestRemote(admin, c.id);
    await checkIn(tenantId);
    const pending = await remoteRequests(tenantId);
    expect(pending).toHaveLength(1);
    expect(pending[0].by).toBe("Aarti Menon");

    const g = await decideRemoteRequest(await ctxFor(), pending[0].id, true, 60, "https://pharmacy.example");
    expect(g?.link).toMatch(/^https:\/\/pharmacy\.example\/support\//);
    expect(await remoteRequests(tenantId)).toHaveLength(0);
    const ra = await db.remoteAccessRequest.findFirstOrThrow({ where: { customerId: c.id } });
    expect(ra.status).toBe("approved");
    expect(approvedLink(ra)?.link).toBe(g?.link);
    expect(await db.supportGrant.count({ where: { tenantId } })).toBe(1);
  });

  it("staff can issue a licence key that another installation connects with", async () => {
    const c = await customer();
    const key = await issueLicenceKey(admin, c.id);
    expect(key).toMatch(new RegExp(`^MEDORO-${c.licenceId}\\.`));
    // The old token stops working; the new key reconnects.
    expect(await checkIn(tenantId)).toMatchObject({ ok: false, error: expect.stringMatching(/not recognised/) });
    await expect(connectLicenceKey(await ctxFor(), "nonsense")).rejects.toThrow(/MEDORO-/);
    await connectLicenceKey(await ctxFor(), key);
    expect((await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId } })).checkError).toBeNull();
  });

  it("without a licence server the install is never limited", async () => {
    delete process.env.LICENSE_SERVER_URL;
    try {
      await db.subscriptionMeta.update({ where: { tenantId }, data: { signedDoc: null, renewsAt: new Date("2020-01-01"), status: "trial" } });
      expect(await accessFor(tenantId)).toMatchObject({ phase: "unlicensed", readOnly: false });
      expect(await checkIn(tenantId)).toMatchObject({ skipped: true });
      await expect(openTicket(await ctxFor(), { subject: "Help me", message: "x" })).rejects.toThrow(/isn’t connected/);
    } finally { process.env.LICENSE_SERVER_URL = SERVER; }
  });

  it("website trial form creates a lead, validates, rate-limits and ignores bots", async () => {
    const sales = await db.staffUser.create({ data: { empNo: "MS-002", name: "Karan Shah", email: "karan@medoro.in", phone: "9822010014", role: "sales", status: "active" } });
    await expect(websiteLead({ name: "R", pharmacy: "Shree Medical", phone: "12345", city: "Pune" }, "198.51.100.1")).rejects.toThrow();
    await websiteLead({ name: "Ravi Kumar", pharmacy: "Shree Medical", phone: "+91 98220 55555", city: "Pune", email: "ravi@shree.in" }, "198.51.100.1");
    const lead = await db.lead.findUniqueOrThrow({ where: { phone: "9822055555" } });
    expect(lead).toMatchObject({ name: "Shree Medical", owner: "Ravi Kumar", email: "ravi@shree.in", source: "Website trial", stage: "new", staffId: sales.id });
    await websiteLead({ name: "Ravi Kumar", pharmacy: "Shree Medical", phone: "9822055555", city: "Pune" }, "198.51.100.1");
    expect(await db.lead.count()).toBe(1);
    expect(await db.leadLog.count({ where: { leadId: lead.id } })).toBe(1);
    await websiteLead({ name: "Bot", pharmacy: "Spam Pharmacy", phone: "9822066666", city: "X Town", website: "http://spam" }, "198.51.100.2");
    expect(await db.lead.count()).toBe(1);
    for (let i = 0; i < 3; i++) await websiteLead({ name: "Asha", pharmacy: `Pharmacy ${i}`, phone: `98220700${10 + i}`, city: "Pune" }, "198.51.100.1");
    await expect(websiteLead({ name: "Asha", pharmacy: "One more", phone: "9822070099", city: "Pune" }, "198.51.100.1")).rejects.toThrow(/Too many/);
  });
});
