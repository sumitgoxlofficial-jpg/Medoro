import { requireCtx } from "@/server/context";
import { dashboard, type Range } from "@/domain/reports/dashboard";
import { t } from "@/lib/i18n";
import { weekdayLong } from "@/lib/dates";
import { PageHead } from "@/components/page-head";
import { Dashboard, DashActions } from "./dashboard";

export const metadata = { title: "Dashboard" };

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireCtx();
  const { range: r } = await searchParams;
  const range: Range = r === "7d" || r === "30d" ? r : "today";
  const data = await dashboard(ctx.tenantId, ctx.branchId, range, ctx.branches.map((b) => b.id));
  const d = t(ctx.lang);
  return (
    <>
      <PageHead title={d.dash} sub={`${weekdayLong()} · ${ctx.branchName}`} right={<DashActions range={range} data={data} branch={ctx.branchName} />} />
      <Dashboard data={data} dict={d} perms={ctx.perms} />
    </>
  );
}
