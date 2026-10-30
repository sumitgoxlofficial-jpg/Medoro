import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { unseal } from "@/server/vault";
import { sendSms, smsEnabled } from "@/server/sms";
import { inr } from "@/lib/money";
import type { WaConfig } from "@/domain/comms/whatsapp";

export type NotifyEvent = "confirmed" | "out_for_delivery" | "delivered";
export type OrderSettings = { templates: Record<NotifyEvent, string> };
const DEFAULTS: OrderSettings = { templates: { confirmed: "order_confirmed", out_for_delivery: "order_out_for_delivery", delivered: "order_delivered" } };
const TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;

export async function orderSettings(tenantId: string): Promise<OrderSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const s = (t.settings as { orders?: Partial<OrderSettings> }).orders;
  return { templates: { ...DEFAULTS.templates, ...(s?.templates ?? {}) } };
}

export async function saveOrderSettings(ctx: Ctx, templates: Partial<Record<NotifyEvent, string>>) {
  authorize(ctx, "integrations");
  const cur = await orderSettings(ctx.tenantId);
  for (const k of Object.keys(DEFAULTS.templates) as NotifyEvent[]) {
    const v = templates[k]?.trim();
    if (v === undefined) continue;
    if (!TEMPLATE_RE.test(v)) throw new UserError("Template names are lowercase letters, digits and underscores.");
    cur.templates[k] = v;
  }
  await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{orders}', ${JSON.stringify(cur)}::jsonb) WHERE id = ${ctx.tenantId}`;
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Order message templates changed", entity: "tenant", detail: JSON.stringify(cur.templates) });
}

type Order = { id: string; tenantId: string; branchId: string; no: string; name: string; phone: string; customerId: string | null; waConsent: boolean; payMode: string; totalPaise: bigint | null; estimatePaise: bigint };
type Extra = { otp?: string; rider?: string };

async function whatsappSender(tenantId: string, template: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "whatsapp" } } });
  if (!i?.connectedAt || !i.encryptedSecret) return null;
  const cfg = i.config as WaConfig;
  const tpl = cfg.templates.find((t) => t.name === template && t.status === "approved");
  if (!tpl) return null;
  const token = (JSON.parse(unseal(i.encryptedSecret).toString()) as { token: string }).token;
  return async (phone: string, vars: string[]) => {
    const parameters = vars.slice(0, tpl.params ?? vars.length).map((text) => ({ type: "text", text }));
    const res = await fetch(`https://graph.facebook.com/${process.env.WA_GRAPH_VERSION ?? "v21.0"}/${cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ messaging_product: "whatsapp", to: "91" + phone, type: "template", template: { name: tpl.name, language: { code: tpl.language }, components: parameters.length ? [{ type: "body", parameters }] : [] } }),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !j.messages) throw new Error(j.error?.message ?? String(res.status));
    return j.messages[0].id;
  };
}

function texts(pharmacy: string, o: Order, event: NotifyEvent, x: Extra) {
  const amount = inr(Number(o.totalPaise ?? o.estimatePaise));
  const first = o.name.split(" ")[0];
  if (event === "confirmed") return { vars: [first, o.no, amount], sms: `${pharmacy}: order ${o.no} is confirmed (about ${amount}). We will message you when it is on the way.` };
  if (event === "out_for_delivery") {
    const pay = o.payMode === "cod" ? ` Please keep ${amount} ready.` : "";
    return { vars: [first, o.no, x.otp ?? "", x.rider ?? "", amount], sms: `${pharmacy}: order ${o.no} is out for delivery${x.rider ? ` with ${x.rider}` : ""}.${pay}${x.otp ? ` Share code ${x.otp} with the delivery person only when you receive it.` : ""}` };
  }
  return { vars: [first, o.no], sms: `${pharmacy}: order ${o.no} was delivered. Thank you!` };
}

/**
 * Tells the customer about their order: an approved WhatsApp template when WhatsApp is connected and the
 * customer agreed to it, otherwise an SMS when a gateway is configured. Never throws; returns the channel used.
 */
export async function notifyCustomer(o: Order, event: NotifyEvent, extra: Extra = {}): Promise<"whatsapp" | "sms" | "none"> {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: o.tenantId }, select: { name: true } });
  const { vars, sms } = texts(tenant.name, o, event, extra);
  const log = (note: string) => db.deliveryEvent.create({ data: { tenantId: o.tenantId, branchId: o.branchId, orderId: o.id, kind: "notified", note: note.slice(0, 300), userName: "Medoro" } });
  const errors: string[] = [];
  try {
    const c = o.customerId ? await db.customer.findFirst({ where: { id: o.customerId, tenantId: o.tenantId }, select: { waOptIn: true, optInMethod: true } }) : null;
    const optedOut = !!c && !c.waOptIn && !!c.optInMethod?.startsWith("Opted out");
    const consent = !optedOut && (o.waConsent || !!c?.waOptIn);
    const s = await orderSettings(o.tenantId);
    const send = consent ? await whatsappSender(o.tenantId, s.templates[event]) : null;
    if (send) {
      const key = `order:${o.id}:${event}:${Date.now().toString(36)}`;
      const m = await db.waMessage.create({ data: { tenantId: o.tenantId, invoiceId: "order:" + o.id, invoiceNo: o.no, recipient: o.phone, idempotencyKey: key, status: "queued", attempts: 1 } });
      try {
        const wamid = await send(o.phone, vars);
        await db.waMessage.update({ where: { id: m.id }, data: { status: "sent", wamid } });
        await log(`${event.replace(/_/g, " ")} · WhatsApp ${s.templates[event]}`);
        return "whatsapp";
      } catch (e) {
        const msg = e instanceof Error ? e.message : "failed";
        await db.waMessage.update({ where: { id: m.id }, data: { status: "failed", errorCode: msg.slice(0, 200) } });
        errors.push("WhatsApp failed: " + msg);
      }
    }
    if (smsEnabled()) {
      try { await sendSms(o.phone, sms); await log(`${event.replace(/_/g, " ")} · SMS${errors.length ? " (" + errors.join("; ") + ")" : ""}`); return "sms"; }
      catch (e) { errors.push("SMS failed: " + (e instanceof Error ? e.message : "error")); }
    }
    await log(`${event.replace(/_/g, " ")} · not sent${errors.length ? ": " + errors.join("; ") : " (no WhatsApp template or SMS gateway)"}`);
  } catch (e) {
    console.error("[orders] notify", e);
  }
  return "none";
}
