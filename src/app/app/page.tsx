import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { dashboard, type Range } from "@/domain/reports/dashboard";
import { dashboardFor } from "@/domain/reports/dashboard-access";
import { t } from "@/lib/i18n";
import { weekdayLong } from "@/lib/dates";
import { PageHead } from "@/components/page-head";
import { waStatus } from "@/domain/comms/whatsapp";
import { Dashboard, DashActions } from "./dashboard";
import { DueCheques } from "./cheques/due-widget";

export const metadata = { title: "Dashboard" };

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireCtx();
  if (can(ctx, "delivery") && !can(ctx, "sale") && !can(ctx, "reports")) redirect("/app/deliveries");
  const { range: r } = await searchParams;
  const range: Range = r === "7d" || r === "30d" ? r : "today";
  const data = dashboardFor(await dashboard(ctx.tenantId, ctx.branchId, range, ctx.branches.map((b) => b.id)), ctx.perms);
  const d = t(ctx.lang);
  const wa = can(ctx, "integrations") ? await waStatus(ctx.tenantId) : null;
  return (
    <>
      <PageHead title={d.dash} sub={`${weekdayLong()} · ${ctx.branchName}`} right={<DashActions range={range} data={data} branch={ctx.branchName} canExport={can(ctx, "reports") && !ctx.readOnly} />} />
      {wa?.connected && wa.cfg.disconnected ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#E5B4AE] bg-bad-bg px-4 py-3 text-[13.5px] text-bad">
          <strong className="font-semibold">WhatsApp is disconnected.</strong> Meta rejected the access token ({wa.cfg.disconnected.reason}). Invoices and reminders are paused.
          <a href="/app/whatsapp" className="ml-auto font-semibold underline">Reconnect</a>
        </div>
      ) : null}
      <Dashboard data={data} dict={d} perms={ctx.perms} />
      <DueCheques ctx={ctx} />
    </>
  );
}
