"use client";
import { useEffect, useState } from "react";
import { LineChart, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import { deviceDb } from "@/drivedb/device";
import type { ForecastScreen } from "@/drivedb/forecast";
import { card, errText, type Cfg } from "./ui";

const th = "text-left text-[12px] font-medium text-muted px-2.5 py-2 border-b border-line whitespace-nowrap";
const td = "px-2.5 py-2 border-b border-line align-top";
const num = " text-right tabular-nums";
const pc = (n: number | null) => (n == null ? "—" : `${Math.round(n * 1000) / 10}%`);
const CONF: Record<string, string> = { high: "bg-green-50 text-green-800 border-green-200", medium: "bg-amber-50 text-amber-800 border-amber-200", low: "bg-red-50 text-red-800 border-red-200" };

/**
 * The statistical demand forecast on the counter (Drive mode): next-week and next-month ranges with a confidence for each
 * item, how the model did on this counter's own past, and reorder recommendations that can go to the order list. Worked out
 * on this device (src/drivedb/forecast.ts); nothing goes to Medoro. An estimate, never a guarantee.
 */
export function ForecastCard({ cfg, refresh, onAdd }: { cfg: Cfg; refresh: number; onAdd: (items: { medicineId: string; qty: number }[]) => void }) {
  const t = useT();
  const dev = deviceDb();
  const [f, setF] = useState<ForecastScreen | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [low, setLow] = useState(false);
  useEffect(() => { dev.call("intelForecast", cfg.branchId).then((x) => { setF(x); setErr(null); }).catch((e) => setErr(errText(e))); }, [dev, cfg.branchId, refresh]);

  if (err) return <div className={card}><div className="text-sm text-bad">{err}</div></div>;
  if (!f) return <div className={card}><div className="text-sm text-muted">{t("Working out the statistical forecast…")}</div></div>;
  const recs = f.rows.filter((r) => r.rec && (low || r.confidence !== "low"));
  const acc = f.accuracy;
  return (
    <div className={card + " !p-0 overflow-hidden"} data-testid="device-forecast">
      <div className="flex items-center gap-2 flex-wrap px-4 pt-3.5">
        <span className="size-8 rounded-lg bg-teal/10 text-teal flex items-center justify-center"><LineChart size={16} /></span>
        <div className="flex flex-col mr-auto min-w-[220px]">
          <div className="font-semibold">{t("Statistical demand forecast")}</div>
          <div className="text-[12.5px] text-muted">{t("Next week and next month with a range and a confidence for each medicine, from this counter’s own bills.")}</div>
        </div>
        {f.lowConfidence ? <label className="text-[12.5px] flex items-center gap-1.5"><input type="checkbox" className="accent-teal" checked={low} onChange={(e) => setLow(e.target.checked)} />{t("Include {n} low-confidence", { n: f.lowConfidence })}</label> : null}
        <Button variant="primary" size="sm" disabled={!recs.length} onClick={() => onAdd(recs.map((r) => ({ medicineId: r.medicineId, qty: r.rec!.qty })))}>
          <ListPlus size={14} />{t("Add {n} to order list", { n: recs.length })}
        </Button>
      </div>
      <p className="mx-4 mt-3 mb-0 text-[12.5px] text-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="device-forecast-disclaimer">
        {t("These are estimates from a simple statistical model (recent level, weekday pattern and an 80% range), not facts and not machine learning. Seasonal swings are not included. Sales stop when stock runs out, so items that were often out of stock are under-forecast. Review before ordering.")}
      </p>
      <div className="px-4 pt-3 text-[13px] flex flex-col gap-1" data-testid="device-forecast-accuracy">
        <div className="font-medium">{t("How accurate is it?")}</div>
        <div>{t("Tested on this counter’s own history: average error {wape} of units sold, actual inside the range {cov} of the time, over {n} items.", { wape: pc(f.portfolio.wape), cov: pc(f.portfolio.coverage), n: f.portfolio.items })}</div>
        {acc.overall.items
          ? <div>{t("Forecasts this counter made and then checked against sales: {n} item-weeks, error {wape}, in range {cov}.", { n: acc.overall.items, wape: pc(acc.overall.wape), cov: pc(acc.overall.coverage) })}</div>
          : <div className="text-muted">{t("No forecast has been made and then checked yet. This week’s is saved when you open this screen, and scored once its week is over ({n} waiting).", { n: acc.pendingWeeks })}</div>}
      </div>
      {f.rows.length ? (
        <div className="overflow-auto max-h-[520px] mt-3">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-page"><tr>
              <th className={th}>{t("Medicine")}</th><th className={th + num}>{t("Next 7 d")}</th><th className={th + num + " max-sm:hidden"}>{t("Range")}</th><th className={th + num + " max-md:hidden"}>{t("Next 30 d")}</th>
              <th className={th + num}>{t("Stock")}</th><th className={th + num + " max-sm:hidden"}>{t("Runs out")}</th><th className={th}>{t("Confidence")}</th><th className={th + num}>{t("Order")}</th>
            </tr></thead>
            <tbody>{f.rows.slice(0, 60).map((r) => (
              <tr key={r.medicineId}>
                <td className={td}><span className="font-medium">{r.name}</span><div className="text-[12px] text-faint">{r.supplier ?? t("No supplier yet")}</div></td>
                <td className={td + num}>{r.week.point}</td>
                <td className={td + num + " max-sm:hidden"}>{r.week.lo}–{r.week.hi}</td>
                <td className={td + num + " max-md:hidden"}>{r.month.point}</td>
                <td className={td + num}>{r.stock}</td>
                <td className={td + num + " max-sm:hidden"}>{r.stockout.point == null ? t("Not within 120 d") : t("in {n} d", { n: r.stockout.point })}</td>
                <td className={td}><span className={`text-[11.5px] rounded-full border px-2 py-0.5 ${CONF[r.confidence]}`}>{t(r.confidence === "high" ? "high" : r.confidence === "medium" ? "medium" : "low")}</span></td>
                <td className={td + num + " font-semibold"} style={{ color: r.rec ? "#0B5E5B" : "#8A929A" }} title={r.rec?.reason}>{r.rec ? "+" + r.rec.qty : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="px-4 py-3 text-[13px] text-muted">{t("No medicine has enough history yet (about 4 weeks of bills with sales on 5 days). Until then the reorder list above uses the 28-day sales rate.")}</div>}
      <div className="px-4 py-3 text-[12px] text-faint">
        {t("{n} medicine(s) have too little history for a forecast and are left out, not shown as zero. The counter has no supplier lead times or purchase orders, so 1 day is used for delivery and nothing is counted as on order.", { n: f.insufficient })}
      </div>
    </div>
  );
}
