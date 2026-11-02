"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { dayMonth, hhmm, monthYear } from "@/lib/dates";
import { fmtQty, parseQty, qtyInput, stockValue } from "@/lib/units";
import { useT } from "@/lib/i18n-client";
import { postCountAction } from "./actions";

type Row = { id: string; name: string; rack: string | null; batchNo: string; expiry: string; system: number; cost: number; packSize: number; packUnit: string; looseUnit: string };
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2 border-b border-row";
const byRack = (a: Row, b: Row) => (a.rack ?? "\uffff").localeCompare(b.rack ?? "\uffff", "en", { numeric: true }) || a.name.localeCompare(b.name);

export function CountView({ rows, recent }: { rows: Row[]; recent: { no: string; at: string; counted: number; changed: number; value: number }[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [zero, setZero] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [rack, setRack] = useState("");
  const [rackOrder, setRackOrder] = useState(false);
  const [pending, start] = useTransition();
  const racks = useMemo(() => [...new Set(rows.map((r) => r.rack).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })), [rows]);
  // Counted boxes take packs, or packs+loose ("2+5") for medicines kept in loose units.
  const unitsOf = (r: Row, v: string) => parseQty(v, r.packSize);
  const entered = Object.entries(vals).filter(([, v]) => v !== "");
  const bad = entered.filter(([id, v]) => { const r = rows.find((x) => x.id === id); return !r || unitsOf(r, v) == null; });
  const variance = entered.reduce((a, [id, v]) => { const r = rows.find((x) => x.id === id), u = r ? unitsOf(r, v) : null; return a + (r && u != null ? stockValue(r.cost, u - r.system, r.packSize) : 0); }, 0);
  const shown = useMemo(() => {
    const f = rows.filter((r) => (zero || r.system > 0 || vals[r.id] != null) && (!rack || r.rack === rack) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.batchNo.includes(q.toUpperCase()) || (r.rack ?? "").toLowerCase() === q.toLowerCase()));
    return rackOrder ? [...f].sort(byRack) : f;
  }, [rows, q, zero, vals, rack, rackOrder]);

  const post = () => {
    if (!entered.length) return toast("Enter counted quantities first.", "red");
    if (bad.length) return toast("Some counted quantities aren’t readable. Use packs, or packs+loose like 2+5.", "red");
    start(async () => {
      const r = await postCountAction(entered.map(([batchId, v]) => ({ batchId, counted: unitsOf(rows.find((x) => x.id === batchId)!, v)! })), "");
      if (!r.ok) return toast(r.error, "red");
      toast(t(r.data.changed === 1 ? "{no} posted. {n} batch adjustment recorded in the ledger." : "{no} posted. {n} batch adjustments recorded in the ledger.", { no: r.data.no, n: r.data.changed }), "green");
      setVals({});
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <style>{`@media print{header,nav,aside,.no-print{display:none!important}main{padding:0!important}}`}</style>
      <div className="no-print bg-white border border-line rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="relative w-[240px] max-sm:w-full"><Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fainter" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter by name, batch or rack")} className="w-full border border-input rounded-lg py-2 pl-8 pr-2 text-[13.5px] outline-none focus:border-teal" /></div>
        {racks.length ? <select value={rack} onChange={(e) => setRack(e.target.value)} aria-label={t("Rack")} className="border border-input rounded-lg px-2 py-2 text-[13.5px] bg-white"><option value="">{t("All racks")}</option>{racks.map((r) => <option key={r} value={r}>{t("Rack {r}", { r })}</option>)}</select> : null}
        <label className="flex items-center gap-1.5 py-2 text-[13px] text-muted"><input type="checkbox" className="size-4" checked={rackOrder} onChange={(e) => setRackOrder(e.target.checked)} /> {t("Shelf order")}</label>
        <span className="text-[13px] text-muted">{t("{n} of {total} batches counted", { n: entered.length, total: shown.length })}</span>
        <label className="flex items-center gap-1.5 py-2 text-[13px] text-muted"><input type="checkbox" className="size-4" checked={zero} onChange={(e) => setZero(e.target.checked)} /> {t("Show zero-stock batches")}</label>
        <span className="text-[13px] font-semibold" style={{ color: variance < 0 ? "#B3261E" : "#1F2328" }}>{t("Variance at cost: {v}", { v: inr0(variance) })}</span>
        <div className="ml-auto flex gap-2 flex-wrap max-sm:ml-0 max-sm:w-full">
          <Button className="max-sm:flex-1" onClick={() => window.print()}><Printer size={14} />{t("Count sheet")}</Button>
          <Button className="max-sm:flex-1" onClick={() => setVals(Object.fromEntries(shown.map((r) => [r.id, qtyInput(r.system, r.packSize)])))}>Prefill system qty</Button>
          <Button variant="primary" className="max-sm:flex-1" onClick={post} disabled={pending}>Post adjustments</Button>
        </div>
      </div>
      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto tbl-scroll">
        {rows.length ? (
          <table className="w-full border-collapse min-w-[760px] max-sm:min-w-0 text-[14px]">
            <thead><tr className="bg-subtle"><th className={th}>{t("Medicine · batch")}</th><th className={th + " max-sm:hidden"}>{t("Rack")}</th><th className={th + " max-sm:hidden"}>{t("Expiry")}</th><th className={th + " text-right"}>{t("System")}</th><th className={th}>{t("Counted")}</th><th className={th + " text-right"}>{t("Variance")}</th><th className={th + " text-right max-sm:hidden"}>{t("At cost")}</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const v = vals[r.id] ?? "", u = v !== "" ? unitsOf(r, v) : null, d = u != null ? u - r.system : 0;
                return (
                  <tr key={r.id}>
                    <td className={td}><strong className="font-semibold">{r.name}</strong> <span className="font-mono text-[12.5px] text-muted">{r.batchNo}</span></td>
                    <td className={td + " text-muted font-mono max-sm:hidden"}>{r.rack ?? "—"}</td>
                    <td className={td + " text-muted max-sm:hidden"}>{monthYear(r.expiry)}</td>
                    <td className={td + " text-right tnum"}>{fmtQty(r.system, r)}</td>
                    <td className={td}><input value={v} onChange={(e) => setVals({ ...vals, [r.id]: e.target.value.replace(/[^\d+]/g, "") })} inputMode="numeric" placeholder="—" title={r.packSize > 1 ? t("Whole {pack}s, or {pack}s+{loose}s like 2+5 (1 {pack} = {n} {loose}s)", { pack: r.packUnit, loose: r.looseUnit, n: r.packSize }) : undefined} aria-label={t("Counted {name} {batch}", { name: r.name, batch: r.batchNo })} className="w-24 border border-input rounded-md px-2 py-1 text-right text-[14px] outline-none focus:border-teal" style={v && u == null ? { borderColor: "#B3261E" } : undefined} /></td>
                    <td className={td + " text-right tnum font-semibold"} style={{ color: d < 0 ? "#B3261E" : d > 0 ? "#1E7F4F" : "#5B636B" }}>{u != null ? (d > 0 ? "+" : "") + fmtQty(d, r) : "—"}</td>
                    <td className={td + " text-right tnum max-sm:hidden"}>{u != null && d ? inr0(stockValue(r.cost, d, r.packSize)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty icon={ClipboardCheck} title="Nothing to count" body="There is no stock at this branch yet." />}
      </div>
      {recent.length ? (
        <div className="no-print bg-white border border-line rounded-xl px-4 py-3">
          <div className="font-semibold text-[14.5px] mb-1">{t("Recent counts")}</div>
          {recent.map((c) => <div key={c.no} className="flex gap-3 py-1.5 border-b border-row last:border-0 text-[13px]"><span className="font-mono text-[12px] w-[130px]">{c.no}</span><span className="text-muted flex-1">{dayMonth(new Date(c.at))} {hhmm(new Date(c.at))} · {t("{n} counted · {m} adjusted", { n: c.counted, m: c.changed })}</span><strong className="tnum" style={{ color: c.value < 0 ? "#B3261E" : undefined }}>{inr(c.value)}</strong></div>)}
        </div>
      ) : null}
      <div className="no-print text-[12px] text-faint">{t("Each adjustment is the counted quantity minus the system quantity at the moment you post, so post soon after counting and avoid selling counted batches in between. Variance at cost posts to Stock loss. For medicines sold loose, count whole packs and loose units as packs+loose, e.g. 2+5.")}</div>
    </div>
  );
}
