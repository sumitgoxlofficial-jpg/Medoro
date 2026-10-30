import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { posCustomers } from "@/domain/sales/service";
import { listOrders, orderCounts, recentSettlements, riderCash, riders } from "@/domain/orders/service";
import { orderSettings } from "@/domain/orders/notify";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { OrdersView } from "./view";

export const metadata = { title: "Orders & delivery" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  const sp = await searchParams;
  const tab = sp.tab === "done" ? "done" : sp.tab === "cash" ? "cash" : "open";
  const [orders, counts, team, cash, settlements, customers, settings] = await Promise.all([
    tab === "cash" ? Promise.resolve([]) : listOrders(ctx, tab, sp.q ?? ""),
    orderCounts(ctx), riders(ctx), riderCash(ctx), tab === "cash" ? recentSettlements(ctx) : Promise.resolve([]), posCustomers(ctx), orderSettings(ctx.tenantId),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).ord} sub={`${ctx.branchName} · phone, WhatsApp and counter orders, billed at packing`} />
      <OrdersView
        tab={tab} q={sp.q ?? ""} orders={orders} counts={counts} riders={team} cash={cash} settlements={settlements}
        customers={customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, optIn: c.optIn, limit: c.limit }))}
        canRefund={can(ctx, "refund")} canCredit={can(ctx, "credit")} templates={can(ctx, "integrations") && !ctx.readOnly ? settings.templates : null}
      />
    </>
  );
}
