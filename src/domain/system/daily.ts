import "server-only";
import { db } from "@/server/db";
import { istDate } from "@/lib/dates";
import { applyRetention } from "./retention";
import { sendUsagePing } from "./telemetry";
import { complianceReminders } from "./compliance";
import { recordAuditCheck } from "./audit-integrity";
import { snapshotForecasts } from "@/domain/intelligence/forecast-intel";

/**
 * Once-a-day jobs per pharmacy: retention clean-up and, when allowed, the anonymous usage ping. Called from the scheduler
 * tick; the day is claimed atomically in the tenant's settings, so each pharmacy runs once per IST day across app servers.
 */
export async function dailyJobs(now = new Date()) {
  const day = istDate(now);
  const out: { tenantId: string; retention?: unknown; ping?: boolean; compliance?: unknown; forecast?: unknown; audit?: boolean; error?: string }[] = [];
  for (const t of await db.tenant.findMany({ select: { id: true } })) {
    const claimed = await db.$executeRaw`
      UPDATE "Tenant" SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, '{jobs}',
        COALESCE(CASE WHEN jsonb_typeof(settings->'jobs') = 'object' THEN settings->'jobs' END, '{}'::jsonb) || jsonb_build_object('daily', ${day}::text))
      WHERE id = ${t.id} AND COALESCE(settings->'jobs'->>'daily', '') <> ${day}`;
    if (!claimed) continue;
    const r: (typeof out)[number] = { tenantId: t.id };
    try { r.retention = await applyRetention(t.id, now); } catch (e) { r.error = e instanceof Error ? e.message : String(e); console.error("[retention]", r.error); }
    r.ping = await sendUsagePing(t.id, now).catch(() => false);
    r.compliance = await complianceReminders(t.id, now).catch((e) => { console.error("[compliance]", e instanceof Error ? e.message : e); return { error: true }; });
    // Once a week per branch, save the forecast as it was made so it can be scored against what sold (idempotent).
    r.forecast = await (async () => { let n = 0; for (const b of await db.branch.findMany({ where: { tenantId: t.id }, select: { id: true } })) n += await snapshotForecasts(t.id, b.id, now).catch((e) => { console.error("[forecast]", e instanceof Error ? e.message : e); return 0; }); return n; })();
    r.audit = (await recordAuditCheck(t.id, now)).ok;
    out.push(r);
  }
  return out;
}

