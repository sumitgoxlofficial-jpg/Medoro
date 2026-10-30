import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { invoiceData } from "@/domain/sales/service";
import { invoicePdf } from "@/domain/sales/pdf";
import { MOBILE_RE, normPhone } from "@/domain/identity/contracts";

const GRAPH = () => `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION ?? "v21.0"}`;
export type WaConfig = { wabaId: string; phoneNumberId: string; displayPhone: string; verifiedName?: string; verifyToken: string; webhookVerified: boolean; invoiceTemplate: string; templateLang: string; templates: { name: string; language: string; status: string; category: string; params?: number }[] };
type Secrets = { token: string; appSecret: string };

async function integration(tenantId: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "whatsapp" } } });
  if (!i?.connectedAt || !i.encryptedSecret) return null;
  return { id: i.id, cfg: i.config as WaConfig, sec: JSON.parse(unseal(i.encryptedSecret).toString()) as Secrets, rotatedAt: i.rotatedAt, connectedAt: i.connectedAt };
}

async function graph<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${GRAPH()}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!r.ok || j.error) throw new UserError(`Meta: ${j.error?.message ?? r.status}`);
  return j;
}

export const connectSchema = z.object({
  wabaId: z.string().trim().regex(/^\d{8,20}$/, "WABA ID is a long number from Meta Business Manager."),
  phoneNumberId: z.string().trim().regex(/^\d{8,20}$/, "Phone number ID is a long number from the WhatsApp API setup page."),
  token: z.string().trim().min(40, "Paste the permanent (system user) access token."),
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/i, "App secret is 32 hex characters from your Meta app’s basic settings."),
  invoiceTemplate: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names are lowercase with underscores.").default("invoice_share"),
  templateLang: z.string().trim().default("en"),
});

/** Verifies the credentials with Meta, then stores them sealed on this server. */
export async function connectWhatsApp(ctx: Ctx, raw: z.input<typeof connectSchema>) {
  authorize(ctx, "integrations");
  const i = connectSchema.parse(raw);
  const phone = await graph<{ display_phone_number: string; verified_name: string }>(`/${i.phoneNumberId}?fields=display_phone_number,verified_name`, i.token);
  const old = await db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } } });
  const cfg: WaConfig = { wabaId: i.wabaId, phoneNumberId: i.phoneNumberId, displayPhone: phone.display_phone_number, verifiedName: phone.verified_name, verifyToken: (old?.config as WaConfig | null)?.verifyToken ?? randomBytes(18).toString("base64url"), webhookVerified: false, invoiceTemplate: i.invoiceTemplate, templateLang: i.templateLang, templates: [] };
  const sealed = new Uint8Array(seal(JSON.stringify({ token: i.token, appSecret: i.appSecret } satisfies Secrets)));
  await db.integration.upsert({
    where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } },
    create: { tenantId: ctx.tenantId, kind: "whatsapp", config: cfg, encryptedSecret: sealed, connectedAt: new Date(), rotatedAt: new Date() },
    update: { config: cfg, encryptedSecret: sealed, connectedAt: old?.connectedAt ?? new Date(), rotatedAt: new Date() },
  });
  await syncTemplates(ctx).catch(() => {});
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: old?.connectedAt ? "WhatsApp token rotated" : "WhatsApp connected", entity: "integration", detail: `${phone.verified_name} · ${phone.display_phone_number}` });
  return cfg;
}

export async function syncTemplates(ctx: Ctx) {
  authorize(ctx, "integrations");
  const w = await integration(ctx.tenantId);
  if (!w) throw new UserError("WhatsApp is not connected.");
  const r = await graph<{ data: { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] }[] }>(`/${w.cfg.wabaId}/message_templates?fields=name,language,status,category,components&limit=100`, w.sec.token);
  // How many {{n}} variables the body has, so automated sends fill exactly those.
  const params = (t: { components?: { type: string; text?: string }[] }) => {
    const body = t.components?.find((c) => c.type.toUpperCase() === "BODY");
    return body ? new Set(body.text?.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size : undefined;
  };
  await db.integration.update({ where: { id: w.id }, data: { config: { ...w.cfg, templates: r.data.map((t) => ({ name: t.name, language: t.language, status: t.status.toLowerCase(), category: t.category.toLowerCase(), params: params(t) })) } } });
  return r.data.length;
}

export async function disconnectWhatsApp(ctx: Ctx) {
  authorize(ctx, "integrations");
  await db.integration.updateMany({ where: { tenantId: ctx.tenantId, kind: "whatsapp" }, data: { connectedAt: null, encryptedSecret: null } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "WhatsApp disconnected", entity: "integration", detail: "Token deleted from this server" });
}

export async function waStatus(tenantId: string) {
  const w = await integration(tenantId);
  return w ? { connected: true as const, cfg: w.cfg, rotatedAt: w.rotatedAt?.toISOString() ?? null } : { connected: false as const };
}

/**
 * Sends the invoice PDF with the approved invoice template. One live message per invoice;
 * a failed one can be retried up to 3 attempts in total. Consent must be confirmed.
 */
export async function sendInvoice(ctx: Ctx, saleId: string, rawPhone: string, consent: boolean, auto = false) {
  if (!ctx.perms.includes("sale")) authorize(ctx, "sale");
  const w = await integration(ctx.tenantId);
  if (!w) throw new UserError("WhatsApp Business isn’t connected. An owner can connect it under WhatsApp.");
  const phone = normPhone(rawPhone);
  if (!MOBILE_RE.test(phone)) throw new UserError("Enter a valid 10-digit Indian mobile number.");
  const [optedOut, optedIn] = await Promise.all([
    db.customer.count({ where: { tenantId: ctx.tenantId, phone, waOptIn: false, optInMethod: { startsWith: "Opted out" } } }),
    db.customer.count({ where: { tenantId: ctx.tenantId, phone, waOptIn: true } }),
  ]);
  if (optedOut && !optedIn) throw new UserError("This customer opted out of WhatsApp messages. Record their consent again on the customer before sending.");
  if (!consent) throw new UserError("Confirm the number with the customer and get their consent first.");
  const inv = await invoiceData(ctx, saleId);
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.voided) throw new UserError(`${inv.invoiceNo} was voided; it can’t be sent.`);
  const prev = await db.waMessage.findFirst({ where: { tenantId: ctx.tenantId, invoiceId: saleId }, orderBy: { createdAt: "desc" } });
  if (prev && prev.status !== "failed") throw new UserError(`Already sent to ${prev.recipient} (${prev.status}).`);
  const attempts = (prev?.attempts ?? 0) + 1;
  if (attempts > 3) throw new UserError("Retry limit reached (3 attempts). Check the number with the customer.");
  const msg = prev
    ? await db.waMessage.update({ where: { id: prev.id }, data: { recipient: phone, status: "queued", attempts, errorCode: null } })
    : await db.waMessage.create({ data: { tenantId: ctx.tenantId, invoiceId: saleId, invoiceNo: inv.invoiceNo, recipient: phone, idempotencyKey: `wa:${saleId}`, status: "queued", attempts } });
  try {
    const pdf = await invoicePdf(inv);
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), `${inv.invoiceNo.replace(/\//g, "-")}.pdf`);
    const media = await graph<{ id: string }>(`/${w.cfg.phoneNumberId}/media`, w.sec.token, { method: "POST", body: form });
    const body = {
      messaging_product: "whatsapp", to: "91" + phone, type: "template",
      template: { name: w.cfg.invoiceTemplate, language: { code: w.cfg.templateLang }, components: [
        { type: "header", parameters: [{ type: "document", document: { id: media.id, filename: `${inv.invoiceNo.replace(/\//g, "-")}.pdf` } }] },
        { type: "body", parameters: [{ type: "text", text: inv.customer?.name ?? "Customer" }, { type: "text", text: inv.invoiceNo }, { type: "text", text: (inv.totals.total / 100).toFixed(2) }] },
      ] },
    };
    const r = await graph<{ messages: { id: string }[] }>(`/${w.cfg.phoneNumberId}/messages`, w.sec.token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await db.waMessage.update({ where: { id: msg.id }, data: { wamid: r.messages[0]?.id ?? null, status: "sent" } });
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: auto ? "Invoice auto-sent on WhatsApp" : "Invoice sent on WhatsApp", entity: "wa_message", entityId: msg.id, detail: `${inv.invoiceNo} → ${phone.slice(0, 5)}•••••` });
    return { status: "sent" as const, id: msg.id };
  } catch (e) {
    const m = e instanceof Error ? e.message : "Send failed";
    await db.waMessage.update({ where: { id: msg.id }, data: { status: "failed", errorCode: m.slice(0, 200) } });
    throw e instanceof UserError ? e : new UserError(m);
  }
}

export async function messageLog(ctx: Ctx) {
  const rows = await db.waMessage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { updatedAt: "desc" }, take: 100 });
  const since = new Date(new Date().setHours(0, 0, 0, 0));
  const today = rows.filter((r) => r.createdAt >= since);
  return {
    rows: rows.map((r) => ({ id: r.id, saleId: r.invoiceId, at: r.updatedAt.toISOString(), invoiceNo: r.invoiceNo, to: r.recipient, status: r.status, attempts: r.attempts, error: r.errorCode })),
    counts: { sent: today.length, delivered: today.filter((r) => r.status === "delivered" || r.status === "read").length, read: today.filter((r) => r.status === "read").length, failed: today.filter((r) => r.status === "failed").length },
  };
}

export async function saleMessage(tenantId: string, saleId: string) {
  const m = await db.waMessage.findFirst({ where: { tenantId, invoiceId: saleId }, orderBy: { createdAt: "desc" } });
  return m ? { status: m.status, attempts: m.attempts, error: m.errorCode, to: m.recipient } : null;
}

// ───────────── Webhook ─────────────

/** GET verification: Meta echoes hub.challenge when our verify token matches. */
export async function verifyWebhook(token: string) {
  const all = await db.integration.findMany({ where: { kind: "whatsapp", connectedAt: { not: null } } });
  const hit = all.find((i) => (i.config as WaConfig).verifyToken === token);
  if (!hit) return false;
  await db.integration.update({ where: { id: hit.id }, data: { config: { ...(hit.config as WaConfig), webhookVerified: true } } });
  return true;
}

type Hook = { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; statuses?: { id: string; status: string; recipient_id?: string; errors?: { title?: string; code?: number }[] }[]; messages?: { from: string; text?: { body?: string }; type: string }[] } }[] }[] };

/** POST: checks X-Hub-Signature-256 with the tenant's app secret, then applies delivery statuses and STOP opt-outs. */
export async function handleWebhook(raw: string, signature: string | null) {
  const body = JSON.parse(raw) as Hook;
  const pnid = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!pnid) return 0;
  const all = await db.integration.findMany({ where: { kind: "whatsapp", connectedAt: { not: null } } });
  const i = all.find((x) => (x.config as WaConfig).phoneNumberId === pnid);
  if (!i?.encryptedSecret) return 0;
  const sec = JSON.parse(unseal(i.encryptedSecret).toString()) as Secrets;
  const want = "sha256=" + createHmac("sha256", sec.appSecret).update(raw).digest("hex");
  if (!signature || signature.length !== want.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(want))) throw new Error("Bad signature");
  const order = ["queued", "sent", "delivered", "read"];
  let n = 0;
  for (const e of body.entry ?? []) for (const c of e.changes ?? []) {
    for (const s of c.value?.statuses ?? []) {
      const m = await db.waMessage.findFirst({ where: { tenantId: i.tenantId, wamid: s.id } });
      if (!m) continue;
      if (s.status === "failed") await db.waMessage.update({ where: { id: m.id }, data: { status: "failed", errorCode: (s.errors?.[0]?.title ?? "Failed").slice(0, 200) } });
      else if (order.indexOf(s.status) > order.indexOf(m.status)) await db.waMessage.update({ where: { id: m.id }, data: { status: s.status as "sent" } });
      n++;
    }
    for (const msg of c.value?.messages ?? []) {
      const text = (msg.text?.body ?? "").trim().toUpperCase();
      if (["STOP", "UNSUBSCRIBE", "BAND"].includes(text)) {
        const phone = msg.from.replace(/^91/, "");
        const r = await db.customer.updateMany({ where: { tenantId: i.tenantId, phone, waOptIn: true }, data: { waOptIn: false, optInMethod: `Opted out by replying ${text} on WhatsApp`, optInAt: new Date() } });
        if (r.count) await writeAudit(db, { tenantId: i.tenantId, action: "WhatsApp opt-out", entity: "customer", detail: `${phone.slice(0, 5)}••••• replied ${text}` });
      }
    }
  }
  return n;
}

export async function waSettings(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { auto: false, pdf: true, ...((t.settings as { wa?: { auto?: boolean; pdf?: boolean } }).wa ?? {}) };
}

export async function saveWaSettings(ctx: Ctx, s: { auto: boolean }) {
  authorize(ctx, "integrations");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), wa: { ...(t.settings as { wa?: object }).wa, auto: s.auto } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "WhatsApp settings changed", entity: "tenant", detail: `auto-send ${s.auto ? "on" : "off"}` });
}
