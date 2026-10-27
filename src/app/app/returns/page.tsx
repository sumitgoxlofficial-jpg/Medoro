import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { currentShift, recentInvoices, todaysCreditNotes } from "@/domain/sales/returns";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { ReturnsView } from "./view";

export const metadata = { title: "Returns & shift" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  const [invoices, cns, shift] = await Promise.all([recentInvoices(ctx, ""), todaysCreditNotes(ctx), currentShift(ctx)]);
  return (
    <>
      <PageHead title={t(ctx.lang).ret} sub="Sales returns, refunds and cashier shift close" />
      <ReturnsView invoices={invoices} creditNotes={cns} shift={shift} canRefund={can(ctx, "refund")} counter={ctx.counterName ?? "Browser counter"} />
    </>
  );
}
