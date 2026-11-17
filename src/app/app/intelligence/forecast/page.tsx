import Link from "next/link";
import { redirect } from "next/navigation";
import { LineChart } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { forecastAccuracy, forecastIntel } from "@/domain/intelligence/forecast-intel";
import { PageHead } from "@/components/page-head";
import { DraftButton } from "./draft-button";

export const metadata = { title: "Demand forecast" };
const card = "bg-white border border-line rounded-xl p-4";
const th = "py-1.5 pr-3 text-left font-normal text-slate-500";
const pc = (n: number | null) => (n == null ? "–" : `${Math.round(n * 1000) / 10}%`);
const CONF: Record<string, string> = { high: "bg-emerald-50 text-emerald-800 border-emerald-200", medium: "bg-amber-50 text-amber-800 border-amber-200", low: "bg-red-50 text-red-800 border-red-200" };
const rs = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

function Bars({ actual, forecast }: { actual: number[]; forecast: { point: number; lo: number; hi: number } }) {
  const max = Math.max(1, ...actual, forecast.hi);
  return (
    <div className="flex items-end gap-[3px] h-10" role="img" aria-label={`Units sold each of the last ${actual.length} weeks, then the forecast for next week: ${forecast.point} (range ${forecast.lo} to ${forecast.hi})`}>
      {actual.map((v, i) => <div key={i} className="w-3 bg-slate-400 rounded-sm" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} title={`${v} packs`} />)}
      <div className="w-3 relative rounded-sm bg-teal-600" style={{ height: `${Math.max(2, (forecast.point / max) * 100)}%` }} title={`forecast ${forecast.point} (${forecast.lo}–${forecast.hi})`}><span className="absolute inset-x-0 -top-px border-t-2 border-teal-900" style={{ transform: `translateY(-${((forecast.hi - forecast.point) / Math.max(forecast.point, 1)) * 100}%)` }} /></div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await requireCtx();
  if (!(can(ctx, "reports") || can(ctx, "purchase"))) redirect("/app");
  const showAll = (await searchParams).all === "1";
  const [f, acc, suppliers] = await Promise.all([forecastIntel(ctx), forecastAccuracy(ctx), db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const recs = f.rows.filter((r) => r.rec), rows = showAll ? f.rows : f.rows.slice(0, 40);
  return (
    <>
      <PageHead icon={LineChart} title="Demand forecast" sub={`${f.branch.name} · statistical estimate from your own bills, not a guarantee`} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        <p className="m-0 text-[12.5px] text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="forecast-disclaimer">
          These are estimates from a simple statistical model (recent level, weekday pattern, and an 80% range), not facts and not machine learning. Seasonal swings are not included (see the seasonal planner on the Insights page). Sales stop when stock runs out, so items that were often out of stock are under-forecast. Always review before ordering.
        </p>

        <section className={card} data-testid="forecast-accuracy">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">How accurate is it?</h2>
          <p className="m-0 mb-1 text-[13px]">Tested on your own history (last weeks, forecast from the data before them): average error {pc(f.portfolio.wape)} of units sold, bias {f.portfolio.bias == null ? "–" : `${f.portfolio.bias > 0 ? "+" : ""}${pc(f.portfolio.bias)}`}, actual inside the 80% range {pc(f.portfolio.coverage)} of the time, over {f.portfolio.items} items.</p>
          {acc.overall.items ? <p className="m-0 mb-1 text-[13px]">Forecasts actually made and since checked against sales: {acc.overall.items} item-weeks, error {pc(acc.overall.wape)}, bias {acc.overall.bias == null ? "–" : `${acc.overall.bias > 0 ? "+" : ""}${pc(acc.overall.bias)}`}, in range {pc(acc.overall.coverage)}.</p> : <p className="m-0 mb-1 text-[13px] text-slate-600">No forecast has been made and then checked yet. Each week’s forecast is saved and scored once its week is over{acc.pendingWeeks ? ` (${acc.pendingWeeks} week(s) waiting)` : ""}.</p>}
          {acc.weeks.length ? <ul className="m-0 pl-5 text-[12.5px] text-slate-700">{acc.weeks.map((w) => <li key={w.generatedOn}>Week of {w.generatedOn}: {w.items} items, error {pc(w.wape)}, in range {pc(w.coverage)}</li>)}</ul> : null}
          <p className="m-0 mt-1 text-[12px] text-slate-500">Error = total absolute miss ÷ units sold. “In range” should be near 80% if the range is honest; much lower means the model is overconfident.</p>
        </section>

        <section className={card} data-testid="forecast-recs">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Reorder recommendations ({recs.length})</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Policy: cover {f.policy.cover} days (set on the Insights page). Reorder point = expected demand over the supplier’s lead time + safety stock sized to how erratic the item’s sales are (95% service level).</p>
          {recs.length ? <ul className="m-0 mb-3 p-0 list-none grid gap-2">{recs.map((r) => (
            <li key={r.medicineId} className="text-[13px]"><strong>{r.name}</strong> → order {r.rec!.qty} packs <span className={`ml-1 text-[11.5px] rounded-full border px-2 py-0.5 ${CONF[r.confidence]}`}>{r.confidence} confidence</span> {r.supplier ? <span className="text-slate-500">· {r.supplier}</span> : <span className="text-red-700">· no supplier on record</span>}<div className="text-[12.5px] text-slate-600">{r.rec!.reason}</div></li>))}</ul> : <p className="m-0 mb-3 text-[13px] text-slate-500">Nothing is at or below its reorder point.</p>}
          <DraftButton suppliers={suppliers} canPurchase={can(ctx, "purchase") && !ctx.readOnly} count={recs.length} lowCount={recs.filter((r) => r.confidence === "low").length} />
        </section>

        <section className={card} data-testid="forecast-table">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Forecast by medicine</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Packs. Ranges are 80% prediction intervals. Bars: units sold in each of the last weeks (grey) and next week’s forecast (green). {f.insufficient} active item(s) have too little history (under 28 days, or fewer than 5 days with sales) and are left out rather than forecast as zero.</p>
          <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse">
            <thead><tr><th className={th}>Medicine</th><th className={th}>Confidence</th><th className={th}>Tomorrow</th><th className={th}>Next 7 days</th><th className={th}>Next 30 days</th><th className={th}>History</th><th className={th}>Stock</th><th className={th}>Runs out</th><th className={th}>Expiry risk</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.medicineId} className="border-t border-line/60 align-top" data-testid="forecast-row">
                <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                <td className="pr-3"><span className={`text-[11.5px] rounded-full border px-2 py-0.5 ${CONF[r.confidence]}`}>{r.confidence}</span><div className="text-[11px] text-slate-500">tested error {pc(r.backtest.wape)} over {r.backtest.weeks} wk</div></td>
                <td className="pr-3">{r.tomorrow.point} <span className="text-slate-500">({r.tomorrow.lo}–{r.tomorrow.hi})</span></td>
                <td className="pr-3">{r.week.point} <span className="text-slate-500">({r.week.lo}–{r.week.hi})</span></td>
                <td className="pr-3">{r.month.point} <span className="text-slate-500">({r.month.lo}–{r.month.hi})</span></td>
                <td className="pr-3"><Bars actual={r.weeklyActuals} forecast={r.week} /></td>
                <td className="pr-3">{r.stock}{r.inbound ? ` + ${r.inbound} on order` : ""}<div className="text-[11px] text-slate-500">lead {r.leadDays} d ({r.leadSource}), safety {r.safetyStock}</div></td>
                <td className="pr-3">{r.stockout.point == null ? "not within 120 days" : `~day ${r.stockout.point}`}{r.stockout.point != null ? <div className="text-[11px] text-slate-500">range day {r.stockout.early ?? "?"}–{r.stockout.late ?? "120+"}</div> : null}</td>
                <td>{r.expiry.unsoldPacks >= 0.5 ? <span className="text-red-700">{r.expiry.unsoldPacks} packs ({rs(r.expiry.valuePaise)}) may expire unsold<div className="text-[11px] text-slate-500">{r.expiry.batches.map((b) => `${b.batchNo}: ${b.unsold} in ${b.days} d`).join(" · ")}</div></span> : <span className="text-slate-500">–</span>}</td>
              </tr>))}</tbody></table></div>
          {!showAll && f.rows.length > rows.length ? <p className="m-0 mt-2 text-[12.5px]"><Link href="/app/intelligence/forecast?all=1" className="underline">Show all {f.rows.length}</Link></p> : null}
        </section>
      </div>
    </>
  );
}
