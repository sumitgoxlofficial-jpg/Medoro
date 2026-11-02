import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { myDeliveries } from "@/domain/orders/service";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { tFor } from "@/lib/tr";
import { inr0 } from "@/lib/money";
import { DeliveriesView } from "./view";

export const metadata = { title: "My deliveries" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "delivery")) redirect("/app");
  const d = await myDeliveries(ctx);
  const tr = tFor(ctx.lang);
  return (
    <>
      <PageHead title={t(ctx.lang).dlv} sub={`${tr("{n} to deliver · cash with you {amount}", { n: d.open.length, amount: inr0(d.cashInHand) })}${d.cashOrders ? ` ${tr(d.cashOrders > 1 ? "from {n} orders" : "from {n} order", { n: d.cashOrders })}` : ""}`} />
      <DeliveriesView open={d.open} done={d.done} cashInHand={d.cashInHand} />
    </>
  );
}
