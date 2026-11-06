import "server-only";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { hit } from "@/server/ratelimit";
import { seal as sealBuf, unseal } from "@/server/vault";
const seal = (v: string) => new Uint8Array(sealBuf(v));
import { sendMail, mailEnabled } from "@/server/mail";
import { graph } from "@/domain/comms/graph";
import { activity, findLead, gaudit, leadScope, need, type Actor } from "./access";
import { addSuppression, messageBlocker, policy, suppressionFor } from "./compliance";
import { filterSchema, filterWhere, staffNames, type LeadFilter } from "./leads";
import { toE164 } from "./normalize";

/**
 * Outreach on official channels only: the WhatsApp Business Platform (Cloud API) with Meta-approved templates, and email
 * through the configured provider. Business-initiated (promotional) messages need recorded consent and no suppression;
 * free-form WhatsApp text is only possible within 24 hours of the contact's last message. No WhatsApp Web automation.
 */

// ── Provider seam (replaced in tests)
export type Sender = {
  whatsapp: (cfg: WaConn, to: string, payload: Record<string, unknown>) => Promise<string>;
  email: (to: string, subject: string, text: string) => Promise<string | null>;
};
type WaConn = { phoneNumberId: string; wabaId: string; token: string };
const realSender: Sender = {
  async whatsapp(c, to, payload) {
    const r = await graph<{ messages?: { id: string }[] }>(`/${c.phoneNumberId}/messages`, c.token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), ...payload }) });
    return r.messages?.[0]?.id ?? "";
  },
  async email(to, subject, text) { await sendMail({ to, subject, text }); return null; },
};
let sender = realSender;
export function setSender(s: Sender | null) { sender = s ?? realSender; }

// ── Connections
type WaSecrets = { token: string; appSecret: string; verifyToken: string };
export async function waConnection() {
  const c = await db.integrationConnection.findUnique({ where: { kind: "whatsapp" } });
  if (!c || c.status !== "connected" || !c.secrets) return null;
  const sec = JSON.parse(unseal(c.secrets).toString()) as WaSecrets;
  const cfg = c.config as { phoneNumberId: string; wabaId: string; displayNumber?: string };
  return { id: c.id, cfg, sec, conn: { phoneNumberId: cfg.phoneNumberId, wabaId: cfg.wabaId, token: sec.token } };
}

export const waConnectSchema = z.object({ phoneNumberId: z.string().regex(/^\d{5,25}$/, "Phone number ID is digits only."), wabaId: z.string().regex(/^\d{5,25}$/, "WhatsApp Business Account ID is digits only."), token: z.string().min(20).max(1000), appSecret: z.string().min(16).max(200) });
export async function connectWhatsApp(a: Actor, raw: z.input<typeof waConnectSchema>, check = true) {
  need(a, "integrations.manage");
  const i = waConnectSchema.parse(raw);
  let display = "";
  if (check) display = (await graph<{ display_phone_number?: string }>(`/${i.phoneNumberId}?fields=display_phone_number`, i.token)).display_phone_number ?? "";
  const verifyToken = randomBytes(18).toString("base64url");
  await db.integrationConnection.upsert({
    where: { kind: "whatsapp" },
    create: { kind: "whatsapp", status: "connected", config: { phoneNumberId: i.phoneNumberId, wabaId: i.wabaId, displayNumber: display }, secrets: seal(JSON.stringify({ token: i.token, appSecret: i.appSecret, verifyToken })), updatedBy: a.id },
    update: { status: "connected", config: { phoneNumberId: i.phoneNumberId, wabaId: i.wabaId, displayNumber: display }, secrets: seal(JSON.stringify({ token: i.token, appSecret: i.appSecret, verifyToken })), updatedBy: a.id, lastError: null },
  });
  await gaudit(a, "WhatsApp connected", "integration", "whatsapp", `number ${display || i.phoneNumberId}`);
  return { verifyToken, display };
}
export async function disconnect(a: Actor, kind: "whatsapp" | "email") {
  need(a, "integrations.manage");
  await db.integrationConnection.updateMany({ where: { kind }, data: { status: "disconnected", secrets: null, updatedBy: a.id } });
  await gaudit(a, `${kind} disconnected`, "integration", kind);
}

export const emailSchema = z.object({ fromName: z.string().trim().min(2).max(60), replyTo: z.string().email().or(z.literal("")).default(""), postalAddress: z.string().trim().min(10, "Email campaigns must show a postal address.").max(300) });
/** Email sender setup: the provider comes from MAIL_PROVIDER/MAIL_FROM; a test mail with a code proves the sender works. */
export async function startEmailSetup(a: Actor, raw: z.input<typeof emailSchema>) {
  need(a, "integrations.manage");
  const i = emailSchema.parse(raw);
  if (!mailEnabled()) throw new UserError("No email provider is configured on this server (MAIL_PROVIDER and MAIL_FROM).");
  const code = String(randomInt(100000, 1000000));
  await sender.email(a.email, "Medoro Growth: confirm the sender", `Enter this code in Growth Intelligence → Email manager to confirm campaign email works: ${code}\n\nSender: ${process.env.MAIL_FROM}`);
  await db.integrationConnection.upsert({ where: { kind: "email" }, create: { kind: "email", status: "pending", config: { ...i, from: process.env.MAIL_FROM ?? "" }, secrets: seal(JSON.stringify({ code })), updatedBy: a.id }, update: { status: "pending", config: { ...i, from: process.env.MAIL_FROM ?? "" }, secrets: seal(JSON.stringify({ code })), updatedBy: a.id } });
  await gaudit(a, "Email sender setup started", "integration", "email", i.fromName);
}
export async function confirmEmailSetup(a: Actor, code: string) {
  need(a, "integrations.manage");
  const c = await db.integrationConnection.findUnique({ where: { kind: "email" } });
  if (!c?.secrets || c.status !== "pending") throw new UserError("Start the sender setup first.");
  const want = (JSON.parse(unseal(c.secrets).toString()) as { code: string }).code;
  if (code.trim() !== want) throw new UserError("That code doesn’t match the one in the test email.");
  await db.integrationConnection.update({ where: { kind: "email" }, data: { status: "connected", secrets: null } });
  await gaudit(a, "Email sender confirmed", "integration", "email");
}
async function emailConfig() {
  const c = await db.integrationConnection.findUnique({ where: { kind: "email" } });
  return c?.status === "connected" ? (c.config as { fromName: string; replyTo: string; postalAddress: string }) : null;
}

export async function integrations() {
  const rows = await db.integrationConnection.findMany();
  const wa = rows.find((r) => r.kind === "whatsapp");
  let verifyToken: string | null = null;
  if (wa?.secrets && wa.status === "connected") verifyToken = (JSON.parse(unseal(wa.secrets).toString()) as WaSecrets).verifyToken;
  return {
    whatsapp: wa ? { status: wa.status, config: wa.config as Record<string, string>, verifyToken, lastError: wa.lastError, updatedAt: wa.updatedAt } : null,
    email: (() => { const e = rows.find((r) => r.kind === "email"); return e ? { status: e.status, config: e.config as Record<string, string>, updatedAt: e.updatedAt } : null; })(),
    mailProvider: mailEnabled() ? (process.env.MAIL_PROVIDER ?? "") : "",
  };
}

// ── Templates
const VARS = { pharmacy: "Pharmacy name", city: "City", owner: "Owner first name (only when verified)", me: "Your first name" } as const;
export const TEMPLATE_VARS = VARS;
/** Email: {{pharmacy}} style. WhatsApp: positional {{1}}=pharmacy, {{2}}=city, {{3}}=sender's first name. */
export function render(body: string, v: { pharmacy: string; city: string; owner: string; me: string }) {
  return body.replace(/\{\{\s*(pharmacy|city|owner|me|1|2|3)\s*\}\}/g, (_, k: string) => ({ pharmacy: v.pharmacy, city: v.city, owner: v.owner, me: v.me, 1: v.pharmacy, 2: v.city, 3: v.me } as Record<string, string>)[k] ?? "");
}
const waParams = (body: string, v: { pharmacy: string; city: string; me: string }) => {
  const n = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  return [v.pharmacy, v.city, v.me].slice(0, n).map((text) => ({ type: "text", text: text || "-" }));
};

export const templateSchema = z.object({ channel: z.enum(["whatsapp", "email"]), name: z.string().trim().regex(/^[a-z0-9_]{3,60}$/, "Use lower-case letters, digits and _ (WhatsApp’s template-name rule)."), language: z.enum(["en", "hi", "en_IN"]).default("en"), category: z.enum(["MARKETING", "UTILITY"]).default("MARKETING"), subject: z.string().trim().max(150).default(""), body: z.string().trim().min(10).max(2000) });
export async function saveTemplate(a: Actor, raw: z.input<typeof templateSchema>) {
  need(a, "campaigns.manage");
  const i = templateSchema.parse(raw);
  if (i.channel === "email" && !i.subject) throw new UserError("Email templates need a subject.");
  const t = await db.messageTemplate.upsert({ where: { channel_name_language: { channel: i.channel, name: i.name, language: i.language } }, create: { ...i, status: "draft", createdBy: a.id }, update: { subject: i.subject, body: i.body, category: i.category, status: "draft" } });
  await gaudit(a, "Template saved", "template", t.id, `${i.channel}/${i.name}`);
  return t.id;
}
/** Email templates are approved in Medoro by an admin. WhatsApp templates are approved by Meta and come in through Sync. */
export async function approveTemplate(a: Actor, id: string) {
  need(a, "campaigns.approve");
  const t = await db.messageTemplate.findUnique({ where: { id } });
  if (!t) throw new UserError("Template not found.");
  if (t.channel === "whatsapp") throw new UserError("WhatsApp templates are approved by Meta. Submit it in WhatsApp Manager, then press Sync.");
  await db.messageTemplate.update({ where: { id }, data: { status: "approved" } });
  await gaudit(a, "Template approved", "template", id, t.name);
}
export async function syncWaTemplates(a: Actor) {
  need(a, "campaigns.manage");
  const w = await waConnection();
  if (!w) throw new UserError("Connect WhatsApp first.");
  type MetaTpl = { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] };
  const r = await graph<{ data?: MetaTpl[] }>(`/${w.cfg.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`, w.sec.token);
  let n = 0;
  for (const t of r.data ?? []) {
    const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
    const status = t.status === "APPROVED" ? "approved" : t.status === "REJECTED" ? "rejected" : "pending";
    await db.messageTemplate.upsert({ where: { channel_name_language: { channel: "whatsapp", name: t.name, language: t.language } }, create: { channel: "whatsapp", name: t.name, language: t.language, category: t.category, body, status, createdBy: a.id }, update: { body, status, category: t.category } });
    n++;
  }
  await gaudit(a, "WhatsApp templates synced", "template", null, `${n}`);
  return n;
}
export const templates = (channel?: string) => db.messageTemplate.findMany({ where: channel ? { channel } : {}, orderBy: [{ channel: "asc" }, { name: "asc" }] });

// ── Unsubscribe links
const unsubSig = (leadId: string, channel: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`growth-unsub:${leadId}:${channel}`).digest("base64url").slice(0, 32);
export const unsubscribeUrl = (leadId: string, channel: string) => `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/growth/unsubscribe?l=${leadId}&c=${channel}&t=${unsubSig(leadId, channel)}`;
export function checkUnsub(leadId: string, channel: string, t: string) {
  const want = unsubSig(leadId, channel);
  return t.length === want.length && timingSafeEqual(Buffer.from(t), Buffer.from(want));
}
export async function unsubscribe(leadId: string, channel: string, t: string) {
  if (!["email", "whatsapp"].includes(channel) || !checkUnsub(leadId, channel, t)) return false;
  const l = await db.pharmacyLead.findUnique({ where: { id: leadId } });
  if (!l) return true;
  const value = channel === "email" ? l.email : l.phone;
  await db.$transaction(async (tx) => {
    if (value) await addSuppression({ id: "public", name: "Unsubscribe link" }, { value, channel, reason: "opt_out", leadId }, tx);
    await tx.contactConsent.updateMany({ where: { leadId, channel, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: "public", revokeNote: "Unsubscribe link" } });
  });
  await gaudit({ id: null, name: "Unsubscribe link" }, "Opt-out", "lead", leadId, channel);
  return true;
}

// ── Sending
async function conversation(channel: string, address: string, leadId: string | null) {
  return db.messageConversation.upsert({ where: { channel_address: { channel, address } }, create: { channel, address, leadId }, update: { ...(leadId ? { leadId } : {}) } });
}
const vars = (l: { name: string; city: string; ownerName: string; ownerVerified: boolean }, me: string) => ({ pharmacy: l.name, city: l.city, owner: l.ownerVerified ? l.ownerName.split(" ")[0] : "", me: me.split(" ")[0] });
const footer = (cfg: { fromName: string; postalAddress: string }, leadId: string) => `\n\n—\n${cfg.fromName}, ${cfg.postalAddress}\nYou received this because you agreed to hear from Medoro. Unsubscribe: ${unsubscribeUrl(leadId, "email")}`;

export const sendSchema = z.object({ leadId: z.string().uuid(), channel: z.enum(["whatsapp", "email"]), templateId: z.string().uuid().optional(), text: z.string().trim().max(2000).optional() });
/** One message to one lead, sent by an employee after reviewing it. */
export async function sendMessage(a: Actor, raw: z.input<typeof sendSchema>) {
  need(a, "messages.send");
  const i = sendSchema.parse(raw);
  const lead = await findLead(a, i.leadId);
  const rl = await hit({ name: "growthSend", limit: 60, windowSec: 600, what: "messages sent" }, a.id);
  if (!rl.ok) throw new UserError("Too many messages in 10 minutes. Wait a little.");
  const address = i.channel === "whatsapp" ? lead.phone : lead.email;
  if (!address) throw new UserError(i.channel === "whatsapp" ? "This lead has no phone number." : "This lead has no email.");
  const conv = await conversation(i.channel, address, lead.id);
  const inWindow = !!conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < 24 * 3600_000;
  if (await suppressionFor(lead, i.channel)) throw new UserError("This contact opted out or is on the do-not-contact list.");
  // A free-form WhatsApp reply inside the 24-hour window answers the contact; everything else is business-initiated and needs consent.
  const freeReply = i.channel === "whatsapp" && !i.templateId && inWindow;
  if (!freeReply) {
    const b = await messageBlocker(lead, i.channel);
    if (b === "no consent") throw new UserError(`No recorded ${i.channel} consent from this pharmacy. Record consent first (with how it was given).`);
    if (b) throw new UserError(`Can’t message this lead: ${b}.`);
  }
  let body = "", payload: Record<string, unknown> = {}, subject = "";
  const v = vars(lead, a.name);
  if (i.templateId) {
    const t = await db.messageTemplate.findUnique({ where: { id: i.templateId } });
    if (!t || t.channel !== i.channel || t.status !== "approved") throw new UserError("Choose an approved template for this channel.");
    body = render(t.body, v); subject = render(t.subject, v);
    payload = { type: "template", template: { name: t.name, language: { code: t.language }, components: waParams(t.body, v).length ? [{ type: "body", parameters: waParams(t.body, v) }] : [] } };
  } else {
    if (!i.text) throw new UserError("Write the message or choose a template.");
    if (i.channel === "whatsapp" && !inWindow) throw new UserError("Outside the 24-hour window WhatsApp only allows approved templates.");
    body = i.text; payload = { type: "text", text: { body: i.text } }; subject = "Medoro";
  }
  const providerId = await deliver(i.channel, address, payload, subject, body, lead.id);
  await db.$transaction(async (tx) => {
    await tx.messageEvent.create({ data: { conversationId: conv.id, direction: "out", kind: i.templateId ? "template" : "text", body, status: "sent", providerId: providerId || null, staffId: a.id } });
    await tx.messageConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), unread: 0 } });
    await activity(tx, lead.id, "message", `${i.channel === "whatsapp" ? "WhatsApp" : "Email"} sent by ${a.name}: ${body.slice(0, 160)}`, a, conv.id);
  });
  return { conversationId: conv.id };
}

async function deliver(channel: string, address: string, payload: Record<string, unknown>, subject: string, body: string, leadId: string) {
  if (channel === "whatsapp") {
    const w = await waConnection();
    if (!w) throw new UserError("WhatsApp isn’t connected. A super admin connects it under Integrations.");
    return sender.whatsapp(w.conn, address, payload);
  }
  const cfg = await emailConfig();
  if (!cfg) throw new UserError("The email sender isn’t set up. A super admin sets it up in Email manager.");
  return (await sender.email(address, subject, body + footer(cfg, leadId))) ?? "";
}

// ── Campaigns: draft → approval by an admin → queued recipients (consent checked) → sent in daily-capped batches.
export const campaignSchema = z.object({ name: z.string().trim().min(3).max(100), channel: z.enum(["whatsapp", "email"]), templateId: z.string().uuid(), audience: z.record(z.string(), z.unknown()).default({}), dailyCap: z.coerce.number<string | number>().int().min(1).max(5000).default(200) });
export async function createCampaign(a: Actor, raw: z.input<typeof campaignSchema>) {
  need(a, "campaigns.manage");
  const i = campaignSchema.parse(raw);
  const t = await db.messageTemplate.findUnique({ where: { id: i.templateId } });
  if (!t || t.channel !== i.channel) throw new UserError("Choose a template for this channel.");
  filterSchema.parse({ ...i.audience, page: 1 });
  const c = await db.$transaction(async (tx) => tx.salesCampaign.create({ data: { code: "CMP-" + String(await nextSeq(tx, "_growth", "CAMPAIGN")).padStart(4, "0"), name: i.name, channel: i.channel, templateId: i.templateId, audience: i.audience as Prisma.InputJsonValue, dailyCap: i.dailyCap, status: "pending_approval", createdBy: a.id } }));
  await gaudit(a, "Campaign created", "campaign", c.id, `${c.code} · ${i.channel} · waiting for approval`);
  return c.id;
}

/** Who a campaign would reach, and who is excluded and why. */
export async function audiencePreview(a: Actor, channel: "whatsapp" | "email", audience: Record<string, unknown>) {
  need(a, "campaigns.manage");
  const leads = await db.pharmacyLead.findMany({ where: { AND: [filterWhere(a, filterSchema.parse({ ...audience, page: 1, pageSize: 200 })), { erasedAt: null }] }, take: 20_000, select: { id: true, phone: true, email: true, stage: true, erasedAt: true } });
  const reasons: Record<string, number> = {};
  let eligible = 0;
  for (const l of leads) { const b = await messageBlocker(l, channel); if (b) reasons[b] = (reasons[b] ?? 0) + 1; else eligible++; }
  return { matched: leads.length, eligible, excluded: reasons };
}

export async function approveCampaign(a: Actor, id: string, reviewed: boolean) {
  need(a, "campaigns.approve");
  if (!reviewed) throw new UserError("Confirm you reviewed the message and the audience.");
  const c = await db.salesCampaign.findUnique({ where: { id } });
  if (!c || c.status !== "pending_approval") throw new UserError("This campaign isn’t waiting for approval.");
  const t = await db.messageTemplate.findUnique({ where: { id: c.templateId } });
  if (!t || t.status !== "approved") throw new UserError(c.channel === "whatsapp" ? "The WhatsApp template isn’t approved by Meta yet (Sync templates to refresh)." : "Approve the email template first.");
  if (c.channel === "whatsapp" && !(await waConnection())) throw new UserError("Connect WhatsApp first.");
  if (c.channel === "email" && !(await emailConfig())) throw new UserError("Set up the email sender first.");
  const leads = await db.pharmacyLead.findMany({ where: { AND: [filterWhere(a, filterSchema.parse({ ...(c.audience as LeadFilter), page: 1, pageSize: 200 })), { erasedAt: null }] }, take: 20_000 });
  const rows: Prisma.CampaignRecipientCreateManyInput[] = [];
  for (const l of leads) {
    const b = await messageBlocker(l, c.channel as "whatsapp" | "email");
    rows.push({ campaignId: c.id, leadId: l.id, address: (c.channel === "whatsapp" ? l.phone : l.email) ?? "", status: b ? "skipped" : "queued", reason: b ?? "" });
  }
  await db.$transaction(async (tx) => {
    const u = await tx.salesCampaign.updateMany({ where: { id, status: "pending_approval" }, data: { status: "running", approvedBy: a.id, approvedAt: new Date() } });
    if (!u.count) throw new UserError("This campaign was already decided.");
    await tx.campaignRecipient.createMany({ data: rows, skipDuplicates: true });
  });
  await gaudit(a, c.createdBy === a.id ? "Campaign approved by its creator" : "Campaign approved", "campaign", id, `${c.code} · ${rows.filter((r) => r.status === "queued").length} queued, ${rows.filter((r) => r.status === "skipped").length} skipped`);
}
export async function cancelCampaign(a: Actor, id: string) {
  need(a, "campaigns.manage");
  const u = await db.salesCampaign.updateMany({ where: { id, status: { in: ["draft", "pending_approval", "running"] } }, data: { status: "cancelled" } });
  if (!u.count) throw new UserError("This campaign can’t be cancelled.");
  await db.campaignRecipient.updateMany({ where: { campaignId: id, status: "queued" }, data: { status: "skipped", reason: "campaign cancelled" } });
  await gaudit(a, "Campaign cancelled", "campaign", id);
}

/** Background: sends the next batch of every running campaign within its daily cap, re-checking consent per recipient. */
export async function sendCampaignBatches(now = new Date(), batch = 50) {
  const pol = await policy();
  const running = await db.salesCampaign.findMany({ where: { status: "running" } });
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  let sent = 0;
  for (const c of running) {
    const t = await db.messageTemplate.findUnique({ where: { id: c.templateId } });
    const today = await db.campaignRecipient.count({ where: { campaignId: c.id, sentAt: { gte: dayStart } } });
    const room = Math.min(c.dailyCap, pol.campaignDailyCap) - today;
    if (room <= 0 || !t) continue;
    const queue = await db.campaignRecipient.findMany({ where: { campaignId: c.id, status: "queued" }, take: Math.min(batch, room) });
    if (!queue.length) { await db.salesCampaign.update({ where: { id: c.id }, data: { status: "completed" } }); continue; }
    const creator = await db.staffUser.findUnique({ where: { id: c.createdBy }, select: { name: true } });
    for (const r of queue) {
      const l = await db.pharmacyLead.findUnique({ where: { id: r.leadId } });
      const b = l ? await messageBlocker(l, c.channel as "whatsapp" | "email") : "deleted";
      if (b || !l) { await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "skipped", reason: b ?? "deleted" } }); continue; }
      const v = vars(l, creator?.name ?? "Medoro");
      const body = render(t.body, v), subject = render(t.subject, v);
      const payload = { type: "template", template: { name: t.name, language: { code: t.language }, components: waParams(t.body, v).length ? [{ type: "body", parameters: waParams(t.body, v) }] : [] } };
      // Claim the recipient first so a crash after sending can't send twice.
      const claim = await db.campaignRecipient.updateMany({ where: { id: r.id, status: "queued" }, data: { status: "sending", sentAt: new Date() } });
      if (!claim.count) continue;
      try {
        const pid = await deliver(c.channel, r.address, payload, subject, body, l.id);
        const conv = await conversation(c.channel, r.address, l.id);
        await db.$transaction([
          db.campaignRecipient.update({ where: { id: r.id }, data: { status: "sent", providerId: pid || null } }),
          db.messageEvent.create({ data: { conversationId: conv.id, direction: "out", kind: "template", body, status: "sent", providerId: pid || null, campaignId: c.id } }),
          db.messageConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } }),
          db.leadActivity.create({ data: { leadId: l.id, kind: "message", text: `Campaign ${c.code} (${c.channel}) sent`, refId: c.id } }),
        ]);
        sent++;
      } catch (e) {
        await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "failed", reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) } });
      }
    }
  }
  return sent;
}

export async function campaigns(a: Actor) {
  need(a, "campaigns.manage");
  const rows = await db.salesCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const stats = await db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: rows.map((r) => r.id) } }, _count: true });
  const names = await staffNames(rows.flatMap((r) => [r.createdBy, r.approvedBy]));
  return rows.map((r) => ({ ...r, createdByName: names.get(r.createdBy) ?? "", approvedByName: r.approvedBy ? names.get(r.approvedBy) ?? "" : "", stats: Object.fromEntries(stats.filter((s) => s.campaignId === r.id).map((s) => [s.status, s._count])) }));
}

// ── Webhooks
const STOP = ["STOP", "UNSUBSCRIBE", "STOP ALL", "BAND", "BAND KARO", "बंद", "बंद करो"];
type WaHook = { entry?: { changes?: { field?: string; value?: { metadata?: { phone_number_id?: string }; statuses?: { id: string; status: string; errors?: { title?: string; code?: number }[] }[]; messages?: { id: string; from: string; type: string; text?: { body?: string } }[]; event?: string; message_template_name?: string; message_template_language?: string } }[] }[] };

export async function verifyWaWebhook(token: string) {
  const w = await waConnection();
  return !!w && token.length === w.sec.verifyToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(w.sec.verifyToken));
}

/** Meta webhook: checks X-Hub-Signature-256 with the app secret before reading anything. */
export async function handleWaWebhook(raw: string, signature: string | null) {
  const w = await waConnection();
  if (!w || !w.sec.appSecret) throw new Error("not connected");
  const want = "sha256=" + createHmac("sha256", w.sec.appSecret).update(raw).digest("hex");
  if (!signature || signature.length !== want.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(want))) throw new Error("bad signature");
  const body = JSON.parse(raw) as WaHook;
  const order = ["sent", "delivered", "read"];
  let n = 0;
  for (const e of body.entry ?? []) for (const ch of e.changes ?? []) {
    const v = ch.value ?? {};
    if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== w.cfg.phoneNumberId) continue;
    for (const s of v.statuses ?? []) {
      const ev = await db.messageEvent.findFirst({ where: { providerId: s.id, direction: "out" } });
      if (!ev) continue;
      const failed = s.status === "failed";
      if (failed || order.indexOf(s.status) > order.indexOf(ev.status)) await db.messageEvent.update({ where: { id: ev.id }, data: { status: s.status, error: failed ? `${s.errors?.[0]?.title ?? "Failed"} (${s.errors?.[0]?.code ?? "?"})` : null } });
      await db.messageEvent.create({ data: { conversationId: ev.conversationId, direction: "status", kind: "status", status: s.status, providerId: s.id } });
      const rec = await db.campaignRecipient.findFirst({ where: { providerId: s.id } });
      if (rec && rec.status !== "replied" && (failed || order.indexOf(s.status) > order.indexOf(rec.status))) await db.campaignRecipient.update({ where: { id: rec.id }, data: { status: s.status, reason: failed ? s.errors?.[0]?.title ?? "failed" : rec.reason } });
      n++;
    }
    if (ch.field === "message_template_status_update" && v.message_template_name && v.event) {
      await db.messageTemplate.updateMany({ where: { channel: "whatsapp", name: v.message_template_name, ...(v.message_template_language ? { language: v.message_template_language } : {}) }, data: { status: v.event === "APPROVED" ? "approved" : v.event === "REJECTED" ? "rejected" : "pending" } });
      n++;
    }
    for (const m of v.messages ?? []) {
      const phone = toE164("+" + m.from);
      if (!phone) continue;
      if (await db.messageEvent.findFirst({ where: { providerId: m.id, direction: "in" } })) continue; // a redelivered webhook
      const lead = await db.pharmacyLead.findFirst({ where: { phone, deletedAt: null }, orderBy: { createdAt: "asc" } });
      const conv = await conversation("whatsapp", phone, lead?.id ?? null);
      const text = m.text?.body ?? `[${m.type}]`;
      await db.$transaction(async (tx) => {
        await tx.messageEvent.create({ data: { conversationId: conv.id, direction: "in", kind: m.type === "text" ? "text" : m.type, body: text.slice(0, 4000), status: "received", providerId: m.id } });
        await tx.messageConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastInboundAt: new Date(), unread: { increment: 1 } } });
        if (lead) {
          await tx.leadActivity.create({ data: { leadId: lead.id, kind: "message", text: `WhatsApp received: ${text.slice(0, 200)}` } });
          const camp = await tx.campaignRecipient.findFirst({ where: { leadId: lead.id, status: { in: ["sent", "delivered", "read"] } }, orderBy: { sentAt: "desc" } });
          if (camp) await tx.campaignRecipient.update({ where: { id: camp.id }, data: { status: "replied" } });
        }
        if (STOP.includes(text.trim().toUpperCase())) {
          await addSuppression({ id: "public", name: "WhatsApp STOP reply" }, { value: phone, channel: "whatsapp", reason: "opt_out", leadId: lead?.id ?? null }, tx);
          if (lead) await tx.contactConsent.updateMany({ where: { leadId: lead.id, channel: "whatsapp", revokedAt: null }, data: { revokedAt: new Date(), revokedBy: "public", revokeNote: `Replied ${text.trim()}` } });
        }
      });
      n++;
    }
  }
  return n;
}

/**
 * Email provider events (bounces, complaints, replies) for any provider: POST JSON {type, email, providerId?, text?}
 * signed with HMAC-SHA256 of the raw body using GROWTH_EMAIL_WEBHOOK_SECRET in the x-medoro-signature header.
 */
export async function handleEmailEvent(raw: string, signature: string | null) {
  const secret = process.env.GROWTH_EMAIL_WEBHOOK_SECRET ?? "";
  if (secret.length < 16) throw new Error("not configured");
  const want = createHmac("sha256", secret).update(raw).digest("hex");
  if (!signature || signature.length !== want.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(want))) throw new Error("bad signature");
  const ev = z.object({ type: z.enum(["bounce", "complaint", "reply", "delivered"]), email: z.string().email(), providerId: z.string().max(200).optional(), text: z.string().max(4000).optional() }).parse(JSON.parse(raw));
  const email = ev.email.toLowerCase();
  const lead = await db.pharmacyLead.findFirst({ where: { email, deletedAt: null } });
  const conv = await conversation("email", email, lead?.id ?? null);
  if (ev.type === "bounce" || ev.type === "complaint") {
    await db.$transaction(async (tx) => {
      await addSuppression({ id: "public", name: "Email provider" }, { value: email, channel: "email", reason: ev.type, leadId: lead?.id ?? null }, tx);
      await tx.messageEvent.create({ data: { conversationId: conv.id, direction: "status", kind: "status", status: ev.type, providerId: ev.providerId ?? null } });
      if (lead) await tx.campaignRecipient.updateMany({ where: { leadId: lead.id, status: { in: ["sent", "delivered"] }, address: email }, data: { status: "failed", reason: ev.type } });
    });
  } else if (ev.type === "reply") {
    await db.messageEvent.create({ data: { conversationId: conv.id, direction: "in", kind: "text", body: (ev.text ?? "").slice(0, 4000), status: "received", providerId: ev.providerId ?? null } });
    await db.messageConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastInboundAt: new Date(), unread: { increment: 1 } } });
    if (lead) await db.campaignRecipient.updateMany({ where: { leadId: lead.id, address: email, status: { in: ["sent", "delivered", "read"] } }, data: { status: "replied" } });
  } else if (ev.providerId) await db.messageEvent.updateMany({ where: { providerId: ev.providerId, direction: "out" }, data: { status: "delivered" } });
  return ev.type;
}

// ── Unified inbox
export async function inbox(a: Actor, opts: { channel?: string; unread?: boolean } = {}) {
  need(a, "inbox.view");
  const visibleLeads = a.growthRole === "admin" ? undefined : (await db.pharmacyLead.findMany({ where: leadScope(a), select: { id: true }, take: 50_000 })).map((l) => l.id);
  const where: Prisma.MessageConversationWhereInput = { ...(opts.channel ? { channel: opts.channel } : {}), ...(opts.unread ? { unread: { gt: 0 } } : {}), ...(visibleLeads ? { leadId: { in: visibleLeads } } : {}), NOT: { address: { startsWith: "erased:" } } };
  const convs = await db.messageConversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 100, include: { events: { where: { direction: { not: "status" } }, orderBy: { at: "desc" }, take: 1 } } });
  const leads = await db.pharmacyLead.findMany({ where: { id: { in: convs.map((c) => c.leadId).filter(Boolean) as string[] } }, select: { id: true, code: true, name: true, stage: true, assignedStaffId: true, nextFollowUpAt: true, ownerName: true } });
  const names = await staffNames(leads.map((l) => l.assignedStaffId));
  return convs.map((c) => { const l = leads.find((x) => x.id === c.leadId); return { id: c.id, channel: c.channel, address: c.address, unread: c.unread, lastMessageAt: c.lastMessageAt.toISOString(), lastInboundAt: c.lastInboundAt?.toISOString() ?? null, last: c.events[0]?.body ?? "", lead: l ? { ...l, nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null, assignee: l.assignedStaffId ? names.get(l.assignedStaffId) ?? "" : "" } : null }; });
}
export async function thread(a: Actor, conversationId: string) {
  need(a, "inbox.view");
  const c = await db.messageConversation.findUnique({ where: { id: conversationId } });
  if (!c) throw new UserError("Conversation not found.");
  if (a.growthRole !== "admin") { if (!c.leadId) throw new UserError("Conversation not found."); await findLead(a, c.leadId); }
  const events = await db.messageEvent.findMany({ where: { conversationId, direction: { not: "status" } }, orderBy: { at: "asc" }, take: 500 });
  await db.messageConversation.update({ where: { id: c.id }, data: { unread: 0 } });
  const names = await staffNames(events.map((e) => e.staffId));
  return { conversation: c, inWindow: !!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < 24 * 3600_000, events: events.map((e) => ({ ...e, at: e.at.toISOString(), staffName: e.staffId ? names.get(e.staffId) ?? "" : "" })) };
}
