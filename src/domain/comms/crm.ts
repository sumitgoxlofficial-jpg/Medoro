import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { Prisma } from "@prisma/client";
import { unseal } from "@/server/vault";
import { addDays, dayMonth, isoOf, todayISO } from "@/lib/dates";
import { istClock } from "@/domain/system/schedule";
import type { WaConfig } from "./whatsapp";

export type CrmSettings = { refill: boolean; feedback: boolean; refillTemplate: string; feedbackTemplate: string; feedbackHours: number };

export async function crmSettings(tenantId: string): Promise<CrmSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { refill: false, feedback: false, refillTemplate: "refill_reminder", feedbackTemplate: "feedback_request", feedbackHours: 4, ...((t.settings as { crm?: object }).crm ?? {}) };
}

const TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;

export async function saveCrm(ctx: Ctx, patch: Partial<CrmSettings>) {
  authorize(ctx, "integrations");
  const p: Partial<CrmSettings> = {};
  if (patch.refill !== undefined) p.refill = !!patch.refill;
  if (patch.feedback !== undefined) p.feedback = !!patch.feedback;
  for (const k of ["refillTemplate", "feedbackTemplate"] as const) {
    if (patch[k] === undefined) continue;
    if (!TEMPLATE_RE.test(patch[k]!)) throw new UserError("Choose an approved template.");
    p[k] = patch[k];
  }
  if (patch.feedbackHours !== undefined) {
    const h = Math.round(Number(patch.feedbackHours));
    if (!(h >= 1 && h <= 72)) throw new UserError("Send feedback requests 1 to 72 hours after the purchase.");
    p.feedbackHours = h;
  }
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), crm: { ...((t.settings as { crm?: object }).crm ?? {}), ...p } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Messaging programs changed", entity: "tenant", detail: JSON.stringify(p) });
}

/** Refill reminders come only from purchase intervals: no conditions are inferred. */
export async function refillReminders(ctx: Ctx) {
  const rows = await refillDue(ctx.tenantId);
  const msgs = await db.waMessage.findMany({ where: { tenantId: ctx.tenantId, idempotencyKey: { in: rows.map((r) => r.key) } }, select: { idempotencyKey: true, status: true } });
  return rows.map((r) => ({ ...r, reminder: msgs.find((m) => m.idempotencyKey === r.key)?.status ?? null }));
}

async function refillDue(tenantId: string) {
  const rows = await db.$queryRaw<{ customerId: string; medicineId: string; ats: Date[] }[]>`
    SELECT s."customerId", si."medicineId", array_agg(s.at ORDER BY s.at) ats FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Customer" c ON c.id = s."customerId"
    WHERE s."tenantId" = ${tenantId} AND c."waOptIn" AND c."erasedAt" IS NULL AND s.at >= ${new Date(Date.now() - 365 * 86400_000)}
      AND NOT EXISTS (SELECT 1 FROM "SaleVoid" sv WHERE sv."saleId" = s.id)
    GROUP BY 1, 2 HAVING COUNT(DISTINCT date_trunc('day', s.at)) >= 2`;
  const [cs, ms] = await Promise.all([
    db.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true, phone: true } }),
    db.medicine.findMany({ where: { id: { in: rows.map((r) => r.medicineId) } }, select: { id: true, name: true } }),
  ]);
  const today = todayISO();
  return rows.map((r) => {
    const days = [...new Set(r.ats.map((d) => isoOf(new Date(d.getTime() + 330 * 60000))))].sort();
    const gaps = days.slice(1).map((d, i) => (Date.parse(d) - Date.parse(days[i])) / 86400_000);
    const interval = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const last = days[days.length - 1];
    const due = addDays(last, interval);
    const c = cs.find((x) => x.id === r.customerId)!, m = ms.find((x) => x.id === r.medicineId)!;
    // One reminder per refill cycle: the cycle is identified by the last purchase it follows.
    return { key: `refill:${c.id}:${m.id}:${last}`, customerId: c.id, customer: c.name, phone: c.phone, medicineId: m.id, medicine: m.name, interval, last, due, inDays: Math.round((Date.parse(due) - Date.parse(today)) / 86400_000) };
  }).filter((r) => r.interval >= 5 && r.inDays >= -7 && r.inDays <= 7).sort((a, b) => a.inDays - b.inDays);
}

export async function listCampaigns(ctx: Ctx) {
  const cs = await db.campaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  const sent = await db.waMessage.groupBy({ by: ["invoiceId", "status"], where: { tenantId: ctx.tenantId, invoiceId: { in: cs.map((c) => campaignRef(c.id)) } }, _count: true });
  return cs.map((c) => ({ id: c.id, name: c.name, template: c.template, audience: c.audience, status: c.status, createdAt: c.createdAt.toISOString(),
    delivered: sent.filter((s) => s.invoiceId === campaignRef(c.id) && (s.status === "delivered" || s.status === "read")).reduce((a, s) => a + s._count, 0),
    failed: sent.filter((s) => s.invoiceId === campaignRef(c.id) && s.status === "failed").reduce((a, s) => a + s._count, 0),
    handled: sent.filter((s) => s.invoiceId === campaignRef(c.id)).reduce((a, s) => a + s._count, 0) }));
}

export async function draftCampaign(ctx: Ctx, name: string, template: string) {
  authorize(ctx, "integrations");
  if (name.trim().length < 3) throw new UserError("Name the campaign.");
  if (!/^[a-z0-9_]{1,512}$/.test(template)) throw new UserError("Choose an approved template.");
  const audience = await db.customer.count({ where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null, phone: { not: null } } });
  const c = await db.campaign.create({ data: { tenantId: ctx.tenantId, name: name.trim(), template, audience, status: "draft" } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Campaign drafted", entity: "campaign", entityId: c.id, detail: `${c.name} · ${template} · ${audience} opted in` });
}

/** Campaign messages are logged with this in place of an invoice id. */
export const campaignRef = (id: string) => "campaign:" + id;
const CAMPAIGN_BATCH = 100;
// Stop well inside a server action's time limit; the caller repeats until done.
const SEND_BUDGET_MS = 40_000;

async function campaignSender(tenantId: string, template: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "whatsapp" } } });
  if (!i?.connectedAt || !i.encryptedSecret) throw new UserError("Connect WhatsApp Business first.");
  const cfg = i.config as WaConfig, tok = (JSON.parse(unseal(i.encryptedSecret).toString()) as { token: string }).token;
  const tpl = cfg.templates.find((t) => t.name === template);
  if (!tpl || tpl.status !== "approved") throw new UserError(`Template ${template} isn’t approved by Meta yet.`);
  // Body variables in order; a template with fewer variables gets only the first ones (unknown count: just the name).
  return async (phone: string, vars: string[]) => {
    const parameters = vars.slice(0, tpl.params ?? 1).map((text) => ({ type: "text", text }));
    const res = await fetch(`https://graph.facebook.com/${process.env.WA_GRAPH_VERSION ?? "v21.0"}/${cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ messaging_product: "whatsapp", to: "91" + phone, type: "template", template: { name: tpl.name, language: { code: tpl.language }, components: parameters.length ? [{ type: "body", parameters }] : [] } }),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !j.messages) throw new Error(j.error?.message ?? String(res.status));
    return j.messages[0].id;
  };
}

const firstName = (n: string) => n.split(" ")[0];

/**
 * Sends a template to every opted-in customer (body variable 1 = their name), in batches. Each
 * recipient's message is recorded before it goes out, so running it again (after a crash, a timeout
 * or a "Resume") skips everyone already handled. Returns done: false when it stopped for time.
 */
export async function sendCampaign(ctx: Ctx, id: string) {
  authorize(ctx, "integrations");
  const c = await db.campaign.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c || !["draft", "sending", "failed"].includes(c.status)) throw new UserError("This campaign was already sent.");
  const send = await campaignSender(ctx.tenantId, c.template);
  if (c.status !== "sending") {
    const r = await db.campaign.updateMany({ where: { id, status: c.status }, data: { status: "sending" } });
    if (!r.count) throw new UserError("Already sending.");
  } else {
    // A run that died between recording and sending: Meta may or may not have it, so don't resend blindly.
    await db.waMessage.updateMany({ where: { tenantId: ctx.tenantId, invoiceId: campaignRef(id), status: "queued", updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, data: { status: "failed", errorCode: "Interrupted before WhatsApp confirmed it. Retry if the customer didn’t get it." } });
  }
  const started = Date.now();
  let ok = 0, bad = 0, cursor: string | undefined;
  try {
    for (;;) {
      if (Date.now() - started > SEND_BUDGET_MS) return { ok, bad, done: false };
      const people = await db.customer.findMany({
        where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null, phone: { not: null } }, orderBy: { id: "asc" }, take: CAMPAIGN_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!people.length) break;
      cursor = people[people.length - 1].id;
      const keys = people.map((p) => `camp:${id}:${p.id}`);
      const seen = new Set((await db.waMessage.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true } })).map((m) => m.idempotencyKey));
      for (const p of people) {
        const key = `camp:${id}:${p.id}`;
        if (seen.has(key)) continue;
        // A concurrent run may claim the same recipient; the unique key lets exactly one send.
        const m = await db.waMessage.create({ data: { tenantId: ctx.tenantId, invoiceId: campaignRef(id), invoiceNo: c.name.slice(0, 60), recipient: p.phone!, idempotencyKey: key, status: "queued", attempts: 1 } })
          .catch((e) => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; throw e; });
        if (!m) continue;
        try {
          const wamid = await send(p.phone!, [firstName(p.name)]);
          await db.waMessage.update({ where: { id: m.id }, data: { status: "sent", wamid } }); ok++;
        } catch (e) { await db.waMessage.update({ where: { id: m.id }, data: { status: "failed", errorCode: (e instanceof Error ? e.message : "failed").slice(0, 200) } }); bad++; }
      }
    }
  } catch (e) {
    await db.campaign.updateMany({ where: { id, status: "sending" }, data: { status: "failed" } });
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Campaign stopped", entity: "campaign", entityId: id, detail: `${c.name} · ${ok} sent · ${bad} failed before an error; resume to continue` });
    throw e;
  }
  const recipients = await db.waMessage.count({ where: { tenantId: ctx.tenantId, invoiceId: campaignRef(id) } });
  await db.campaign.updateMany({ where: { id, status: "sending" }, data: { status: "sent", audience: recipients } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Campaign sent", entity: "campaign", entityId: id, detail: `${c.name} · ${recipients} recipients · ${ok} sent · ${bad} failed in the last run` });
  return { ok, bad, done: true };
}

/** Retries one failed campaign message (3 attempts in all), only if the customer is still opted in. */
export async function retryCampaignMessage(ctx: Ctx, messageId: string) {
  authorize(ctx, "integrations");
  const m = await db.waMessage.findFirst({ where: { id: messageId, tenantId: ctx.tenantId } });
  if (!m || !m.invoiceId.startsWith(campaignRef(""))) throw new UserError("Message not found.");
  if (m.status !== "failed") throw new UserError(`Already ${m.status}.`);
  if (m.attempts >= 3) throw new UserError("Retry limit reached (3 attempts).");
  const c = await db.campaign.findFirst({ where: { id: m.invoiceId.slice(campaignRef("").length), tenantId: ctx.tenantId } });
  if (!c) throw new UserError("Campaign not found.");
  const p = await db.customer.findFirst({ where: { id: m.idempotencyKey.split(":")[2], tenantId: ctx.tenantId, waOptIn: true, erasedAt: null, phone: { not: null } } });
  if (!p) throw new UserError("This customer has opted out or has no mobile number now.");
  const send = await campaignSender(ctx.tenantId, c.template);
  const claimed = await db.waMessage.updateMany({ where: { id: m.id, status: "failed", attempts: m.attempts }, data: { status: "queued", attempts: m.attempts + 1, recipient: p.phone!, errorCode: null } });
  if (!claimed.count) throw new UserError("This message is already being retried.");
  try {
    const wamid = await send(p.phone!, [firstName(p.name)]);
    await db.waMessage.update({ where: { id: m.id }, data: { status: "sent", wamid } });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "Send failed").slice(0, 200);
    await db.waMessage.update({ where: { id: m.id }, data: { status: "failed", errorCode: msg } });
    throw new UserError(msg);
  }
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Campaign message retried", entity: "wa_message", entityId: m.id, detail: `${c.name} → ${p.phone!.slice(0, 5)}•••••` });
  return { status: "sent" as const, id: m.id };
}

export async function optOuts(ctx: Ctx) {
  const cs = await db.customer.findMany({ where: { tenantId: ctx.tenantId, waOptIn: false, optInMethod: { startsWith: "Opted out" } }, orderBy: { optInAt: "desc" }, take: 50 });
  return cs.map((c) => ({ phone: c.phone ? `${c.phone.slice(0, 5)} ${c.phone.slice(5, 6)}••••` : "—", via: c.optInMethod ?? "", at: c.optInAt?.toISOString() ?? null }));
}

export async function optInCount(ctx: Ctx) {
  const [opted, all] = await Promise.all([db.customer.count({ where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null } }), db.customer.count({ where: { tenantId: ctx.tenantId, erasedAt: null } })]);
  return { opted, all };
}

type Actor = { userId?: string; userName?: string };
type RunResult = { sent: number; failed: number; skipped: number };

/**
 * Records a scheduled message under its idempotency key before sending, so a cycle is messaged once.
 * A failed one is retried on a later run, up to 3 attempts. Returns null when there's nothing to send.
 */
async function claim(tenantId: string, key: string, ref: string, label: string, phone: string) {
  const m = await db.waMessage.create({ data: { tenantId, invoiceId: ref, invoiceNo: label.slice(0, 60), recipient: phone, idempotencyKey: key, status: "queued", attempts: 1 } })
    .catch((e) => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; throw e; });
  if (m) return m;
  const old = await db.waMessage.findUnique({ where: { idempotencyKey: key } });
  if (!old || old.status !== "failed" || old.attempts >= 3) return null;
  const r = await db.waMessage.updateMany({ where: { id: old.id, status: "failed", attempts: old.attempts }, data: { status: "queued", attempts: old.attempts + 1, recipient: phone, errorCode: null } });
  return r.count ? { ...old, attempts: old.attempts + 1 } : null;
}

async function deliver(id: string, go: () => Promise<string>) {
  try { await db.waMessage.update({ where: { id }, data: { status: "sent", wamid: await go() } }); return true; }
  catch (e) { await db.waMessage.update({ where: { id }, data: { status: "failed", errorCode: (e instanceof Error ? e.message : "failed").slice(0, 200) } }); return false; }
}

/**
 * Sends today's refill reminders: opted-in customers whose usual refill is due within 2 days (or up to a
 * week overdue), one message per customer per run and one per refill cycle. Variables: name, medicine, due date.
 */
export async function sendRefillReminders(tenantId: string, by: Actor = {}): Promise<RunResult> {
  const s = await crmSettings(tenantId);
  if (!s.refill) throw new UserError("Turn on refill reminders first.");
  const send = await campaignSender(tenantId, s.refillTemplate);
  const due = (await refillDue(tenantId)).filter((r) => r.inDays <= 2 && r.phone);
  const out = { sent: 0, failed: 0, skipped: 0 }, done = new Set<string>();
  for (const r of due) {
    if (done.has(r.customerId)) { out.skipped++; continue; }
    // Opt-in can change between the query and the send (a STOP reply, an erasure).
    const c = await db.customer.findFirst({ where: { id: r.customerId, tenantId, waOptIn: true, erasedAt: null, phone: { not: null } } });
    if (!c) { out.skipped++; continue; }
    const m = await claim(tenantId, r.key, `refill:${c.id}`, `Refill · ${r.medicine}`, c.phone!);
    if (!m) continue;
    done.add(c.id);
    if (await deliver(m.id, () => send(c.phone!, [firstName(c.name), r.medicine, dayMonth(new Date(r.due + "T00:00:00+05:30"))]))) out.sent++; else out.failed++;
  }
  if (out.sent || out.failed) await writeAudit(db, { tenantId, userId: by.userId ?? null, userName: by.userName ?? "Scheduler", action: "Refill reminders sent", entity: "campaign", detail: `${out.sent} sent · ${out.failed} failed · template ${s.refillTemplate}` });
  return out;
}

/**
 * Asks for feedback a set number of hours after a sale, once per sale and at most once a month per
 * customer, only to opted-in customers. Variables: name, invoice number.
 */
export async function sendFeedbackRequests(tenantId: string, now = new Date()): Promise<RunResult> {
  const s = await crmSettings(tenantId);
  if (!s.feedback) throw new UserError("Turn on feedback requests first.");
  const send = await campaignSender(tenantId, s.feedbackTemplate);
  const until = new Date(now.getTime() - s.feedbackHours * 3600_000);
  const sales = await db.sale.findMany({
    where: { tenantId, at: { gte: new Date(until.getTime() - 48 * 3600_000), lte: until }, voided: { is: null }, customer: { waOptIn: true, erasedAt: null, phone: { not: null } } },
    include: { customer: true }, orderBy: { at: "asc" }, take: 500,
  });
  const out = { sent: 0, failed: 0, skipped: 0 }, done = new Set<string>();
  for (const sale of sales) {
    const c = sale.customer!;
    if (done.has(c.id)) { out.skipped++; continue; }
    const prev = await db.waMessage.findUnique({ where: { idempotencyKey: `fb:${sale.id}` } });
    if (prev && (prev.status !== "failed" || prev.attempts >= 3)) continue;
    const recent = await db.waMessage.count({ where: { tenantId, invoiceId: { startsWith: "feedback:" }, recipient: c.phone!, status: { not: "failed" }, createdAt: { gte: new Date(now.getTime() - 30 * 86400_000) } } });
    if (recent) { out.skipped++; continue; }
    const m = await claim(tenantId, `fb:${sale.id}`, `feedback:${sale.id}`, sale.invoiceNo, c.phone!);
    if (!m) continue;
    done.add(c.id);
    if (await deliver(m.id, () => send(c.phone!, [firstName(c.name), sale.invoiceNo]))) out.sent++; else out.failed++;
  }
  if (out.sent || out.failed) await writeAudit(db, { tenantId, userName: "Scheduler", action: "Feedback requests sent", entity: "campaign", detail: `${out.sent} sent · ${out.failed} failed · template ${s.feedbackTemplate}` });
  return out;
}

export async function sendRefillsNow(ctx: Ctx) {
  authorize(ctx, "integrations");
  return sendRefillReminders(ctx.tenantId, ctx);
}

const REFILL_TIME = "10:00";

/**
 * Scheduled messaging, run from the cron tick. Refill reminders go once a day per pharmacy (from 10:00
 * India time; the daily host cron runs them whenever it fires). Feedback requests are checked every 10 minutes.
 */
export async function messagingTick(now = new Date(), opts: { daily?: boolean } = {}) {
  const tenants = await db.$queryRaw<{ id: string; refill: boolean; feedback: boolean }[]>`
    SELECT id, COALESCE((settings->'crm'->>'refill')::boolean, false) refill, COALESCE((settings->'crm'->>'feedback')::boolean, false) feedback
    FROM "Tenant" WHERE settings->'crm'->>'refill' = 'true' OR settings->'crm'->>'feedback' = 'true'`;
  const { hhmm } = istClock(now);
  for (const t of tenants) {
    if (t.feedback && (opts.daily || Math.floor(now.getTime() / 60_000) % 10 === 0)) {
      await sendFeedbackRequests(t.id, now).catch((e) => { if (!(e instanceof UserError)) console.error("[messaging]", e); });
    }
    if (t.refill && (opts.daily || hhmm >= REFILL_TIME)) {
      const day = todayISO(now);
      // Claim today's run atomically so two servers or overlapping ticks can't both send.
      const claimed = await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{crmRefillDay}', to_jsonb(${day}::text)) WHERE id = ${t.id} AND COALESCE(settings->>'crmRefillDay', '') <> ${day}`;
      if (claimed) await sendRefillReminders(t.id).catch((e) => { if (!(e instanceof UserError)) console.error("[messaging]", e); });
    }
  }
}