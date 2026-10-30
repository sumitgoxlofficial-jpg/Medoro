import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { listOrders, pendingScans, purchaseCatalogue, recentGrns } from "@/domain/purchasing/service";
import { ocrConfigured } from "@/domain/purchasing/ocr";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { PurchasesView } from "./view";

export const metadata = { title: "Purchases" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; po?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "purchase")) redirect("/app");
  const sp = await searchParams;
  const [orders, catalogue, suppliers, grns, scans] = await Promise.all([
    listOrders(ctx), purchaseCatalogue(ctx), db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }), recentGrns(ctx), pendingScans(ctx),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).pur} sub="Purchase orders, supplier invoices and GRNs" />
      <PurchasesView tab={sp.tab === "receive" ? "receive" : "po"} poId={sp.po ?? null} orders={orders} catalogue={catalogue} suppliers={suppliers} grns={grns} scans={scans} ocr={ocrConfigured()} today={todayISO()} />
    </>
  );
}
