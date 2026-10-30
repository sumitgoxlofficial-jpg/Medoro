import "server-only";
import { db } from "@/server/db";
import { istDate } from "@/lib/dates";
import { applyRetention } from "./retention";
import { sendUsagePing } from "./telemetry";

/**
 * Once-a-day jobs per pharmacy: retention clean-up and, when allowed, the anonymous usage ping. Called from the scheduler
 * tick; the day is claimed atomically in the tenant's settings, so each pharmacy runs once per IST day across app servers.
 */
export async function dailyJobs(now = new Date()) {
  const day = istDate(now);
  const out: { tenantId: string; retention?: unknown; ping?: boolean; error?: string }[] = [];
  for (const t of await db.tenant.findMany({ select: { id: true } })) {
    const claimed = await db.$executeRaw`
      UPDATE "Tenant" SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, '{jobs}',
        COALESCE(CASE WHEN jsonb_typeof(settings->'jobs') = 'object' THEN settings->'jobs' END, '{}'::jsonb) || jsonb_build_object('daily', ${day}::text))
      WHERE id = ${t.id} AND COALESCE(settings->'jobs'->>'daily', '') <> ${day}`;
    if (!claimed) continue;
    const r: (typeof out)[number] = { tenantId: t.id };
    try { r.retention = await applyRetention(t.id, now); } catch (e) { r.error = e instanceof Error ? e.message : String(e); console.error("[retention]", r.error); }
    r.ping = await sendUsagePing(t.id, now).catch(() => false);
    out.push(r);
  }
  return out;
}
