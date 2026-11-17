import Link from "next/link";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { supplierIntel, QUOTE_WINDOW_DAYS } from "@/domain/purchasing/supplier-intel";
import { WEIGHTS } from "@/domain/purchasing/supplier-score";
import { PageHead } from "@/components/page-head";

export const metadata = { title: "Supplier intelligence" };
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n)}%`);
const card = "bg-white border border-line rounded-xl p-4";

export default async function Page({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const q = (await searchParams).branch;
  const branch = q && ctx.branches.some((b) => b.id === q) ? q : null;
  const d = await supplierIntel(ctx, branch);
  return (
    <>
      <PageHead icon={Truck} title="Supplier intelligence" sub={`Ranking from your own purchase orders and GRNs · ${d.scope.branchName}`} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        {ctx.branches.length > 1 ? (
          <nav aria-label="Branch" className="flex gap-2 flex-wrap text-[13px]" data-testid="supplier-branches">
            <Link href="/app/intelligence/suppliers" className={`rounded-lg border px-3 py-1 ${!branch ? "bg-slate-900 text-white" : "border-line"}`}>All my branches</Link>
            {ctx.branches.map((b) => <Link key={b.id} href={`/app/intelligence/suppliers?branch=${b.id}`} className={`rounded-lg border px-3 py-1 ${branch === b.id ? "bg-slate-900 text-white" : "border-line"}`}>{b.name}</Link>)}
          </nav>
        ) : null}

        <section className={card} data-testid="supplier-ranking">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Supplier ranking</h2>
          <p className="m-0 mb-3 text-[12.5px] text-slate-500">
            Score out of 100: landed cost {WEIGHTS.price * 100}%, fulfilment {WEIGHTS.fulfilment * 100}%, delivery {WEIGHTS.delivery * 100}%, credit {WEIGHTS.credit * 100}%, expiry returns {WEIGHTS.returns * 100}%. A factor with no history is left out and the rest re-scaled; confidence shows how much history there is.
          </p>
          {d.suppliers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead><tr className="text-left text-slate-500 border-b border-line">
                  <th className="py-1.5 pr-3">#</th><th className="pr-3">Supplier</th><th className="pr-3">Score</th><th className="pr-3">Confidence</th><th className="pr-3">Orders</th><th className="pr-3">Fulfilled</th><th className="pr-3">On time</th>
                  <th className="pr-3">Credit</th><th className="pr-3">Expiry returns</th><th className="pr-3">Price vs cheapest</th><th>Price trend</th></tr></thead>
                <tbody>
                  {d.suppliers.map((s, i) => (
                    <tr key={s.id} className="border-b border-line/60 align-top" data-testid="supplier-row">
                      <td className="py-1.5 pr-3">{i + 1}</td>
                      <td className="pr-3 font-medium">{s.name}</td>
                      <td className="pr-3"><details><summary className="cursor-pointer">{s.score.score}</summary>
                        <ul className="m-0 pl-4 text-[12px] text-slate-600">{s.score.factors.map((f) => <li key={f.key}>{f.label}: {f.value ?? "no data"}{f.value != null ? ` × ${Math.round(f.weight * 100)}% = ${f.points}` : ""}</li>)}</ul></details></td>
                      <td className="pr-3">{s.score.confidence}</td>
                      <td className="pr-3">{s.orders}</td><td className="pr-3">{pct(s.fillPct)}</td><td className="pr-3">{pct(s.onTimePct)}</td>
                      <td className="pr-3">{s.creditDays} d</td>
                      <td className="pr-3">{s.acceptsReturns ? `${s.returnWindowDays} d window` : "None"}</td>
                      <td className="pr-3">{s.priceIndexPct == null ? "–" : `${s.priceIndexPct >= 0 ? "+" : ""}${s.priceIndexPct.toFixed(1)}% (${s.comparedMedicines} med.)`}</td>
                      <td>{s.priceChange180Pct == null ? "–" : `${s.priceChange180Pct >= 0 ? "+" : ""}${s.priceChange180Pct.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="m-0 text-[13px] text-slate-500">No suppliers yet.</p>}
        </section>

        {d.byBranch.length ? (
          <section className={card} data-testid="supplier-by-branch">
            <h2 className="m-0 mb-2 text-[15px] font-semibold">Branch-wise evaluation</h2>
            <ul className="m-0 pl-0 list-none grid gap-1 text-[13px]">
              {d.byBranch.map((b) => <li key={b.branchId}><strong>{b.branch}:</strong> {b.top.length ? b.top.map((t) => `${t.name} (${t.score})`).join(", ") : "no purchase history yet"}</li>)}
            </ul>
          </section>
        ) : null}

        <section className={card} data-testid="supplier-recommendations">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Purchase recommendations</h2>
          <p className="m-0 mb-3 text-[12.5px] text-slate-500">Medicines bought from two or more suppliers in the last {QUOTE_WINDOW_DAYS} days. Cost is the documented landed cost per unit from the GRN (after discounts, free goods and non-claimable GST); credit terms are scored separately.{d.linesWithoutLandedCost ? ` ${d.linesWithoutLandedCost} older GRN line(s) have no landed cost and are not compared.` : ""}</p>
          {d.recommendations.length ? d.recommendations.map((r) => (
            <article key={r.medicineId} className="border-t border-line py-2" data-testid="supplier-rec">
              <h3 className="m-0 text-[14px] font-semibold">{r.medicine} → {r.rec.ranked.find((x) => x.supplierId === r.rec.pickId)?.name}</h3>
              <ul className="m-0 mt-1 pl-4 text-[12.5px] text-slate-700">{r.rec.explanation.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <p className="m-0 mt-1 text-[12px] text-slate-500">Quotes: {r.quotes.map((x) => `${x.supplier} ${rs(x.landedPaise)}`).join(" · ")}</p>
            </article>
          )) : <p className="m-0 text-[13px] text-slate-500">Not enough history yet: a recommendation needs the same medicine bought from at least two suppliers.</p>}
        </section>
      </div>
    </>
  );
}
