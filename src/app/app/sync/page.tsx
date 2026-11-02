import { requireCtx, can } from "@/server/context";
import { canManageOffline, offlineOverview } from "@/domain/sales/offline";
import { OfflinePanel } from "./offline-panel";
import { db } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { PageHead } from "@/components/page-head";
import { t as dictFor } from "@/lib/i18n";
import { tFor, type TFn } from "@/lib/tr";
import { dayMonth, hhmm } from "@/lib/dates";
import { Monitor, Smartphone } from "lucide-react";

export const metadata = { title: "Sync & offline" };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-1";

function ago(d: Date, t: TFn) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  return s < 60 ? t("{n} s ago", { n: s }) : s < 3600 ? t("{n} min ago", { n: Math.round(s / 60) }) : s < 86400 ? t("{n} h ago", { n: Math.round(s / 3600) }) : `${dayMonth(d)} ${hhmm(d)}`;
}

/** "Chrome on Windows", "Safari on iPhone"… from a user agent; null when it can't tell. */
function uaLabel(ua: string | null, t: TFn, hi: boolean): string | null {
  if (!ua) return null;
  const os = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /CrOS/i.test(ua) ? "Chromebook" : /Linux/i.test(ua) ? "Linux" : null;
  const br = /Electron|Medoro/i.test(ua) ? t("Medoro app") : /Edg\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /Chrome|CriOS/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : null;
  if (br && os) return hi ? `${br} · ${os}` : `${br} on ${os}`; // browser and OS names stay as they are
  return br ?? os;
}

export default async function Page() {
  const ctx = await requireCtx();
  const t = tFor(ctx.lang);
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
    const place = c ? `${branches.find((b) => b.id === c.branchId)?.name} · ${c.name}` : s.device;
    const name = uaLabel(s.userAgent, t, ctx.lang === "hi") ?? place ?? (mobile ? t("Phone or tablet") : t("Browser"));
    const sub = [place && place !== name ? place : null, s.user.name, s.ip].filter(Boolean).join(" · ");
    return { id: s.id, name, sub, live, last: ago(s.lastSeenAt, t), mobile, isThis: s.id === ctx.sessionId };
  });
  return (
    <>
      <PageHead title={dictFor(ctx.lang).sync} sub="Devices connected to your server and offline reconciliation" />
      <div className="flex flex-col gap-4 max-w-[1400px]">
        <div className={card}>
          <div className="font-semibold text-[15px] mb-1">{allUsers ? t("Signed-in devices") : t("Your signed-in devices")}</div>
          {devices.map((d) => (
            <div key={d.id} className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 items-start py-2 border-b border-row last:border-0 text-[13.5px]">
              {d.mobile ? <Smartphone size={16} className="text-muted mt-0.5" /> : <Monitor size={16} className="text-muted mt-0.5" />}
              <div className="flex flex-col min-w-0"><span className="font-medium break-words">{d.name}</span><span className="text-muted text-[12.5px] break-words">{d.sub}</span></div>
              <div className="flex flex-col items-end gap-0.5"><Badge tone={d.live ? "green" : "gray"}>{d.isThis ? t("This device") : d.live ? t("Online") : t("Idle")}</Badge><span className="text-[12.5px] text-faint text-right whitespace-nowrap">{d.last}</span></div>
            </div>
          ))}
        </div>
        <OfflinePanel devices={off.devices} ops={off.ops} branchId={ctx.branchId} branchName={ctx.branchName} counterName={ctx.counterName} canManage={!ctx.readOnly && canManageOffline(ctx)} />
      </div>
    </>
  );
}
