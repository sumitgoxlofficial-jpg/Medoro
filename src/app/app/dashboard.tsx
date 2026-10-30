"use client";
import Link from "next/link";
import { askAi } from "@/components/shell/ai-drawer";
import { useRouter } from "next/navigation";
import {
  IndianRupee, Percent, Truck, Receipt, Users, CalendarClock, TrendingUp, TrendingDown, Sparkles, CloudCheck, CloudOff, Download, PackagePlus, CheckCircle2, Circle,
} from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/csv";
import { inr0 } from "@/lib/money";
import { READY, type ScreenId } from "@/lib/nav";
import type { Dict } from "@/lib/i18n";
import type { DashboardData, Range } from "@/domain/reports/dashboard";
import { dashboardAccess } from "@/domain/reports/dashboard-access";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] px-[18px] py-4 flex flex-col";
const rangeLabel = { today: "today", "7d": "last 7 days", "30d": "last 30 days" };

function Go({ screen, href, children, className }: { screen: ScreenId; href: string; children: React.ReactNode; className?: string }) {
  if (href.startsWith("#ai:")) return <button onClick={() => askAi(href.slice(4))} className={(className ?? "text-teal text-[13px] font-semibold") + " cursor-pointer"}>{children}</button>;
  return READY.has(screen) ? <Link href={href} className={className ?? "text-teal text-[13px] font-semibold hover:text-teal-hover"}>{children}</Link> : null;
}

export function DashActions({ range, data, branch, canExport }: { range: Range; data: DashboardData; branch: string; canExport: boolean }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="flex gap-2 items-center">
      <div className="inline-flex gap-px bg-white border border-line p-0.5 rounded-lg">
        <Segmented value={range} onChange={(v) => router.push(v === "today" ? "/app" : `/app?range=${v}`)} className="bg-transparent p-0"
          options={[{ value: "today", label: "Today" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }]} />
      </div>
      {canExport ? <Button onClick={() => {
        const k = data.kpi;
        downloadCsv(`dashboard-${branch.toLowerCase()}-${range}`, [
          ["Metric", "Value"], ["Period", rangeLabel[range]], ["Bills", k.bills], ["Net sales (₹)", k.sales / 100],
          ["Cash (₹)", data.pay.cash / 100], ["UPI (₹)", data.pay.upi / 100], ["Card (₹)", data.pay.card / 100], ["Credit (₹)", data.pay.credit / 100],
          ["Gross margin %", k.margin?.toFixed(1) ?? ""], ["Purchases (₹)", k.purchases / 100], ["Expenses (₹)", k.expenses / 100],
          ["Receivables (₹)", k.receivable / 100], ["Payables (₹)", k.payable / 100],
        ]);
        toast("CSV exported (generated on this device)", "green");
      }}><Download size={15} />Export</Button> : null}
    </div>
  );
}

export function Dashboard({ data, dict: t, perms }: { data: DashboardData; dict: Dict; perms: string[] }) {
  const k = data.kpi;
  const delta = (v: number, suffix: string, goodUp: boolean) => {
    const up = v >= 0, good = goodUp ? up : !up;
    return { text: (up ? "+" : "") + v.toFixed(1) + suffix, Icon: up ? TrendingUp : TrendingDown, bg: good ? "#E7F6EE" : "#FDECEC", fg: good ? "#18794E" : "#C0362C" };
  };
  const salesDelta = k.salesPrev > 0 ? delta(((k.sales - k.salesPrev) / k.salesPrev) * 100, "%", true) : null;
  const marginDelta = k.margin != null && k.margin7 != null ? delta(k.margin - k.margin7, " pts", true) : null;
  const { fin, pay, activity: showActivity } = dashboardAccess(perms);
  const kpis = [
    { label: data.range === "today" ? t.sales : `Sales, ${rangeLabel[data.range]}`, value: inr0(k.sales), Icon: IndianRupee, ibg: "#E1F1EF", ifg: "#0B5E5B", d: salesDelta, sub: `${salesDelta ? "vs previous · " : ""}${k.bills} bill${k.bills === 1 ? "" : "s"}` },
    { label: t.margin, value: k.margin == null ? "—" : k.margin.toFixed(1) + "%", Icon: Percent, ibg: "#EAF0FC", ifg: "#2459C9", d: marginDelta, sub: marginDelta ? "vs 7-day average" : "No sales yet" },
    { label: t.purch, value: inr0(k.purchases), Icon: Truck, ibg: "#F1EEFB", ifg: "#5B45B0", d: null, sub: `${k.grnCount} GRN${k.grnCount === 1 ? "" : "s"} posted` },
    { label: t.expn, value: inr0(k.expenses), Icon: Receipt, ibg: "#F2F4F5", ifg: "#4B535B", d: null, sub: `${k.expenseCount} payment voucher${k.expenseCount === 1 ? "" : "s"}` },
    { label: t.cdue, value: inr0(k.receivable), Icon: Users, ibg: "#FDF2E1", ifg: "#94570A", d: null, sub: `${k.onCredit} customer${k.onCredit === 1 ? "" : "s"} on credit` },
    { label: t.sdue, value: inr0(k.payable), Icon: CalendarClock, ibg: "#FDECEC", ifg: "#C0362C", d: null, sub: `${inr0(k.dueWeek)} due in 7 days`, subRed: k.dueWeek > 0 },
  ].filter((x) => x.label === t.cdue ? pay : x.Icon === IndianRupee || fin);
  const mx = Math.max(1, ...data.history.map((h) => h.total));
  const payTotal = data.pay.cash + data.pay.upi + data.pay.card + data.pay.credit;
  const pays = ([["Cash", data.pay.cash, "#0B5E5B"], ["UPI", data.pay.upi, "#2459C9"], ["Card", data.pay.card, "#7FB8B1"], ["Credit", data.pay.credit, "#C9A227"]] as const).filter((x) => x[1] > 0);
  const bm = Math.max(1, ...data.branchPerf.map((b) => b.total));

  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      {data.catalogueSize === 0 ? <GettingStarted perms={perms} /> : null}

      <div className={"grid bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden " + (kpis.length > 2 ? "grid-cols-2 md:grid-cols-3 2xl:grid-cols-6" : "grid-cols-1 sm:grid-cols-2 max-w-[640px]")}>
        {kpis.map((x) => (
          <div key={x.label} className="px-[18px] pt-4 pb-[15px] flex flex-col gap-2.5 border-r border-b border-line-soft -mr-px -mb-px min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-[26px] rounded-[7px] flex items-center justify-center flex-none" style={{ background: x.ibg, color: x.ifg }}><x.Icon size={14} /></span>
              <span className="flex-1 min-w-0 text-[12.5px] text-muted font-medium leading-tight">{x.label}</span>
            </div>
            <div className="text-[24px] font-semibold tracking-[-.02em] leading-[1.1] tnum text-ink-strong">{x.value}</div>
            <div className="flex items-center gap-1.5 min-h-5 flex-wrap">
              {x.d ? <span className="inline-flex items-center gap-[3px] h-5 px-1.5 rounded-[5px] text-[11.5px] font-semibold tnum" style={{ background: x.d.bg, color: x.d.fg }}><x.d.Icon size={12} />{x.d.text}</span> : null}
              <span className="text-[12px] truncate" style={{ color: x.subRed ? "#C0362C" : "#6B737B" }}>{x.sub}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))]">
        <div className={card + " gap-3.5"}>
          <div className="flex justify-between items-baseline gap-2"><div className="font-semibold text-[15px]">Sales, last 14 days</div><div className="text-[12.5px] text-faint whitespace-nowrap">Incl. GST</div></div>
          <div className="flex items-end gap-1.5 h-[170px]">
            {data.history.map((h, i) => (
              <div key={h.date} title={`${h.date} · ${inr0(h.total)}`} className="flex-1 flex flex-col items-center gap-1 justify-end h-full">
                <div className="text-[11px] font-semibold text-teal whitespace-nowrap">{i === 13 && h.total ? inr0(h.total) : ""}</div>
                <div className="w-full max-w-7 rounded-t" style={{ height: Math.max(h.total ? 4 : 2, Math.round((h.total / mx) * 140)), background: i === 13 ? "#0B5E5B" : h.total ? "#B5D9D4" : "#EEF0F2" }} />
                <div className="text-[11px] text-fainter">{Number(h.date.slice(8))}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[12.5px] text-muted font-medium">{t.coll} {rangeLabel[data.range]}</div>
            {payTotal ? (
              <>
                <div className="flex h-2.5 rounded-[5px] overflow-hidden gap-0.5">{pays.map((p) => <div key={p[0]} style={{ width: (p[1] / payTotal) * 100 + "%", background: p[2] }} />)}</div>
                <div className="flex flex-wrap gap-4">{pays.map((p) => <div key={p[0]} className="flex items-center gap-1.5 text-[13px]"><span className="size-[9px] rounded-sm" style={{ background: p[2] }} />{p[0]} <strong className="tnum">{inr0(p[1])}</strong></div>)}</div>
              </>
            ) : <div className="text-[13px] text-fainter">No collections yet.</div>}
          </div>
        </div>
        <div className={card + " gap-3"}>
          <div className="flex items-center gap-2"><Sparkles size={16} className="text-teal" /><div className="font-semibold text-[15px]">{t.insights}</div><div className="ml-auto text-[12px] text-muted">Computed on your server</div></div>
          {data.insights.length ? data.insights.map((ins) => (
            <div key={ins.title} className="flex flex-col gap-1 py-3 border-t border-line-soft">
              <div className="font-semibold text-[14px]">{ins.title}</div>
              <div className="text-[13.5px] text-ink-2">{ins.body}</div>
              <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
                <div className="text-[12px] text-faint">Basis: {ins.basis}</div>
                <Go screen={ins.href === "/app/expiry" ? "exp" : "pur"} href={ins.href} className="ml-auto text-teal font-semibold text-[13px]">{ins.cta} →</Go>
              </div>
            </div>
          )) : <div className="text-[13px] text-fainter border-t border-line-soft pt-3">Insights appear once there are sales and stock to learn from: expiry exposure, items about to run out, and price changes.</div>}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        <div className={card + " gap-2.5"}>
          <div className="flex justify-between items-center"><div className="font-semibold text-[15px]">{t.low}</div><Go screen="inv" href="/app/inventory?filter=low">View all</Go></div>
          {data.lowStock.length ? data.lowStock.slice(0, 6).map((ls) => (
            <div key={ls.id} className="flex flex-col gap-[5px] py-1.5">
              <div className="flex justify-between w-full text-[13.5px]"><span className="font-medium">{ls.name}</span><span className="tnum text-muted">{ls.stock} / {ls.reorder}</span></div>
              <div className="w-full h-[5px] bg-line-soft rounded-[3px] overflow-hidden"><div className="h-full bg-[#C27B12]" style={{ width: Math.round((ls.stock / ls.reorder) * 100) + "%" }} /></div>
              {ls.coverDays != null ? <div className="text-[12px] text-warn">{ls.coverDays} days cover</div> : null}
            </div>
          )) : <div className="text-[13px] text-fainter">Nothing below its reorder level.</div>}
        </div>
        <div className={card + " gap-1.5"}>
          <div className="flex justify-between items-center"><div className="font-semibold text-[15px]">{t.expiring}</div><Go screen="exp" href="/app/expiry">Prevent loss</Go></div>
          {data.expiring.length ? data.expiring.slice(0, 6).map((e) => {
            const [bg, fg] = e.days <= 30 ? ["#FBEAE8", "#B3261E"] : e.days <= 60 ? ["#FDF2E1", "#94570A"] : ["#EEF0F2", "#4B535B"];
            return (
              <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2.5 items-center py-[7px] border-b border-row">
                <div className="flex flex-col min-w-0"><span className="text-[13.5px] font-medium">{e.name}</span><span className="text-[12px] text-muted">{e.batchNo} · {e.qty} units{e.status !== "ok" ? ` · ${e.status}` : ""}</span></div>
                <span className="text-[13px] tnum">{inr0(e.value)}</span>
                <span className="px-2 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ background: bg, color: fg }}>{e.days} days</span>
              </div>
            );
          }) : <div className="text-[13px] text-fainter">No batches expire in the next 90 days.</div>}
        </div>
        <div className={card + " gap-3"}>
          <div className="font-semibold text-[15px]">{t.branchPerf}</div>
          {data.branchPerf.map((b) => (
            <div key={b.name} className="flex flex-col gap-[5px]">
              <div className="flex justify-between text-[13.5px]"><span className="font-medium">{b.name}</span><span className="tnum"><strong>{inr0(b.total)}</strong> <span className="text-muted">· {b.bills} bills</span></span></div>
              <div className="h-2 bg-line-soft rounded overflow-hidden"><div className="h-full bg-blue rounded" style={{ width: Math.round((b.total / bm) * 100) + "%" }} /></div>
            </div>
          ))}
          <div className="mt-auto pt-3 border-t border-line-soft flex items-center gap-2.5">
            {data.backup.last ? <CloudCheck size={20} className="text-ok" /> : <CloudOff size={20} className="text-warn" />}
            <div className="flex flex-col flex-1"><span className="text-[13px] font-semibold">Last verified backup</span><span className="text-[12.5px] text-muted">{data.backup.last ?? "None yet"} · {data.backup.driveConnected ? "Google Drive connected" : "Drive not connected"}</span>{data.backup.problems.map((x) => <span key={x} role="alert" className="text-[12.5px] text-bad">{x}</span>)}</div>
            <Go screen="bak" href="/app/backup" className="border border-input bg-white rounded-[7px] px-2.5 py-1.5 text-[12.5px] text-ink">Open</Go>
          </div>
        </div>
      </div>

      {showActivity ? <div className={card + " gap-1"}>
        <div className="font-semibold text-[15px] mb-1.5">{t.activity}</div>
        {data.activity.map((a) => (
          <div key={a.id} className="grid grid-cols-[96px_minmax(0,1fr)_auto] gap-3 py-[7px] border-b border-row text-[13.5px] items-baseline max-sm:grid-cols-[72px_minmax(0,1fr)]">
            <span className="text-faint text-[12.5px] tnum">{a.when}</span>
            <span><strong className="font-semibold">{a.action}</strong>{a.detail ? <span className="text-muted"> · {a.detail}</span> : null}</span>
            <span className="text-muted text-[12.5px] whitespace-nowrap max-sm:hidden">{a.who}</span>
          </div>
        ))}
      </div> : null}
    </div>
  );
}

function GettingStarted({ perms }: { perms: string[] }) {
  const steps: { done: boolean; title: string; body: string; screen: ScreenId; href: string; perm?: string }[] = [
    { done: false, title: "Add your medicines", body: "Build the catalogue: name, generic, pack, GST rate, MRP and reorder level.", screen: "inv", href: "/app/inventory?add=1" },
    { done: false, title: "Receive opening stock", body: "Enter batches with expiry dates and cost, or scan a supplier invoice.", screen: "pur", href: "/app/purchases", perm: "purchase" },
    { done: false, title: "Make your first sale", body: "Billing picks the earliest-expiring batch automatically (FEFO).", screen: "pos", href: "/app/pos", perm: "sale" },
    { done: false, title: "Connect backups", body: "Encrypted daily backups to your own Google Drive.", screen: "bak", href: "/app/backup", perm: "integrations" },
  ];
  return (
    <div className="bg-white border border-teal-line rounded-xl px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-2"><PackagePlus size={18} className="text-teal" /><div className="font-semibold text-[15px]">Get your pharmacy running</div></div>
      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {steps.filter((s) => !s.perm || perms.includes(s.perm)).map((s) => {
          const ready = READY.has(s.screen);
          const inner = (
            <>
              <div className="flex items-center gap-2 font-semibold text-[13.5px] text-ink">{s.done ? <CheckCircle2 size={16} className="text-ok" /> : <Circle size={16} className="text-fainter" />}{s.title}</div>
              <div className="text-[12.5px] text-muted">{s.body}</div>
            </>
          );
          return ready
            ? <Link key={s.title} href={s.href} className="flex flex-col gap-1 border border-line rounded-[10px] p-3 hover:border-teal-border no-underline">{inner}</Link>
            : <div key={s.title} className="flex flex-col gap-1 border border-line rounded-[10px] p-3 opacity-70">{inner}</div>;
        })}
      </div>
    </div>
  );
}
