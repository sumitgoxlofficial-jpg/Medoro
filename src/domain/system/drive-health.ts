import "server-only";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { mailEnabled, sendMail } from "@/server/mail";
import { driveSyncHealth, financeAlerts } from "@/domain/reports/alerts";
import { driveQuota } from "./gdrive";
import { quotaProblem, type Quota } from "./drive-state";

const DAY = 86400_000;
type HealthState = { checkedAt?: string; mailedAt?: string; quota?: Quota };

/**
 * Once a day per Drive mode pharmacy: reads how full its Google Drive is, and emails the owners when a counter
 * stopped saving to Drive, a sync keeps failing, or Drive is nearly full (at most one email a day).
 */
export async function driveHealthTick(now = new Date(), quota: typeof driveQuota = driveQuota) {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true, settings: true } });
  for (const t of tenants) {
    const s = (t.settings ?? {}) as { driveMode?: boolean; driveHealth?: HealthState };
    if (s.driveMode !== true) continue;
    const h = s.driveHealth ?? {};
    if (h.checkedAt && now.getTime() - Date.parse(h.checkedAt) < DAY) continue;
    try {
      const q = await quota(t.id).catch((e) => { log.warn("Couldn’t read Google Drive storage.", { err: e, tenantId: t.id }); return null; });
      const next: HealthState = { ...h, checkedAt: now.toISOString(), ...(q ? { quota: { ...q, at: now.toISOString() } } : {}) };
      const money = await financeAlerts(t.id, now);
      const problems = [...(await driveSyncHealth(t.id, now)), ...[quotaProblem(next.quota)].filter((x): x is string => !!x)];
      if ((problems.length || money.length) && mailEnabled() && (!h.mailedAt || now.getTime() - Date.parse(h.mailedAt) >= DAY)) {
        const owners = await db.user.findMany({ where: { tenantId: t.id, active: true, isSupport: false, role: { name: "Owner" }, email: { not: null } }, select: { email: true } });
        for (const o of owners) {
          const parts = [
            problems.length ? `${problems.map((p) => `• ${p}`).join("\n")}\n\nYour pharmacy's records live on your counters and in your Google Drive. Bills that haven't reached Drive exist only on that counter, so fix these soon. Open Medoro on the counter while online, or check Counter → Devices on the owner's counter.` : "",
            money.length ? `UPI & Bank\n${money.map((p) => `• ${p}`).join("\n")}` : "",
          ].filter(Boolean);
          await sendMail({ to: o.email!, subject: problems.length ? `Medoro: your counters and Google Drive need a look (${t.name})` : `Medoro: payments to check (${t.name})`, text: parts.join("\n\n") }).catch(() => {});
        }
        if (owners.length) next.mailedAt = now.toISOString();
      }
      const cur = await db.tenant.findUniqueOrThrow({ where: { id: t.id }, select: { settings: true } });
      await db.tenant.update({ where: { id: t.id }, data: { settings: { ...((cur.settings ?? {}) as object), driveHealth: next } } });
    } catch (e) { log.error("Drive health check failed.", { err: e, tenantId: t.id }); }
  }
}
