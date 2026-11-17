import Link from "next/link";
import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireCtx, can, entitlementsOf } from "@/server/context";
import { hasFeature, upgradeMessage } from "@/lib/plans";
import { UpgradeNote } from "@/components/upgrade-note";
import { profitIntel, profitPeriod, COST_WINDOW_DAYS } from "@/domain/reports/profit";
import { COST_VARIATION_FLAG_PCT, DISCOUNT_FLAG, RECON_TOLERANCE } from "@/domain/reports/profit-rules";
import { UserError } from "@/server/action";
import { PageHead } from "@/components/page-head";

export const metadata = { title: "Profit intelligence" };
const rs = (p: number) => `${p < 0 ? "−" : ""}₹${Math.abs(Math.round(p / 100)).toLocaleString("en-IN")}`;
const pc = (n: number | null) => (n == null ? "–" : `${n}%`);
const card = "bg-white border border-line rounded-xl p-4";
const th = "py-1.5 pr-3 text-left font-normal text-slate-500";

export default async function Page({ searchParams }: { searchParams: Promise<{ branch?: string; from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const q = await searchParams;
  const branch = q.branch && ctx.branches.some((b) => b.id === q.branch) ? q.branch : null;
  let period, error: string | null = null;
  try { period = profitPeriod(q.from, q.to); } catch (e) { if (!(e instanceof UserError)) throw e; error = e.message; period = profitPeriod(undefined, undefined); }
  const [d, ent] = await Promise.all([profitIntel(ctx, branch, period), entitlementsOf(ctx)]);
  const flagsOn = hasFeature(ent, "anomaly");
  const qs = (b: string | null) => `?${new URLSearchParams({ ...(b ? { branch: b } : {}), from: period.fromDay, to: period.toDay })}`;
  const T = d.total;
  return (
    <>
      <PageHead icon={TrendingUp} title="Profit intelligence" sub={`${d.scope.branchName} · ${period.fromDay} to ${period.toDay} · from the ledger and landed cost`} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        <form method="get" className="flex gap-2 flex-wrap items-end text-[13px]" data-testid="profit-period">
          {branch ? <input type="hidden" name="branch" value={branch} /> : null}
          <label className="flex flex-col gap-0.5">From<input type="date" name="from" defaultValue={period.fromDay} className="border border-line rounded-lg px-2 py-1" /></label>
          <label className="flex flex-col gap-0.5">To<input type="date" name="to" defaultValue={period.toDay} className="border border-line rounded-lg px-2 py-1" /></label>
          <button className="rounded-lg border border-line px-3 py-1.5">Apply</button>
          {error ? <span role="alert" className="text-red-700">{error} Showing the last 30 days.</span> : null}
        </form>
        {ctx.branches.length > 1 ? (
          <nav aria-label="Branch" className="flex gap-2 flex-wrap text-[13px]">
            <Link href={`/app/intelligence/profit${qs(null)}`} className={`rounded-lg border px-3 py-1 ${!branch ? "bg-slate-900 text-white" : "border-line"}`}>All my branches</Link>
            {ctx.branches.map((b) => <Link key={b.id} href={`/app/intelligence/profit${qs(b.id)}`} className={`rounded-lg border px-3 py-1 ${branch === b.id ? "bg-slate-900 text-white" : "border-line"}`}>{b.name}</Link>)}
          </nav>
        ) : null}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="profit-kpis">
          {[["Net sales (ex GST)", rs(T.ledgerSales)], ["Landed cost of goods sold", rs(T.cogs)], ["Gross profit", `${rs(T.grossProfit)} (${pc(T.grossPct)})`], ["After branch expenses", rs(T.netProfit)]].map(([k, v]) => <div key={k} className={card}><div className="text-[12px] text-slate-500">{k}</div><div className="text-[20px] font-semibold">{v}</div></div>)}
        </section>
        <p className="m-0 text-[12.5px] text-slate-500" data-testid="profit-basis">
          Net sales are the ledger’s Sales less sales returns (voids are reversal entries). Cost is the landed cost on each sale line: purchase rate less discounts, spread over free goods, plus GST that can’t be claimed. “After branch expenses” subtracts ledger debits to expense, stock-loss, claim-loss, cash-difference, loyalty and round-off accounts posted to a branch; pharmacy-wide entries with no branch are not included. This is not MRP minus purchase price.
        </p>

        <section className={card} data-testid="profit-branches">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Branch-wise profit and reconciliation</h2>
          <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse">
            <thead><tr><th className={th}>Branch</th><th className={th}>Net sales</th><th className={th}>Cost</th><th className={th}>Gross profit</th><th className={th}>Expenses</th><th className={th}>After expenses</th><th className={th}>Discount given</th><th className={th}>Ledger vs sale lines</th></tr></thead>
            <tbody>{[...d.branches, ...(d.branches.length > 1 ? [d.total] : [])].map((b) => (
              <tr key={b.branchId || "total"} className={`border-t border-line/60 ${b.branchId ? "" : "font-semibold"}`}>
                <td className="py-1.5 pr-3">{b.branch}</td><td className="pr-3">{rs(b.ledgerSales)}</td><td className="pr-3">{rs(b.cogs)}</td><td className="pr-3">{rs(b.grossProfit)} ({pc(b.grossPct)})</td><td className="pr-3">{rs(b.indirect)}</td><td className="pr-3">{rs(b.netProfit)}</td><td className="pr-3">{rs(b.discountPaise)} ({pc(b.discountPct)})</td>
                <td>{b.recon.status === "reconciled" ? "Reconciled" : <span className="text-red-700">Differs by {rs(b.recon.diff)}: investigate before relying on this</span>}</td>
              </tr>))}</tbody></table></div>
          <p className="m-0 mt-2 text-[12px] text-slate-500">“Reconciled” means the sale lines and the ledger agree within ₹{RECON_TOLERANCE.paise / 100} or {RECON_TOLERANCE.ratio * 100}%.</p>
        </section>

        <section className={card} data-testid="profit-items">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Gross profit by medicine (top 25), category and supplier</h2>
          {([["Medicine", d.byItem], ["Category (dosage form)", d.byCategory], ["Supplier on the batch sold", d.bySupplier]] as const).map(([title, rows]) => (
            <div key={title} className="mb-3"><h3 className="m-0 mb-1 text-[13px] font-semibold">{title}</h3>
              {rows.length ? <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Name</th><th className={th}>Qty</th><th className={th}>Sales</th><th className={th}>Cost</th><th className={th}>Profit</th><th className={th}>Margin</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-line/60"><td className="py-1 pr-3">{r.name}</td><td className="pr-3">{r.qty}</td><td className="pr-3">{rs(r.sales)}</td><td className="pr-3">{rs(r.cost)}</td><td className="pr-3">{rs(r.margin)}</td><td>{pc(r.pct)}</td></tr>)}</tbody></table></div> : <p className="m-0 text-[13px] text-slate-500">No sales in this period.</p>}</div>
          ))}
        </section>

        <section className={card} data-testid="profit-leakage">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Profit leakage</h2>
          <ul className="m-0 pl-4 text-[13px] grid gap-1">
            <li><strong>Sold below landed cost:</strong> {rs(d.leakage.belowCostTotal)} lost across {d.leakage.belowCost.length} medicine(s).</li>
            <li><strong>Stock written off:</strong> {rs(d.leakage.writeOffs.totalPaise)} in {d.leakage.writeOffs.count} write-off(s) at cost (expired, damaged and lost stock together; the reason is the free text entered).</li>
            <li><strong>Damaged returns:</strong> {d.leakage.damagedReturns.count} return(s), {rs(d.leakage.damagedReturns.refundPaise)} refunded for goods that were not restocked.</li>
            <li><strong>Expired stock still on the shelf:</strong> {rs(d.leakage.expiredInStockPaise)} at cost. Not yet a loss in the books until written off or claimed.</li>
          </ul>
          {d.leakage.belowCost.length ? <div className="overflow-x-auto mt-2"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Medicine sold below cost</th><th className={th}>Units</th><th className={th}>Shortfall</th></tr></thead>
            <tbody>{d.leakage.belowCost.map((r) => <tr key={r.medicineId} className="border-t border-line/60"><td className="py-1 pr-3">{r.name}</td><td className="pr-3">{r.qty}</td><td>{rs(r.lossPaise)}</td></tr>)}</tbody></table></div> : null}
          {d.leakage.writeOffs.byReason.length ? <p className="m-0 mt-2 text-[12.5px] text-slate-600">Write-off reasons: {d.leakage.writeOffs.byReason.map((r) => `${r.reason} (${r.count}, ${rs(r.valuePaise)})`).join(" · ")}</p> : null}
          <p className="m-0 mt-2 text-[12px] text-slate-500">Slow-moving stock is capital tied up, not a realised loss; see the Insights page for the slow and dead stock list.</p>
        </section>

        <section className={card} data-testid="profit-discounts">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Discounts</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Pharmacy-wide discount rate {pc(d.discounts.overallPct)} of MRP value on bills that were not voided.</p>
          {flagsOn ? (
            <>
              <p className="m-0 mb-2 text-[12px] text-slate-500">A cashier is flagged when their rate is at least {DISCOUNT_FLAG.ratio}× the pharmacy-wide rate over {DISCOUNT_FLAG.minBills}+ bills. A flag is a prompt to look, not proof of wrongdoing.</p>
              <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Cashier</th><th className={th}>Bills</th><th className={th}>Discount</th><th className={th}>Rate</th><th className={th}>Flag</th></tr></thead>
                <tbody>{d.discounts.cashiers.map((c) => <tr key={c.userId} className="border-t border-line/60"><td className="py-1 pr-3">{c.name}</td><td className="pr-3">{c.bills}</td><td className="pr-3">{rs(c.discountPaise)}</td><td className="pr-3">{pc(c.ratePct)}</td><td>{c.flagged ? <strong className="text-red-700">Unusual</strong> : "–"}</td></tr>)}</tbody></table></div>
            </>
          ) : <UpgradeNote compact message={upgradeMessage(ent, "anomaly")} canUpgrade={can(ctx, "users")} />}
        </section>

        <section className={card} data-testid="profit-free">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Free goods received</h2>
          {d.freeGoods.length ? <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Supplier</th><th className={th}>Free packs</th><th className={th}>Paid packs</th><th className={th}>Free share</th><th className={th}>Free value (list rate)</th><th className={th}>Paid value</th></tr></thead>
            <tbody>{d.freeGoods.map((f) => <tr key={f.supplier} className="border-t border-line/60"><td className="py-1 pr-3">{f.supplier}</td><td className="pr-3">{f.freeUnits}</td><td className="pr-3">{f.paidUnits}</td><td className="pr-3">{pc(f.freeSharePct)}</td><td className="pr-3">{rs(f.freeValuePaise)}</td><td>{rs(f.paidValuePaise)}</td></tr>)}</tbody></table></div> : <p className="m-0 text-[13px] text-slate-500">No free goods received in this period.</p>}
          <p className="m-0 mt-2 text-[12px] text-slate-500">Free goods are already inside landed cost (spread over all units), so they raise margin; this shows where it comes from.</p>
        </section>

        <section className={card} data-testid="profit-variation">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Purchase-cost variation</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Landed cost per pack over the last {COST_WINDOW_DAYS} days; medicines whose dearest purchase was {COST_VARIATION_FLAG_PCT}%+ above their cheapest.</p>
          {d.costVariation.length ? <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Medicine</th><th className={th}>Purchases</th><th className={th}>Lowest</th><th className={th}>Highest</th><th className={th}>Latest</th><th className={th}>Spread</th><th className={th}>Latest vs average</th></tr></thead>
            <tbody>{d.costVariation.map((c) => <tr key={c.medicineId} className="border-t border-line/60"><td className="py-1 pr-3">{c.name}</td><td className="pr-3">{c.v.n}</td><td className="pr-3">{rs(c.v.min)}</td><td className="pr-3">{rs(c.v.max)}</td><td className="pr-3">{rs(c.v.latest)}</td><td className="pr-3">{c.v.spreadPct}%</td><td>{c.v.latestVsAvgPct > 0 ? "+" : ""}{c.v.latestVsAvgPct}%</td></tr>)}</tbody></table></div> : <p className="m-0 text-[13px] text-slate-500">No medicine shows a spread that large.</p>}
        </section>
      </div>
    </>
  );
}
