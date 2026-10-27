import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { unseal } from "@/server/vault";
import { addDays, isoOf, todayISO } from "@/lib/dates";
import type { WaConfig } from "./whatsapp";

export async function crmSettings(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { refill: false, feedback: false, refillTemplate: "refill_reminder", ...((t.settings as { crm?: object }).crm ?? {}) } as { refill: boolean; feedback: boolean; refillTemplate: string };
}

export async function saveCrm(ctx: Ctx, patch: { refill?: boolean; feedback?: boolean }) {
  authorize(ctx, "integrations");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), crm: { ...((t.settings as { crm?: object }).crm ?? {}), ...patch } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Messaging programs changed", entity: "tenant", detail: JSON.stringify(patch) });
}

/** Refill reminders come only from purchase intervals: no conditions are inferred. */
export async function refillReminders(ctx: Ctx) {
  const rows = await db.$queryRaw<{ customerId: string; medicineId: string; ats: Date[] }[]>`
    SELECT s."customerId", si."medicineId", array_agg(s.at ORDER BY s.at) ats FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Customer" c ON c.id = s."customerId"
    WHERE s."tenantId" = ${ctx.tenantId} AND c."waOptIn" AND c."erasedAt" IS NULL AND s.at >= ${new Date(Date.now() - 365 * 86400_000)}
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
    const due = addDays(days[days.length - 1], interval);
    const c = cs.find((x) => x.id === r.customerId)!, m = ms.find((x) => x.id === r.medicineId)!;
    return { customerId: c.id, customer: c.name, phone: c.phone, medicine: m.name, interval, last: days[days.length - 1], due, inDays: Math.round((Date.parse(due) - Date.parse(today)) / 86400_000) };
  }).filter((r) => r.interval >= 5 && r.inDays >= -7 && r.inDays <= 7).sort((a, b) => a.inDays - b.inDays);
}

export async function listCampaigns(ctx: Ctx) {
  const cs = await db.campaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  const sent = await db.waMessage.groupBy({ by: ["invoiceId", "status"], where: { tenantId: ctx.tenantId, invoiceId: { in: cs.map((c) => "campaign:" + c.id) } }, _count: true });
  return cs.map((c) => ({ id: c.id, name: c.name, template: c.template, audience: c.audience, status: c.status, createdAt: c.createdAt.toISOString(),
    delivered: sent.filter((s) => s.invoiceId === "campaign:" + c.id && (s.status === "delivered" || s.status === "read")).reduce((a, s) => a + s._count, 0),
    failed: sent.filter((s) => s.invoiceId === "campaign:" + c.id && s.status === "failed").reduce((a, s) => a + s._count, 0) }));
}

export async function draftCampaign(ctx: Ctx, name: string, template: string) {
  authorize(ctx, "integrations");
  if (name.trim().length < 3) throw new UserError("Name the campaign.");
  if (!/^[a-z0-9_]{1,512}$/.test(template)) throw new UserError("Choose an approved template.");
  const audience = await db.customer.count({ where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null, phone: { not: null } } });
  const c = await db.campaign.create({ data: { tenantId: ctx.tenantId, name: name.trim(), template, audience, status: "draft" } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Campaign drafted", entity: "campaign", entityId: c.id, detail: `${c.name} · ${template} · ${audience} opted in` });
}

/** Sends a template to every opted-in customer (body variable 1 = their name). Each recipient once. */
export async function sendCampaign(ctx: Ctx, id: string) {
  authorize(ctx, "integrations");
  const c = await db.campaign.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c || c.status !== "draft") throw new UserError("Only draft campaigns can be sent.");
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } } });
  if (!i?.connectedAt || !i.encryptedSecret) throw new UserError("Connect WhatsApp Business first.");
  const cfg = i.config as WaConfig, tok = (JSON.parse(unseal(i.encryptedSecret).toString()) as { token: string }).token;
  const tpl = cfg.templates.find((t) => t.name === c.template);
  if (!tpl || tpl.status !== "approved") throw new UserError(`Template ${c.template} isn’t approved by Meta yet.`);
  const r = await db.campaign.updateMany({ where: { id, status: "draft" }, data: { status: "sending" } });
  if (!r.count) throw new UserError("Already sending.");
  const people = await db.customer.findMany({ where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null, phone: { not: null } }, take: 1000 });
  let ok = 0, bad = 0;
  for (const p of people) {
    const key = `camp:${id}:${p.id}`;
    if (await db.waMessage.findUnique({ where: { idempotencyKey: key } })) continue;
    const m = await db.waMessage.create({ data: { tenantId: ctx.tenantId, invoiceId: "campaign:" + id, invoiceNo: c.name.slice(0, 60), recipient: p.phone!, idempotencyKey: key, status: "queued", attempts: 1 } });
    try {
      const res = await fetch(`https://graph.facebook.com/${process.env.WA_GRAPH_VERSION ?? "v21.0"}/${cfg.phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ messaging_product: "whatsapp", to: "91" + p.phone, type: "template", template: { name: tpl.name, language: { code: tpl.language }, components: [{ type: "body", parameters: [{ type: "text", text: p.name.split(" ")[0] }] }] } }) });
      const j = (await res.json()) as { messages?: { id: string }[]; error?: { message?: string } };
      if (!res.ok || !j.messages) throw new Error(j.error?.message ?? String(res.status));
      await db.waMessage.update({ where: { id: m.id }, data: { status: "sent", wamid: j.messages[0].id } }); ok++;
    } catch (e) { await db.waMessage.update({ where: { id: m.id }, data: { status: "failed", errorCode: (e instanceof Error ? e.message : "failed").slice(0, 200) } }); bad++; }
  }
  await db.campaign.update({ where: { id }, data: { status: "sent", audience: people.length } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Campaign sent", entity: "campaign", entityId: id, detail: `${c.name} · ${ok} sent · ${bad} failed` });
  return { ok, bad };
}

export async function optOuts(ctx: Ctx) {
  const cs = await db.customer.findMany({ where: { tenantId: ctx.tenantId, waOptIn: false, optInMethod: { startsWith: "Opted out" } }, orderBy: { optInAt: "desc" }, take: 50 });
  return cs.map((c) => ({ phone: c.phone ? `${c.phone.slice(0, 5)} ${c.phone.slice(5, 6)}••••` : "—", via: c.optInMethod ?? "", at: c.optInAt?.toISOString() ?? null }));
}

export async function optInCount(ctx: Ctx) {
  const [opted, all] = await Promise.all([db.customer.count({ where: { tenantId: ctx.tenantId, waOptIn: true, erasedAt: null } }), db.customer.count({ where: { tenantId: ctx.tenantId, erasedAt: null } })]);
  return { opted, all };
}
