import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { listOrders, pendingScans, purchaseCatalogue, recentGrns } from "@/domain/purchasing/service";
import { ocrConfigured } from "@/domain/purchasing/ocr";
import { rulesOf } from "@/domain/purchasing/pricing";
import { listClaims, nearExpiryClaims } from "@/domain/inventory/claims";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { PurchasesView } from "./view";

export const metadata = { title: "Purchases" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; po?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "purchase")) redirect("/app");
  const sp = await searchParams;
  const [orders, catalogue, suppliers, grns, scans, tenant, claims, nearExpiry] = await Promise.all([
    listOrders(ctx), purchaseCatalogue(ctx), db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }), recentGrns(ctx), pendingScans(ctx),
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } }), listClaims(ctx), nearExpiryClaims(ctx),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).pur} sub="Purchase orders, supplier invoices and GRNs" />
      <PurchasesView tab={sp.tab === "receive" ? "receive" : sp.tab === "claims" ? "claims" : "po"} poId={sp.po ?? null} orders={orders} catalogue={catalogue} suppliers={suppliers} grns={grns} scans={scans} ocr={ocrConfigured()} today={todayISO()}
        rules={rulesOf(tenant.settings)} canRules={can(ctx, "users") && !ctx.readOnly} claims={claims} nearExpiry={nearExpiry} />
    </>
  );
}
