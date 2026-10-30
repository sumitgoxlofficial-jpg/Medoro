import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { listCustomers, listSuppliers } from "@/domain/parties/service";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { PartiesView } from "./view";

export const metadata = { title: "Suppliers & customers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "payments") && !can(ctx, "purchase")) redirect("/app");
  const { tab } = await searchParams;
  const [suppliers, customers] = await Promise.all([listSuppliers(ctx), listCustomers(ctx)]);
  return (
    <>
      <PageHead title={t(ctx.lang).parties} sub="Balances, terms and payments" />
      <PartiesView tab={tab === "cus" ? "cus" : "sup"} suppliers={suppliers} customers={customers}
        canPay={can(ctx, "payments")} canCredit={can(ctx, "credit")} canEditSup={can(ctx, "purchase") || can(ctx, "payments")} canMessage={can(ctx, "integrations")} />
    </>
  );
}
