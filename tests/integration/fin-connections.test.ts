import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { DEFAULT_GRANTS } from "@/domain/identity/permissions";
import type { Ctx } from "@/server/context";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { saveCustomer } from "@/domain/parties/service";
import { customerBalance } from "@/domain/parties/balances";
import { setDriveMode } from "@/domain/system/drive-mode";
import { registerDevice } from "@/domain/system/drivedb-relay";
import { connectors, registerTestConnector } from "@/domain/finance/connectors";
import { AuthFailed, RateLimited, Unavailable, type ConnectorAdapter, type FetchResult, type FinBatch, type SourceRecord } from "@/domain/finance/connectors/types";
import {
  ackFinInbox, completeCallback, connectionAlerts, disconnectConnection, finInboxFor, handleWebhook, listConnections, providersView, refreshConsent,
  requestSync, revokeConnection, runSyncJobs, startConnection, syncHistory,
} from "@/domain/finance/connections";
import { listTransactions } from "@/domain/finance/server-api";
import { medoroRef } from "@/domain/finance/match";
import { newDeviceKeys } from "@/drivedb/keyring";
import { FIN_AAD, openForDevice, openJsonForDevice } from "@/drivedb/inbox";
import { memoryDb } from "@/drivedb/node";
import { importSynced, transactions } from "@/drivedb/money";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const today = todayISO();
const rec = (ref: string, amountPaise: number, description: string, over: Partial<SourceRecord> = {}): SourceRecord => ({
  sourceRef: ref, direction: "credit", amountPaise, currency: "INR", date: today, time: "10:15:00", description, utr: null, bankRef: null,
  counterpartyName: null, counterpartyVpa: null, status: "success", accountMasked: "XXXX4321", ...over,
});

/** A simulated bank, only for these tests: each fetch returns the next scripted page (or throws it). */
const script: (FetchResult | Error)[] = [];
const calls = { fetch: 0, revoke: 0, cursors: [] as unknown[] };
let revokeFails = false;
const fake: ConnectorAdapter = {
  async start({ state, returnUrl }) { return { redirectUrl: `https://bank.example/consent?state=${state}&return=${encodeURIComponent(returnUrl)}`, externalId: "consent-1" }; },
  async callback(p) {
    if (p.get("code") === "deny") return { ok: false, reason: "denied", message: "You declined at the bank." };
    if (p.get("code") !== "ok") throw new Error("bad code");
    return { ok: true, displayName: "Test Bank", accountMasked: "XXXX4321", secret: { token: "SECRET-TOKEN-123", hook: "whsec" }, consentExpiresAt: new Date(Date.now() + 30 * 86400_000), externalId: "consent-1" };
  },
  async fetch({ cursor }) {
    calls.fetch++; calls.cursors.push(cursor);
    const next = script.shift() ?? { records: [], cursor, more: false };
    if (next instanceof Error) throw next;
    return next;
  },
  async refreshConsent({ state }) { return { redirectUrl: `https://bank.example/renew?state=${state}` }; },
  async revoke() { calls.revoke++; if (revokeFails) throw new Unavailable(); },
  async verifyWebhook({ raw, headers, secret }) {
    const want = createHmac("sha256", (secret as { hook: string }).hook).update(raw).digest("hex");
    if (headers.get("x-signature") !== want) return null;
    return (JSON.parse(raw) as { records: SourceRecord[] }).records;
  },
};

const state = (redirectUrl: string) => new URL(redirectUrl).searchParams.get("state")!;
async function connect(ctx: Ctx, code = "ok") {
  const s = await startConnection(ctx, "test:bank");
  const r = await completeCallback(ctx, new URLSearchParams({ state: state(s.redirectUrl), code }));
  return { ...s, result: r };
}
const sign = (raw: string, key = "whsec") => createHmac("sha256", key).update(raw).digest("hex");

let unregister = () => {};
let med = "", batch = "";

describe("bank / provider connections and the sync engine (simulated provider)", () => {
  const prevDrive = process.env.E2E_FAKE_DRIVE;
  beforeAll(() => {
    // Counters register against the fake Google Drive used by the other Drive tests.
    process.env.E2E_FAKE_DRIVE = "1"; delete process.env.VERCEL;
    // The real registry: nothing can be connected in this build.
    expect(connectors().every((c) => c.adapter === null)).toBe(true);
    unregister = registerTestConnector({ id: "test:bank", kind: "bank", sourceId: "bank-api", name: "Test Bank", label: "available", capabilities: { webhook: true, minPollMin: 60, historyDays: 30, consent: true }, adapter: fake });
  });
  afterAll(() => { unregister(); if (prevDrive === undefined) delete process.env.E2E_FAKE_DRIVE; else process.env.E2E_FAKE_DRIVE = prevDrive; });
  beforeEach(async () => {
    await resetDb(); await makePharmacy();
    script.length = 0; calls.fetch = 0; calls.revoke = 0; calls.cursors = []; revokeFails = false;
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { form: "Tablet", manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 0, barcode: "", hsn: "3004", rack: "", name: "Testmed", generic: "Paracetamol", strength: "500 mg", mrp: "100", schedule: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "B1", expiry: addDays(today, 400), qty: 1000, cost: "50", mrp: "100", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow({ where: { batchNo: "B1" } })).id;
  });

  it("real connectors stay unavailable; only a live adapter is connectable", async () => {
    const p = providersView();
    expect(p.find((x) => x.id === "phonepe")).toMatchObject({ connectable: false, labelText: "Partner onboarding required" });
    expect(p.find((x) => x.id === "bharatpe")).toMatchObject({ connectable: false, labelText: "Not yet supported" });
    expect(p.find((x) => x.id === "test:bank")).toMatchObject({ connectable: true });
    await expect(startConnection(await ctxFor(), "phonepe")).rejects.toThrow(/Partner onboarding required/);
    await expect(startConnection(await ctxFor(), "aa")).rejects.toThrow(/Partner onboarding required/);
  });

  it("connects only after the provider confirms; the state is single-use and tied to the user; secrets are sealed", async () => {
    await expect(startConnection(await ctxFor("Cashier"), "test:bank")).rejects.toThrow(/role cannot/);
    const ctx = await ctxFor();
    const s = await startConnection(ctx, "test:bank");
    expect((await listConnections(ctx))[0]).toMatchObject({ status: "pending" });
    const params = new URLSearchParams({ state: state(s.redirectUrl), code: "ok" });
    await expect(completeCallback({ ...ctx, userId: "someone-else" }, params)).rejects.toThrow(/isn’t valid for you/);
    const r = await completeCallback(ctx, params);
    expect(r).toMatchObject({ ok: true, connection: { status: "active", displayName: "Test Bank", accountMasked: "XXXX4321" } });
    await expect(completeCallback(ctx, params)).rejects.toThrow(/already used/);
    const row = await db.finConnection.findFirstOrThrow();
    expect(Buffer.from(row.encryptedSecret!).toString()).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(await listConnections(ctx))).not.toContain("SECRET");
    expect((await db.finConsent.findMany({ orderBy: { at: "asc" } })).map((c) => c.event)).toEqual(["requested", "approved"]);
    expect(await db.finSyncJob.count({ where: { trigger: "initial", status: "queued" } })).toBe(1);
  });

  it("a declined or expired authorisation never connects", async () => {
    const ctx = await ctxFor();
    expect((await connect(ctx, "deny")).result).toMatchObject({ ok: false, message: "You declined at the bank." });
    expect((await db.finConnection.findFirstOrThrow()).status).toBe("disconnected");
    const s = await startConnection(ctx, "test:bank");
    await db.finAuthState.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(completeCallback(ctx, new URLSearchParams({ state: state(s.redirectUrl), code: "ok" }))).rejects.toThrow(/expired/);
  });

  it("syncs into statement lines, pays a credit bill with its reference, saves the cursor, never duplicates", async () => {
    const ctx = await ctxFor();
    const custId = await saveCustomer(ctx, null, { name: "City Hospital", phone: "9822000099", waOptIn: false, creditLimit: "100000" });
    const cust = { id: custId };
    const sale = await commitSale(ctx, { idempotencyKey: "k_" + randomUUID(), lines: [{ medicineId: med, batchId: batch, qty: 3 }], customerId: custId, discountPct: 0, pay: { mode: "credit" } });
    await connect(ctx);
    const page1 = [rec("t1", 30000, `NEFT CR CITY HOSPITAL ${medoroRef(sale.invoiceNo)}`, { utr: "SBIN426306123456" }), rec("t2", 5000, "UPI/430512345678/x", { status: "pending" })];
    script.push({ records: page1, cursor: { after: "t2" }, more: false });
    expect(await runSyncJobs(new Date(), 30_000)).toBe(1);
    expect(await customerBalance(db, ctx.tenantId, cust.id)).toBe(0);
    const t = await listTransactions(ctx, new URLSearchParams({ from: today, to: today }));
    expect(t.transactions).toHaveLength(1); // the pending one is not delivered
    expect(t.transactions[0]).toMatchObject({ amountPaise: 30000, status: "matched", matchedTo: "credit bills", utr: "SBIN426306123456" });
    expect((await db.finConnection.findFirstOrThrow()).cursor).toEqual({ after: "t2" });
    expect((await syncHistory(ctx))[0]).toMatchObject({ trigger: "initial", fetched: 2, delivered: 1, errors: 0 });
    // Same records again (a provider resend): nothing new.
    await db.finConnection.updateMany({ data: { cursor: undefined } });
    script.push({ records: page1, cursor: { after: "t2" }, more: false });
    await requestSync(ctx, (await db.finConnection.findFirstOrThrow()).id);
    await runSyncJobs(new Date(), 30_000);
    expect((await listTransactions(ctx, new URLSearchParams({ from: today, to: today }))).transactions).toHaveLength(1);
    await expect(requestSync(ctx, (await db.finConnection.findFirstOrThrow()).id)).rejects.toThrow(/last 10 minutes/);
  });

  it("partial sync: a failure keeps the last delivered cursor and retries with backoff; auth failure stops", async () => {
    const ctx = await ctxFor();
    await connect(ctx);
    script.push({ records: [rec("a1", 1000, "UPI one")], cursor: "c1", more: true }, new Unavailable());
    await runSyncJobs(new Date(), 30_000);
    let job = await db.finSyncJob.findFirstOrThrow();
    expect(job).toMatchObject({ status: "queued", lastError: "The provider is not answering right now." });
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now() + 50_000); // backoff: about a minute
    expect((await db.finConnection.findFirstOrThrow()).cursor).toBe("c1");
    // Later: continues from c1.
    script.push({ records: [rec("a2", 2000, "UPI two")], cursor: "c2", more: false });
    await runSyncJobs(new Date(Date.now() + 2 * 60_000), 30_000);
    expect(calls.cursors.at(-1)).toBe("c1");
    expect((await db.finSyncJob.findFirstOrThrow()).status).toBe("done");
    expect(await db.bankLine.count()).toBe(2);
    // Rate limited: back in the queue at the provider's time, connection stays active.
    await db.$executeRawUnsafe(`DELETE FROM "LoginAttempt" WHERE key LIKE 'rl:fin-sync:%'`);
    await requestSync(ctx, (await db.finConnection.findFirstOrThrow()).id);
    script.push(new RateLimited(600));
    await runSyncJobs(new Date(), 30_000);
    job = await db.finSyncJob.findFirstOrThrow({ where: { status: "queued" } });
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now() + 590_000);
    expect((await db.finConnection.findFirstOrThrow()).status).toBe("active");
    // The provider stops accepting the connection: stop, no retry.
    script.push(new AuthFailed());
    await runSyncJobs(new Date(Date.now() + 700_000), 30_000);
    expect((await db.finConnection.findFirstOrThrow()).status).toBe("error");
    expect(await db.finSyncJob.count({ where: { status: "queued" } })).toBe(0);
    expect(await connectionAlerts(ctx.tenantId)).toEqual([expect.stringMatching(/Test Bank stopped syncing/)]);
  });

  it("consent: expiry stops fetching; renewal goes back through the provider; revocation is recorded even if the provider fails", async () => {
    const ctx = await ctxFor();
    await connect(ctx);
    await db.finConnection.updateMany({ data: { consentExpiresAt: new Date(Date.now() - 1000) } });
    await runSyncJobs(new Date(), 30_000);
    expect(calls.fetch).toBe(0);
    const c = await db.finConnection.findFirstOrThrow();
    expect(c.status).toBe("expired");
    expect(await connectionAlerts(ctx.tenantId)).toEqual([expect.stringMatching(/consent has expired/)]);
    const r = await refreshConsent(ctx, c.id);
    await completeCallback(ctx, new URLSearchParams({ state: new URL(r.redirectUrl).searchParams.get("state")!, code: "ok" }));
    expect((await db.finConnection.findFirstOrThrow()).status).toBe("active");
    expect((await db.finConsent.findMany({ orderBy: { at: "asc" } })).map((x) => x.event)).toEqual(["requested", "approved", "expired", "requested", "renewed"]);
    revokeFails = true;
    const rv = await revokeConnection(ctx, c.id);
    expect(rv.warning).toMatch(/didn’t confirm the revocation/);
    const after = await db.finConnection.findFirstOrThrow();
    expect([after.status, after.encryptedSecret]).toEqual(["revoked", null]);
    await expect(requestSync(ctx, c.id)).rejects.toThrow(/isn’t active/);
    await disconnectConnection(ctx, c.id);
    expect(await listConnections(ctx)).toEqual([]);
  });

  it("webhooks: refused without the pharmacy's signature, delivered with it; unknown providers 404", async () => {
    const ctx = await ctxFor();
    await connect(ctx);
    const raw = JSON.stringify({ records: [rec("w1", 4200, "UPI/430799990000/pay", { utr: "430799990000" })] });
    expect(await handleWebhook("test:bank", ctx.tenantId, raw, new Headers({ "x-signature": "nope" }))).toMatchObject({ status: 401 });
    expect(await db.bankLine.count()).toBe(0);
    expect(await handleWebhook("phonepe", ctx.tenantId, raw, new Headers())).toMatchObject({ status: 404 });
    expect(await handleWebhook("test:bank", ctx.tenantId, raw, new Headers({ "x-signature": sign(raw) }))).toMatchObject({ status: 200, note: "delivered 1" });
    expect(await db.bankLine.count()).toBe(1);
  });

  it("Drive pharmacy: batches are sealed for each counter, opened only by it, recorded on the counter, then deleted", async () => {
    const ctx = await ctxFor();
    await setDriveMode(ctx, true);
    const keys = await newDeviceKeys();
    await registerDevice(ctx, { deviceId: "OWN1", name: "Counter", publicKey: { kty: "RSA", n: keys.publicJwk.n!, e: keys.publicJwk.e! } });
    await connect({ ...ctx });
    script.push({ records: [rec("d1", 85000, "UPI-RAHUL-rahul@okhdfcbank-HDFC0001-430512345678-PAY", { utr: "430512345678" })], cursor: "x", more: false });
    await runSyncJobs(new Date(), 30_000);
    expect(await db.bankLine.count()).toBe(0); // nothing readable on the server
    const waiting = await finInboxFor(ctx.tenantId, "OWN1");
    expect(waiting).toHaveLength(1);
    expect(waiting[0].sealed).not.toContain("RAHUL");
    await expect(openForDevice(keys.privateKey, waiting[0].sealed)).rejects.toThrow(); // not a payment-link entry
    const batchData = await openJsonForDevice<FinBatch>(keys.privateKey, waiting[0].sealed, FIN_AAD);
    const dev = await memoryDb("OWN1");
    expect(importSynced(dev, batchData, "bank-sync")).toMatchObject({ added: 1, duplicates: 0 });
    expect(importSynced(dev, batchData, "bank-sync")).toMatchObject({ added: 0, duplicates: 1 });
    expect(transactions(dev)[0]).toMatchObject({ amountPaise: 85000, utr: "430512345678", verified: true, channel: "upi", counterpartyVpa: "rahul@okhdfcbank" });
    expect(await ackFinInbox(ctx.tenantId, [waiting[0].batchId])).toBe(1);
    expect(await finInboxFor(ctx.tenantId, "OWN1")).toEqual([]);
    await expect(listTransactions(ctx, new URLSearchParams())).rejects.toThrow(/live on its counters/);
  });

  it("another pharmacy can't see, sync, revoke or finish someone else's connection", async () => {
    const ctx = await ctxFor();
    const s = await startConnection(ctx, "test:bank");
    const a = await db.tenant.findFirstOrThrow();
    const t = await db.tenant.create({ data: { code: "OTHER-MUM", name: "Other Pharmacy", settings: a.settings as object } });
    const b = await db.branch.create({ data: { tenantId: t.id, name: "Main", code: "OTM" } });
    const role = await db.role.create({ data: { tenantId: t.id, name: "Owner", permissions: [...DEFAULT_GRANTS.Owner], locked: true } });
    const u = await db.user.create({ data: { tenantId: t.id, name: "Other Owner", email: "o@other.in", phone: "9811100009", roleId: role.id } });
    const other: Ctx = { ...ctx, tenantId: t.id, tenantName: t.name, userId: u.id, branchId: b.id, branches: [{ id: b.id, name: b.name, code: b.code }] };
    await expect(completeCallback(other, new URLSearchParams({ state: state(s.redirectUrl), code: "ok" }))).rejects.toThrow(/isn’t valid for you/);
    await completeCallback(ctx, new URLSearchParams({ state: state(s.redirectUrl), code: "ok" }));
    const id = (await db.finConnection.findFirstOrThrow()).id;
    expect(await listConnections(other)).toEqual([]);
    await expect(requestSync(other, id)).rejects.toThrow(/not found/);
    await expect(revokeConnection(other, id)).rejects.toThrow(/not found/);
    await expect(disconnectConnection(other, id)).rejects.toThrow(/not found/);
    expect(await handleWebhook("test:bank", t.id, "{}", new Headers({ "x-signature": sign("{}") }))).toMatchObject({ status: 401 });
  });
});
