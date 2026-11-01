import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@/server/db";
import { setDriveMode } from "@/domain/system/drive-mode";
import { registerDevice, relay } from "@/domain/system/drivedb-relay";
import { connectCustomerPay, createPayLink, handlePayWebhook, payStatus } from "@/domain/system/customer-pay";
import { newDeviceKeys } from "@/drivedb/keyring";
import { applyPayments, openForDevice } from "@/drivedb/inbox";
import { memoryDb } from "@/drivedb/node";
import { customerBalance } from "@/drivedb/trade";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

// Fake Razorpay credentials, made at run time (no secret-looking literals in the repo).
const KEYS = { keyId: ["rzp", "test", "A".repeat(12)].join("_"), keySecret: "k".repeat(16), webhookSecret: "w".repeat(12) };
const calls: { url: string; init?: RequestInit }[] = [];
const fakeRzp = (status = 200, body: unknown = { items: [] }) => (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
const P = (o: Record<string, string>) => new URLSearchParams(o);
const paid = (customerId: string, paymentId = "pay_TESTPAY0001", amount = 25000) => JSON.stringify({
  event: "payment_link.paid",
  payload: { payment_link: { entity: { id: "plink_1", amount_paid: amount, notes: { medoro: "1", customer: customerId } } }, payment: { entity: { id: paymentId, amount, method: "upi", created_at: 1793500000 } } },
});
const sign = (raw: string, secret = KEYS.webhookSecret) => createHmac("sha256", secret).update(raw).digest("hex");

describe("customer online payments in Drive mode (phase 6)", () => {
  const prev = process.env.E2E_FAKE_DRIVE;
  let tenantId = "";
  beforeAll(async () => {
    process.env.E2E_FAKE_DRIVE = "1"; delete process.env.VERCEL;
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    tenantId = ctx.tenantId;
    await setDriveMode(ctx, true);
  });
  afterAll(() => { if (prev === undefined) delete process.env.E2E_FAKE_DRIVE; else process.env.E2E_FAKE_DRIVE = prev; });

  it("the owner connects their own Razorpay account; bad keys are refused and the secrets are kept sealed", async () => {
    const ctx = await ctxFor();
    await expect(connectCustomerPay(await ctxFor("Manager"), KEYS, fakeRzp())).rejects.toThrow(/role|owner/);
    await expect(connectCustomerPay(ctx, { ...KEYS, keyId: "nope" }, fakeRzp())).rejects.toThrow(/Key Id/);
    await expect(connectCustomerPay(ctx, KEYS, fakeRzp(401, {}))).rejects.toThrow(/didn’t accept/);
    const st = await connectCustomerPay(ctx, KEYS, fakeRzp());
    expect(st).toMatchObject({ connected: true, keyId: KEYS.keyId, webhookUrl: expect.stringMatching(new RegExp(`/api/razorpay/pay/${tenantId}$`)) });
    const i = await db.integration.findFirstOrThrow({ where: { tenantId, kind: "razorpay_pay" } });
    expect(Buffer.from(i.encryptedSecret!).toString()).not.toContain(KEYS.keySecret);
    expect(await db.auditEvent.count({ where: { tenantId, action: "Online payments connected" } })).toBe(1);
    expect((await payStatus(ctx)).connected).toBe(true);
  });

  it("a counter gets a payment link for a customer's dues (Medoro keeps nothing)", async () => {
    const cashier = await ctxFor("Cashier");
    calls.length = 0;
    const r = await createPayLink({ ...cashier, moved: true }, { customerId: "c1", customerName: "Asha", phone: "98220 00001", amountPaise: 25000, label: "Dues" }, fakeRzp(200, { id: "plink_1", short_url: "https://rzp.io/i/abc" }));
    expect(r).toEqual({ url: "https://rzp.io/i/abc", id: "plink_1" });
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body).toMatchObject({ amount: 25000, currency: "INR", customer: { name: "Asha", contact: "+919822000001" }, notes: { medoro: "1", customer: "c1" } });
    expect(calls[0].init!.headers).toMatchObject({ Authorization: "Basic " + Buffer.from(`${KEYS.keyId}:${KEYS.keySecret}`).toString("base64") });
    expect(await db.paymentInbox.count()).toBe(0);
  });

  it("a payment made while the counter is offline waits sealed, is recorded when it comes back, then is deleted", async () => {
    const owner = await ctxFor();
    const keys = await newDeviceKeys();
    await registerDevice(owner, { deviceId: "OWN1", name: "Counter", publicKey: { kty: "RSA", n: keys.publicJwk.n!, e: keys.publicJwk.e! } });
    const raw = paid("c1");
    expect(await handlePayWebhook(tenantId, raw, "bad")).toMatchObject({ status: 401 });
    expect(await handlePayWebhook(tenantId, raw, sign(raw, "other-secret"))).toMatchObject({ status: 401 });
    expect(await handlePayWebhook(tenantId, raw, sign(raw))).toMatchObject({ status: 200, note: "queued" });
    expect(await handlePayWebhook(tenantId, raw, sign(raw))).toMatchObject({ status: 200 }); // Razorpay retries: still one entry
    const rows = await db.paymentInbox.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sealed).not.toContain("c1"); // only the device can read who paid

    // The counter comes online: it picks the payment up through the relay, records it, and acknowledges it.
    const dev = await memoryDb("OWN1");
    dev.from("customer").insert({ id: "c1", name: "Asha", phone: "9822000001", creditLimitPaise: 100000 });
    dev.from("customerReceipt").insert({ customerId: "c1", amountPaise: -40000, mode: "cash", ref: "Opening", userId: "u", at: "2026-01-01T00:00:00.000Z" });
    const box = (await relay(owner, "OWN1", "inbox", P({}), Buffer.alloc(0))) as { payments: { paymentId: string; sealed: string }[] };
    const opened = await Promise.all(box.payments.map((p) => openForDevice(keys.privateKey, p.sealed)));
    expect(opened).toEqual([expect.objectContaining({ customerId: "c1", amountPaise: 25000, paymentId: "pay_TESTPAY0001" })]);
    const done = applyPayments(dev, opened);
    expect(customerBalance(dev, "c1")).toBe(15000);
    await relay(owner, "OWN1", "inbox-ack", P({ ids: done.join(",") }), Buffer.alloc(0));
    expect(await db.paymentInbox.count({ where: { tenantId } })).toBe(0);
  });

  it("ignores other events and links Medoro didn't make", async () => {
    const other = JSON.stringify({ event: "payment.captured", payload: {} });
    expect(await handlePayWebhook(tenantId, other, sign(other))).toMatchObject({ status: 200, note: "ignored" });
    const foreign = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_2", notes: {} } }, payment: { entity: { id: "pay_X0000001", amount: 100 } } } });
    expect(await handlePayWebhook(tenantId, foreign, sign(foreign))).toMatchObject({ status: 200, note: "not a Medoro link" });
    expect(await db.paymentInbox.count({ where: { tenantId } })).toBe(0);
  });
});
