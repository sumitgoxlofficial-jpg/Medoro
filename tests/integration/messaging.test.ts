import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { completeEmbeddedSignup, connectWhatsApp, embeddedSignupConfig, handleWebhook, invoiceTemplateState, messageLog, saveWaSettings, sendInvoice } from "@/domain/comms/whatsapp";
import { deliveryTick, retryMessage } from "@/domain/comms/delivery";
import { draftCampaign, messagingTick, saveCrm, saveSmsSettings, sendCampaign, sendPaymentRemindersNow } from "@/domain/comms/crm";
import { handleInboundSms } from "@/domain/comms/sms-inbound";
import { checkInvoiceLink } from "@/domain/comms/links";
import { badgesAndAlerts } from "@/domain/reports/alerts";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer } from "@/domain/sales/service";
import { saveCustomer } from "@/domain/parties/service";
import { GET as invoiceLinkGet } from "@/app/api/wa/invoice/[token]/route";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

// Fixtures built at runtime so secret scanners don't flag them.
const APP_SECRET = randomBytes(16).toString("hex");
const TOKEN = "EAAB" + "t".repeat(60);
const WABA = "555000111222", PNID = "666000111222";
let sendError: { code: number; status?: number } | null = null;
const calls: { method: string; url: string; body: string }[] = [];
const T = (name: string, params: number, header?: string) => ({ name, language: "en", status: "APPROVED", category: "UTILITY", components: [...(header ? [{ type: "HEADER", format: header }] : []), { type: "BODY", text: Array.from({ length: params }, (_, i) => `{{${i + 1}}}`).join(" x ") }] });
const templates = [T("invoice_share", 3, "DOCUMENT"), T("invoice_link", 4), T("payment_reminder", 3), T("store_update", 2)];

const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const u = String(url), method = init?.method ?? "GET";
  calls.push({ method, url: u.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, ""), body: typeof init?.body === "string" ? init.body : "" });
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.startsWith("https://sms.example/")) return ok({ id: "sms-" + calls.length });
  if (u.includes("/oauth/access_token")) return ok({ access_token: TOKEN, token_type: "bearer" });
  if (u.includes("/debug_token")) return ok({ data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: [WABA] }, { scope: "whatsapp_business_messaging", target_ids: [WABA] }] } });
  if (u.includes(`/${WABA}/phone_numbers`)) return ok({ data: [{ id: PNID, display_phone_number: "+91 20 2546 7788", verified_name: "Test Medical", platform_type: "NOT_APPLICABLE" }] });
  if (u.includes("fields=id,display_phone_number")) return ok({ id: PNID, display_phone_number: "+91 20 2546 7788", verified_name: "Test Medical" });
  if (u.endsWith("/subscribed_apps") || u.endsWith("/register")) return ok({ success: true });
  if (u.includes("message_templates")) return ok({ data: templates });
  if (u.endsWith("/media")) return ok({ id: "media-1" });
  if (u.endsWith("/messages")) {
    if (sendError) return new Response(JSON.stringify({ error: { message: `(#${sendError.code}) failed`, type: "OAuthException", code: sendError.code } }), { status: sendError.status ?? 400 });
    return ok({ messages: [{ id: "wamid." + randomUUID() }] });
  }
  throw new Error("unexpected " + u);
});
const sends = () => calls.filter((c) => c.url.endsWith("/messages"));
const lastBody = () => JSON.parse(sends().at(-1)!.body) as { to: string; template: { name: string; components: { type: string; parameters: { type: string; text?: string }[] }[] } };

describe("WhatsApp onboarding, delivery worker and reminders", () => {
  let med = "", batch = "";
  const sell = async (customerId: string | null, pay: "cash" | "credit" = "cash") => (await commitSale(await ctxFor(), { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId, discountPct: 0, pay: { mode: pay } })).saleId;

  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubEnv("APP_URL", "https://pharmacy.example.in");
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300).slice(0, 7), qty: 50, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow()).id;
  });
  afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("connects through Embedded Signup: code exchange, webhook subscription with override, number registration", async () => {
    const ctx = await ctxFor();
    expect(embeddedSignupConfig()).toBeNull();
    await expect(completeEmbeddedSignup(ctx, { code: "c".repeat(40) })).rejects.toThrow(/isn’t set up/);
    vi.stubEnv("WA_APP_ID", "1234567890"); vi.stubEnv("WA_APP_SECRET", APP_SECRET); vi.stubEnv("WA_CONFIG_ID", "998877");
    expect(embeddedSignupConfig()).toMatchObject({ appId: "1234567890", configId: "998877" });
    await expect(completeEmbeddedSignup(ctx, { code: "c".repeat(40), wabaId: "111111111" })).rejects.toThrow(/didn’t grant/);
    const r = await completeEmbeddedSignup(ctx, { code: "c".repeat(40), wabaId: WABA, phoneNumberId: PNID });
    expect(r).toMatchObject({ wabaId: WABA, phoneNumberId: PNID, via: "embedded", registerError: null });
    const exchange = calls.find((c) => c.url.includes("/oauth/access_token"))!;
    expect(new URL("https://x" + exchange.url).searchParams.get("client_secret")).toBe(APP_SECRET);
    const sub = calls.find((c) => c.method === "POST" && c.url === `/${WABA}/subscribed_apps`)!;
    expect(JSON.parse(sub.body)).toEqual({ override_callback_uri: "https://pharmacy.example.in/api/wa/webhook", verify_token: r.verifyToken });
    expect(JSON.parse(calls.find((c) => c.url === `/${PNID}/register`)!.body)).toMatchObject({ messaging_product: "whatsapp", pin: expect.stringMatching(/^\d{6}$/) });
    const i = await db.integration.findFirstOrThrow({ where: { kind: "whatsapp" } });
    expect(Buffer.from(i.encryptedSecret!).includes(Buffer.from("EAAB"))).toBe(false);
    expect((i.config as { templates: { name: string; header?: string }[] }).templates).toContainEqual(expect.objectContaining({ name: "invoice_share", header: "DOCUMENT" }));
  });

  it("sends only with an approved template; attach-PDF off sends a text template with a signed link", async () => {
    const ctx = await ctxFor();
    const c = await createCustomer(ctx, { name: "Asha Rao", phone: "9822000301", waOptIn: true, creditLimit: "0" });
    const sale = await sell(c);
    await saveWaSettings(ctx, { pdf: false, textTemplate: "invoice_missing" });
    expect(await invoiceTemplateState(ctx.tenantId)).toMatchObject({ ok: false, name: "invoice_missing" });
    await expect(sendInvoice(ctx, sale, "9822000301", true)).rejects.toThrow(/isn’t approved/);
    expect(await db.waMessage.count()).toBe(0);
    await saveWaSettings(ctx, { textTemplate: "invoice_link" });
    const media = calls.filter((x) => x.url.endsWith("/media")).length;
    await sendInvoice(ctx, sale, "9822000301", true);
    expect(calls.filter((x) => x.url.endsWith("/media")).length).toBe(media);
    const b = lastBody();
    expect(b.template.name).toBe("invoice_link");
    const link = b.template.components[0].parameters[3].text!;
    expect(link).toMatch(/^https:\/\/pharmacy\.example\.in\/api\/wa\/invoice\//);
    const token = link.split("/").at(-1)!;
    expect(checkInvoiceLink(token)).toBe(sale);
    expect(checkInvoiceLink(token, Date.now() + 8 * 86400_000)).toBeNull();
    expect(checkInvoiceLink(token.slice(0, -2) + "xx")).toBeNull();
    const res = await invoiceLinkGet(new Request(link), { params: Promise.resolve({ token }) });
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await invoiceLinkGet(new Request(link), { params: Promise.resolve({ token: "bad.1.x" }) })).status).toBe(404);
    await saveWaSettings(ctx, { pdf: true });
  });

  it("retries rate-limited sends with backoff from the worker", async () => {
    const ctx = await ctxFor();
    const c = await createCustomer(ctx, { name: "Bina", phone: "9822000302", waOptIn: true, creditLimit: "0" });
    const sale = await sell(c);
    sendError = { code: 130429 };
    await expect(sendInvoice(ctx, sale, "9822000302", true)).rejects.toThrow(/throughput/);
    const m = await db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: `wa:${sale}` } });
    expect(m).toMatchObject({ status: "failed", errorKind: "retry", attempts: 1 });
    expect(m.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(30_000);
    sendError = null;
    expect(await deliveryTick(new Date())).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await deliveryTick(new Date(Date.now() + 2 * 60_000))).toMatchObject({ sent: 1 });
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "sent", attempts: 2, errorKind: null });
    expect(calls.filter((x) => x.url.endsWith("/media")).length).toBeGreaterThanOrEqual(2);
  });

  it("never retries permanent failures and flags numbers that aren't on WhatsApp", async () => {
    const ctx = await ctxFor();
    const c = await createCustomer(ctx, { name: "Chetan", phone: "9822000303", waOptIn: true, creditLimit: "0" });
    const sale = await sell(c);
    sendError = { code: 131026 };
    await expect(sendInvoice(ctx, sale, "9822000303", true)).rejects.toThrow(/isn’t on WhatsApp/);
    const m = await db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: `wa:${sale}` } });
    expect(m).toMatchObject({ status: "failed", errorKind: "invalid", nextAttemptAt: null });
    expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).waInvalidAt).not.toBeNull();
    sendError = null;
    expect(await deliveryTick(new Date(Date.now() + 86400_000))).toMatchObject({ sent: 0 });
    await expect(retryMessage(ctx, m.id)).rejects.toThrow(/Not retried/);
    expect((await messageLog(ctx)).rows.find((r) => r.id === m.id)).toMatchObject({ retryable: false, errorKind: "invalid" });
    await expect(sendInvoice(ctx, sale, "9822000303", true)).rejects.toThrow(/isn’t on WhatsApp/);
    expect((await badgesAndAlerts(ctx.tenantId, ctx.branchId)).badges.wa?.[0]).toBe(1);
    // A corrected number clears the flag.
    await saveCustomer(ctx, c, { name: "Chetan", phone: "9822000313", waOptIn: true, creditLimit: "0" });
    expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).waInvalidAt).toBeNull();

    // Template problems are permanent too, but say nothing about the number.
    const d = await createCustomer(ctx, { name: "Deepa", phone: "9822000304", waOptIn: true, creditLimit: "0" });
    const sale2 = await sell(d);
    sendError = { code: 132001 };
    await expect(sendInvoice(ctx, sale2, "9822000304", true)).rejects.toThrow(/isn’t approved/);
    expect(await db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: `wa:${sale2}` } })).toMatchObject({ errorKind: "permanent" });
    expect((await db.customer.findUniqueOrThrow({ where: { id: d } })).waInvalidAt).toBeNull();
    sendError = null;
  });

  it("disconnects on a revoked token, pauses the queue and resumes after reconnecting", async () => {
    const ctx = await ctxFor();
    const c = await createCustomer(ctx, { name: "Esha", phone: "9822000305", waOptIn: true, creditLimit: "0" });
    const [s1, s2] = [await sell(c), await sell(c)];
    sendError = { code: 130429 };
    await expect(sendInvoice(ctx, s1, "9822000305", true)).rejects.toThrow();
    sendError = { code: 190, status: 401 };
    await expect(sendInvoice(ctx, s2, "9822000305", true)).rejects.toThrow(/expired or was revoked/);
    const i = await db.integration.findFirstOrThrow({ where: { kind: "whatsapp" } });
    expect((i.config as { disconnected?: { reason: string } }).disconnected?.reason).toMatch(/190/);
    expect((await badgesAndAlerts(ctx.tenantId, ctx.branchId)).alerts.join(" ")).toMatch(/WhatsApp disconnected/);
    const held = await db.waMessage.findMany({ where: { invoiceId: { in: [s1, s2] } } });
    expect(held.map((m) => m.errorKind)).toEqual(["auth", "auth"]);
    expect(held.map((m) => m.attempts).sort()).toEqual([0, 1]);
    await expect(sendInvoice(ctx, s2, "9822000305", true)).rejects.toThrow(/disconnected/);
    sendError = null;
    expect(await deliveryTick(new Date(Date.now() + 3600_000))).toMatchObject({ sent: 0 });
    await connectWhatsApp(ctx, { wabaId: WABA, phoneNumberId: PNID, token: TOKEN, appSecret: APP_SECRET });
    expect((await db.integration.findFirstOrThrow({ where: { kind: "whatsapp" } })).config).toMatchObject({ disconnected: null });
    expect(await deliveryTick(new Date(Date.now() + 1000))).toMatchObject({ sent: 2 });
  });

  it("reminds customers with credit dues, manually and weekly, only with consent", async () => {
    const ctx = await ctxFor();
    const opted = await createCustomer(ctx, { name: "Farid Khan", phone: "9822000306", waOptIn: true, creditLimit: "1000" });
    const silent = await createCustomer(ctx, { name: "Gita", phone: "9822000307", waOptIn: false, creditLimit: "1000" });
    await sell(opted, "credit"); await sell(silent, "credit");
    const before = sends().length;
    expect(await sendPaymentRemindersNow(ctx)).toMatchObject({ sent: 1, failed: 0 });
    expect(sends().length - before).toBe(1);
    expect(lastBody()).toMatchObject({ to: "919822000306", template: { name: "payment_reminder", components: [{ parameters: [{ text: "Farid" }, { text: "155.00" }, { text: "Test Medical Store" }] }] } });
    expect(await sendPaymentRemindersNow(ctx, [opted])).toMatchObject({ sent: 0 });
    await saveCrm(ctx, { payment: true, paymentDay: new Date(Date.now() + 330 * 60_000).getUTCDay() });
    await messagingTick(new Date(), { daily: true });
    expect(sends().length - before).toBe(1); // reminded within the last 6 days
  });

  it("falls back to SMS for customers who only consented to SMS, and honours STOP by SMS", async () => {
    const ctx = await ctxFor();
    vi.stubEnv("OTP_PROVIDER", "http"); vi.stubEnv("OTP_HTTP_URL", "https://sms.example/send"); vi.stubEnv("SMS_INBOUND_TOKEN", "inbound-" + randomUUID());
    const h = await createCustomer(ctx, { name: "Hari Om", phone: "9822000308", waOptIn: false, smsOptIn: true, creditLimit: "1000" });
    await sell(h, "credit");
    expect(await sendPaymentRemindersNow(ctx, [h])).toMatchObject({ sent: 0, skipped: 1 }); // SMS still off
    await saveSmsSettings(ctx, { enabled: true, templates: { payment: "1107160000000000001" } });
    expect(await sendPaymentRemindersNow(ctx, [h])).toMatchObject({ sent: 1 });
    const sms = calls.filter((c) => c.url === "https://sms.example/send").at(-1)!;
    expect(JSON.parse(sms.body)).toMatchObject({ phone: "+919822000308", type: "payment", vars: ["Hari", "155.00", "Test Medical Store"], dltTemplateId: "1107160000000000001", text: expect.stringMatching(/Rs 155\.00 is due.*Reply STOP/) });
    expect(await db.waMessage.findFirstOrThrow({ where: { customerId: h } })).toMatchObject({ channel: "sms", status: "sent" });

    const headers = (tok: string) => new Headers({ authorization: `Bearer ${tok}` });
    expect(await handleInboundSms(JSON.stringify({ from: "+919822000308", text: "stop" }), headers("wrong"))).toBeNull();
    expect(await handleInboundSms(JSON.stringify({ from: "+919822000308", text: "STOP please" }), headers(process.env.SMS_INBOUND_TOKEN!))).toBe(1);
    expect(await db.customer.findUniqueOrThrow({ where: { id: h } })).toMatchObject({ smsOptIn: false, smsOptInMethod: "Opted out by replying STOP by SMS" });

    // Store update: WhatsApp customers get the template with the text as variable 2; Hari opted out of SMS.
    await draftCampaign(ctx, "Diwali hours", "store_update", "Open 9 to 2 on Diwali.\nHappy Diwali!");
    const camp = await db.campaign.findFirstOrThrow({ where: { name: "Diwali hours" } });
    expect(camp.message).toBe("Open 9 to 2 on Diwali. Happy Diwali!");
    const smsBefore = calls.filter((c) => c.url === "https://sms.example/send").length;
    const r = await sendCampaign(ctx, camp.id);
    expect(r.done).toBe(true);
    expect(lastBody().template).toMatchObject({ name: "store_update", components: [{ parameters: [{}, { text: "Open 9 to 2 on Diwali. Happy Diwali!" }] }] });
    expect(calls.filter((c) => c.url === "https://sms.example/send").length).toBe(smsBefore);
    expect(await db.waMessage.count({ where: { invoiceId: "campaign:" + camp.id, customerId: h } })).toBe(0);
  });

  it("applies failures reported later by webhook: retry temporary ones, flag invalid numbers", async () => {
    const ctx = await ctxFor();
    const c = await createCustomer(ctx, { name: "Indu", phone: "9822000309", waOptIn: true, creditLimit: "0" });
    const [s1, s2] = [await sell(c), await sell(c)];
    await sendInvoice(ctx, s1, "9822000309", true);
    await sendInvoice(ctx, s2, "9822000309", true);
    const [m1, m2] = await Promise.all([s1, s2].map((s) => db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: `wa:${s}` } })));
    const hook = (statuses: unknown[]) => JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PNID }, statuses } }] }] });
    const sign = (b: string) => "sha256=" + createHmac("sha256", APP_SECRET).update(b).digest("hex");
    const b1 = hook([{ id: m1.wamid, status: "failed", errors: [{ code: 131000, title: "Something went wrong" }] }]);
    await handleWebhook(b1, sign(b1));
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: m1.id } })).toMatchObject({ status: "failed", errorKind: "retry" });
    await handleWebhook(b1, sign(b1)); // replay is a no-op
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: m1.id } })).attempts).toBe(1);
    const b2 = hook([{ id: m2.wamid, status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }]);
    await handleWebhook(b2, sign(b2));
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: m2.id } })).toMatchObject({ errorKind: "invalid" });
    expect((await db.customer.findUniqueOrThrow({ where: { id: c } })).waInvalidReason).toMatch(/131026/);
    // The worker won't resend to a flagged number: the pending retry is dropped.
    expect(await deliveryTick(new Date(Date.now() + 3600_000))).toMatchObject({ sent: 0, skipped: 1 });
    expect(await db.waMessage.findUniqueOrThrow({ where: { id: m1.id } })).toMatchObject({ errorKind: "permanent" });
    const b3 = JSON.stringify({ entry: [{ id: WABA, changes: [{ field: "message_template_status_update", value: { event: "PAUSED", message_template_name: "store_update", message_template_language: "en" } }] }] });
    await handleWebhook(b3, sign(b3));
    expect((await db.integration.findFirstOrThrow({ where: { kind: "whatsapp" } })).config).toMatchObject({ templates: expect.arrayContaining([expect.objectContaining({ name: "store_update", status: "paused" })]) });
  });
});
