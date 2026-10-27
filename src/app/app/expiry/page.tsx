import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { expiryRows } from "@/domain/intelligence/service";
import { big } from "@/lib/money";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { ExpiryView } from "./view";

export const metadata = { title: "Expiry prevention" };

export default async function Page({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const ctx = await requireCtx();
  const w = [30, 60, 90, 180].includes(Number((await searchParams).w)) ? Number((await searchParams).w) : 60;
  const [data, recovered] = await Promise.all([
    expiryRows(ctx, w),
    db.stockOut.aggregate({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, kind: "supplier_return", at: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { valuePaise: true } }),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).exp} sub="Batch exposure, projected loss and recovery actions" />
      <ExpiryView w={w} data={data} recovered={big(recovered._sum.valuePaise)} canAdjust={can(ctx, "adjust")} canPurchase={can(ctx, "purchase")} />
    </>
  );
}
