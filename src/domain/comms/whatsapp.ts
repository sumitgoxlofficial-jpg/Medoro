import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, requireSubscription, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { seal } from "@/server/vault";
import { STOP_WORDS } from "@/server/sms";
import { invoiceData } from "@/domain/sales/service";
import { creditNoteData } from "@/domain/sales/returns";
import { MOBILE_RE, normPhone } from "@/domain/identity/contracts";
import { graph, GRAPH_VERSION, GraphError, reasonFor, webhookKind } from "./graph";
import { invoiceLink } from "./links";
import {
  activeAccount, approvedTemplate, dispatch, MAX_ATTEMPTS, patchConfig, queueMessage, recordFailure, refreshTemplates, resumeAfterReconnect, retryable, waAccount,
  type Payload, type Secrets, type WaConfig,
} from "./delivery";

export type { WaConfig } from "./delivery";

export type WaSettings = { auto: boolean; pdf: boolean; textTemplate: string; creditNoteTemplate: string };
const TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;

export const connectSchema = z.object({
  wabaId: z.string().trim().regex(/^\d{8,20}$/, "WABA ID is a long number from Meta Business Manager."),
  phoneNumberId: z.string().trim().regex(/^\d{8,20}$/, "Phone number ID is a long number from the WhatsApp API setup page."),
  token: z.string().trim().min(40, "Paste the permanent (system user) access token."),
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/i, "App secret is 32 hex characters from your Meta app’s basic settings."),
  invoiceTemplate: z.string().trim().regex(TEMPLATE_RE, "Template names are lowercase with underscores.").default("invoice_share"),
  templateLang: z.string().trim().default("en"),
});

type Phone = { id: string; display_phone_number: string; verified_name: string; platform_type?: string };

/** Seals the credentials on this server and (re)connects; a reconnect resumes messages paused by a revoked token. */
async function saveConnection(ctx: Ctx, c: { wabaId: string; phone: Phone; sec: Secrets; via: "embedded" | "manual"; invoiceTemplate?: string; templateLang?: string }) {
  const old = await db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } } });
  const prev = (old?.config ?? null) as WaConfig | null;
  const cfg: WaConfig = {
    wabaId: c.wabaId, phoneNumberId: c.phone.id, displayPhone: c.phone.display_phone_number, verifiedName: c.phone.verified_name,
    verifyToken: prev?.verifyToken ?? randomBytes(18).toString("base64url"), webhookVerified: prev?.phoneNumberId === c.phone.id ? prev.webhookVerified : false,
    invoiceTemplate: c.invoiceTemplate ?? prev?.invoiceTemplate ?? "invoice_share", templateLang: c.templateLang ?? prev?.templateLang ?? "en",
    templates: prev?.wabaId === c.wabaId ? prev.templates : [], via: c.via, disconnected: null, registerError: null,
  };
  const sealed = new Uint8Array(seal(JSON.stringify(c.sec)));
  await db.integration.upsert({
    where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } },
    create: { tenantId: ctx.tenantId, kind: "whatsapp", config: cfg, encryptedSecret: sealed, connectedAt: new Date(), rotatedAt: new Date() },
    update: { config: cfg, encryptedSecret: sealed, connectedAt: old?.connectedAt ?? new Date(), rotatedAt: new Date() },
  });
  await resumeAfterReconnect(ctx.tenantId);
  const action = prev?.disconnected ? "WhatsApp reconnected" : old?.connectedAt ? "WhatsApp token rotated" : "WhatsApp connected";
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action, entity: "integration", detail: `${c.phone.verified_name} · ${c.phone.display_phone_number} · ${c.via === "embedded" ? "Embedded Signup" : "manual credentials"}` });
  return cfg;
}

/** Manual fallback: verifies pasted credentials with Meta, then stores them sealed on this server. */
export async function connectWhatsApp(ctx: Ctx, raw: z.input<typeof connectSchema>) {
  authorize(ctx, "integrations");
  const i = connectSchema.parse(raw);
  const phone = await graph<Phone>(`/${i.phoneNumberId}?fields=id,display_phone_number,verified_name`, i.token);
  const cfg = await saveConnection(ctx, { wabaId: i.wabaId, phone: { ...phone, id: i.phoneNumberId }, sec: { token: i.token, appSecret: i.appSecret }, via: "manual", invoiceTemplate: i.invoiceTemplate, templateLang: i.templateLang });
  await syncTemplates(ctx).catch(() => {});
  return cfg;
}

// ───────────── Embedded Signup ─────────────

/** Settings the browser needs to launch Meta's Embedded Signup; null when the server isn't set up for it. */
export function embeddedSignupConfig() {
  const { WA_APP_ID: appId, WA_CONFIG_ID: configId, WA_APP_SECRET: secret } = process.env;
  return appId && configId && secret ? { appId, configId, version: GRAPH_VERSION() } : null;
}

export const signupSchema = z.object({
  code: z.string().trim().min(10).max(4000),
  wabaId: z.string().trim().regex(/^\d{5,25}$/).optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/).optional(),
});

/**
 * Finishes Embedded Signup (Tech Provider onboarding): exchanges the 30-second code for the customer's
 * business token, finds the shared WABA (from the session event, checked against the token's granted
 * assets) and its phone number, seals the token, subscribes this app to the WABA's webhooks (pointed at this
 * server when APP_URL is https), registers the number for Cloud API if needed, and syncs templates.
 */
export async function completeEmbeddedSignup(ctx: Ctx, raw: z.input<typeof signupSchema>) {
  authorize(ctx, "integrations");
  const es = embeddedSignupConfig();
  if (!es) throw new UserError("Embedded Signup isn’t set up on this server (WA_APP_ID, WA_APP_SECRET, WA_CONFIG_ID). Use the manual form.");
  const i = signupSchema.parse(raw);
  const secret = process.env.WA_APP_SECRET!;
  const { access_token: token } = await graph<{ access_token: string }>(`/oauth/access_token?${new URLSearchParams({ client_id: es.appId, client_secret: secret, code: i.code })}`, null);
  if (!token) throw new UserError("Meta didn’t return an access token. Start the signup again.");
  const dbg = await graph<{ data: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(`/debug_token?${new URLSearchParams({ input_token: token, access_token: `${es.appId}|${secret}` })}`, null);
  const scopes = dbg.data.granular_scopes ?? [];
  const granted = [...new Set(["whatsapp_business_management", "whatsapp_business_messaging"].flatMap((s) => scopes.find((x) => x.scope === s)?.target_ids ?? []))];
  if (i.wabaId && granted.length && !granted.includes(i.wabaId)) throw new UserError("Meta didn’t grant access to that WhatsApp Business Account. Start the signup again.");
  const wabaId = i.wabaId ?? granted[0];
  if (!wabaId) throw new UserError("No WhatsApp Business Account was shared during signup. Start it again and finish every step.");
  const phones = await graph<{ data: Phone[] }>(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type`, token);
  const phone = i.phoneNumberId ? phones.data.find((p) => p.id === i.phoneNumberId) : phones.data[0];
  if (!phone) throw new UserError(i.phoneNumberId ? "That phone number isn’t in the shared WhatsApp Business Account." : "No business phone number was added during signup. Add one in WhatsApp Manager, then connect again.");
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const cfg = await saveConnection(ctx, { wabaId, phone, sec: { token, appSecret: secret, pin }, via: "embedded" });

  const base = process.env.APP_URL?.replace(/\/$/, "");
  const notes: string[] = [];
  const subscribe = (override: boolean) => graph(`/${wabaId}/subscribed_apps`, token, override
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ override_callback_uri: `${base}/api/wa/webhook`, verify_token: cfg.verifyToken }) }
    : { method: "POST" });
  // Each pharmacy hosts its own webhook; Meta verifies it (GET with our verify token) before accepting the override.
  if (base?.startsWith("https://")) await subscribe(true).catch(async (e) => { notes.push(`Webhook override not accepted (${e instanceof Error ? e.message : "error"}); add the webhook URL in your Meta app.`); await subscribe(false); });
  else { await subscribe(false); notes.push("APP_URL isn’t https, so delivery updates go to the webhook set in your Meta app."); }

  let registerError: string | null = null;
  if (phone.platform_type !== "CLOUD_API") {
    await graph(`/${phone.id}/register`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", pin }) })
      .catch((e) => { registerError = (e instanceof GraphError ? e.reason : "Registration failed").slice(0, 200); });
  }
  const w = await waAccount(ctx.tenantId);
  if (w) {
    await patchConfig(w.id, { registerError });
    await refreshTemplates(w).catch(() => {});
  }
  if (registerError) notes.push(`Phone number not registered for Cloud API: ${registerError}`);
  return { ...cfg, registerError, notes };
}

export async function syncTemplates(ctx: Ctx) {
  authorize(ctx, "integrations");
  const w = await waAccount(ctx.tenantId);
  if (!w) throw new UserError("WhatsApp is not connected.");
  return (await refreshTemplates(w)).length;
}

export async function disconnectWhatsApp(ctx: Ctx) {
  authorize(ctx, "integrations");
  await db.integration.updateMany({ where: { tenantId: ctx.tenantId, kind: "whatsapp" }, data: { connectedAt: null, encryptedSecret: null } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "WhatsApp disconnected", entity: "integration", detail: "Token deleted from this server" });
}

export async function waStatus(tenantId: string) {
  const w = await waAccount(tenantId);
  return w ? { connected: true as const, cfg: w.cfg, rotatedAt: w.rotatedAt?.toISOString() ?? null, paused: !!w.cfg.disconnected } : { connected: false as const, paused: false };
}

/** The invoice template the current settings use, and whether Meta has it approved (with a document header for PDFs). */
export async function invoiceTemplateState(tenantId: string) {
  const [w, s] = await Promise.all([activeAccount(tenantId), waSettings(tenantId)]);
  const name = s.pdf ? (w?.cfg.invoiceTemplate ?? "invoice_share") : s.textTemplate;
  if (!w) return { name, ok: false, error: "WhatsApp isn’t connected." };
  try { await approvedTemplate(w, name, { document: s.pdf }); return { name, ok: true, error: null }; }
  catch (e) { return { name, ok: false, error: e instanceof Error ? e.message : "Template check failed" }; }
}

// ───────────── Documents to customers ─────────────

type DocSend = { key: string; ref: string; label: string; phone: string; consent: boolean; payload: Payload; auditAction: string };

/**
 * Sends a document message (invoice, credit note) to a confirmed number. One live message per document; a
 * temporary failure can be tried again up to 3 attempts, a permanent one only after the number is changed.
 */
async function sendDocument(ctx: Ctx, d: DocSend) {
  const w = await waAccount(ctx.tenantId);
  if (!w) throw new UserError("WhatsApp Business isn’t connected. An owner can connect it under WhatsApp.");
  if (w.cfg.disconnected) throw new UserError("WhatsApp is disconnected (Meta rejected the access token). An owner needs to reconnect it under WhatsApp.");
  const phone = d.phone;
  const [optedOut, optedIn, invalid] = await Promise.all([
    db.customer.count({ where: { tenantId: ctx.tenantId, phone, waOptIn: false, optInMethod: { startsWith: "Opted out" } } }),
    db.customer.count({ where: { tenantId: ctx.tenantId, phone, waOptIn: true } }),
    db.customer.findFirst({ where: { tenantId: ctx.tenantId, phone, waInvalidAt: { not: null } } }),
  ]);
  if (optedOut && !optedIn) throw new UserError("This customer opted out of WhatsApp messages. Record their consent again on the customer before sending.");
  if (invalid) throw new UserError(`WhatsApp reported ${phone.slice(0, 5)} ${phone.slice(5)} isn’t on WhatsApp. Check the number with the customer and update it on their profile.`);
  if (!d.consent) throw new UserError("Confirm the number with the customer and get their consent first.");
  if (d.payload.ch === "wa") await approvedTemplate(w, d.payload.template, { document: !!d.payload.pdfSaleId });
  const prev = await db.waMessage.findUnique({ where: { idempotencyKey: d.key } });
  if (prev && prev.status !== "failed") throw new UserError(`Already sent to ${prev.recipient} (${prev.status}).`);
  if (prev && prev.attempts >= MAX_ATTEMPTS) throw new UserError(`Retry limit reached (${MAX_ATTEMPTS} attempts). Check the number with the customer.`);
  if (prev && !retryable(prev) && prev.recipient === phone) throw new UserError(`Not sent again: ${prev.errorCode ?? "permanent failure"}. Correct the number to try once more.`);
  const msg = prev
    ? await db.waMessage.update({ where: { id: prev.id }, data: { recipient: phone, status: "queued", attempts: prev.attempts + 1, errorCode: null, errorKind: null, nextAttemptAt: null, payload: d.payload } })
    : await queueMessage(ctx.tenantId, { key: d.key, ref: d.ref, label: d.label, phone, payload: d.payload });
  if (!msg) throw new UserError("Already being sent.");
  const r = await dispatch(msg);
  if (!r.ok) throw new UserError(r.error);
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: d.auditAction, entity: "wa_message", entityId: msg.id, detail: `${d.label} → ${phone.slice(0, 5)}•••••` });
  return { status: "sent" as const, id: msg.id };
}

const checkPhone = (raw: string) => {
  const phone = normPhone(raw);
  if (!MOBILE_RE.test(phone)) throw new UserError("Enter a valid 10-digit Indian mobile number.");
  return phone;
};

/**
 * Sends an invoice with the approved template. With "Attach PDF" on, the PDF goes as the template's document
 * header; off, a text-only template whose 4th variable is a signed link to the PDF, valid for 7 days.
 */
export async function sendInvoice(ctx: Ctx, saleId: string, rawPhone: string, consent: boolean, auto = false) {
  if (!ctx.perms.includes("sale")) authorize(ctx, "sale");
  const phone = checkPhone(rawPhone);
  const inv = await invoiceData(ctx, saleId);
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.voided) throw new UserError(`${inv.invoiceNo} was voided; it can’t be sent.`);
  const [s, w] = await Promise.all([waSettings(ctx.tenantId), waAccount(ctx.tenantId)]);
  const vars = [inv.customer?.name ?? "Customer", inv.invoiceNo, (inv.totals.total / 100).toFixed(2)];
  const payload: Payload = s.pdf
    ? { ch: "wa", template: w?.cfg.invoiceTemplate ?? "invoice_share", vars, n: 3, pdfSaleId: saleId }
    : { ch: "wa", template: s.textTemplate, vars: [...vars, invoiceLink(saleId) ?? ""], n: 4 };
  return sendDocument(ctx, { key: `wa:${saleId}`, ref: saleId, label: inv.invoiceNo, phone, consent, payload, auditAction: auto ? "Invoice auto-sent on WhatsApp" : "Invoice sent on WhatsApp" });
}

/** Sends a credit note summary (text template: name, credit note no., amount, invoice no.). */
export async function sendCreditNote(ctx: Ctx, returnId: string, rawPhone: string, consent: boolean) {
  if (!ctx.perms.includes("refund")) authorize(ctx, "sale");
  const phone = checkPhone(rawPhone);
  const cn = await creditNoteData(ctx, returnId);
  if (!cn) throw new UserError("Credit note not found.");
  const s = await waSettings(ctx.tenantId);
  const payload: Payload = { ch: "wa", template: s.creditNoteTemplate, vars: [cn.customer?.name ?? "Customer", cn.no, (cn.totals.total / 100).toFixed(2), cn.invoiceNo], n: 4 };
  return sendDocument(ctx, { key: `wa:cn:${returnId}`, ref: `creditnote:${returnId}`, label: cn.no, phone, consent, payload, auditAction: "Credit note sent on WhatsApp" });
}

const kindOf = (ref: string) => (ref.startsWith("campaign:") ? "Campaign" : ref.startsWith("refill:") ? "Refill" : ref.startsWith("feedback:") ? "Feedback" : ref.startsWith("payrem:") ? "Payment reminder" : ref.startsWith("creditnote:") ? "Credit note" : ref.startsWith("loyalty:") ? "Points" : "Invoice");

export async function messageLog(ctx: Ctx) {
  const rows = await db.waMessage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { updatedAt: "desc" }, take: 100 });
  const since = new Date(new Date().setHours(0, 0, 0, 0));
  const today = rows.filter((r) => r.createdAt >= since);
  return {
    rows: rows.map((r) => ({
      id: r.id, saleId: r.invoiceId, at: r.updatedAt.toISOString(), invoiceNo: r.invoiceNo, kind: kindOf(r.invoiceId), channel: r.channel, to: r.recipient, status: r.status, attempts: r.attempts,
      error: r.errorCode, errorKind: r.errorKind, retryable: retryable(r), nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    })),
    counts: { sent: today.length, delivered: today.filter((r) => r.status === "delivered" || r.status === "read").length, read: today.filter((r) => r.status === "read").length, failed: today.filter((r) => r.status === "failed").length },
  };
}

export async function saleMessage(tenantId: string, saleId: string) {
  const m = await db.waMessage.findFirst({ where: { tenantId, invoiceId: saleId }, orderBy: { createdAt: "desc" } });
  return m ? { status: m.status, attempts: m.attempts, error: m.errorCode, to: m.recipient, retryable: retryable(m) } : null;
}

// ───────────── Webhook ─────────────

/** GET verification: Meta echoes hub.challenge when our verify token matches. */
export async function verifyWebhook(token: string) {
  const all = await db.integration.findMany({ where: { kind: "whatsapp", connectedAt: { not: null } } });
  const hit = all.find((i) => (i.config as WaConfig).verifyToken === token);
  if (!hit) return false;
  await patchConfig(hit.id, { webhookVerified: true });
  return true;
}

type HookValue = {
  metadata?: { phone_number_id?: string };
  statuses?: { id: string; status: string; recipient_id?: string; errors?: { title?: string; code?: number }[] }[];
  messages?: { from: string; text?: { body?: string }; type: string }[];
  event?: string; message_template_name?: string; message_template_language?: string;
};
type Hook = { entry?: { id?: string; changes?: { field?: string; value?: HookValue }[] }[] };

/** POST: checks X-Hub-Signature-256 with the app secret, then applies delivery statuses, failures, template status and STOP opt-outs. */
export async function handleWebhook(raw: string, signature: string | null) {
  const body = JSON.parse(raw) as Hook;
  const entry = body.entry?.[0];
  const pnid = entry?.changes?.[0]?.value?.metadata?.phone_number_id;
  const all = await db.integration.findMany({ where: { kind: "whatsapp", connectedAt: { not: null } } });
  const i = all.find((x) => (pnid ? (x.config as WaConfig).phoneNumberId === pnid : !!entry?.id && (x.config as WaConfig).wabaId === entry.id));
  const w = i ? await waAccount(i.tenantId) : null;
  if (!i || !w) return 0;
  const want = "sha256=" + createHmac("sha256", w.sec.appSecret).update(raw).digest("hex");
  if (!signature || signature.length !== want.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(want))) throw new Error("Bad signature");
  const order = ["queued", "sent", "delivered", "read"];
  let n = 0;
  for (const e of body.entry ?? []) for (const c of e.changes ?? []) {
    const v = c.value ?? {};
    for (const s of v.statuses ?? []) {
      const m = await db.waMessage.findFirst({ where: { tenantId: i.tenantId, wamid: s.id } });
      if (!m) continue;
      if (s.status === "failed") {
        if (m.status !== "failed") await recordFailure(m, webhookKind(s.errors?.[0]?.code), reasonFor(s.errors?.[0]?.code, s.errors?.[0]?.title));
      } else if (m.status !== "failed" && order.indexOf(s.status) > order.indexOf(m.status)) await db.waMessage.update({ where: { id: m.id }, data: { status: s.status as "sent" } });
      n++;
    }
    if (c.field === "message_template_status_update" && v.message_template_name && v.event) {
      const status = v.event.toLowerCase(), cur = (await waAccount(i.tenantId))!.cfg;
      await patchConfig(i.id, { templates: cur.templates.map((t) => (t.name === v.message_template_name && (!v.message_template_language || t.language === v.message_template_language) ? { ...t, status } : t)) });
      n++;
    }
    for (const msg of v.messages ?? []) {
      const text = (msg.text?.body ?? "").trim().toUpperCase();
      if (STOP_WORDS.includes(text)) {
        const phone = msg.from.replace(/^91/, "");
        const r = await db.customer.updateMany({ where: { tenantId: i.tenantId, phone, waOptIn: true }, data: { waOptIn: false, optInMethod: `Opted out by replying ${text} on WhatsApp`, optInAt: new Date() } });
        if (r.count) await writeAudit(db, { tenantId: i.tenantId, action: "WhatsApp opt-out", entity: "customer", detail: `${phone.slice(0, 5)}••••• replied ${text}` });
      }
    }
  }
  return n;
}

// ───────────── Settings ─────────────

export async function waSettings(tenantId: string): Promise<WaSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { auto: false, pdf: true, textTemplate: "invoice_link", creditNoteTemplate: "credit_note", ...((t.settings as { wa?: Partial<WaSettings> }).wa ?? {}) };
}

export async function saveWaSettings(ctx: Ctx, patch: Partial<WaSettings>) {
  authorize(ctx, "integrations");
  const p: Partial<WaSettings> = {};
  if (patch.auto !== undefined) p.auto = !!patch.auto;
  if (patch.pdf !== undefined) p.pdf = !!patch.pdf;
  for (const k of ["textTemplate", "creditNoteTemplate"] as const) {
    if (patch[k] === undefined) continue;
    if (!TEMPLATE_RE.test(patch[k]!)) throw new UserError("Template names are lowercase with underscores.");
    p[k] = patch[k];
  }
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), wa: { ...(t.settings as { wa?: object }).wa, ...p } } } });
  const desc = [p.auto !== undefined && `auto-send ${p.auto ? "on" : "off"}`, p.pdf !== undefined && `attach PDF ${p.pdf ? "on" : "off"}`, p.textTemplate && `text template ${p.textTemplate}`, p.creditNoteTemplate && `credit note template ${p.creditNoteTemplate}`].filter(Boolean).join(" · ");
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "WhatsApp settings changed", entity: "tenant", detail: desc || "no change" });
}
