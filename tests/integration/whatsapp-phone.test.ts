import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { disconnectWhatsApp, phoneLinkStatus, sendInvoice, waStatus } from "@/domain/comms/whatsapp";
import { deliveryTick } from "@/domain/comms/delivery";
import { draftCampaign } from "@/domain/comms/crm";
import { phoneKind, phoneText } from "@/domain/comms/phone-text";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer } from "@/domain/sales/service";
import { addDays, todayISO } from "@/lib/dates";
import { counterWhatsAppState, sendCounterBill, type CounterBill } from "@/domain/comms/counter-send";
import { setDriveMode } from "@/domain/system/drive-mode";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

// A stand-in for the WhatsApp connector (fitron/whatsapp-connector): one business, a session that goes from
// DISCONNECTED to QR to CONNECTED, and a message log.
const URL_ = "https://wa-api.test";
let session = "DISCONNECTED";
let sendError: { code: string; message: string; status: number } | null = null;
const created: { externalId?: string }[] = [];
const sent: { path: string; to: string; text: string; key: string; file?: string }[] = [];
const results: Record<string, string> = {};
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const auth = new Headers(init?.headers).get("authorization");
  const path = u.pathname;
  if (path.startsWith("/api/v1/gyms")) {
    expect(auth).toBe("Bearer master-key");
    if (path.startsWith("/api/v1/gyms/by-external/")) return new Response(JSON.stringify({ success: false, error: { code: "GYM_NOT_FOUND", message: "no" } }), { status: 404 });
    created.push(JSON.parse(String(init?.body)));
    return ok({ gymId: "gym-1", apiKey: "wak_pharmacy" }, 201);
  }
  expect(auth).toBe("Bearer wak_pharmacy");
  if (path === "/api/v1/whatsapp/status") return ok({ status: session, phone: session === "CONNECTED" ? "+919822000555" : null, error: null, workerRunning: true, today: { sent: 0 }, limits: { perDay: 500 } });
  if (path === "/api/v1/whatsapp/connect") { session = "QR_REQUIRED"; return ok({ status: session }); }
  if (path === "/api/v1/whatsapp/qr") return ok({ status: session, qr: "data:image/png;base64,QR" });
  if (path === "/api/v1/whatsapp/disconnect") { session = "DISCONNECTED"; return ok({ status: session }); }
  if (path === "/api/v1/messages" && init?.method !== "POST") {
    const ids = (u.searchParams.get("ids") ?? "").split(",");
    return ok({ items: ids.filter((id) => results[id]).map((id) => ({ messageId: id, status: results[id], error: results[id] === "FAILED" ? "This number is not on WhatsApp" : null, idempotencyKey: null })) });
  }
  if (path === "/api/v1/messages/send" || path === "/api/v1/messages/document") {
    if (sendError) return new Response(JSON.stringify({ success: false, error: sendError }), { status: sendError.status });
    const id = "msg-" + (sent.length + 1);
    if (init?.body instanceof FormData) {
      const f = init.body;
      sent.push({ path, to: String(f.get("to")), text: String(f.get("caption")), key: String(f.get("idempotencyKey")), file: (f.get("file") as File).name });
    } else {
      const b = JSON.parse(String(init?.body));
      sent.push({ path, to: b.to, text: b.message, key: b.idempotencyKey });
    }
    return ok({ messageId: id, status: "QUEUED" }, 202);
  }
  throw new Error("unexpected " + path);
});

describe("WhatsApp from a linked phone (QR)", () => {
  let sale = "";
  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubEnv("WA_CONNECTOR_URL", URL_);
    vi.stubEnv("WA_CONNECTOR_KEY", "master-key");
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300).slice(0, 7), qty: 10, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    const c = await createCustomer(ctx, { name: "Ramesh Patil", phone: "9822041736", waOptIn: true, marketingWa: true, creditLimit: "0" });
    sale = (await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: (await db.batch.findFirstOrThrow()).id, qty: 1 }], customerId: c, discountPct: 0, pay: { mode: "cash" } })).saleId;
  });
  afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("writes the message text itself for each kind of message", () => {
    expect(phoneKind("refill:c:m:2026-01-01")).toBe("refill");
    expect(phoneKind("3f1c-sale-id")).toBe("invoice");
    expect(phoneText("invoice", ["Ramesh", "INV/1", "155.00"], "Test Medical", { pdf: true })).toBe("Hello Ramesh, thank you for shopping at Test Medical. Your invoice INV/1 for Rs 155.00 is attached.");
    expect(phoneText("campaign", ["Asha", "Open on   Sunday"], "Test Medical")).toBe("Hi Asha, Open on Sunday - Test Medical\n\nReply STOP to opt out.");
  });

  it("shows a QR, then records the linked phone as the pharmacy's WhatsApp", async () => {
    const ctx = await ctxFor();
    const first = await phoneLinkStatus(ctx);
    expect(first.state).toBe("waiting");
    expect(created[0].externalId).toBe(`medoro:${ctx.tenantId}`);
    // The connector key is sealed, never stored as text.
    const key = await db.integration.findFirstOrThrow({ where: { kind: "wa_connector" } });
    expect(Buffer.from(key.encryptedSecret!).includes(Buffer.from("wak_pharmacy"))).toBe(false);
    expect(await phoneLinkStatus(ctx)).toMatchObject({ state: "qr", qr: "data:image/png;base64,QR" });
    session = "CONNECTED";
    expect(await phoneLinkStatus(ctx)).toMatchObject({ state: "ready", number: "+919822000555" });
    const st = await waStatus(ctx.tenantId);
    expect(st.connected && st.cfg).toMatchObject({ via: "phone", displayPhone: "+919822000555", disconnected: null });
  });

  it("sends the bill PDF from the phone, then follows its delivery", async () => {
    const ctx = await ctxFor("Cashier");
    expect((await sendInvoice(ctx, sale, "98220 41736", true)).status).toBe("sent");
    expect(sent[0]).toMatchObject({ path: "/api/v1/messages/document", to: "+919822041736" });
    expect(sent[0].file).toMatch(/\.pdf$/);
    expect(sent[0].text).toMatch(/Hello Ramesh Patil, thank you for shopping at Test Medical Store\. Your invoice .+ is attached\./);
    const m = await db.waMessage.findFirstOrThrow();
    expect(m).toMatchObject({ status: "sent", wamid: "msg-1" });
    results["msg-1"] = "DELIVERED";
    await deliveryTick();
    expect((await db.waMessage.findFirstOrThrow()).status).toBe("delivered");
    results["msg-1"] = "SENT"; // never backwards
    await deliveryTick();
    expect((await db.waMessage.findFirstOrThrow()).status).toBe("delivered");
  });

  it("a Drive counter's bill goes out as a PDF from the linked phone, and Medoro keeps nothing", async () => {
    const owner = await ctxFor(), cashier = await ctxFor("Cashier");
    const bill: CounterBill = {
      sendId: "press0000001", phone: "98220 41736", customerName: "Ramesh Patil", invoiceNo: "DAB12-2026-7", at: new Date().toISOString(),
      lines: [{ name: "Pan 40", batchNo: "P1", expiry: "2027-08-31", qtyText: "1 strip", mrp: 15500, discount: 0, gstRate: 12, amount: 15500 }],
      totals: { mrp: 15500, discount: 0, taxable: 13839, cgst: 830, sgst: 831, igst: 0, roundOff: 0, total: 15500 }, payments: [{ mode: "cash" }],
    };
    await expect(sendCounterBill(cashier, bill)).rejects.toThrow(/sent from Billing/); // only Drive mode pharmacies
    await setDriveMode(owner, true);
    expect(await counterWhatsAppState(cashier)).toMatchObject({ connected: true, via: "phone" });
    await expect(sendCounterBill(cashier, { ...bill, phone: "12345" })).rejects.toThrow(/valid 10-digit/);
    const rows = await db.waMessage.count(), audits = await db.auditEvent.count();
    expect(await sendCounterBill(cashier, bill)).toEqual({ sent: true, via: "phone" });
    const m = sent.at(-1)!;
    expect(m).toMatchObject({ path: "/api/v1/messages/document", to: "+919822041736", file: "DAB12-2026-7.pdf", key: `counter:${cashier.tenantId}:press0000001` });
    expect(m.text).toBe("Hello Ramesh Patil, thank you for shopping at Test Medical Store. Your invoice DAB12-2026-7 for Rs 155.00 is attached.");
    expect(await db.waMessage.count()).toBe(rows);
    expect(await db.auditEvent.count()).toBe(audits);
    await setDriveMode(owner, false);
  });

  it("a store update needs its text; there are no Meta templates", async () => {
    const ctx = await ctxFor();
    await expect(draftCampaign(ctx, "Diwali", "store_update")).rejects.toThrow(/update text/);
    await draftCampaign(ctx, "Diwali", "store_update", "Open till 11 pm this week");
    expect(await db.campaign.count()).toBe(1);
  });

  it("a signed-out phone pauses sending, and sending resumes once it is back", async () => {
    const ctx = await ctxFor();
    await db.waMessage.updateMany({ data: { status: "failed", errorKind: "retry" } });
    sendError = { code: "WHATSAPP_NOT_CONNECTED", message: "WhatsApp is not connected.", status: 409 };
    await expect(sendInvoice(ctx, sale, "9822041736", true)).rejects.toThrow(/not connected/);
    const st = await waStatus(ctx.tenantId);
    expect(st.connected && st.cfg.disconnected).toBeTruthy();
    expect(await db.waMessage.findFirstOrThrow()).toMatchObject({ status: "failed", errorKind: "auth" });
    // The phone comes back on the connector: the worker notices, clears the pause and sends the held message.
    sendError = null;
    await deliveryTick();
    expect((await waStatus(ctx.tenantId)).paused).toBe(false);
    await deliveryTick();
    expect((await db.waMessage.findFirstOrThrow()).status).toBe("sent");
    expect(sent.at(-1)!.key).not.toBe(sent[0].key);
  });

  it("unlinking signs the phone out on the connector", async () => {
    const ctx = await ctxFor();
    await disconnectWhatsApp(ctx);
    expect(session).toBe("DISCONNECTED");
    expect((await waStatus(ctx.tenantId)).connected).toBe(false);
  });
});

describe("Meta webhook with a linked phone", () => {
  it("never accepts a payload signed with the phone link's empty app secret", async () => {
    const { createHmac } = await import("node:crypto");
    const { handleWebhook, verifyWebhook } = await import("@/domain/comms/whatsapp");
    const i = await db.integration.findFirst({ where: { kind: "whatsapp" } });
    if (!i) return;
    await db.integration.update({ where: { id: i.id }, data: { connectedAt: new Date(), config: { ...(i.config as object), via: "phone", phoneNumberId: "", wabaId: "" } } });
    const body = JSON.stringify({ entry: [{ id: "", changes: [{ value: { metadata: { phone_number_id: "" }, messages: [{ from: "919822041736", type: "text", text: { body: "STOP" } }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", "").update(body).digest("hex");
    expect(await handleWebhook(body, sig)).toBe(0);
    expect(await verifyWebhook((i.config as { verifyToken: string }).verifyToken)).toBe(false);
  });
});
