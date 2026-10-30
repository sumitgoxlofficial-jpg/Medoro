import { requireCtx, can } from "@/server/context";
import { canManageOffline, offlineOverview } from "@/domain/sales/offline";
import { OfflinePanel } from "./offline-panel";
import { db } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { dayMonth, hhmm } from "@/lib/dates";
import { Monitor, Smartphone } from "lucide-react";

export const metadata = { title: "Sync & offline" };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-1";

function ago(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${dayMonth(d)} ${hhmm(d)}`;
}

export default async function Page() {
  const ctx = await requireCtx();
  // Everyone can see their own sign-ins and this branch's offline billing; the full device list (with IPs) is for user admins.
  const allUsers = can(ctx, "users");
  const [sessions, counters, branches, off] = await Promise.all([
    db.session.findMany({ where: { user: { tenantId: ctx.tenantId }, ...(allUsers ? {} : { userId: ctx.userId }), revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { select: { name: true } } }, orderBy: { lastSeenAt: "desc" } }),
    db.counter.findMany({ where: { tenantId: ctx.tenantId, active: true } }),
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    offlineOverview(ctx),
  ]);
  const devices = sessions.map((s) => {
    const c = counters.find((x) => x.id === s.counterId);
    const live = Date.now() - s.lastSeenAt.getTime() < 5 * 60_000;
    const mobile = /Android|iPhone|iPad/i.test(s.userAgent ?? "");
    return { id: s.id, name: c ? `${branches.find((b) => b.id === c.branchId)?.name} · ${c.name}` : s.device ?? (mobile ? "Phone or tablet" : "Browser"), who: s.user.name, live, last: ago(s.lastSeenAt), mobile, isThis: s.id === ctx.sessionId, ip: s.ip };
  });
  return (
    <>
      <PageHead title={t(ctx.lang).sync} sub="Devices connected to your server and offline reconciliation" />
      <div className="flex flex-col gap-4 max-w-[1100px]">
        <div className={card}>
          <div className="font-semibold text-[15px] mb-1">{allUsers ? "Devices on the live database" : "Your devices on the live database"}</div>
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2 border-b border-row last:border-0 text-[13.5px] flex-wrap">
              {d.mobile ? <Smartphone size={16} className="text-muted" /> : <Monitor size={16} className="text-muted" />}
              <span className="font-medium">{d.name}</span><span className="text-muted">{d.who}{d.ip ? ` · ${d.ip}` : ""}</span>
              <Badge tone={d.live ? "green" : "gray"} className="ml-auto">{d.isThis ? "This device" : d.live ? "Online" : "Idle"}</Badge>
              <span className="text-[12.5px] text-faint w-[110px] text-right">{d.last}</span>
            </div>
          ))}
        </div>
        <OfflinePanel devices={off.devices} ops={off.ops} branchId={ctx.branchId} branchName={ctx.branchName} counterName={ctx.counterName} canManage={!ctx.readOnly && canManageOffline(ctx)} />
      </div>
    </>
  );
}
