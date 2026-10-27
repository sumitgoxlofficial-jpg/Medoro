"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import type { anomalies, forecast, priceComparison, seasonal, slowStock } from "@/domain/intelligence/service";
import { draftAction, policyAction, reviewAction, seasonalPoAction, thresholdsAction } from "./actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row align-top";

export function IntelView({ policy, th: thr, fc, prices, slow, anomalies: an, sea, month, cur, suppliers, canPurchase, canReview }: {
  policy: { cover: number; safety: number }; th: { disc: number; refunds: number; cash: number };
  fc: Awaited<ReturnType<typeof forecast>>; prices: Awaited<ReturnType<typeof priceComparison>>; slow: Awaited<ReturnType<typeof slowStock>>;
  anomalies: Awaited<ReturnType<typeof anomalies>>; sea: Awaited<ReturnType<typeof seasonal>>; month: number; cur: number;
  suppliers: { id: string; name: string }[]; canPurchase: boolean; canReview: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [t, setT] = useState({ disc: String(thr.disc), refunds: String(thr.refunds), cash: String(thr.cash) });
  const [fallback, setFallback] = useState(suppliers[0]?.id ?? "");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  useEffect(() => setSel({}), [month]);
  const need = fc.filter((r) => r.suggestion > 0);
  const setPolicy = (cover: number, safety: number) => start(async () => { const r = await policyAction(cover, safety); if (!r.ok) toast(r.error, "red"); });
  const seaRows = sea.ready ? sea.plan : [];
  const chosen = seaRows.filter((r) => r.need > 0 && sel[r.id] !== false);
  const costOf = (id: string) => fc.find((f) => f.id === id)?.cost ?? 0;

  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      <div className={card + " p-4 flex flex-col gap-3"}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="size-8 rounded-lg bg-teal-tint text-teal flex items-center justify-center"><Sparkles size={16} /></span>
          <div className="flex flex-col flex-1 min-w-[240px]"><div className="font-semibold text-[15px]">Seasonal demand planner</div><div className="text-[12.5px] text-muted">Finds items that sold above average in a coming month in your own history, so you can stock up before the rush.</div></div>
          {sea.ready ? <Segmented value={String(month)} onChange={(v) => router.replace(`/app/intelligence?m=${v}`)} className="bg-[#EEF0F2]" options={[1, 2, 3, 4].map((k) => ({ value: String((cur + k) % 12), label: MONTHS[(cur + k) % 12] }))} /> : null}
        </div>
        {!sea.ready ? (
          <div className="text-[13px] text-muted bg-subtle rounded-lg px-3 py-2.5">Needs 12 months of sales history at this branch ({sea.months} so far). Until then, reorders use the 28-day sales rate below.</div>
        ) : seaRows.length ? (
          <>
            <div className="overflow-auto">
              <table className="w-full border-collapse min-w-[760px] text-[13.5px]">
                <thead><tr><th className={th} /><th className={th}>Medicine</th><th className={th}>12-month pattern</th><th className={th + " text-right"}>vs avg</th><th className={th + " text-right"}>Expected</th><th className={th + " text-right"}>Stock then</th><th className={th + " text-right"}>Pre-stock</th></tr></thead>
                <tbody>
                  {seaRows.map((r) => {
                    const mx = Math.max(...r.bars, 0.01);
                    return (
                      <tr key={r.id}>
                        <td className={td}><input type="checkbox" className="accent-teal" disabled={!r.need} checked={!!r.need && sel[r.id] !== false} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} aria-label={`Include ${r.name}`} /></td>
                        <td className={td + " font-semibold"}>{r.name}</td>
                        <td className={td}><div className="flex items-end gap-[2px] h-7">{r.bars.map((b, i) => <div key={i} title={`${MONTHS[i]}: ${Math.round(b * 100)}% of average`} className="w-[7px] rounded-sm" style={{ height: Math.round(4 + (b / mx) * 22), background: i === month ? "#0B5E5B" : i === cur ? "#7FB8B1" : "#D5E7E4" }} />)}</div></td>
                        <td className={td + " text-right tnum text-teal font-semibold"}>+{Math.round(r.lift)}%</td>
                        <td className={td + " text-right tnum"}>{r.expected}</td><td className={td + " text-right tnum"}>{r.atStart}</td>
                        <td className={td + " text-right tnum font-semibold"} style={{ color: r.need ? "#0B5E5B" : "#18794E" }}>{r.need ? "+" + r.need : "Covered"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[12px] text-faint flex-1 min-w-[260px]">Basis: the same month in your sales history compared with the 12-month average, current stock and expected sales until then. Weather and outbreaks can shift real demand, so review before ordering.</span>
              <span className="text-[13px]">{chosen.length} selected · <strong>{inr0(chosen.reduce((a, r) => a + r.need * costOf(r.id), 0))}</strong> at cost</span>
              {canPurchase ? <Button variant="primary" disabled={!chosen.length || !fallback || pending} onClick={() => start(async () => { const r = await seasonalPoAction(fallback, chosen.map((x) => ({ medicineId: x.id, qty: x.need, rate: costOf(x.id) / 100 })), MONTHS[month]); toast(r.ok ? `${r.data} saved as draft for ${MONTHS[month]}. Nothing is sent until you place it.` : r.error, r.ok ? "green" : "red"); })}>Create draft PO for {MONTHS[month]}</Button> : null}
            </div>
          </>
        ) : <div className="text-[13px] text-muted">No items sell noticeably above average in {MONTHS[month]}. Normal reorder rules are enough.</div>}
      </div>

      <div className={card + " overflow-auto"}>
        <div className="flex items-center gap-3 flex-wrap px-4 pt-3.5 pb-2.5">
          <div className="font-semibold text-[15px] mr-auto">Demand forecast & reorder policy</div>
          <span className="text-[12.5px] text-muted">Cover</span>
          <Segmented size="sm" value={String(policy.cover)} onChange={(v) => setPolicy(Number(v), policy.safety)} options={[7, 14, 21, 30].map((x) => ({ value: String(x), label: `${x} d` }))} />
          <span className="text-[12.5px] text-muted">Safety</span>
          <Segmented size="sm" value={String(policy.safety)} onChange={(v) => setPolicy(policy.cover, Number(v))} options={[1, 2, 3, 5].map((x) => ({ value: String(x), label: `${x} d` }))} />
          {canPurchase ? (
            <>
              {need.some((r) => !r.supplierId) && suppliers.length ? <select value={fallback} onChange={(e) => setFallback(e.target.value)} aria-label="Default supplier" className="border border-input rounded-md px-2 py-1 text-[12.5px] bg-white">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}
              <Button variant="primary" size="sm" disabled={!need.length || pending} onClick={() => start(async () => { const r = await draftAction(fallback || null); toast(r.ok ? `${r.data.join(", ")} saved as draft. Review in Purchases before ordering.` : r.error, r.ok ? "green" : "red"); })}>Draft PO · {need.length} item{need.length === 1 ? "" : "s"}</Button>
            </>
          ) : null}
        </div>
        {fc.length ? (
          <table className="w-full border-collapse min-w-[980px] text-[13.5px]">
            <thead><tr className="bg-subtle"><th className={th}>Medicine</th><th className={th + " text-right"}>28-d avg</th><th className={th + " text-right"}>Next 14 d</th><th className={th + " text-right"}>Sellable</th><th className={th + " text-right"}>Cover</th><th className={th + " text-right"}>Reorder pt</th><th className={th + " text-right"}>Suggest</th><th className={th}>Why</th></tr></thead>
            <tbody>
              {fc.map((r) => (
                <tr key={r.id}>
                  <td className={td}><strong className="font-semibold">{r.name}</strong><div className="text-[12px] text-faint">{r.supplier ?? "No supplier yet"}</div></td>
                  <td className={td + " text-right tnum"}>{r.velocity ? r.velocity.toFixed(1) + "/day" : "—"}</td><td className={td + " text-right tnum"}>{r.f14}</td><td className={td + " text-right tnum"}>{r.stock}</td>
                  <td className={td + " text-right tnum"} style={{ color: r.cover != null && r.cover <= r.lead + policy.safety ? "#B3261E" : r.cover != null && r.cover <= 7 ? "#94570A" : undefined }}>{r.cover != null ? r.cover + " d" : "—"}</td>
                  <td className={td + " text-right tnum"}>{r.rop}</td>
                  <td className={td + " text-right tnum font-semibold"} style={{ color: r.suggestion ? "#0B5E5B" : "#8A929A" }}>{r.suggestion ? "+" + r.suggestion : "—"}</td>
                  <td className={td + " text-[12.5px] text-ink-2 max-w-[360px]"}>{r.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="px-4 pb-4 text-[13px] text-fainter">Add medicines and record sales to see forecasts.</div>}
        <div className="px-4 py-2.5 text-[12px] text-faint">Basis: 28-day sales history and supplier lead times. These are estimates, not guarantees.</div>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card + " p-4 flex flex-col gap-2"}>
          <div className="font-semibold text-[15px]">Supplier price comparison</div>
          {prices.length ? prices.map((p) => (
            <div key={p.name} className="flex flex-col gap-0.5 py-1.5 border-b border-row last:border-0">
              <div className="flex justify-between gap-2"><strong className="text-[13.5px]">{p.name}</strong><span className="text-[12.5px]" style={{ color: p.savingPct ? "#1E7F4F" : "#5B636B" }}>Best: {p.best}{p.savingPct ? ` · ${p.savingPct.toFixed(1)}% below last price` : " · last price is best"}</span></div>
              <div className="text-[12.5px] text-muted">{p.quotes.map((q) => `${q.supplier} ${inr(q.rate)}`).join(" · ")}</div>
            </div>
          )) : <div className="text-[13px] text-fainter">Shows once you’ve bought the same medicine from more than one supplier. Based on your GRN history.</div>}
        </div>
        <div className={card + " p-4 flex flex-col gap-2"}>
          <div className="font-semibold text-[15px]">Slow-moving & dead stock</div>
          {slow.length ? slow.map((x) => (
            <div key={x.name} className="flex justify-between gap-3 py-1.5 border-b border-row last:border-0">
              <div className="flex flex-col"><strong className="text-[13.5px]">{x.name}</strong><span className="text-[12.5px] text-muted">{x.note}{x.cover != null ? ` · ${x.cover} days of stock` : ""}</span></div>
              <div className="text-right"><div className="font-semibold tnum">{inr0(x.value)}</div><div className="text-[12px] text-faint">{x.qty} units</div></div>
            </div>
          )) : <div className="text-[13px] text-fainter">No slow or dead stock. Items qualify after 30 days on the shelf with little or no sales.</div>}
        </div>
      </div>

      <div className={card + " p-4 flex flex-col gap-2"}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="font-semibold text-[15px]">Audit anomalies</div>
          <span className="text-[12px] text-faint">Signals to review, not proof of wrongdoing. Last 7 days.</span>
          <div className="ml-auto flex items-center gap-3 text-[12.5px] text-muted flex-wrap">
            <label className="flex items-center gap-1">Discount &gt;<input value={t.disc} onChange={(e) => setT({ ...t, disc: e.target.value.replace(/\D/g, "") })} className="w-10 border border-input rounded px-1 py-0.5 text-right" />%</label>
            <label className="flex items-center gap-1">Refunds/day &gt;<input value={t.refunds} onChange={(e) => setT({ ...t, refunds: e.target.value.replace(/\D/g, "") })} className="w-10 border border-input rounded px-1 py-0.5 text-right" /></label>
            <label className="flex items-center gap-1">Cash diff &gt; ₹<input value={t.cash} onChange={(e) => setT({ ...t, cash: e.target.value.replace(/\D/g, "") })} className="w-14 border border-input rounded px-1 py-0.5 text-right" /></label>
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await thresholdsAction(Number(t.disc), Number(t.refunds), Number(t.cash)); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); })}>Save</Button>
          </div>
        </div>
        {an.length ? an.map((a) => (
          <div key={a.key} className="flex items-center gap-3 py-2 border-b border-row last:border-0 flex-wrap">
            <Badge tone={a.sev}>{a.rule}</Badge>
            <span className="text-[13.5px] flex-1 min-w-[200px]">{a.detail} <span className="text-muted">· {a.who}</span></span>
            {a.reviewed ? <span className="text-[12.5px] text-ok">{a.reviewed}</span> : canReview ? <Button size="sm" disabled={pending} onClick={() => start(async () => { await reviewAction(a.key, `${a.rule} · ${a.detail}`); })}>Mark reviewed</Button> : null}
          </div>
        )) : <div className="text-[13px] text-fainter">Nothing flagged in the last 7 days.</div>}
      </div>
    </div>
  );
}
