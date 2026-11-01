import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { ReadOnlyError, SubscriptionLockedError, type Ctx } from "@/server/context";
import { seal, unseal } from "@/server/vault";
import { log } from "@/server/log";
import { sealForDevice, type InboxPayment } from "@/drivedb/inbox";
import { driveModeOn, ownerOnly } from "./drive-mode";

/**
 * Customers pay a pharmacy's bills online (phase 6), into the pharmacy's own Razorpay account. The counter asks for
 * a payment link (Medoro forwards it to Razorpay and keeps nothing); when the customer pays, Razorpay calls Medoro,
 * which seals the payment for each of the pharmacy's devices and holds it only until a counter records it.
 */
const KIND = "razorpay_pay";
const API = "https://api.razorpay.com/v1";
type Secrets = { keySecret: string; webhookSecret: string };

export const connectInput = z.object({
  keyId: z.string().trim().regex(/^rzp_(live|test)_[A-Za-z0-9]{6,40}$/, "Paste the Key Id from Razorpay → Settings → API keys (starts with rzp_live_ or rzp_test_)."),
  keySecret: z.string().trim().min(10, "Paste the Key Secret.").max(100),
  webhookSecret: z.string().trim().min(8, "Make up a webhook secret (8 characters or more) and paste the same in Razorpay.").max(100),
});

const integration = (tenantId: string) => db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: KIND } } });
const auth = (keyId: string, secret: string) => "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64");
const baseUrl = () => (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://medoro.in").replace(/\/$/, "");
export const webhookUrl = (tenantId: string) => `${baseUrl()}/api/razorpay/pay/${tenantId}`;

async function account(tenantId: string) {
  const i = await integration(tenantId);
  if (!i?.connectedAt || !i.encryptedSecret) return null;
  return { keyId: (i.config as { keyId: string }).keyId, ...(JSON.parse(unseal(i.encryptedSecret).toString()) as Secrets) };
}

export async function payStatus(ctx: Ctx) {
  const i = await integration(ctx.tenantId);
  return { connected: !!i?.connectedAt, keyId: i?.connectedAt ? (i.config as { keyId: string }).keyId : null, webhookUrl: webhookUrl(ctx.tenantId) };
}

/** Owner: connects the pharmacy's own Razorpay account. The keys are checked with Razorpay, then kept sealed. */
export async function connectCustomerPay(ctx: Ctx, raw: z.input<typeof connectInput>, f: typeof fetch = fetch) {
  ownerOnly(ctx, "connect online payments");
  if (!(await driveModeOn(ctx.tenantId))) throw new UserError("Turn on Drive mode first.");
  const i = connectInput.parse(raw);
  const r = await f(`${API}/payment_links?count=1`, { headers: { Authorization: auth(i.keyId, i.keySecret) } }).catch(() => null);
  if (!r) throw new UserError("Couldn’t reach Razorpay. Check the internet connection and try again.");
  if (r.status === 401) throw new UserError("Razorpay didn’t accept these keys. Copy the Key Id and Key Secret again.");
  if (!r.ok) throw new UserError(`Razorpay answered ${r.status}. Make sure Payment Links are enabled on the account.`);
  const box = new Uint8Array(seal(JSON.stringify({ keySecret: i.keySecret, webhookSecret: i.webhookSecret } satisfies Secrets)));
  await db.integration.upsert({
    where: { tenantId_kind: { tenantId: ctx.tenantId, kind: KIND } },
    create: { tenantId: ctx.tenantId, kind: KIND, config: { keyId: i.keyId }, encryptedSecret: box, connectedAt: new Date() },
    update: { config: { keyId: i.keyId }, encryptedSecret: box, connectedAt: new Date(), rotatedAt: new Date() },
  });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Online payments connected", entity: "integration", detail: `Razorpay ${i.keyId}` });
  return payStatus(ctx);
}

export async function disconnectCustomerPay(ctx: Ctx) {
  ownerOnly(ctx, "disconnect online payments");
  await db.integration.updateMany({ where: { tenantId: ctx.tenantId, kind: KIND }, data: { connectedAt: null, encryptedSecret: null } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Online payments disconnected", entity: "integration" });
  return payStatus(ctx);
}

export const linkInput = z.object({
  customerId: z.string().min(1).max(64),
  saleId: z.string().max(64).nullish(),
  customerName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).nullish(),
  amountPaise: z.number().int().min(100, "At least ₹1.").max(10_000_000_00),
  label: z.string().trim().max(60).optional(),
});

/**
 * A Razorpay payment link for a customer's dues (or one bill). Records live on the counter, so this isn't a
 * business change on Medoro's server: any signed-in user who may bill on credit or take payments can ask for one.
 */
export async function createPayLink(ctx: Ctx, raw: z.input<typeof linkInput>, f: typeof fetch = fetch) {
  if (ctx.readOnly) throw new ReadOnlyError();
  if (ctx.locked) throw new SubscriptionLockedError();
  if (!["sale", "payments", "credit"].some((p) => ctx.perms.includes(p))) throw new UserError("Your role can’t take payments.");
  const a = await account(ctx.tenantId);
  if (!a) throw new UserError("Online payments aren’t connected. The owner connects Razorpay under Counter on their counter.");
  const i = linkInput.parse(raw);
  const contact = (i.phone ?? "").replace(/\D/g, "").slice(-10);
  const r = await f(`${API}/payment_links`, {
    method: "POST", headers: { Authorization: auth(a.keyId, a.keySecret), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: i.amountPaise, currency: "INR", accept_partial: false, description: (i.label || `Payment to the pharmacy`).slice(0, 60),
      customer: { name: i.customerName, ...(/^[6-9]\d{9}$/.test(contact) ? { contact: `+91${contact}` } : {}) },
      notify: { sms: false, email: false }, reminder_enable: false,
      notes: { medoro: "1", customer: i.customerId, ...(i.saleId ? { sale: i.saleId } : {}) },
    }),
  }).catch(() => null);
  if (!r) throw new UserError("Couldn’t reach Razorpay. Payment links need the internet.");
  const j = (await r.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
  if (!r.ok || !j.short_url) throw new UserError(`Razorpay didn’t make the link: ${j.error?.description ?? r.status}`);
  return { url: j.short_url, id: j.id ?? "" };
}

const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type LinkPaid = {
  event?: string;
  payload?: { payment_link?: { entity?: { id: string; amount_paid?: number; notes?: Record<string, string> } }; payment?: { entity?: { id: string; amount: number; method?: string; created_at?: number } } };
};

/**
 * Razorpay webhook for one pharmacy (`payment_link.paid`). Checks the signature with that pharmacy's secret, then
 * seals the payment for each approved device. Nothing readable is stored; a counter records it and Medoro deletes it.
 */
export async function handlePayWebhook(tenantId: string, raw: string, signature: string | null) {
  const a = await account(tenantId).catch(() => null);
  if (!a) return { status: 404, note: "not connected" };
  if (!signature || !sameHex(createHmac("sha256", a.webhookSecret).update(raw).digest("hex"), signature)) return { status: 401, note: "bad signature" };
  const body = JSON.parse(raw) as LinkPaid;
  if (body.event !== "payment_link.paid") return { status: 200, note: "ignored" };
  const link = body.payload?.payment_link?.entity, pay = body.payload?.payment?.entity;
  if (!link || !pay || link.notes?.medoro !== "1" || !link.notes.customer) return { status: 200, note: "not a Medoro link" };
  const p: InboxPayment = {
    paymentId: pay.id, linkId: link.id, amountPaise: pay.amount, customerId: link.notes.customer, saleId: link.notes.sale ?? null,
    method: pay.method ?? "upi", paidAt: new Date((pay.created_at ?? Date.now() / 1000) * 1000).toISOString(),
  };
  const devices = await db.driveDevice.findMany({ where: { tenantId, status: "approved" } });
  if (!devices.length) { log.warn("Online payment with no approved device to receive it.", { tenantId, paymentId: p.paymentId }); return { status: 503, note: "no device yet" }; }
  const rows = await Promise.all(devices.map(async (d) => ({ tenantId, deviceId: d.deviceId, paymentId: p.paymentId, sealed: await sealForDevice(d.publicKey as JsonWebKey, p) })));
  await db.paymentInbox.createMany({ data: rows, skipDuplicates: true });
  return { status: 200, note: "queued" };
}

/** This device's waiting payments (still sealed). */
export async function inboxFor(tenantId: string, deviceId: string) {
  return (await db.paymentInbox.findMany({ where: { tenantId, deviceId }, orderBy: { createdAt: "asc" }, take: 100 })).map((r) => ({ paymentId: r.paymentId, sealed: r.sealed }));
}

/** A counter recorded these payments: every device's copy goes. */
export async function ackInbox(tenantId: string, paymentIds: string[]) {
  const ids = paymentIds.filter((x) => /^pay_[A-Za-z0-9]{6,40}$/.test(x)).slice(0, 100);
  if (!ids.length) return 0;
  return (await db.paymentInbox.deleteMany({ where: { tenantId, paymentId: { in: ids } } })).count;
}
