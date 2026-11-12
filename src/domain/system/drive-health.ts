import "server-only";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { mailEnabled, sendMail } from "@/server/mail";
import { compose } from "@/server/mail-template";
import { driveSyncHealth } from "@/domain/reports/alerts";
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
      const problems = [...(await driveSyncHealth(t.id, now)), ...[quotaProblem(next.quota)].filter((x): x is string => !!x)];
      if (problems.length && mailEnabled() && (!h.mailedAt || now.getTime() - Date.parse(h.mailedAt) >= DAY)) {
        const owners = await db.user.findMany({ where: { tenantId: t.id, active: true, isSupport: false, role: { name: "Owner" }, email: { not: null } }, select: { email: true } });
        for (const o of owners) {
          const subject = `Action needed: your counters and Google Drive (${t.name})`;
          await sendMail({ to: o.email!, subject, ...compose({
            greeting: "Dear Owner,",
            blocks: [
              { p: `During today's check of ${t.name} we found the following:\n${problems.map((p) => `• ${p}`).join("\n")}` },
              { p: "Your pharmacy's records live on your counters and in your Google Drive. Bills that have not reached Drive exist only on that counter, so please resolve this soon." },
              { note: "What to do: open Medoro on the counter while it is online, or check Counter → Devices on the owner's counter." },
            ],
          }, subject) }).catch(() => {});
        }
        if (owners.length) next.mailedAt = now.toISOString();
      }
      const cur = await db.tenant.findUniqueOrThrow({ where: { id: t.id }, select: { settings: true } });
      await db.tenant.update({ where: { id: t.id }, data: { settings: { ...((cur.settings ?? {}) as object), driveHealth: next } } });
    } catch (e) { log.error("Drive health check failed.", { err: e, tenantId: t.id }); }
  }
}
