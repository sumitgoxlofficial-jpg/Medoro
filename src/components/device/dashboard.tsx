"use client";
import { useEffect, useRef, useState } from "react";
import { IndianRupee, Percent, Truck, Receipt, Users, CalendarClock, Hourglass, PackageMinus, Download, CloudCheck } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/csv";
import { todayISO, weekdayLong } from "@/lib/dates";
import { useLang, useT } from "@/lib/i18n-client";
import { localeOf, type Lang } from "@/lib/tr";
import { deviceDb } from "@/drivedb/device";
import type { Dashboard as Dash, DashRange } from "@/drivedb/dashboard";
import { inr } from "@/lib/money";
import { card, errText, type Cfg } from "./ui";

const tile = "bg-white p-4 flex flex-col gap-1";
const dm = (iso: string, lang: Lang) => new Date(iso + "T00:00:00").toLocaleDateString(localeOf(lang), { day: "numeric", month: "short" });
const weekday = (lang: Lang) => (lang === "en" ? weekdayLong() : new Date(todayISO() + "T00:00:00Z").toLocaleDateString(localeOf(lang), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));

/** The owner's dashboard, from this device's own data: sales, margin, purchases, dues, the last 14 days, and stock to act on. */
export function Dashboard({ cfg, owner, refresh, go }: { cfg: Cfg; owner: boolean; refresh: number; go: (tab: "stock" | "reports" | "customers" | "accounts") => void }) {
  const toast = useToast();
  const t = useT();
  const lang = useLang();
  const dev = useRef(deviceDb()).current;
  const [range, setRange] = useState<DashRange>("today");
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drive, setDrive] = useState<{ lastSnapshot: string | null; pending: number } | null>(null);
  useEffect(() => { dev.call("driveStatus").then((x) => setDrive({ lastSnapshot: x.lastSnapshot ?? null, pending: x.pending }), () => setDrive(null)); }, [dev, refresh]);
  useEffect(() => { dev.call("dashboard", cfg.branchId, range).then((x) => { setD(x); setErr(null); }, (e) => setErr(errText(e))); }, [dev, cfg.branchId, range, refresh]);
  const head = (
    <PageHead title="Dashboard" sub={`${weekday(lang)} · ${cfg.branchName}`} right={
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
        }}><Download size={15} />{t("Export")}</Button> : null}
      </div>
    } />
  );
  if (err) return <>{head}<div className={card}><div className="text-sm text-bad">{err}</div></div></>;
  if (!d) return <>{head}<div className={card}><div className="text-sm text-muted">{t("Loading the dashboard…")}</div></div></>;

  const max = Math.max(1, ...d.chart.map((c) => c.salesPaise));
  const pts = d.margin.pct !== null && d.margin.prevPct !== null ? Math.round((d.margin.pct - d.margin.prevPct) * 1000) / 10 : null;
  const coll = [["Cash", d.collections.cash, "bg-teal"], ["UPI", d.collections.upi, "bg-blue-600"], ["Card", d.collections.card, "bg-teal/50"], ["Credit", d.collections.credit, "bg-amber-500"]] as const;
  const collTotal = coll.reduce((a, c) => a + c[1], 0);
  const Tile = ({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: string; sub: React.ReactNode; onClick?: () => void }) => (
    <div className={`${tile} ${onClick ? "cursor-pointer hover:bg-page" : ""}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-[13px] text-muted">{icon}{t(label)}</div>
      <div className="text-[24px] font-semibold tabular-nums">{value}</div>
      <div className="text-[12.5px] text-faint">{sub}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4 max-w-[1400px]" data-testid="device-dashboard">
      {head}
      <div className="grid gap-px bg-line border border-line rounded-xl overflow-hidden grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Tile icon={<IndianRupee size={15} className="text-teal" />} label={range === "today" ? "Sales today" : "Sales"} value={inr(d.sales.paise)} sub={t(d.sales.bills === 1 ? "{n} bill" : "{n} bills", { n: d.sales.bills })} />
        {owner && <Tile icon={<Percent size={15} className="text-teal" />} label="Gross margin" value={d.margin.pct === null ? "—" : `${(d.margin.pct * 100).toFixed(1)}%`} sub={pts === null ? t("Before GST, after returns") : <span className={pts >= 0 ? "text-ok" : "text-bad"}>{t("{pts} pts vs the 7 days before", { pts: `${pts >= 0 ? "+" : ""}${pts}` })}</span>} />}
        <Tile icon={<Truck size={15} className="text-teal" />} label="Purchases" value={inr(d.purchases.paise)} sub={t(d.purchases.count === 1 ? "{n} supplier bill" : "{n} supplier bills", { n: d.purchases.count })} />
        {owner && <Tile icon={<Receipt size={15} className="text-teal" />} label="Expenses" value={inr(d.expenses.paise)} sub={t(d.expenses.count === 1 ? "{n} entry" : "{n} entries", { n: d.expenses.count })} onClick={() => go("accounts")} />}
        <Tile icon={<Users size={15} className="text-teal" />} label="Receivables" value={inr(d.receivables.paise)} sub={t(d.receivables.customers === 1 ? "{n} customer on credit" : "{n} customers on credit", { n: d.receivables.customers })} onClick={() => go("customers")} />
        {owner && <Tile icon={<CalendarClock size={15} className="text-teal" />} label="Payables" value={inr(d.payables.paise)} sub={t(d.payables.suppliers === 1 ? "{n} supplier" : "{n} suppliers", { n: d.payables.suppliers })} onClick={() => go("accounts")} />}
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold">{t("Sales, last 14 days")}</div><div className="text-[12px] text-faint">{t("Incl. GST")}</div></div>
          <div className="flex items-end gap-1.5 h-40" aria-label={t("Sales by day")}>
            {d.chart.map((c) => (
              <div key={c.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${dm(c.date, lang)}: ${inr(c.salesPaise)}`}>
                <div className="w-full bg-teal/30 rounded-t" style={{ height: `${Math.max(2, (c.salesPaise / max) * 100)}%` }} />
                <div className="text-[10.5px] text-faint tabular-nums">{c.date.slice(8)}</div>
              </div>
            ))}
          </div>
          <div className="text-[12.5px] text-muted">{t("Collections today")}</div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-line-soft">{collTotal ? coll.map(([k, v, cls]) => v ? <div key={k} className={cls} style={{ width: `${(v / collTotal) * 100}%` }} /> : null) : null}</div>
          <div className="flex gap-4 flex-wrap text-[12.5px]">{coll.map(([k, v, cls]) => <span key={k} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${cls}`} />{t(k)} <b className="tabular-nums">{inr(v)}</b></span>)}</div>
        </div>
        <div className={card}>
          <div className="font-semibold">{t("Insights")}</div>
          {d.negativeCount ? (
            <button onClick={() => go("stock")} className="flex flex-col gap-0.5 text-left cursor-pointer" aria-label={t("Stock below zero: count these batches")}>
              <div className="font-medium text-[14px] text-bad">{t(d.negativeCount === 1 ? "{n} batch shows stock below zero" : "{n} batches show stock below zero", { n: d.negativeCount })}</div>
              <div className="text-[13px] text-muted">{t("Two counters sold the same stock while one was offline ({names}). Count the shelf under Stock to correct it.", { names: d.negative.slice(0, 3).map((b) => b.name).join(", ") + (d.negativeCount > 3 ? "…" : "") })}</div>
            </button>
          ) : null}
          {d.expiringCount ? <div className="flex flex-col gap-0.5"><div className="font-medium text-[14px]">{t("{amount} of stock expires within 90 days", { amount: inr(d.expiringValuePaise) })}</div><div className="text-[13px] text-muted">{t(d.expiringCount === 1 ? "{n} batch at risk. Sell these first or return them to the supplier." : "{n} batches at risk. Sell these first or return them to the supplier.", { n: d.expiringCount })}</div></div> : null}
          {d.lowCount ? <div className="flex flex-col gap-0.5"><div className="font-medium text-[14px]">{t(d.lowCount === 1 ? "{n} medicine is at or below the reorder level" : "{n} medicines are at or below the reorder level", { n: d.lowCount })}</div><div className="text-[13px] text-muted">{t("Order before they run out.")}</div></div> : null}
          {d.receivables.paise ? <div className="flex flex-col gap-0.5"><div className="font-medium text-[14px]">{t("{amount} to collect from customers", { amount: inr(d.receivables.paise) })}</div><div className="text-[13px] text-muted">{t("Send reminders from Customers.")}</div></div> : null}
          {!d.negativeCount && !d.expiringCount && !d.lowCount && !d.receivables.paise ? <div className="text-[13px] text-muted">{t("Nothing needs attention right now.")}</div> : null}
        </div>
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><PackageMinus size={16} className="text-teal" />{t("Low stock")}</div><button onClick={() => go("stock")} className="text-[13px] text-teal font-medium cursor-pointer">{t("View all")}</button></div>
          {d.lowStock.length ? <ul className="flex flex-col gap-3">{d.lowStock.map((m) => (
            <li key={m.id} className="flex flex-col gap-1">
              <div className="flex justify-between text-[14px]"><span className="font-medium">{m.name}</span><span className="text-muted tabular-nums">{m.stock} / {m.reorder}</span></div>
              <div className="h-1.5 rounded-full bg-line-soft overflow-hidden"><div className="h-full bg-amber-600" style={{ width: `${Math.min(100, Math.max(3, (m.stock / Math.max(1, m.reorder)) * 100))}%` }} /></div>
              <div className="text-[12.5px] text-amber-700">{m.daysCover === null ? t("No sales in 28 days") : t(m.daysCover === 1 ? "{n} day cover" : "{n} days cover", { n: m.daysCover })}</div>
            </li>
          ))}</ul> : <div className="text-[13px] text-faint">{t("Nothing is low.")}</div>}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><Hourglass size={16} className="text-teal" />{t("Expiring within 90 days")}</div><button onClick={() => go("reports")} className="text-[13px] text-teal font-medium cursor-pointer">{t("Prevent loss")}</button></div>
          {d.expiring.length ? <ul className="flex flex-col">{d.expiring.map((e) => (
            <li key={e.name + e.batchNo} className="flex items-center justify-between gap-3 py-2 border-b border-row last:border-0">
              <div className="min-w-0"><div className="text-[14px] font-medium truncate">{e.name}</div><div className="text-[12.5px] text-muted">{e.batchNo} · {t("{n} units", { n: e.qty })}</div></div>
              <div className="flex items-center gap-2 whitespace-nowrap"><span className="text-[13.5px] tabular-nums">{inr(e.valuePaise)}</span>
                <span className={`text-[12px] font-semibold rounded-full px-2 py-0.5 ${e.expired ? "bg-bad-bg text-bad" : e.daysLeft <= 30 ? "bg-bad-bg text-bad" : e.daysLeft <= 60 ? "bg-amber-50 text-amber-700" : "bg-chip text-muted"}`}>{e.expired ? t("Expired") : t("{n} days", { n: e.daysLeft })}</span></div>
            </li>
          ))}</ul> : <div className="text-[13px] text-faint">{t("Nothing expires in the next 90 days.")}</div>}
        </div>
        <div className={card}>
          <div className="font-semibold">{t("Branch performance")}</div>
          {d.branches.length ? <ul className="flex flex-col gap-3">{(() => { const top = Math.max(1, ...d.branches.map((b) => b.salesPaise)); return d.branches.map((b) => (
            <li key={b.id} className="flex flex-col gap-1">
              <div className="flex justify-between text-[14px]"><span className="font-medium">{b.name}</span><span className="tabular-nums"><b>{inr(b.salesPaise)}</b> <span className="text-muted">· {t(b.bills === 1 ? "{n} bill" : "{n} bills", { n: b.bills })}</span></span></div>
              <div className="h-1.5 rounded-full bg-line-soft overflow-hidden"><div className="h-full bg-blue-700" style={{ width: `${Math.max(3, (b.salesPaise / top) * 100)}%` }} /></div>
            </li>
          )); })()}</ul> : <div className="text-[13px] text-faint">{t("No bills in this period yet.")}</div>}
          <div className="mt-auto border-t border-line pt-3 flex items-center gap-3">
            <CloudCheck size={20} className={drive?.lastSnapshot ? "text-ok" : "text-faint"} />
            <div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold">{t("Last full copy in Google Drive")}</div><div className="text-[12.5px] text-muted">{drive?.lastSnapshot ? `${new Date(drive.lastSnapshot).toLocaleString(localeOf(lang), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} · ${drive.pending ? t("{n} changes waiting", { n: drive.pending }) : t("up to date")}` : t("Not saved to Drive yet")}</div></div>
            <a href="/app/backup" className="border border-line rounded-lg px-3 h-8 inline-flex items-center text-[13px] text-ink no-underline hover:border-teal">{t("Open", { ctx: "verb" })}</a>
          </div>
        </div>
      </div>
      <div className={card}>
        <div className="font-semibold">{t("Recent activity")}</div>
        {d.activity.length ? <ul className="flex flex-col">{d.activity.map((r, i) => (
          <li key={i} className="flex items-baseline gap-4 py-2 border-b border-row last:border-0 text-[13.5px]">
            <span className="text-muted w-24 flex-none tabular-nums">{new Date(r.at).toLocaleString(localeOf(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
            <span className="flex-1 min-w-0 truncate">{t(r.what)}{r.amountPaise != null ? <span className="text-muted"> · {inr(Math.abs(r.amountPaise))}</span> : null}</span>
            <span className="text-muted whitespace-nowrap">{t(r.who)}</span>
          </li>
        ))}</ul> : <div className="text-[13px] text-faint">{t("Nothing yet.")}</div>}
      </div>
    </div>
  );
}
