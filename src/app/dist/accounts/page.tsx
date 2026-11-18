import { requireDistCtx, distView } from "@/domain/distribution/context";
import { dayBook, periodOf, trialBalance } from "@/domain/accounting/service";
import { bankReconciliation } from "@/domain/accounting/bank";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, Stat, Tabs } from "../_ui/ui";
import { ActButton, ActForm, F } from "../_ui/forms";
import { bankImportAction, bankMatchAction } from "../actions";

export const metadata = { title: "Accounts & bank" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; asof?: string; period?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "reports");
  const sp = await searchParams;
  const tab = sp.tab ?? "tb";
  return (
    <>
      <PageHead title="Accounting, ledgers & bank" sub="Double-entry books shared with the rest of MEDORO: every invoice, credit note, receipt, GRN and claim posts a balanced voucher. Vouchers are never edited." />
      <Tabs active={tab} tabs={[{ key: "tb", label: "Trial balance", href: "?tab=tb" }, { key: "day", label: "Day book", href: "?tab=day" }, { key: "bank", label: "Bank reconciliation", href: "?tab=bank" }]} />
      {tab === "tb" ? <Tb ctx={ctx} asOf={sp.asof} /> : tab === "day" ? <Day ctx={ctx} period={sp.period} /> : <Bank ctx={ctx} />}
    </>
  );
}

async function Tb({ ctx, asOf }: { ctx: Awaited<ReturnType<typeof requireDistCtx>>; asOf?: string }) {
  const tb = await trialBalance(ctx, asOf);
  return (
    <Panel pad={false} title={`As of ${dateIN(tb.asOf)}`} right={<form><input type="date" name="asof" defaultValue={tb.asOf} className="h-8 border border-input rounded px-1 text-[12px]" /><input type="hidden" name="tab" value="tb" /><button className="h-8 px-2 ml-1 border border-input rounded text-[12px]">Show</button></form>}>
      <DataTable cols={[{ label: "Account" }, { label: "Debit", num: true }, { label: "Credit", num: true }]} rows={tb.rows.map((r) => [r.account, r.dr ? inr(r.dr) : "", r.cr ? inr(r.cr) : ""])} footer={["Total", inr(tb.dr), inr(tb.cr)]} />
      {tb.dr !== tb.cr ? <div className="p-3 text-[#B3261E] font-semibold">Debits and credits differ — contact support.</div> : null}
    </Panel>
  );
}

async function Day({ ctx, period }: { ctx: Awaited<ReturnType<typeof requireDistCtx>>; period?: string }) {
  const p = periodOf(period ?? "month");
  const rows = await dayBook(ctx, p, undefined, 300);
  return (
    <Panel pad={false} title={`Day book · ${p.label}`} right={<form className="flex gap-1"><input type="hidden" name="tab" value="day" /><select name="period" defaultValue={period ?? "month"} className="h-8 border border-input rounded px-1 text-[12.5px]"><option value="month">This month</option><option value="last">Last month</option><option value="fy">This financial year</option></select><button className="h-8 px-2 border border-input rounded text-[12px]">Show</button></form>}>
      <DataTable dense cols={[{ label: "Date" }, { label: "Voucher" }, { label: "Type" }, { label: "Narration" }, { label: "Debit" }, { label: "Credit" }, { label: "Amount", num: true }]}
        rows={rows.map((v) => [dateIN(v.date), v.no, v.type.replace("_", " "), <span key="n">{v.narration}{v.reversed ? <Pill tone="gray">reversed</Pill> : null}</span>, v.dr, v.cr, inr(v.amount)])} empty="No vouchers in this period." />
    </Panel>
  );
}

async function Bank({ ctx }: { ctx: Awaited<ReturnType<typeof requireDistCtx>> }) {
  const r = await bankReconciliation(ctx);
  return (
    <>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat label="Matched lines" value={r.matched} tone="green" />
        <Stat label="Unmatched lines" value={r.statement.length} tone={r.statement.length ? "amber" : "navy"} />
        {r.balance ? <><Stat label={`Bank balance ${dateIN(r.balance.date)}`} value={inr(r.balance.bank)} /><Stat label="Books balance" value={inr(r.balance.books)} note={`Difference ${inr(r.balance.bank - r.balance.books)}`} /></> : null}
      </div>
      <Panel title="Import bank statement" sub="CSV or Excel from any bank. Duplicate lines are skipped; matching is by amount, date ±3 days and cheque / UTR reference." className="mb-4">
        <ActForm action={bankImportAction} submit="Import" inline><F label="Statement file" name="file" type="file" accept=".csv,.xlsx,.xls" required /></ActForm>
      </Panel>
      <Panel pad={false} title="Unmatched statement lines">
        <DataTable cols={[{ label: "Date" }, { label: "Description" }, { label: "Ref" }, { label: "Amount", num: true }, { label: "Possible book entries" }]}
          rows={r.statement.map((b) => [dateIN(b.date), b.description, b.ref ?? "", inr(b.amount), b.candidates.length ? <span key="c" className="flex flex-col gap-1">{b.candidates.slice(0, 3).map((c) => <ActButton key={c.id} size="sm" label={`Match ${c.no} (${c.date})`} action={async () => { "use server"; return bankMatchAction(b.id, c.id); }} />)}</span> : <span key="n" className="text-[12px] text-muted">No entry with this amount. Post the receipt or payment first.</span>])} empty="Everything imported is reconciled." />
      </Panel>
    </>
  );
}
