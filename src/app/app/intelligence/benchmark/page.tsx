import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { benchmark } from "@/domain/reports/benchmark";
import { profitPeriod } from "@/domain/reports/profit";
import { UserError } from "@/server/action";
import { PageHead } from "@/components/page-head";

export const metadata = { title: "Chain benchmarking" };
const rs = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
const pc = (n: number | null) => (n == null ? "–" : `${n}%`);
const card = "bg-white border border-line rounded-xl p-4";
const th = "py-1.5 pr-3 text-left font-normal text-slate-500";
const R = ({ n }: { n: number | null }) => (n == null ? null : <span className={`ml-1 text-[11px] rounded px-1 ${n === 1 ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>#{n}</span>);

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const q = await searchParams;
  let period, error: string | null = null;
  try { period = profitPeriod(q.from, q.to); } catch (e) { if (!(e instanceof UserError)) throw e; error = e.message; period = profitPeriod(undefined, undefined); }
  const d = await benchmark(ctx, period);
  return (
    <>
      <PageHead icon={BarChart3} title="Chain benchmarking" sub={`${period.fromDay} to ${period.toDay} against ${d.previous.fromDay} to ${d.previous.toDay} · only branches you can access`} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        <form method="get" className="flex gap-2 flex-wrap items-end text-[13px]" data-testid="bench-period">
          <label className="flex flex-col gap-0.5">From<input type="date" name="from" defaultValue={period.fromDay} className="border border-line rounded-lg px-2 py-1" /></label>
          <label className="flex flex-col gap-0.5">To<input type="date" name="to" defaultValue={period.toDay} className="border border-line rounded-lg px-2 py-1" /></label>
          <button className="rounded-lg border border-line px-3 py-1.5">Apply</button>
          {error ? <span role="alert" className="text-red-700">{error} Showing the last 30 days.</span> : null}
        </form>
        {!d.ranked ? <p className="m-0 text-[13px] text-slate-600" data-testid="bench-single">Only one branch is available to you, so there is nothing to rank against. Figures are shown without ranks.</p> : null}
        <section className={card} data-testid="bench-table">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Branch comparison</h2>
          <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse">
            <thead><tr><th className={th}>Branch</th><th className={th}>Net sales</th><th className={th}>Growth</th><th className={th}>Gross margin</th><th className={th}>Stock turnover (×/yr)</th><th className={th}>Write-off loss</th><th className={th}>Stockout</th><th className={th}>Customer retention</th></tr></thead>
            <tbody>{d.branches.map((b) => (
              <tr key={b.branchId} className="border-t border-line/60">
                <td className="py-1.5 pr-3 font-medium">{b.branch}</td><td className="pr-3">{rs(b.salesPaise)}</td>
                <td className="pr-3">{pc(b.growthPct)}<R n={b.ranks.growth} /></td><td className="pr-3">{pc(b.grossMarginPct)}<R n={b.ranks.margin} /></td>
                <td className="pr-3">{b.stockTurnover ?? "–"}<R n={b.ranks.turnover} /></td><td className="pr-3">{pc(b.expiryLossPct)} ({rs(b.writeOffPaise)})<R n={b.ranks.expiryLoss} /></td>
                <td className="pr-3">{pc(b.stockoutPct)} ({b.stockouts}/{b.tracked})<R n={b.ranks.stockout} /></td><td>{pc(b.retentionPct)}<R n={b.ranks.retention} /></td>
              </tr>))}</tbody></table></div>
          <ul className="m-0 mt-3 pl-4 text-[12px] text-slate-500 grid gap-0.5">
            <li>Net sales are the ledger’s Sales less returns. Growth is against the previous period of the same length; “–” means there was nothing to compare with.</li>
            <li>Stock turnover is cost of goods sold, annualised, over today’s stock at cost. Past stock levels are not recorded, so this is an approximation.</li>
            <li>Write-off loss is stock written off at cost (expired, damaged and lost together) as a share of net sales. Lower is better.</li>
            <li>Stockout is the share of items with a reorder level that have nothing sellable on the shelf right now. Lower is better. Medicines are pharmacy-wide, so a branch that never stocks an item counts it as out.</li>
            <li>Retention is the average of the monthly retention rates over the last 12 months at that branch (see Customer intelligence).</li>
            <li>Ranks (#1 = best) appear only with two or more branches; tiny branches and short periods make ranks noisy, so read them with the numbers.</li>
          </ul>
        </section>
        {d.branches.map((b) => (
          <section key={b.branchId} className={card} data-testid="bench-employees">
            <h2 className="m-0 mb-1 text-[15px] font-semibold">Employee activity · {b.branch}</h2>
            <p className="m-0 mb-2 text-[12px] text-slate-500">Activity on bills that were not voided, in this period. It describes volume and habits; it is not a quality rating, and voids and returns can be entirely legitimate.</p>
            {b.employees.length ? <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Name</th><th className={th}>Bills</th><th className={th}>Net sales</th><th className={th}>Avg basket</th><th className={th}>Discount rate</th><th className={th}>Voids</th><th className={th}>Returns</th></tr></thead>
              <tbody>{b.employees.map((e) => <tr key={e.userId} className="border-t border-line/60"><td className="py-1 pr-3">{e.name}</td><td className="pr-3">{e.bills}</td><td className="pr-3">{rs(e.netSalesPaise)}</td><td className="pr-3">{e.avgBasketPaise == null ? "–" : rs(e.avgBasketPaise)}</td><td className="pr-3">{pc(e.discountPct)}</td><td className="pr-3">{e.voids}</td><td>{e.returns}</td></tr>)}</tbody></table></div> : <p className="m-0 text-[13px] text-slate-500">No bills in this period.</p>}
          </section>
        ))}
      </div>
    </>
  );
}
