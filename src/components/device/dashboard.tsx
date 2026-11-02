"use client";
import { useEffect, useRef, useState } from "react";
import { IndianRupee, Percent, Truck, Receipt, Users, CalendarClock, Hourglass, PackageMinus, Download } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/csv";
import { weekdayLong } from "@/lib/dates";
import { deviceDb } from "@/drivedb/device";
import type { Dashboard as Dash, DashRange } from "@/drivedb/dashboard";
import { inr } from "@/lib/money";
import { card, errText, type Cfg } from "./ui";

const tile = "bg-white p-4 flex flex-col gap-1";
const dm = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** The owner's dashboard, from this device's own data: sales, margin, purchases, dues, the last 14 days, and stock to act on. */
export function Dashboard({ cfg, owner, refresh, go }: { cfg: Cfg; owner: boolean; refresh: number; go: (tab: "stock" | "reports" | "customers" | "accounts") => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [range, setRange] = useState<DashRange>("today");
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { dev.call("dashboard", cfg.branchId, range).then((x) => { setD(x); setErr(null); }, (e) => setErr(errText(e))); }, [dev, cfg.branchId, range, refresh]);
  const head = (
    <PageHead title="Dashboard" sub={`${weekdayLong()} · ${cfg.branchName}`} right={
      <div className="flex gap-2 items-center">
        <div className="inline-flex gap-px bg-white border border-line p-0.5 rounded-lg">
          <Segmented value={range} onChange={(v) => setRange(v as DashRange)} className="bg-transparent p-0" options={[{ value: "today", label: "Today" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }]} />
        </div>
        {owner && d ? <Button onClick={() => {
          downloadCsv(`dashboard-${cfg.branchName.toLowerCase()}-${range}`, [
            ["Metric", "Value"], ["Period", range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days"], ["Bills", d.sales.bills], ["Sales (₹)", d.sales.paise / 100],
            ["Cash today (₹)", d.collections.cash / 100], ["UPI today (₹)", d.collections.upi / 100], ["Card today (₹)", d.collections.card / 100], ["Credit today (₹)", d.collections.credit / 100],
            ["Gross margin %", d.margin.pct === null ? "" : (d.margin.pct * 100).toFixed(1)], ["Purchases (₹)", d.purchases.paise / 100], ["Expenses (₹)", d.expenses.paise / 100],
            ["Receivables (₹)", d.receivables.paise / 100], ["Payables (₹)", d.payables.paise / 100],
          ]);
          toast("CSV exported (generated on this device)", "green");
        }}><Download size={15} />Export</Button> : null}
      </div>
    } />
  );
  if (err) return <>{head}<div className={card}><div className="text-sm text-bad">{err}</div></div></>;
  if (!d) return <>{head}<div className={card}><div className="text-sm text-muted">Loading the dashboard…</div></div></>;

  const max = Math.max(1, ...d.chart.map((c) => c.salesPaise));
  const pts = d.margin.pct !== null && d.margin.prevPct !== null ? Math.round((d.margin.pct - d.margin.prevPct) * 1000) / 10 : null;
  const coll = [["Cash", d.collections.cash, "bg-teal"], ["UPI", d.collections.upi, "bg-blue-600"], ["Card", d.collections.card, "bg-teal/50"], ["Credit", d.collections.credit, "bg-amber-500"]] as const;
  const collTotal = coll.reduce((a, c) => a + c[1], 0);
  const Tile = ({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: string; sub: React.ReactNode; onClick?: () => void }) => (
    <div className={`${tile} ${onClick ? "cursor-pointer hover:bg-page" : ""}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-[13px] text-muted">{icon}{label}</div>
      <div className="text-[24px] font-semibold tabular-nums">{value}</div>
      <div className="text-[12.5px] text-faint">{sub}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4 max-w-[1400px]" data-testid="device-dashboard">
      {head}
      <div className="grid gap-px bg-line border border-line rounded-xl overflow-hidden grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Tile icon={<IndianRupee size={15} className="text-teal" />} label={range === "today" ? "Sales today" : "Sales"} value={inr(d.sales.paise)} sub={`${d.sales.bills} ${d.sales.bills === 1 ? "bill" : "bills"}`} />
        {owner && <Tile icon={<Percent size={15} className="text-teal" />} label="Gross margin" value={d.margin.pct === null ? "—" : `${(d.margin.pct * 100).toFixed(1)}%`} sub={pts === null ? "Before GST, after returns" : <span className={pts >= 0 ? "text-ok" : "text-bad"}>{pts >= 0 ? "+" : ""}{pts} pts vs the 7 days before</span>} />}
        <Tile icon={<Truck size={15} className="text-teal" />} label="Purchases" value={inr(d.purchases.paise)} sub={`${d.purchases.count} supplier ${d.purchases.count === 1 ? "bill" : "bills"}`} />
        {owner && <Tile icon={<Receipt size={15} className="text-teal" />} label="Expenses" value={inr(d.expenses.paise)} sub={`${d.expenses.count} ${d.expenses.count === 1 ? "entry" : "entries"}`} onClick={() => go("accounts")} />}
        <Tile icon={<Users size={15} className="text-teal" />} label="Receivables" value={inr(d.receivables.paise)} sub={`${d.receivables.customers} ${d.receivables.customers === 1 ? "customer" : "customers"} on credit`} onClick={() => go("customers")} />
        {owner && <Tile icon={<CalendarClock size={15} className="text-teal" />} label="Payables" value={inr(d.payables.paise)} sub={`${d.payables.suppliers} ${d.payables.suppliers === 1 ? "supplier" : "suppliers"}`} onClick={() => go("accounts")} />}
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold">Sales, last 14 days</div><div className="text-[12px] text-faint">Incl. GST</div></div>
          <div className="flex items-end gap-1.5 h-40" aria-label="Sales by day">
            {d.chart.map((c) => (
              <div key={c.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${dm(c.date)}: ${inr(c.salesPaise)}`}>
                <div className="w-full bg-teal/30 rounded-t" style={{ height: `${Math.max(2, (c.salesPaise / max) * 100)}%` }} />
                <div className="text-[10.5px] text-faint tabular-nums">{c.date.slice(8)}</div>
              </div>
            ))}
          </div>
          <div className="text-[12.5px] text-muted">Collections today</div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-line-soft">{collTotal ? coll.map(([k, v, cls]) => v ? <div key={k} className={cls} style={{ width: `${(v / collTotal) * 100}%` }} /> : null) : null}</div>
          <div className="flex gap-4 flex-wrap text-[12.5px]">{coll.map(([k, v, cls]) => <span key={k} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${cls}`} />{k} <b className="tabular-nums">{inr(v)}</b></span>)}</div>
        </div>
        <div className={card}>
          <div className="font-semibold">Insights</div>
          {d.expiringCount ? <div className="flex flex-col gap-0.5"><div className="font-medium text-[14px]">{inr(d.expiringValuePaise)} of stock expires within 90 days</div><div className="text-[13px] text-muted">{d.expiringCount} {d.expiringCount === 1 ? "batch" : "batches"} at risk. Sell these first or return them to the supplier.</div></div> : null}
          {d.lowCount ? <div className="flex flex-col gap-0.5"><div className="font-medium text-[14px]">{d.lowCount} {d.lowCount === 1 ? "medicine is" : "medicines are"} at or below the reorder level</div><div className="text-[13px] text-muted">Order before they run out.</div></div> : null}
          {d.receivables.paise ? <div className="flex flex-col gap-0.5"><div className="font-medium text-[14px]">{inr(d.receivables.paise)} to collect from customers</div><div className="text-[13px] text-muted">Send reminders from Customers.</div></div> : null}
          {!d.expiringCount && !d.lowCount && !d.receivables.paise ? <div className="text-[13px] text-muted">Nothing needs attention right now.</div> : null}
        </div>
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><PackageMinus size={16} className="text-teal" />Low stock</div><button onClick={() => go("stock")} className="text-[13px] text-teal font-medium cursor-pointer">View all</button></div>
          {d.lowStock.length ? <ul className="flex flex-col text-[13.5px]">{d.lowStock.map((m) => <li key={m.id} className="flex justify-between py-1.5 border-b border-row last:border-0"><span>{m.name}</span><span className="text-bad tabular-nums">{m.stock} left</span></li>)}</ul> : <div className="text-[13px] text-faint">Nothing is low.</div>}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><Hourglass size={16} className="text-teal" />Expiring within 90 days</div><button onClick={() => go("reports")} className="text-[13px] text-teal font-medium cursor-pointer">View all</button></div>
          {d.expiring.length ? <ul className="flex flex-col text-[13.5px]">{d.expiring.map((e) => <li key={e.name + e.batchNo} className="flex justify-between gap-3 py-1.5 border-b border-row last:border-0"><span className="min-w-0 truncate">{e.name} <span className="text-faint">· {e.batchNo}</span></span><span className={`tabular-nums whitespace-nowrap ${e.expired ? "text-bad" : "text-amber-700"}`}>{e.expired ? "Expired" : dm(e.expiryDate)}</span></li>)}</ul> : <div className="text-[13px] text-faint">Nothing expires in the next 90 days.</div>}
        </div>
      </div>
    </div>
  );
}
