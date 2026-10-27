import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { anomalies, forecast, priceComparison, seasonal, settings, slowStock } from "@/domain/intelligence/service";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { IntelView } from "./view";

export const metadata = { title: "Stock intelligence" };

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const s = await settings(ctx.tenantId);
  const cur = new Date(Date.now() + 330 * 60000).getUTCMonth();
  const m = Number((await searchParams).m);
  const month = Number.isInteger(m) && m >= 0 && m < 12 ? m : (cur + 1) % 12;
  const [fc, prices, slow, an, sea, suppliers] = await Promise.all([
    forecast(ctx, s.policy), priceComparison(ctx), slowStock(ctx), anomalies(ctx, s.anomaly), seasonal(ctx, month),
    db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).intel} sub="Forecasts, reorder policy, supplier prices and anomaly review" />
      <IntelView policy={s.policy} th={s.anomaly} fc={fc} prices={prices} slow={slow} anomalies={an} sea={sea} month={month} cur={cur} suppliers={suppliers}
        canPurchase={can(ctx, "purchase")} canReview={can(ctx, "reports")} />
    </>
  );
}
