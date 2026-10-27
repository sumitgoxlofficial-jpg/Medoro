import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { daysTo, dayMonth } from "@/lib/dates";

export const metadata = { title: "Subscription" };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2";

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  const [sub, branches, counters, users] = await Promise.all([
    db.subscriptionMeta.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.branch.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.counter.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.user.count({ where: { tenantId: ctx.tenantId, active: true, isSupport: false } }),
  ]);
  const left = sub?.renewsAt ? daysTo(sub.renewsAt) : null;
  const status = sub?.status === "trial" ? `Trial · ${Math.max(0, left ?? 0)} day${left === 1 ? "" : "s"} left` : sub?.status === "active" ? "Active" : sub?.status ?? "Not set";
  const licence = !!process.env.LICENSE_SERVER_URL;
  return (
    <>
      <PageHead title={t(ctx.lang).plan} sub="Plan, usage and licence" />
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] max-w-[1200px]">
        <div className={card}>
          <div className="text-[12.5px] text-muted font-medium">Current plan</div>
          <div className="text-[22px] font-semibold">{sub?.plan ?? "—"}{sub?.addons.includes("ai") ? " + AI add-on" : ""}</div>
          <div className="text-[13px] text-muted">{status}{sub?.renewsAt ? ` · ${sub.status === "trial" ? "ends" : "renews"} ${dayMonth(sub.renewsAt, true)}` : ""}</div>
          {[["Branches", String(branches)], ["Counters", String(counters)], ["Active users", String(users)], ["WhatsApp invoices", "Included (your own Meta account)"], ["Backups", "Included (your own Google Drive)"]].map(([k, v]) => (
            <div key={k} className="flex justify-between text-[13.5px] py-1 border-b border-row last:border-0"><span className="text-ink-2">{k}</span><span className="tnum">{v}</span></div>
          ))}
          <div className="text-[12.5px] text-faint mt-1">To change plan or add the AI add-on, contact Medoro billing. In-app payments arrive with the licence service.</div>
        </div>
        <div className="flex flex-col gap-4">
          <div className={card}>
            <div className="font-semibold text-[15px]">Licence (customer-hosted)</div>
            {licence ? (
              <div className="text-[13.5px] text-ink-2">Licence server configured at <span className="font-mono">{process.env.LICENSE_SERVER_URL}</span>. Check-ins share only your tenant ID, plan, app version and device count.</div>
            ) : (
              <div className="text-[13.5px] text-ink-2">This installation isn’t connected to Medoro’s licence server (<span className="font-mono">LICENSE_SERVER_URL</span> is not set), so it runs without a licence token.</div>
            )}
            <div className="text-[12.5px] text-faint">When connected: counters keep billing for up to 30 days without reaching Medoro. If payment fails there’s a 7-day grace period, then the app goes read-only. Billing history and exports always stay available.</div>
          </div>
          <div className={card}>
            <div className="font-semibold text-[15px]">Medoro invoices</div>
            <div className="text-[13px] text-fainter">No invoices yet.</div>
          </div>
        </div>
      </div>
    </>
  );
}
