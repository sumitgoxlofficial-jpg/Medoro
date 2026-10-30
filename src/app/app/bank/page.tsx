import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { bankReconciliation } from "@/domain/accounting/bank";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { BankView } from "./view";

export const metadata = { title: "Bank reconciliation" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "payments") && !can(ctx, "reports")) redirect("/app");
  return (
    <>
      <PageHead title={t(ctx.lang).bank} sub="Upload your bank statement (CSV or Excel). Entries are matched to the Bank account by amount, date (±3 days) and cheque / UTR number." />
      <BankView data={await bankReconciliation(ctx)} canAct={can(ctx, "payments") && !ctx.readOnly} />
    </>
  );
}
