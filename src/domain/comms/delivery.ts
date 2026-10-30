import "server-only";
import { Prisma, type WaMessage } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { unseal } from "@/server/vault";
import type { Ctx } from "@/server/context";
import { sendSms, smsAvailable, smsNeedsTemplate, SmsError, type SmsType } from "@/server/sms";
import { invoiceData } from "@/domain/sales/service";
import { invoicePdf } from "@/domain/sales/pdf";
import { graph, GraphError, type FailKind } from "./graph";

export type WaTemplate = { name: string; language: string; status: string; category: string; params?: number; header?: string };
export type WaConfig = {
  wabaId: string; phoneNumberId: string; displayPhone: string; verifiedName?: string; verifyToken: string; webhookVerified: boolean;
  invoiceTemplate: string; invoiceTextTemplate?: string; templateLang: string; templates: WaTemplate[]; templatesAt?: string;
  via?: "embedded" | "manual"; registerError?: string | null;
  /** Meta rejected the token: sending is paused until the owner reconnects. */
  disconnected?: { at: string; reason: string } | null;
};
export type Secrets = { token: string; appSecret: string; pin?: string };

/**
 * What a queued message sends, kept on the row so the worker can retry it. WhatsApp: a template with body
 * variables (only the first `n` are used when Meta's body variable count isn't known), optionally with the
 * invoice PDF as document header. SMS: the message type, its variables and plain text.
 */
export type Payload =
  | { ch: "wa"; template: string; vars: string[]; n?: number; pdfSaleId?: string }
  | { ch: "sms"; type: SmsType; vars: string[]; text: string };

export const MAX_ATTEMPTS = 3;
/** Wait before automatic retry n+1: 1, 4, 16 minutes. */
export const backoffMs = (attempts: number) => 60_000 * 4 ** Math.max(0, attempts - 1);

export async function waAccount(tenantId: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "whatsapp" } } });
  if (!i?.connectedAt || !i.encryptedSecret) return null;
  return { id: i.id, tenantId, cfg: i.config as WaConfig, sec: JSON.parse(unseal(i.encryptedSecret).toString()) as Secrets, rotatedAt: i.rotatedAt, connectedAt: i.connectedAt };
}
export type WaAccount = NonNullable<Awaited<ReturnType<typeof waAccount>>>;

/** The account when it can send now (connected, and Meta hasn't revoked the token). */
export async function activeAccount(tenantId: string) {
  const w = await waAccount(tenantId);
  return w && !w.cfg.disconnected ? w : null;
}

export async function patchConfig(id: string, patch: Partial<WaConfig>) {
  await db.$transaction(async (tx) => {
    const i = await tx.integration.findUniqueOrThrow({ where: { id } });
    await tx.integration.update({ where: { id }, data: { config: { ...(i.config as WaConfig), ...patch } } });
  });
}

/** Meta said the token is expired or revoked: pause sending, alert the owner (once). */
export async function markDisconnected(tenantId: string, reason: string) {
  const w = await waAccount(tenantId);
  if (!w || w.cfg.disconnected) return;
  await patchConfig(w.id, { disconnected: { at: new Date().toISOString(), reason: reason.slice(0, 200) } });
  // Pending retries wait for the reconnect instead of using up their attempts.
  await db.waMessage.updateMany({ where: { tenantId, channel: "whatsapp", status: "failed", errorKind: "retry" }, data: { errorKind: "auth", nextAttemptAt: null } });
  await writeAudit(db, { tenantId, userName: "WhatsApp", action: "WhatsApp disconnected by Meta", entity: "integration", detail: `${reason.slice(0, 160)} · sending paused until an owner reconnects` });
}

type MetaTemplate = { name: string; language: string; status: string; category: string; components?: { type: string; format?: string; text?: string }[] };

/** Fetches the template list from Meta: status, language, body variable count and header type. */
export async function refreshTemplates(w: WaAccount) {
  const r = await graph<{ data: MetaTemplate[] }>(`/${w.cfg.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`, w.sec.token).catch(async (e) => {
    if (e instanceof GraphError && e.kind === "auth") await markDisconnected(w.tenantId, e.reason);
    throw e;
  });
  const comp = (t: MetaTemplate, type: string) => t.components?.find((c) => c.type.toUpperCase() === type);
  const templates: WaTemplate[] = r.data.map((t) => {
    const body = comp(t, "BODY"), head = comp(t, "HEADER");
    return { name: t.name, language: t.language, status: t.status.toLowerCase(), category: t.category.toLowerCase(), params: body ? new Set(body.text?.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size : undefined, header: head?.format?.toUpperCase() };
  });
  await patchConfig(w.id, { templates, templatesAt: new Date().toISOString() });
  w.cfg = { ...w.cfg, templates, templatesAt: new Date().toISOString() };
  return templates;
}

const TEMPLATE_TTL = 6 * 3600_000;

/**
 * The approved template to send, preferring the account's language. The cached list is refreshed when it's
 * older than 6 hours, or once when the template isn't in it. Throws a UserError naming what's missing.
 */
export async function approvedTemplate(w: WaAccount, name: string, opts: { document?: boolean } = {}) {
  const find = () => {
    const all = w.cfg.templates.filter((t) => t.name === name && t.status === "approved");
    return all.find((t) => t.language === w.cfg.templateLang) ?? all[0];
  };
  const age = w.cfg.templatesAt ? Date.now() - Date.parse(w.cfg.templatesAt) : Infinity;
  if (age > TEMPLATE_TTL || (!find() && age > 60_000)) await refreshTemplates(w).catch((e) => { if (e instanceof GraphError && e.kind === "auth") throw e; });
  const t = find();
  if (!t) throw new UserError(`WhatsApp template “${name}” isn’t approved in Meta${w.cfg.templates.some((x) => x.name === name) ? " yet" : " (not found)"}. Create or fix it in WhatsApp Manager, then Sync.`);
  if (opts.document && t.header && t.header !== "DOCUMENT") throw new UserError(`WhatsApp template “${name}” has a ${t.header.toLowerCase()} header; the invoice PDF needs a document header.`);
  return t;
}

async function uploadPdf(w: WaAccount, pdf: Uint8Array, filename: string) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  return (await graph<{ id: string }>(`/${w.cfg.phoneNumberId}/media`, w.sec.token, { method: "POST", body: form })).id;
}

async function sendWa(tenantId: string, phone: string, p: Extract<Payload, { ch: "wa" }>) {
  const w = await activeAccount(tenantId);
  if (!w) throw new GraphError("WhatsApp is disconnected. Reconnect it under WhatsApp to resume sending.", undefined, "auth");
  const tpl = await approvedTemplate(w, p.template, { document: !!p.pdfSaleId });
  const components: object[] = [];
  if (p.pdfSaleId) {
    const inv = await invoiceData({ tenantId } as Ctx, p.pdfSaleId);
    if (!inv) throw new UserError("Invoice not found.");
    if (inv.voided) throw new UserError(`${inv.invoiceNo} was voided; it can’t be sent.`);
    const filename = `${inv.invoiceNo.replace(/\//g, "-")}.pdf`;
    // Uploaded to Meta's media store and sent by id, so the PDF is never exposed on a public URL.
    const id = await uploadPdf(w, await invoicePdf(inv), filename);
    components.push({ type: "header", parameters: [{ type: "document", document: { id, filename } }] });
  }
  const parameters = p.vars.slice(0, tpl.params ?? p.n ?? 1).map((text) => ({ type: "text", text: text.replace(/\s+/g, " ").trim() || "-" }));
  if (parameters.length) components.push({ type: "body", parameters });
  const r = await graph<{ messages: { id: string }[] }>(`/${w.cfg.phoneNumberId}/messages`, w.sec.token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: "91" + phone, type: "template", template: { name: tpl.name, language: { code: tpl.language }, components } }),
  });
  return r.messages[0]?.id ?? null;
}

// ───────────── SMS settings ─────────────

export type SmsSettings = { enabled: boolean; templates: Partial<Record<SmsType, string>> };
export async function smsSettings(tenantId: string): Promise<SmsSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const s = (t.settings as { sms?: Partial<SmsSettings> }).sms ?? {};
  return { enabled: !!s.enabled, templates: s.templates ?? {} };
}
/** SMS can carry this message type: turned on, a gateway configured, and (msg91) a template id set. */
export const smsReady = (s: SmsSettings, type: SmsType) => s.enabled && smsAvailable() && (!smsNeedsTemplate() || !!s.templates[type]);

async function sendSmsMsg(tenantId: string, phone: string, p: Extract<Payload, { ch: "sms" }>) {
  const s = await smsSettings(tenantId);
  if (!s.enabled) throw new SmsError("SMS messages are turned off under Customer messaging.", false);
  return sendSms(phone, { text: p.text, vars: p.vars, type: p.type, template: s.templates[p.type] });
}

// ───────────── Queue, send, failure handling ─────────────

type NewMsg = { key: string; ref: string; label: string; phone: string; customerId?: string | null; payload: Payload };

/**
 * Records a message under its idempotency key before sending, so it goes once. Calling again for the same key
 * re-queues it only when the last attempt failed for a temporary reason and attempts remain. Null: nothing to send.
 */
export async function queueMessage(tenantId: string, m: NewMsg) {
  const channel = m.payload.ch === "sms" ? "sms" : "whatsapp";
  const created = await db.waMessage.create({ data: { tenantId, invoiceId: m.ref, invoiceNo: m.label.slice(0, 60), recipient: m.phone, idempotencyKey: m.key, status: "queued", attempts: 1, channel, customerId: m.customerId ?? null, payload: m.payload } })
    .catch((e) => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; throw e; });
  if (created) return created;
  const old = await db.waMessage.findUnique({ where: { idempotencyKey: m.key } });
  if (!old || !retryable(old)) return null;
  return claimRetry(old, { recipient: m.phone, channel, payload: m.payload });
}

/** A failed message that may be sent again (by the worker, or a person pressing Retry). */
export const retryable = (m: Pick<WaMessage, "status" | "errorKind" | "attempts">) =>
  m.status === "failed" && m.attempts < MAX_ATTEMPTS && (m.errorKind === null || m.errorKind === "retry" || m.errorKind === "auth");

/** Moves a failed message back to queued for one more attempt; null when someone else already did. */
async function claimRetry(m: WaMessage, data: Prisma.WaMessageUpdateInput = {}) {
  const r = await db.waMessage.updateMany({ where: { id: m.id, status: "failed", attempts: m.attempts }, data: { ...(data as Prisma.WaMessageUpdateManyMutationInput), status: "queued", attempts: m.attempts + 1, errorCode: null, errorKind: null, nextAttemptAt: null } });
  return r.count ? db.waMessage.findUniqueOrThrow({ where: { id: m.id } }) : null;
}

/** Sends a queued message and records the outcome. Never throws for a delivery failure. */
export async function dispatch(m: WaMessage): Promise<{ ok: true } | { ok: false; error: string; kind: FailKind }> {
  const p = m.payload as Payload | null;
  try {
    if (!p) throw new UserError("Nothing recorded to send.");
    const ref = p.ch === "sms" ? "sms:" + (await sendSmsMsg(m.tenantId, m.recipient, p)) : await sendWa(m.tenantId, m.recipient, p);
    await db.waMessage.update({ where: { id: m.id }, data: { status: "sent", wamid: ref, errorCode: null, errorKind: null, nextAttemptAt: null } });
    return { ok: true };
  } catch (e) {
    const kind: FailKind = e instanceof GraphError ? e.kind : e instanceof SmsError ? (e.retry ? "retry" : "permanent") : e instanceof UserError ? "permanent" : "retry";
    const reason = (e instanceof GraphError ? e.reason : e instanceof Error ? e.message : "Send failed").slice(0, 200);
    if (!(e instanceof UserError)) console.error("[delivery]", e);
    await recordFailure(m, kind, reason, e instanceof GraphError && e.code !== undefined);
    return { ok: false, error: reason, kind };
  }
}

/**
 * Applies a failure (from a send, or a webhook): temporary ones are retried with backoff; a number that isn't
 * on WhatsApp is flagged on the customer so automatic sends stop; a revoked token disconnects the integration
 * and the message waits, uncounted, for the reconnect.
 */
export async function recordFailure(m: WaMessage, kind: FailKind, reason: string, fromMeta = true) {
  const attempts = kind === "auth" ? Math.max(0, m.attempts - 1) : m.attempts;
  await db.waMessage.update({ where: { id: m.id }, data: {
    status: "failed", errorCode: reason, errorKind: kind, attempts,
    nextAttemptAt: kind === "retry" && attempts < MAX_ATTEMPTS ? new Date(Date.now() + backoffMs(attempts)) : null,
  } });
  if (kind === "invalid" && m.channel === "whatsapp") {
    const r = await db.customer.updateMany({ where: { tenantId: m.tenantId, phone: m.recipient, waInvalidAt: null }, data: { waInvalidAt: new Date(), waInvalidReason: reason } });
    if (r.count) await writeAudit(db, { tenantId: m.tenantId, userName: "WhatsApp", action: "Number marked not on WhatsApp", entity: "customer", detail: `${m.recipient.slice(0, 5)}••••• · ${reason}` });
  }
  if (kind === "auth" && fromMeta && m.channel === "whatsapp") await markDisconnected(m.tenantId, reason);
}

const stillConsents = async (m: WaMessage) => {
  if (m.channel === "whatsapp" && (await db.customer.count({ where: { tenantId: m.tenantId, phone: m.recipient, waInvalidAt: { not: null } } }))) return false;
  if (!m.customerId) return true;
  const c = await db.customer.findFirst({ where: { id: m.customerId, tenantId: m.tenantId, erasedAt: null, phone: m.recipient } });
  return !!c && (m.channel === "sms" ? c.smsOptIn : c.waOptIn && !c.waInvalidAt);
};

/** One more attempt at a failed message, on request. */
export async function retryMessage(ctx: Ctx, id: string) {
  const m = await db.waMessage.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!m) throw new UserError("Message not found.");
  if (m.status !== "failed") throw new UserError(`Already ${m.status}.`);
  if (m.attempts >= MAX_ATTEMPTS) throw new UserError(`Retry limit reached (${MAX_ATTEMPTS} attempts).`);
  if (!retryable(m)) throw new UserError(`Not retried: ${m.errorCode ?? "this failure is permanent"}.`);
  if (m.channel === "whatsapp" && !(await activeAccount(ctx.tenantId))) throw new UserError("WhatsApp is disconnected. Reconnect it first.");
  if (!(await stillConsents(m))) throw new UserError("This customer has opted out or their number changed.");
  const c = await claimRetry(m);
  if (!c) throw new UserError("This message is already being retried.");
  const r = await dispatch(c);
  if (!r.ok) throw new UserError(r.error);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Message retried", entity: "wa_message", entityId: m.id, detail: `${m.invoiceNo} → ${m.recipient.slice(0, 5)}•••••` });
  return { status: "sent" as const, id: m.id };
}

/** After a reconnect, messages held back by the revoked token go out on the next worker run. */
export async function resumeAfterReconnect(tenantId: string) {
  await db.waMessage.updateMany({ where: { tenantId, channel: "whatsapp", status: "failed", errorKind: "auth" }, data: { errorKind: "retry", nextAttemptAt: new Date() } });
}

/**
 * Delivery worker, run from the cron tick: retries temporary failures whose backoff has passed, up to 3
 * attempts in all. Pharmacies whose WhatsApp is disconnected are skipped (their queue is paused).
 */
export async function deliveryTick(now = new Date(), limit = 100) {
  const due = await db.waMessage.findMany({ where: { status: "failed", errorKind: "retry", attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: limit });
  const paused = new Map<string, boolean>();
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const m of due) {
    if (m.channel === "whatsapp") {
      if (!paused.has(m.tenantId)) paused.set(m.tenantId, !(await activeAccount(m.tenantId)));
      if (paused.get(m.tenantId)) {
        await db.waMessage.updateMany({ where: { id: m.id, status: "failed" }, data: { errorKind: "auth", nextAttemptAt: null } });
        out.skipped++; continue;
      }
    }
    if (!(await stillConsents(m))) {
      await db.waMessage.updateMany({ where: { id: m.id, status: "failed" }, data: { errorKind: "permanent", nextAttemptAt: null, errorCode: "Not retried: the customer opted out or changed number" } });
      out.skipped++; continue;
    }
    const c = await claimRetry(m);
    if (!c) continue;
    if ((await dispatch(c)).ok) out.sent++; else out.failed++;
  }
  return out;
}
