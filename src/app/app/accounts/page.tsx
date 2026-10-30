import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { UserError } from "@/server/action";
import { accountLedger, accountNames, accountsOverview, dayBook, DAY_BOOK_PAGE, periodOf, trialBalance } from "@/domain/accounting/service";
import { PHARMACY_REPORTS, REPORTS } from "@/domain/accounting/reports";
import { ACC, EXPENSE_ACCOUNTS } from "@/domain/accounting/accounts";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { AccountsView, PeriodPicker } from "./view";
import { AccountsTabs, LedgerView, TrialBalanceView } from "./ledger";

export const metadata = { title: "Accounting & reports" };

export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string; view?: string; account?: string; from?: string; to?: string; asof?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const sp = await searchParams;
  const view = sp.view === "tb" ? "tb" : sp.view === "ledger" ? "ledger" : "overview";
  if (view === "tb") {
    const tb = await trialBalance(ctx, sp.asof);
    return <><PageHead title={t(ctx.lang).acc} sub={`Trial balance as on ${tb.asOf} · all branches`} /><AccountsTabs view={view} /><TrialBalanceView tb={tb} /></>;
  }
  if (view === "ledger") {
    const accounts = await accountNames(ctx);
    const account = sp.account && accounts.includes(sp.account) ? sp.account : ACC.cash;
    let led;
    try { led = await accountLedger(ctx, account, sp.from, sp.to); } catch (e) { if (!(e instanceof UserError)) throw e; led = await accountLedger(ctx, account); }
    return <><PageHead title={t(ctx.lang).acc} sub={`${account} · ${led.fromDay} to ${led.toDay} · all branches`} /><AccountsTabs view={view} /><LedgerView led={led} accounts={accounts} /></>;
  }
  const p = periodOf(sp.period);
  const [ov, book] = await Promise.all([accountsOverview(ctx, p), dayBook(ctx, p)]);
  return (
    <>
      <PageHead title={t(ctx.lang).acc} sub={`Ledgers, P&L, GST summary and exports · ${p.label}`} right={<PeriodPicker value={p.key} />} />
      <AccountsTabs view={view} />
      <AccountsView ov={ov} book={book} pageSize={DAY_BOOK_PAGE} reports={REPORTS.map(([id, name, desc]) => ({ id, name, desc, pharmacy: PHARMACY_REPORTS.includes(id) }))} branchName={ctx.branches.length > 1 ? ctx.branchName : null} expenseAccounts={[...EXPENSE_ACCOUNTS]} canPay={can(ctx, "payments")} periodKey={p.key} />
    </>
  );
}
