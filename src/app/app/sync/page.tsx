import { requireCtx } from "@/server/context";
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
  const [sessions, counters, branches, ops] = await Promise.all([
    db.session.findMany({ where: { user: { tenantId: ctx.tenantId }, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { select: { name: true } } }, orderBy: { lastSeenAt: "desc" } }),
    db.counter.findMany({ where: { tenantId: ctx.tenantId, active: true } }),
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    db.offlineOp.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
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
          <div className="font-semibold text-[15px] mb-1">Devices on the live database</div>
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2 border-b border-row last:border-0 text-[13.5px] flex-wrap">
              {d.mobile ? <Smartphone size={16} className="text-muted" /> : <Monitor size={16} className="text-muted" />}
              <span className="font-medium">{d.name}</span><span className="text-muted">{d.who}{d.ip ? ` · ${d.ip}` : ""}</span>
              <Badge tone={d.live ? "green" : "gray"} className="ml-auto">{d.isThis ? "This device" : d.live ? "Online" : "Idle"}</Badge>
              <span className="text-[12.5px] text-faint w-[110px] text-right">{d.last}</span>
            </div>
          ))}
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px] mb-1">Offline queue</div>
          {ops.length ? ops.map((o) => <div key={o.id} className="flex gap-3 py-1.5 text-[13.5px]"><span className="font-mono text-[12px]">{o.id}</span><span>{o.kind}</span><Badge tone={o.status === "conflict" ? "red" : o.status === "pending" ? "amber" : "green"}>{o.status}</Badge></div>)
            : <div className="text-[13px] text-muted">Nothing queued. Browser counters work online against your server, so every sale posts immediately.</div>}
          <div className="text-[12px] text-faint mt-2">Offline billing needs the Medoro desktop app on the counter, which reserves a stock quota per device and queues sales with unique IDs. Price, permission and stock are rechecked before anything posts; until then an offline sale is provisional.</div>
        </div>
      </div>
    </>
  );
}
