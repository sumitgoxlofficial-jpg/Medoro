"use client";
import { useMemo, useState } from "react";
import { inr, toPaise } from "@/lib/money";
import { pharmaPricing, type MarginBasis } from "@/lib/pharma-pricing";
import { Field, card, input } from "./ui";

const SLABS = [0, 5, 12, 18] as const;
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

function Stat({ name, value, sub, strong = false }: { name: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-lg p-4 ${strong ? "bg-[var(--s-brand)] text-white" : "bg-[var(--s-soft)]"}`}>
      <dt className={`text-[13px] font-semibold ${strong ? "text-white/80" : "text-[var(--s-muted)]"}`}>{name}</dt>
      <dd className={`m-0 text-[24px] font-semibold tabular-nums tracking-[-.01em] ${strong ? "text-white" : "text-[var(--s-ink)]"}`}>{value}</dd>
      {sub ? <span className={`text-[13px] ${strong ? "text-white/80" : "text-[var(--s-muted)]"}`}>{sub}</span> : null}
    </div>
  );
}

/** PTR / PTS / retail margin calculator. All maths in src/lib/pharma-pricing.ts. */
export function MarginCalculator() {
  const [mrp, setMrp] = useState("105");
  const [gst, setGst] = useState<number>(5);
  const [retail, setRetail] = useState("20");
  const [stockist, setStockist] = useState("10");
  const [basis, setBasis] = useState<MarginBasis>("selling");
  const [qty, setQty] = useState("10");

  const r = num(retail), s = num(stockist);
  const error = basis === "selling" && (r >= 100 || s >= 100) ? "A margin on the selling price must be below 100%." : r < 0 || s < 0 ? "Margins can't be negative." : num(mrp) <= 0 ? "Enter the MRP printed on the pack." : "";
  const p = useMemo(() => pharmaPricing({ mrpPaise: Math.max(0, toPaise(mrp)), gstRate: gst, retailerMargin: Math.max(0, Math.min(r, 99.99)), stockistMargin: Math.max(0, Math.min(s, 99.99)), basis, qty: num(qty) }), [mrp, gst, r, s, basis, qty]);
  const pct = (n: number) => `${n.toFixed(2)}%`;

  return (
    <div className="grid gap-5 grid-cols-1 min-[960px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
      <form className={`${card} flex flex-col gap-4`} onSubmit={(e) => e.preventDefault()} aria-label="Margin calculator inputs">
        <Field id="mc-mrp" name="MRP per strip (₹, GST included)">
          <input id="mc-mrp" className={input} inputMode="decimal" value={mrp} onChange={(e) => setMrp(e.target.value)} aria-invalid={num(mrp) <= 0} />
        </Field>
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <legend className="text-[14px] font-semibold text-[var(--s-ink)] mb-1.5">GST slab</legend>
          <div className="grid grid-cols-4 gap-2">
            {SLABS.map((g) => (
              <label key={g} className={`h-11 flex items-center justify-center rounded-lg border text-[15px] font-semibold cursor-pointer transition-colors ${gst === g ? "border-[var(--s-brand)] bg-[var(--s-brand-tint)] text-[var(--s-brand-ink)]" : "border-[#C9D1CF] text-[var(--s-ink-2)] hover:border-[var(--s-ink)]"}`}>
                <input type="radio" name="mc-gst" value={g} checked={gst === g} onChange={() => setGst(g)} className="sr-only" />{g}%
              </label>
            ))}
          </div>
          <span className="text-[13px] text-[var(--s-muted)]">Most medicines are 5% since 22 Sep 2025; 12% still appears on older stock.</span>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field id="mc-retail" name="Retailer margin %"><input id="mc-retail" className={input} inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} /></Field>
          <Field id="mc-stockist" name="Stockist margin %"><input id="mc-stockist" className={input} inputMode="decimal" value={stockist} onChange={(e) => setStockist(e.target.value)} /></Field>
        </div>
        <Field id="mc-basis" name="Margin is calculated" hint={basis === "selling" ? "PTR = MRP without GST × (1 − margin). The usual trade convention." : "PTR = MRP without GST ÷ (1 + margin)."}>
          <select id="mc-basis" className={input} value={basis} onChange={(e) => setBasis(e.target.value as MarginBasis)} aria-describedby="mc-basis-hint">
            <option value="selling">On the selling price (margin)</option>
            <option value="markup">On cost (markup)</option>
          </select>
        </Field>
        <Field id="mc-qty" name="Strips in the order"><input id="mc-qty" className={input} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {error ? <p role="alert" className="m-0 text-[14px] font-medium text-[#B3261E]">{error}</p> : null}
      </form>

      <div className={`${card} flex flex-col gap-5`} aria-live="polite">
        <dl className="m-0 grid gap-3 grid-cols-1 min-[520px]:grid-cols-3">
          <Stat name="PTR (price to retailer)" value={inr(p.ptr)} sub={`${inr(p.ptrWithGst)} with GST`} strong />
          <Stat name="PTS (price to stockist)" value={inr(p.pts)} sub={`${inr(p.ptsWithGst)} with GST`} />
          <Stat name="Your profit per strip" value={inr(p.retailerProfit)} sub={`${pct(p.marginOnSale)} margin · ${pct(p.markupOnCost)} markup`} />
        </dl>
        <div className="grid gap-5 grid-cols-1 min-[640px]:grid-cols-2">
          <table className="w-full text-[14.5px] border-collapse">
            <caption className="text-left text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)] pb-2">Price chain per strip</caption>
            <tbody className="tabular-nums">
              {([["MRP (with GST)", inr(toPaise(mrp))], ["MRP without GST", inr(p.base)], ["PTR", inr(p.ptr)], ["PTS", inr(p.pts)], ["Stockist's profit", inr(p.stockistProfit)]] as const).map(([k, v]) => (
                <tr key={k} className="border-t border-[var(--s-line-2)]"><th scope="row" className="py-2 text-left font-normal text-[var(--s-ink-2)]">{k}</th><td className="py-2 pl-3 text-right font-semibold text-[var(--s-ink)] whitespace-nowrap">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-[14.5px] border-collapse">
            <caption className="text-left text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)] pb-2">GST per strip ({gst}%)</caption>
            <tbody className="tabular-nums">
              {([["GST collected on sale", inr(p.outputGst)], ["  CGST / SGST", `${inr(p.cgst)} / ${inr(p.sgst)}`], ["GST paid on purchase (input credit)", inr(p.inputGst)], ["Net GST you pay", inr(p.netGst)]] as const).map(([k, v]) => (
                <tr key={k} className="border-t border-[var(--s-line-2)]"><th scope="row" className={`py-2 text-left font-normal text-[var(--s-ink-2)] ${k.startsWith("  ") ? "pl-4" : ""}`}>{k.trim()}</th><td className="py-2 pl-3 text-right font-semibold text-[var(--s-ink)] whitespace-nowrap">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg bg-[var(--s-brand-tint)] p-4 flex flex-wrap gap-x-8 gap-y-2 text-[14.5px] tabular-nums">
          <span className="font-semibold text-[var(--s-brand-ink)] w-full">For {Math.max(0, Math.floor(num(qty)))} strips</span>
          <span>You pay <b>{inr(p.order.cost)}</b></span>
          <span>You sell for <b>{inr(p.order.sales)}</b></span>
          <span>Profit <b>{inr(p.order.profit)}</b></span>
          <span>Net GST <b>{inr(p.order.netGst)}</b></span>
        </div>
        <p className="m-0 text-[13px] text-[var(--s-muted)]">Figures are rounded to the paisa. Free goods, schemes and cash discounts lower your real cost further; Medoro works out landed cost from every distributor bill.</p>
      </div>
    </div>
  );
}
