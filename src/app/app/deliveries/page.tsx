import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { myDeliveries } from "@/domain/orders/service";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { inr0 } from "@/lib/money";
import { DeliveriesView } from "./view";

export const metadata = { title: "My deliveries" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "delivery")) redirect("/app");
  const d = await myDeliveries(ctx);
  return (
    <>
      <PageHead title={t(ctx.lang).dlv} sub={`${d.open.length} to deliver · cash with you ${inr0(d.cashInHand)}${d.cashOrders ? ` from ${d.cashOrders} order${d.cashOrders > 1 ? "s" : ""}` : ""}`} />
      <DeliveriesView open={d.open} done={d.done} cashInHand={d.cashInHand} />
    </>
  );
}
