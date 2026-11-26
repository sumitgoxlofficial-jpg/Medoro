import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { toE164 } from "@/staff/growth/normalize";

/**
 * The WhatsApp copy of HRMS alerts: settings and the queue. Kept apart from whatsapp.ts so notify() (auth.ts) can queue
 * without importing the sender. A message is queued only when the super admin switched WhatsApp alerts on and the
 * employee opted in on their profile with a valid Indian mobile number.
 */
export const waConfigSchema = z.object({
  enabled: z.boolean(),
  // The Meta-approved utility template: one body variable {{1}} that carries the alert text.
  template: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names are lowercase letters, digits and underscores, as in WhatsApp Manager."),
  lang: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Language code looks wrong (e.g. en, en_US, hi)."),
});
export type WaConfig = z.infer<typeof waConfigSchema>;
export const WA_DEFAULT: WaConfig = { enabled: false, template: "hrms_alert", lang: "en" };

export async function waConfig(): Promise<WaConfig> {
  const v = (await db.hrSetting.findUnique({ where: { key: "whatsapp" } }))?.value as Partial<WaConfig> | undefined;
  return { ...WA_DEFAULT, ...(v ?? {}) };
}

/** WhatsApp template variables can't hold new lines, tabs or long runs of spaces, and are capped in length. */
export const waText = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 900);

/** Queues the WhatsApp copy of an alert for the people in `ids` who opted in. Returns how many were queued. */
export async function queueWa(ids: string[], text: string): Promise<number> {
  if (!ids.length || !(await waConfig()).enabled) return 0;
  const people = await db.hrProfile.findMany({
    where: { staffId: { in: ids }, waAlerts: true, staff: { status: "active", deletedAt: null } },
    select: { staffId: true, staff: { select: { phone: true } } },
  });
  const rows = people.flatMap((p) => { const to = toE164(p.staff.phone); return to ? [{ staffId: p.staffId, to, text: waText(text) }] : []; });
  if (rows.length) await db.hrWaMessage.createMany({ data: rows });
  return rows.length;
}
