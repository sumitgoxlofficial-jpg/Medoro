import "server-only";
import type { Customer } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, requireSubscription, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { Prisma } from "@prisma/client";
import { smsAvailable, smsNeedsTemplate, smsText, SMS_TYPES, type SmsType } from "@/server/sms";
import { addDays, dayMonth, isoOf, todayISO } from "@/lib/dates";
import { istClock } from "@/domain/system/schedule";
import { phoneMasker } from "@/domain/system/strict";
import { maskPhone } from "@/lib/mask";
import { customerBalances } from "@/domain/parties/balances";
import { loyaltySettings, salePoints } from "@/domain/sales/loyalty";
import { consentWhere, hasConsent, type Purpose } from "@/domain/parties/consent";
import { activeAccount, approvedTemplate, dispatch, queueMessage, smsReady, smsSettings, waAccount, type Payload, type SmsSettings, type WaTemplate } from "./delivery";

export type CrmSettings = {
  refill: boolean; feedback: boolean; payment: boolean; refillTemplate: string; feedbackTemplate: string; paymentTemplate: string; feedbackHours: number;
  /** Day of the week (0 Sunday … 6 Saturday) for the weekly payment reminders. */
  paymentDay: number;
};

export async function crmSettings(tenantId: string): Promise<CrmSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { refill: false, feedback: false, payment: false, refillTemplate: "refill_reminder", feedbackTemplate: "feedback_request", paymentTemplate: "payment_reminder", feedbackHours: 4, paymentDay: 1, ...((t.settings as { crm?: object }).crm ?? {}) };
}

const TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;

export async function saveCrm(ctx: Ctx, patch: Partial<CrmSettings>) {
  authorize(ctx, "integrations");
  const p: Partial<CrmSettings> = {};
  for (const k of ["refill", "feedback", "payment"] as const) if (patch[k] !== undefined) p[k] = !!patch[k];
  for (const k of ["refillTemplate", "feedbackTemplate", "paymentTemplate"] as const) {
    if (patch[k] === undefined) continue;
    if (!TEMPLATE_RE.test(patch[k]!)) throw new UserError("Choose an approved template.");
    p[k] = patch[k];
  }
  if (patch.feedbackHours !== undefined) {
    const h = Math.round(Number(patch.feedbackHours));
    if (!(h >= 1 && h <= 72)) throw new UserError("Send feedback requests 1 to 72 hours after the purchase.");
    p.feedbackHours = h;
  }
  if (patch.paymentDay !== undefined) {
    const d = Math.round(Number(patch.paymentDay));
    if (!(d >= 0 && d <= 6)) throw new UserError("Choose a day of the week.");
    p.paymentDay = d;
  }
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), crm: { ...((t.settings as { crm?: object }).crm ?? {}), ...p } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Messaging programs changed", entity: "tenant", detail: JSON.stringify(p) });
}

/** SMS for customers without WhatsApp consent: on/off and the MSG91 (DLT-linked) template id per message type. */
export async function saveSmsSettings(ctx: Ctx, patch: { enabled?: boolean; templates?: Partial<Record<SmsType, string>> }) {
  authorize(ctx, "integrations");
  const cur = await smsSettings(ctx.tenantId);
  const next: SmsSettings = { enabled: patch.enabled ?? cur.enabled, templates: { ...cur.templates } };
  for (const [k, v] of Object.entries(patch.templates ?? {}) as [SmsType, string][]) {
    if (!SMS_TYPES.includes(k)) continue;
    const id = (v ?? "").trim();
    if (id && !/^[A-Za-z0-9_-]{4,40}$/.test(id)) throw new UserError("Template ids are letters and digits, as shown in your SMS gateway.");
    if (id) next.templates[k] = id; else delete next.templates[k];
  }
  if (next.enabled && !smsAvailable()) throw new UserError("No SMS gateway is set up on this server (SMS_PROVIDER or OTP_PROVIDER).");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), sms: next } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "SMS messaging changed", entity: "tenant", detail: `${next.enabled ? "on" : "off"} · templates ${Object.keys(next.templates).join(", ") || "none"}` });
}

export async function smsStatus(tenantId: string) {
  return { ...(await smsSettings(tenantId)), available: smsAvailable(), needsTemplate: smsNeedsTemplate() };
}

const firstName = (n: string) => n.split(" ")[0];

/**
 * Which channel reaches each customer for one kind of message: WhatsApp when they consented to this purpose there
 * (and the number isn't flagged as not on WhatsApp) and the template is approved; else SMS when they consented to
 * this purpose by SMS and SMS is set up for this type. Campaigns and store updates are marketing; refill, feedback,
 * payment and points messages are transactional (see domain/parties/consent). A connected WhatsApp with the
 * template missing is an error the owner must fix.
 */
async function router(tenantId: string, template: string | null, smsType: SmsType | null, purpose: Purpose = smsType === "campaign" ? "marketing" : "transactional") {
  const [w, s, t] = await Promise.all([activeAccount(tenantId), smsSettings(tenantId), db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } })]);
  const tpl: WaTemplate | null = w && template ? await approvedTemplate(w, template) : null;
  const sms = !!smsType && smsReady(s, smsType);
  if (!tpl && !sms) {
    const any = await waAccount(tenantId);
    throw new UserError(any?.cfg.disconnected ? "WhatsApp is disconnected (Meta rejected the access token). Reconnect it under WhatsApp." : "Connect WhatsApp Business first.");
  }
  return {
    wa: !!tpl, sms,
    /** Prisma filter for customers this router can reach. */
    audience: { OR: [...(tpl ? [{ ...consentWhere(purpose, "whatsapp"), waInvalidAt: null }] : []), ...(sms ? [consentWhere(purpose, "sms")] : [])] } satisfies Prisma.CustomerWhereInput,
    payload(c: Pick<Customer, "phone" | "erasedAt" | "optInMethod" | "waOptIn" | "waInvalidAt" | "smsOptIn" | "marketingWa" | "marketingSms">, vars: string[]): Payload | null {
      if (tpl && hasConsent(c, purpose, "whatsapp") && !c.waInvalidAt) return { ch: "wa", template: tpl.name, vars, n: 1 };
      if (sms && hasConsent(c, purpose, "sms")) return { ch: "sms", type: smsType!, vars, text: smsText(smsType!, vars, t.name) };
      return null;
    },
  };
}

/** Refill reminders come only from purchase intervals: no conditions are inferred. */
export async function refillReminders(ctx: Ctx) {
  const [rows, mask] = await Promise.all([refillDue(ctx.tenantId), phoneMasker(ctx)]);
  const msgs = await db.waMessage.findMany({ where: { tenantId: ctx.tenantId, idempotencyKey: { in: rows.map((r) => r.key) } }, select: { idempotencyKey: true, status: true } });
  return rows.map((r) => ({ ...r, phone: mask(r.phone), reminder: msgs.find((m) => m.idempotencyKey === r.key)?.status ?? null }));
}

async function refillDue(tenantId: string) {
  const rows = await db.$queryRaw<{ customerId: string; medicineId: string; ats: Date[] }[]>`
    SELECT s."customerId", si."medicineId", array_agg(s.at ORDER BY s.at) ats FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Customer" c ON c.id = s."customerId"
    WHERE s."tenantId" = ${tenantId} AND (c."waOptIn" OR c."smsOptIn") AND c."erasedAt" IS NULL AND s.at >= ${new Date(Date.now() - 365 * 86400_000)}
      AND NOT EXISTS (SELECT 1 FROM "SaleVoid" sv WHERE sv."saleId" = s.id)
    GROUP BY 1, 2 HAVING COUNT(DISTINCT (s.at + interval '330 minutes')::date) >= 2`;
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

// ───────────── Campaigns and store updates ─────────────

export async function listCampaigns(ctx: Ctx) {
  const cs = await db.campaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  const sent = await db.waMessage.groupBy({ by: ["invoiceId", "status"], where: { tenantId: ctx.tenantId, invoiceId: { in: cs.map((c) => campaignRef(c.id)) } }, _count: true });
  return cs.map((c) => ({ id: c.id, name: c.name, template: c.template, message: c.message, audience: c.audience, status: c.status, createdAt: c.createdAt.toISOString(),
    delivered: sent.filter((s) => s.invoiceId === campaignRef(c.id) && (s.status === "delivered" || s.status === "read")).reduce((a, s) => a + s._count, 0),
    failed: sent.filter((s) => s.invoiceId === campaignRef(c.id) && s.status === "failed").reduce((a, s) => a + s._count, 0),
    handled: sent.filter((s) => s.invoiceId === campaignRef(c.id)).reduce((a, s) => a + s._count, 0) }));
}

/**
 * Drafts a campaign. With a message it's a store update: the text goes as body variable 2 (variable 1 is
 * the customer's first name) and as the SMS text for customers reached by SMS.
 */
export async function draftCampaign(ctx: Ctx, name: string, template: string, message?: string) {
  authorize(ctx, "integrations");
  requireSubscription(ctx);
  if (name.trim().length < 3) throw new UserError("Name the campaign.");
  if (!TEMPLATE_RE.test(template)) throw new UserError("Choose an approved template.");
  // WhatsApp variables can't contain line breaks, tabs or long runs of spaces.
  const text = message?.replace(/\s+/g, " ").trim() || null;
  if (text && text.length > 300) throw new UserError("Keep the update under 300 characters.");
  const r = await router(ctx.tenantId, template, "campaign", "marketing");
  const audience = await db.customer.count({ where: { tenantId: ctx.tenantId, erasedAt: null, phone: { not: null }, ...r.audience } });
  const c = await db.campaign.create({ data: { tenantId: ctx.tenantId, name: name.trim(), template, message: text, audience, status: "draft" } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: text ? "Store update drafted" : "Campaign drafted", entity: "campaign", entityId: c.id, detail: `${c.name} · ${template} · ${audience} opted in` });
}

/** Campaign messages are logged with this in place of an invoice id. */
export const campaignRef = (id: string) => "campaign:" + id;
const CAMPAIGN_BATCH = 100;
// Stop well inside a server action's time limit; the caller repeats until done.
const SEND_BUDGET_MS = 40_000;

/**
 * Sends a template to every opted-in customer (variable 1 = their name, 2 = the update text), in batches,
 * on WhatsApp or (without WhatsApp consent) SMS. Each recipient's message is recorded before it goes out, so
 * running it again (after a crash, a timeout or a "Resume") skips everyone already handled. Returns done:
 * false when it stopped for time.
 */
export async function sendCampaign(ctx: Ctx, id: string) {
  authorize(ctx, "integrations");
  requireSubscription(ctx);
  const c = await db.campaign.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c || !["draft", "sending", "failed"].includes(c.status)) throw new UserError("This campaign was already sent.");
  const route = await router(ctx.tenantId, c.template, "campaign", "marketing");
  if (c.status !== "sending") {
    const r = await db.campaign.updateMany({ where: { id, status: c.status }, data: { status: "sending" } });
    if (!r.count) throw new UserError("Already sending.");
  } else {
    // A run that died between recording and sending: Meta may or may not have it, so don't resend blindly.
    await db.waMessage.updateMany({ where: { tenantId: ctx.tenantId, invoiceId: campaignRef(id), status: "queued", updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, data: { status: "failed", errorKind: "permanent", errorCode: "Interrupted before it was confirmed. Retry if the customer didn’t get it." } });
  }
  const started = Date.now();
  let ok = 0, bad = 0, cursor: string | undefined;
  try {
    for (;;) {
      if (Date.now() - started > SEND_BUDGET_MS) return { ok, bad, done: false };
      const people = await db.customer.findMany({
        where: { tenantId: ctx.tenantId, erasedAt: null, phone: { not: null }, ...route.audience }, orderBy: { id: "asc" }, take: CAMPAIGN_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!people.length) break;
      cursor = people[people.length - 1].id;
      const keys = people.map((p) => `camp:${id}:${p.id}`);
      const seen = new Set((await db.waMessage.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true } })).map((m) => m.idempotencyKey));
      for (const p of people) {
        const key = `camp:${id}:${p.id}`;
        const payload = route.payload(p, c.message ? [firstName(p.name), c.message] : [firstName(p.name)]);
        if (seen.has(key) || !payload) continue;
        // A concurrent run may claim the same recipient; the unique key lets exactly one send.
        const m = await db.waMessage.create({ data: { tenantId: ctx.tenantId, invoiceId: campaignRef(id), invoiceNo: c.name.slice(0, 60), recipient: p.phone!, idempotencyKey: key, status: "queued", attempts: 1, channel: payload.ch === "sms" ? "sms" : "whatsapp", customerId: p.id, payload } })
          .catch((e) => { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; throw e; });
        if (!m) continue;
        if ((await dispatch(m)).ok) ok++; else bad++;
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

export async function optOuts(ctx: Ctx) {
  const cs = await db.customer.findMany({ where: { tenantId: ctx.tenantId, OR: [{ waOptIn: false, optInMethod: { startsWith: "Opted out" } }, { smsOptIn: false, smsOptInMethod: { startsWith: "Opted out" } }] }, orderBy: { optInAt: "desc" }, take: 50 });
  return cs.map((c) => {
    const sms = !c.smsOptIn && c.smsOptInMethod?.startsWith("Opted out");
    return { phone: maskPhone(c.phone) ?? "—", via: (sms && !c.optInMethod?.startsWith("Opted out") ? c.smsOptInMethod : c.optInMethod) ?? "", at: (sms ? c.smsOptInAt : c.optInAt)?.toISOString() ?? null };
  });
}

export async function optInCount(ctx: Ctx) {
  const [opted, sms, all] = await Promise.all([
    db.customer.count({ where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null } }),
    db.customer.count({ where: { tenantId: ctx.tenantId, smsOptIn: true, waOptIn: false, erasedAt: null } }),
    db.customer.count({ where: { tenantId: ctx.tenantId, erasedAt: null } }),
  ]);
  return { opted, sms, all };
}

type Actor = { userId?: string; userName?: string };
type RunResult = { sent: number; failed: number; skipped: number };

/**
 * Sends today's refill reminders: opted-in customers whose usual refill is due within 2 days (or up to a
 * week overdue), one message per customer per run and one per refill cycle. Variables: name, medicine, due date.
 */
export async function sendRefillReminders(tenantId: string, by: Actor = {}): Promise<RunResult> {
  const s = await crmSettings(tenantId);
  if (!s.refill) throw new UserError("Turn on refill reminders first.");
  const route = await router(tenantId, s.refillTemplate, "refill");
  const due = (await refillDue(tenantId)).filter((r) => r.inDays <= 2 && r.phone);
  const out = { sent: 0, failed: 0, skipped: 0 }, done = new Set<string>();
  for (const r of due) {
    if (done.has(r.customerId)) { out.skipped++; continue; }
    // Consent can change between the query and the send (a STOP reply, an erasure).
    const c = await db.customer.findFirst({ where: { id: r.customerId, tenantId, erasedAt: null, phone: { not: null } } });
    const payload = c && route.payload(c, [firstName(c.name), r.medicine, dayMonth(new Date(r.due + "T00:00:00+05:30"))]);
    if (!c || !payload) { out.skipped++; continue; }
    const m = await queueMessage(tenantId, { key: r.key, ref: `refill:${c.id}`, label: `Refill · ${r.medicine}`, phone: c.phone!, customerId: c.id, payload });
    if (!m) continue;
    done.add(c.id);
    if ((await dispatch(m)).ok) out.sent++; else out.failed++;
  }
  if (out.sent || out.failed) await writeAudit(db, { tenantId, userId: by.userId ?? null, userName: by.userName ?? "Scheduler", action: "Refill reminders sent", entity: "campaign", detail: `${out.sent} sent · ${out.failed} failed · template ${s.refillTemplate}` });
  return out;
}

/**
 * Asks for feedback a set number of hours after a sale, once per sale and at most once a month per
 * customer, only to customers opted in on WhatsApp. Variables: name, invoice number.
 */
export async function sendFeedbackRequests(tenantId: string, now = new Date()): Promise<RunResult> {
  const s = await crmSettings(tenantId);
  if (!s.feedback) throw new UserError("Turn on feedback requests first.");
  const route = await router(tenantId, s.feedbackTemplate, null);
  const until = new Date(now.getTime() - s.feedbackHours * 3600_000);
  const sales = await db.sale.findMany({
    where: { tenantId, at: { gte: new Date(until.getTime() - 48 * 3600_000), lte: until }, voided: { is: null }, customer: { waOptIn: true, waInvalidAt: null, erasedAt: null, phone: { not: null } } },
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
    const payload = route.payload(c, [firstName(c.name), sale.invoiceNo]);
    if (!payload) { out.skipped++; continue; }
    const m = await queueMessage(tenantId, { key: `fb:${sale.id}`, ref: `feedback:${sale.id}`, label: sale.invoiceNo, phone: c.phone!, customerId: c.id, payload });
    if (!m) continue;
    done.add(c.id);
    if ((await dispatch(m)).ok) out.sent++; else out.failed++;
  }
  if (out.sent || out.failed) await writeAudit(db, { tenantId, userName: "Scheduler", action: "Feedback requests sent", entity: "campaign", detail: `${out.sent} sent · ${out.failed} failed · template ${s.feedbackTemplate}` });
  return out;
}

export async function sendRefillsNow(ctx: Ctx) {
  authorize(ctx, "integrations");
  return sendRefillReminders(ctx.tenantId, ctx);
}

// ───────────── Payment reminders ─────────────

const rupees = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Customers with an outstanding credit balance, largest first, with the last reminder sent to each. */
export async function paymentDues(ctx: Ctx) {
  const bal = await customerBalances(db, ctx.tenantId);
  const ids = [...bal].filter(([, v]) => v > 0).map(([k]) => k);
  const [cs, last] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId, erasedAt: null } }),
    db.waMessage.groupBy({ by: ["customerId"], where: { tenantId: ctx.tenantId, invoiceId: { startsWith: "payrem:" }, status: { not: "failed" }, customerId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  return cs.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, due: bal.get(c.id) ?? 0, wa: c.waOptIn && !c.waInvalidAt, sms: c.smsOptIn,
    lastReminder: last.find((l) => l.customerId === c.id)?._max.createdAt?.toISOString() ?? null,
  })).sort((a, b) => b.due - a.due);
}

/**
 * Reminds customers of their outstanding balance (variables: name, amount due, pharmacy), only those who
 * consented to WhatsApp or SMS. At most one reminder per customer a day; the weekly run also skips anyone
 * reminded in the past 6 days.
 */
export async function sendPaymentReminders(tenantId: string, opts: { customerIds?: string[]; weekly?: boolean; by?: Actor } = {}): Promise<RunResult> {
  const s = await crmSettings(tenantId);
  if (opts.weekly && !s.payment) throw new UserError("Turn on payment reminders first.");
  const route = await router(tenantId, s.paymentTemplate, "payment");
  const [bal, tenant] = await Promise.all([customerBalances(db, tenantId), db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } })]);
  const ids = [...bal].filter(([id, v]) => v > 0 && (!opts.customerIds || opts.customerIds.includes(id))).map(([id]) => id);
  const people = await db.customer.findMany({ where: { id: { in: ids }, tenantId, erasedAt: null, phone: { not: null }, ...route.audience } });
  const today = todayISO(), out = { sent: 0, failed: 0, skipped: ids.length - people.length };
  for (const c of people) {
    if (opts.weekly && (await db.waMessage.count({ where: { tenantId, customerId: c.id, invoiceId: { startsWith: "payrem:" }, status: { not: "failed" }, createdAt: { gte: new Date(Date.now() - 6 * 86400_000) } } }))) { out.skipped++; continue; }
    const payload = route.payload(c, [firstName(c.name), rupees(bal.get(c.id)!), tenant.name]);
    if (!payload) { out.skipped++; continue; }
    const m = await queueMessage(tenantId, { key: `pay:${c.id}:${today}`, ref: `payrem:${c.id}`, label: `Payment due · ${rupees(bal.get(c.id)!)}`, phone: c.phone!, customerId: c.id, payload });
    if (!m) { out.skipped++; continue; }
    if ((await dispatch(m)).ok) out.sent++; else out.failed++;
  }
  if (out.sent || out.failed) await writeAudit(db, { tenantId, userId: opts.by?.userId ?? null, userName: opts.by?.userName ?? "Scheduler", action: "Payment reminders sent", entity: "campaign", detail: `${out.sent} sent · ${out.failed} failed · ${out.skipped} skipped` });
  return out;
}

export async function sendPaymentRemindersNow(ctx: Ctx, customerIds?: string[]) {
  authorize(ctx, "integrations");
  return sendPaymentReminders(ctx.tenantId, { customerIds, by: ctx });
}

const REFILL_TIME = "10:00";

/**
 * Optional message after a sale that earned points (variables: name, points earned, balance), when loyalty
 * messages are on and the customer consented on WhatsApp or SMS. Once per sale.
 */
export async function sendPointsMessage(tenantId: string, saleId: string) {
  const ls = await loyaltySettings(tenantId);
  if (!ls.enabled || !ls.notify) return null;
  const sale = await db.sale.findFirst({ where: { id: saleId, tenantId }, include: { customer: true } });
  const c = sale?.customer;
  if (!sale || !c?.phone || c.erasedAt) return null;
  const pts = await salePoints(tenantId, saleId, c.id);
  if (!pts?.earned) return null;
  const route = await router(tenantId, ls.template, "loyalty");
  const payload = route.payload(c, [firstName(c.name), String(pts.earned), String(pts.balance)]);
  if (!payload) return null;
  const m = await queueMessage(tenantId, { key: `pts:${saleId}`, ref: `loyalty:${saleId}`, label: `${pts.earned} points · ${sale.invoiceNo}`, phone: c.phone, customerId: c.id, payload });
  return m ? dispatch(m) : null;
}

/**
 * Scheduled messaging, run from the cron tick. Refill reminders go once a day per pharmacy (from 10:00
 * India time; the daily host cron runs them whenever it fires), payment reminders once a week on the chosen
 * day from 10:00. Feedback requests are checked every 10 minutes.
 */
export async function messagingTick(now = new Date(), opts: { daily?: boolean } = {}) {
  const tenants = await db.$queryRaw<{ id: string; refill: boolean; feedback: boolean; payment: boolean; payday: number }[]>`
    SELECT id, COALESCE((settings->'crm'->>'refill')::boolean, false) refill, COALESCE((settings->'crm'->>'feedback')::boolean, false) feedback,
      COALESCE((settings->'crm'->>'payment')::boolean, false) payment, COALESCE((settings->'crm'->>'paymentDay')::int, 1) payday
    FROM "Tenant" WHERE settings->'crm'->>'refill' = 'true' OR settings->'crm'->>'feedback' = 'true' OR settings->'crm'->>'payment' = 'true'`;
  const { hhmm } = istClock(now);
  const weekday = new Date(now.getTime() + 330 * 60_000).getUTCDay();
  const day = todayISO(now);
  const log = (e: unknown) => { if (!(e instanceof UserError)) console.error("[messaging]", e); };
  // Claim today's run atomically so two servers or overlapping ticks can't both send.
  const claim = (id: string, key: string) => db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, ${`{${key}}`}::text[], to_jsonb(${day}::text)) WHERE id = ${id} AND COALESCE(settings->>${key}, '') <> ${day}`;
  for (const t of tenants) {
    if (t.feedback && (opts.daily || Math.floor(now.getTime() / 60_000) % 10 === 0)) await sendFeedbackRequests(t.id, now).catch(log);
    if (t.refill && (opts.daily || hhmm >= REFILL_TIME) && (await claim(t.id, "crmRefillDay"))) await sendRefillReminders(t.id).catch(log);
    if (t.payment && weekday === t.payday && (opts.daily || hhmm >= REFILL_TIME) && (await claim(t.id, "crmPayDay"))) await sendPaymentReminders(t.id, { weekly: true }).catch(log);
  }
}
