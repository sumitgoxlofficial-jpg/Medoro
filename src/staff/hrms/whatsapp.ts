import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { sendWhatsAppPayload, waConnection } from "@/staff/growth/comms";
import { toE164 } from "@/staff/growth/normalize";
import { audit, needAdmin, type Me } from "./auth";
import { WA_DEFAULT, waConfig, waConfigSchema, waText, type WaConfig } from "./wa-queue";

/**
 * HRMS alerts on WhatsApp. Uses the company's WhatsApp Business number that is connected once for Medoro
 * (Growth → Integrations, the official Cloud API) and one approved utility template whose single variable {{1}} carries
 * the alert, e.g. "Medoro HRMS: {{1}}". The in-app notification always comes first; WhatsApp is a copy for people who
 * opted in. Sending runs on the scheduler, with up to 3 tries.
 */
const MAX_TRIES = 3;

const masked = (to: string) => to.replace(/^(\+\d{2})\d+(\d{3})$/, "$1•••••$2");

/** Super admin: the settings card. */
export async function waAdmin(me: Me) {
  needAdmin(me);
  const [cfg, wa, optedIn, recent] = await Promise.all([
    waConfig(), waConnection(),
    db.hrProfile.count({ where: { waAlerts: true, staff: { status: "active", deletedAt: null } } }),
    db.hrWaMessage.groupBy({ by: ["status"], where: { createdAt: { gte: new Date(Date.now() - 7 * 864e5) } }, _count: true }),
  ]);
  const lastError = (await db.hrWaMessage.findFirst({ where: { status: "failed" }, orderBy: { createdAt: "desc" }, select: { error: true, createdAt: true } })) ?? null;
  return {
    cfg, connected: !!wa, number: wa?.cfg.displayNumber ?? "", optedIn,
    week: Object.fromEntries(recent.map((r) => [r.status, r._count])) as Record<string, number>, lastError,
  };
}

export async function saveWaConfig(me: Me, raw: WaConfig) {
  needAdmin(me);
  const value = waConfigSchema.parse(raw);
  if (value.enabled && !(await waConnection())) throw new UserError("Connect the company WhatsApp Business number first (Growth → Integrations), then switch alerts on.");
  await db.hrSetting.upsert({ where: { key: "whatsapp" }, update: { value }, create: { key: "whatsapp", value } });
  await audit(me, value.enabled ? "WhatsApp alerts switched on" : "WhatsApp alerts switched off", `template ${value.template} · ${value.lang}`);
}

/** Sends a test alert to the super admin's own phone straight away, so a wrong template name shows up at once. */
export async function sendWaTest(me: Me) {
  needAdmin(me);
  const cfg = await waConfig();
  const to = toE164(me.phone);
  if (!to) throw new UserError("Add your mobile number to your profile first.");
  const row = await db.hrWaMessage.create({ data: { staffId: me.id, to, text: waText(`Test from ${me.name}: WhatsApp alerts are working.`) } });
  await deliver(row.id, cfg, true);
  const done = await db.hrWaMessage.findUniqueOrThrow({ where: { id: row.id } });
  if (done.status !== "sent") throw new UserError(`WhatsApp didn’t take the test message: ${done.error || "unknown error"}`);
  return `Test message sent to ${masked(to)}.`;
}

/** The employee's own switch, shown on their profile once the super admin switched alerts on. */
export async function myWaAlerts(me: Me) {
  const [cfg, p] = await Promise.all([waConfig(), db.hrProfile.findUnique({ where: { staffId: me.id }, select: { waAlerts: true } })]);
  const to = toE164(me.phone);
  return { available: cfg.enabled, on: !!p?.waAlerts, phone: to ? masked(to) : "" };
}

export async function setMyWaAlerts(me: Me, on: boolean) {
  const v = z.boolean().parse(on);
  if (v) {
    if (!(await waConfig()).enabled) throw new UserError("WhatsApp alerts aren’t switched on for the company yet.");
    if (!toE164(me.phone)) throw new UserError("Add a valid Indian mobile number to your profile first.");
  }
  await db.hrProfile.update({ where: { staffId: me.id }, data: { waAlerts: v, waAlertsAt: new Date() } });
  if (!v) await db.hrWaMessage.updateMany({ where: { staffId: me.id, status: "pending" }, data: { status: "failed", error: "Switched off by the employee" } });
  await audit(me, v ? "WhatsApp alerts on" : "WhatsApp alerts off");
}

/** Claims one queued message and sends it. Claiming first means two schedulers never send the same message twice. */
async function deliver(id: string, cfg: WaConfig, force = false) {
  const claimed = await db.hrWaMessage.updateMany({ where: { id, status: "pending" }, data: { status: "sending", attempts: { increment: 1 }, nextAt: new Date() } }); // nextAt = when it was claimed, while sending
  if (!claimed.count) return;
  const m = await db.hrWaMessage.findUniqueOrThrow({ where: { id } });
  try {
    if (!cfg.enabled && !force) throw new Error("WhatsApp alerts are switched off.");
    const wa = await waConnection();
    if (!wa) throw new Error("The company WhatsApp number isn’t connected.");
    const waId = await sendWhatsAppPayload(wa.conn, m.to, {
      type: "template",
      template: { name: cfg.template, language: { code: cfg.lang }, components: [{ type: "body", parameters: [{ type: "text", text: m.text }] }] },
    });
    await db.hrWaMessage.update({ where: { id }, data: { status: "sent", waId, sentAt: new Date(), error: "" } });
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const last = force || m.attempts >= MAX_TRIES;
    await db.hrWaMessage.update({ where: { id }, data: { status: last ? "failed" : "pending", error, nextAt: new Date(Date.now() + m.attempts * 5 * 60_000) } });
    if (last) log.warn("hrms whatsapp alert failed", { id, error });
  }
}

/** Scheduler job: send what is due; a message stuck in "sending" (a crashed run) goes back to the queue after 15 minutes. */
export async function waTick(now = new Date(), batch = 50) {
  await db.hrWaMessage.updateMany({ where: { status: "sending", nextAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, data: { status: "pending" } });
  const due = await db.hrWaMessage.findMany({ where: { status: "pending", nextAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: batch, select: { id: true } });
  if (!due.length) return 0;
  const cfg = await waConfig();
  for (const d of due) await deliver(d.id, cfg);
  return due.length;
}

export { WA_DEFAULT };
