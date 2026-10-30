import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { connectWhatsApp, handleWebhook, sendInvoice, verifyWebhook } from "@/domain/comms/whatsapp";
import { campaignRef, draftCampaign, retryCampaignMessage, sendCampaign } from "@/domain/comms/crm";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer } from "@/domain/sales/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

// Built at runtime so secret scanners don't mistake the test fixture for a real key.
const SECRET = randomBytes(16).toString("hex");
let fail = false;
const calls: string[] = [];
const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const u = String(url); calls.push(`${init?.method ?? "GET"} ${u.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, "")}`);
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.includes("fields=display_phone_number")) return ok({ display_phone_number: "+91 20 2546 7788", verified_name: "Test Medical" });
  if (u.includes("message_templates")) return ok({ data: [{ name: "invoice_share", language: "en", status: "APPROVED", category: "UTILITY" }] });
  if (u.endsWith("/media")) return ok({ id: "media-1" });
  if (u.endsWith("/messages")) return fail ? new Response(JSON.stringify({ error: { message: "Recipient not on WhatsApp" } }), { status: 400 }) : ok({ messages: [{ id: "wamid.ABC" + calls.length }] });
  throw new Error("unexpected " + u);
});

describe("WhatsApp", () => {
  let sale = "";
  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300).slice(0, 7), qty: 10, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    const c = await createCustomer(ctx, { name: "Ramesh", phone: "9822041736", waOptIn: true, creditLimit: "0" });
    sale = (await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: (await db.batch.findFirstOrThrow()).id, qty: 1 }], customerId: c, discountPct: 0, pay: { mode: "cash" } })).saleId;
  });
  afterAll(() => vi.unstubAllGlobals());

  it("connects only after Meta accepts the credentials and seals the token", async () => {
    const ctx = await ctxFor();
    await expect(connectWhatsApp(ctx, { wabaId: "1", phoneNumberId: "2", token: "x", appSecret: "y" })).rejects.toThrow();
    const cfg = await connectWhatsApp(ctx, { wabaId: "104829371650012", phoneNumberId: "112093847561203", token: "EAAG" + "x".repeat(60), appSecret: SECRET });
    expect(cfg.displayPhone).toBe("+91 20 2546 7788");
    const i = await db.integration.findFirstOrThrow({ where: { kind: "whatsapp" } });
    expect(Buffer.from(i.encryptedSecret!).includes(Buffer.from("EAAG"))).toBe(false);
    expect((i.config as { templates: unknown[] }).templates).toHaveLength(1);
    expect(await verifyWebhook("wrong")).toBe(false);
    expect(await verifyWebhook((i.config as { verifyToken: string }).verifyToken)).toBe(true);
  });

  it("sends once, needs consent, updates from signed webhooks, honours STOP", async () => {
    const ctx = await ctxFor("Cashier");
    await expect(sendInvoice(ctx, sale, "98220 41736", false)).rejects.toThrow(/consent/);
    const r = await sendInvoice(ctx, sale, "98220 41736", true);
    expect(r.status).toBe("sent");
    expect(calls.some((c) => c.startsWith("POST") && c.endsWith("/media"))).toBe(true);
    await expect(sendInvoice(ctx, sale, "9822041736", true)).rejects.toThrow(/Already sent/);
    const m = await db.waMessage.findFirstOrThrow();
    const hook = (statuses: unknown[], messages: unknown[] = []) => JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "112093847561203" }, statuses, messages } }] }] });
    const sign = (b: string) => "sha256=" + createHmac("sha256", SECRET).update(b).digest("hex");
    const b1 = hook([{ id: m.wamid, status: "delivered" }]);
    await expect(handleWebhook(b1, "sha256=bad")).rejects.toThrow(/signature/);
    await handleWebhook(b1, sign(b1));
    expect((await db.waMessage.findFirstOrThrow()).status).toBe("delivered");
    const b2 = hook([{ id: m.wamid, status: "sent" }]); // out-of-order event must not go backwards
    await handleWebhook(b2, sign(b2));
    expect((await db.waMessage.findFirstOrThrow()).status).toBe("delivered");
    const b3 = hook([], [{ from: "919822041736", type: "text", text: { body: "stop" } }]);
    await handleWebhook(b3, sign(b3));
    expect((await db.customer.findFirstOrThrow()).waOptIn).toBe(false);
  });

  it("failed sends retry at most 3 times", async () => {
    await db.waMessage.updateMany({ data: { status: "failed" } });
    fail = true;
    const ctx = await ctxFor();
    await expect(sendInvoice(ctx, sale, "9822041736", true)).rejects.toThrow(/Recipient not on WhatsApp/);
    await expect(sendInvoice(ctx, sale, "9822041736", true)).rejects.toThrow(/Recipient/);
    await expect(sendInvoice(ctx, sale, "9822041736", true)).rejects.toThrow(/limit/);
    expect((await db.waMessage.findFirstOrThrow()).attempts).toBe(3);
  });

  it("campaigns resume without resending, finish as sent, and failed messages can be retried", async () => {
    fail = false;
    const ctx = await ctxFor();
    const ids = [];
    for (const [n, ph] of [["Asha Rao", "9822000101"], ["Bina", "9822000102"], ["Chetan", "9822000103"]] as const) ids.push(await createCustomer(ctx, { name: n, phone: ph, waOptIn: true, creditLimit: "0" }));
    await draftCampaign(ctx, "Diwali", "invoice_share");
    const camp = await db.campaign.findFirstOrThrow({ where: { name: "Diwali" } });
    // A previous run reached Asha, then the server died with the campaign still "sending".
    await db.campaign.update({ where: { id: camp.id }, data: { status: "sending" } });
    await db.waMessage.create({ data: { tenantId: camp.tenantId, invoiceId: campaignRef(camp.id), invoiceNo: "Diwali", recipient: "9822000101", idempotencyKey: `camp:${camp.id}:${ids[0]}`, status: "sent", attempts: 1 } });
    const before = calls.filter((c) => c.endsWith("/messages")).length;
    const r = await sendCampaign(ctx, camp.id);
    expect(r).toEqual({ ok: 2, bad: 0, done: true });
    expect(calls.filter((c) => c.endsWith("/messages")).length - before).toBe(2);
    expect(await db.campaign.findUniqueOrThrow({ where: { id: camp.id } })).toMatchObject({ status: "sent", audience: 3 });
    await expect(sendCampaign(ctx, camp.id)).rejects.toThrow(/already sent/);

    const m = await db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: `camp:${camp.id}:${ids[1]}` } });
    await db.waMessage.update({ where: { id: m.id }, data: { status: "failed" } });
    expect((await retryCampaignMessage(ctx, m.id)).status).toBe("sent");
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "sent", attempts: 2 });
    await db.waMessage.update({ where: { id: m.id }, data: { status: "failed" } });
    await db.customer.update({ where: { id: ids[1] }, data: { waOptIn: false } });
    await expect(retryCampaignMessage(ctx, m.id)).rejects.toThrow(/opted out/);
  });
});
