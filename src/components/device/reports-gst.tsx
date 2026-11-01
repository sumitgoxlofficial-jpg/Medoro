"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import type { gstReturns } from "@/drivedb/books";
import { inr } from "@/lib/money";
import { addDays, todayISO } from "@/lib/dates";
import { card, errText, type Cfg } from "./ui";

type Day = { date: string; bills: number; salesPaise: number; taxPaise: number; discountPaise: number; costPaise: number; returnsPaise: number; profitPaise: number };
type Top = { id: string; name: string; qty: number; revenuePaise: number; profitPaise: number };
type Exp = { name: string; batchNo: string; expiryDate: string; qty: number; packSize: number; packUnit: string; expired: boolean; valuePaise: number };
type Gst = ReturnType<typeof gstReturns>;

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";
function save(name: string, body: string, type = "text/csv") {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([body], { type })), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}

/** Reports (sales and profit, best sellers, expiring stock) and GST returns from this device's data. */
export function ReportsGst({ cfg }: { cfg: Cfg }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [from, setFrom] = useState(addDays(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [days, setDays] = useState<Day[]>([]);
  const [top, setTop] = useState<Top[]>([]);
  const [exp, setExp] = useState<Exp[]>([]);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [gst, setGst] = useState<Gst | null>(null);
  const gstin = cfg.pharmacy?.gstin ?? "";

  useEffect(() => {
    Promise.all([dev.call("salesByDay", cfg.branchId, from, to), dev.call("topMedicines", cfg.branchId, from, to), dev.call("expiringStock", cfg.branchId, 90)])
      .then(([d, t, e]) => { setDays(d); setTop(t); setExp(e); });
  }, [dev, cfg.branchId, from, to]);
  useEffect(() => {
    if (!gstin) return;
    dev.call("gstReturns", month, gstin).then(setGst, (e) => toast(errText(e), "red"));
  }, [dev, month, gstin, toast]);

  const tot = days.reduce((a, d) => ({ bills: a.bills + d.bills, sales: a.sales + d.salesPaise, profit: a.profit + d.profitPaise, returns: a.returns + d.returnsPaise }), { bills: 0, sales: 0, profit: 0, returns: 0 });
  const fp = `${month.slice(5, 7)}${month.slice(0, 4)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div className="font-semibold">Sales and profit</div>
          <div className="flex gap-2 items-center text-sm">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} className="border border-line rounded-lg px-2 h-8" aria-label="From" /> to
            <input type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value || to)} className="border border-line rounded-lg px-2 h-8" aria-label="To" />
            <Button size="sm" onClick={() => save(`sales-${from}-to-${to}.csv`, csv([["Date", "Bills", "Sales", "GST", "Discount", "Returns", "Cost", "Gross profit"], ...days.map((d) => [d.date, d.bills, d.salesPaise / 100, d.taxPaise / 100, d.discountPaise / 100, d.returnsPaise / 100, d.costPaise / 100, d.profitPaise / 100])]))}><Download size={14} /> CSV</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-muted">Bills</div><b>{tot.bills}</b></div>
          <div><div className="text-muted">Sales (incl. GST)</div><b>{inr(tot.sales)}</b></div>
          <div><div className="text-muted">Returns</div><b>{inr(tot.returns)}</b></div>
          <div><div className="text-muted">Gross profit</div><b data-testid="gross-profit">{inr(tot.profit)}</b></div>
        </div>
        <table className="text-sm w-full">
          <thead><tr className="text-left text-muted"><th className="font-medium py-1">Date</th><th className="font-medium text-right">Bills</th><th className="font-medium text-right">Sales</th><th className="font-medium text-right">Profit</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1">{d.date}</td><td className="text-right">{d.bills}</td><td className="text-right tabular-nums">{inr(d.salesPaise)}</td><td className="text-right tabular-nums">{inr(d.profitPaise)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="font-semibold">Best sellers</div>
          <ul className="text-sm divide-y divide-line">{top.map((t) => <li key={t.id} className="py-1.5 flex justify-between gap-2"><span>{t.name} <span className="text-muted">· {t.qty} sold</span></span><span className="tabular-nums">{inr(t.revenuePaise)} · profit {inr(t.profitPaise)}</span></li>)}{!top.length && <li className="py-1.5 text-muted">No sales in this period.</li>}</ul>
        </div>
        <div className={card}>
          <div className="font-semibold">Expiring in 90 days</div>
          <ul className="text-sm divide-y divide-line max-h-72 overflow-auto">{exp.map((e) => <li key={`${e.name}-${e.batchNo}`} className="py-1.5 flex justify-between gap-2"><span>{e.name} <span className="text-muted">· B {e.batchNo}</span></span><span className={e.expired ? "text-bad" : ""}>{e.expired ? "expired" : e.expiryDate} · {e.packSize > 1 ? `${Math.floor(e.qty / e.packSize)} ${e.packUnit}s` : e.qty} · {inr(e.valuePaise)}</span></li>)}{!exp.length && <li className="py-1.5 text-muted">Nothing expiring soon.</li>}</ul>
        </div>
      </div>

      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div className="font-semibold">GST returns {gstin ? <span className="text-muted font-normal">· {gstin}</span> : null}</div>
          <input type="month" value={month} max={todayISO().slice(0, 7)} onChange={(e) => setMonth(e.target.value || month)} className="border border-line rounded-lg px-2 h-8 text-sm" aria-label="GST month" />
        </div>
        {!gstin ? <div className="text-sm text-muted">Add the pharmacy’s GSTIN in Medoro settings and load the catalogue again to make GST returns on this device.</div> : gst && (
          <>
            <div className="text-sm text-muted">From this device’s bills: {gst.invoices} invoice(s), {gst.creditNotes} credit note(s). Bills on other counters appear once they have synced.</div>
            <table className="text-sm w-full">
              <thead><tr className="text-left text-muted"><th className="font-medium py-1">GSTR-1 section</th><th className="font-medium text-right">Docs/rows</th><th className="font-medium text-right">Taxable</th><th className="font-medium text-right">CGST</th><th className="font-medium text-right">SGST</th></tr></thead>
              <tbody>{gst.gstr1Summary.sections.map((r) => <tr key={r.section} className="border-t border-line"><td className="py-1">{r.section}</td><td className="text-right">{r.count}</td><td className="text-right tabular-nums">₹{r.taxable.toFixed(2)}</td><td className="text-right tabular-nums">₹{r.cgst.toFixed(2)}</td><td className="text-right tabular-nums">₹{r.sgst.toFixed(2)}</td></tr>)}</tbody>
            </table>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => save(`GSTR1_${gstin}_${fp}.json`, JSON.stringify(gst.gstr1), "application/json")}><Download size={14} /> GSTR-1 JSON (offline tool)</Button>
              <Button size="sm" onClick={() => save(`GSTR1_${gstin}_${fp}.csv`, csv(gst.gstr1Csv))}><Download size={14} /> GSTR-1 CSV</Button>
              <Button size="sm" onClick={() => save(`GSTR3B_${gstin}_${fp}.json`, JSON.stringify(gst.gstr3b), "application/json")}><Download size={14} /> GSTR-3B JSON</Button>
              <Button size="sm" onClick={() => save(`GSTR3B_${gstin}_${fp}.csv`, csv(gst.gstr3bRows))}><Download size={14} /> GSTR-3B CSV</Button>
              <Button size="sm" onClick={() => save(`HSN_${gstin}_${fp}.csv`, csv(gst.hsnCsv))}><Download size={14} /> HSN summary CSV</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
