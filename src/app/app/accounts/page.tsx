import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { accountsOverview, dayBook, periodOf } from "@/domain/accounting/service";
import { REPORTS } from "@/domain/accounting/reports";
import { EXPENSE_ACCOUNTS } from "@/domain/accounting/accounts";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { AccountsView, PeriodPicker } from "./view";

export const metadata = { title: "Accounting & reports" };

export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const p = periodOf((await searchParams).period);
  const [ov, book] = await Promise.all([accountsOverview(ctx, p), dayBook(ctx, p)]);
  return (
    <>
      <PageHead title={t(ctx.lang).acc} sub={`Ledgers, P&L, GST summary and exports · ${p.label}`} right={<PeriodPicker value={p.key} />} />
      <AccountsView ov={ov} book={book} reports={REPORTS.map(([id, name, desc]) => ({ id, name, desc }))} expenseAccounts={[...EXPENSE_ACCOUNTS]} canPay={can(ctx, "payments")} periodKey={p.key} />
    </>
  );
}
