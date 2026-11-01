import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Bike, CloudCheck, CloudOff, Mail, Package, ScanBarcode, Truck, Wallet, Hourglass, ArrowLeftRight, RefreshCw } from "lucide-react";
import { can, requireCtx } from "@/server/context";
import { ownerSnapshot } from "@/domain/reports/owner";
import { inr0 } from "@/lib/money";
import { t } from "@/lib/i18n";
import { PageHead } from "@/components/page-head";

export const metadata = { title: "Owner view" };

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const PAY_NAME: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit", cod: "COD", split: "Split" };
const payName = (m: string) => PAY_NAME[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const s = await ownerSnapshot(ctx);
  const d = pct(s.total.today, s.total.yesterday);
  const p = s.pending;
  const allBr = s.branches.length > 1 ? " · all branches" : "";
  const approvals = [
    { n: p.newOrders, label: "new orders to confirm", href: "/app/orders" },
    { n: p.transfers, label: "stock transfers waiting", href: "/app/inventory?tab=transfers" },
    { n: p.drafts, label: "purchase order drafts", href: "/app/purchases" },
    { n: p.conflicts, label: "offline bill conflicts", href: "/app/sync" },
  ].filter((x) => x.n > 0);
  const actions = [
    { href: "/app/pos", label: "New bill", Icon: ScanBarcode, perm: "sale" },
    { href: "/app/orders", label: "Orders", Icon: Bike, perm: "sale" },
    { href: "/app/inventory?tab=transfers", label: "Transfers", Icon: ArrowLeftRight, perm: null },
    { href: "/app/purchases", label: "Purchases", Icon: Truck, perm: "purchase" },
    { href: "/app/expiry", label: "Expiry", Icon: Hourglass, perm: null },
    { href: "/app/owner/reports", label: "Email reports", Icon: Mail, perm: "reports" },
  ].filter((a) => !a.perm || can(ctx, a.perm as "sale"));

  return (
    <div className="max-w-[560px] flex flex-col gap-3 lg:max-w-[1120px] lg:grid lg:grid-cols-2 lg:items-start">
      <div className="lg:col-span-2"><PageHead title={t(ctx.lang).own} sub={`${s.day} · as of ${s.asOf} · ${ctx.branches.length} branch${ctx.branches.length > 1 ? "es" : ""}`} /></div>

      <section className={card}>
        <div className="text-[12.5px] text-faint">Net sales today</div>
        <div className="flex items-end gap-2">
          <div className="text-[30px] font-semibold tracking-[-.02em] leading-none tnum">{inr0(s.total.today)}</div>
          {d != null ? <span className={"text-[13px] font-semibold flex items-center " + (d >= 0 ? "text-ok" : "text-bad")}>{d >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{Math.abs(d)}%</span> : null}
        </div>
        <div className="text-[12.5px] text-muted">{s.total.bills} bill{s.total.bills === 1 ? "" : "s"} · yesterday by this time {inr0(s.total.yesterday)}</div>
        {Object.keys(s.pay).length ? <div className="flex gap-1.5 flex-wrap">{Object.entries(s.pay).map(([m, v]) => <span key={m} className="text-[12px] bg-chip rounded-full px-2 py-0.5">{payName(m)} {inr0(v)}</span>)}</div> : null}
        {s.branches.length > 1 ? (
          <table className="text-[13px] w-full mt-1">
            <thead><tr className="text-faint text-left"><th className="font-medium">Branch</th><th className="font-medium text-right">Today</th><th className="font-medium text-right">Yesterday</th></tr></thead>
            <tbody>{s.branches.map((b) => <tr key={b.id} className="border-t border-line-soft"><td className="py-1.5">{b.name}</td><td className="text-right tnum">{inr0(b.today)}</td><td className="text-right tnum text-faint">{inr0(b.yesterday)}</td></tr>)}</tbody>
          </table>
        ) : null}
      </section>

      <section className={card}>
        <div className="flex items-center gap-2 font-semibold"><Wallet size={16} className="text-teal" />Cash in drawers</div>
        {s.drawers.length ? s.drawers.map((x) => (
          <div key={x.id} className="flex text-[13px] gap-2"><span className="flex-1">{x.branch} · {x.counter} <span className="text-faint">· {x.by} since {x.since}</span></span><span className="tnum font-semibold">{inr0(x.cash)}</span></div>
        )) : <div className="text-[13px] text-faint">No shift is open.</div>}
        {p.codWithRiders ? <div className="text-[12.5px] text-[#94570A]">{inr0(p.codWithRiders)} cash on delivery is still with delivery staff.</div> : null}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/app/inventory" className={card + " no-underline text-ink"}><Package size={16} className="text-[#94570A]" /><div className="text-[24px] font-semibold tnum leading-none">{s.stock.low}</div><div className="text-[12.5px] text-muted">low on stock{allBr}</div></Link>
        <Link href="/app/expiry" className={card + " no-underline text-ink"}><Hourglass size={16} className="text-bad" /><div className="text-[24px] font-semibold tnum leading-none">{s.stock.expiring}</div><div className="text-[12.5px] text-muted">batches expire in 30 days{allBr}</div></Link>
      </div>

      <section className={card}>
        <div className="font-semibold">Waiting for you</div>
        {approvals.length ? approvals.map((a) => <Link key={a.label} href={a.href} className="flex text-[13.5px] gap-2 no-underline text-ink"><span className="min-w-[26px] h-[22px] rounded-full bg-[#FDF2E1] text-[#94570A] text-[12px] font-semibold flex items-center justify-center">{a.n}</span>{a.label}</Link>) : <div className="text-[13px] text-faint">Nothing to approve.</div>}
        {p.outOrders ? <div className="text-[12.5px] text-muted">{p.outOrders} order{p.outOrders > 1 ? "s" : ""} out for delivery.</div> : null}
        {p.discountApprovals ? <div className="text-[12.5px] text-muted">{p.discountApprovals} discount{p.discountApprovals > 1 ? "s" : ""} above the cashier cap approved today.</div> : null}
      </section>

      <Link href="/app/backup" className={card + " no-underline text-ink flex-row items-center"}>
        {s.backup.healthy ? <CloudCheck size={18} className="text-ok" /> : <CloudOff size={18} className="text-bad" />}
        <div className="flex-1 text-[13px]">
          <div className="font-semibold">{s.backup.healthy ? "Backups are healthy" : "Backup needs attention"}</div>
          <div className="text-muted">{s.backup.lastOk ? `Last verified ${s.backup.lastOk}` : "No verified backup yet"}{s.backup.last?.status === "failed" ? ` · last run failed${s.backup.last.error ? ": " + s.backup.last.error.slice(0, 80) : ""}` : ""}{s.backup.drive ? " · Google Drive on" : " · Drive not connected"}</div>
        </div>
      </Link>

      {s.alerts.length ? (
        <section className={card}>
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-[#94570A]" />Alerts · {ctx.branchName}</div>
          <ul className="text-[13px] list-disc pl-5">{s.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
        </section>
      ) : null}

      <section className="grid grid-cols-3 gap-2">
        {actions.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="bg-white border border-line rounded-xl p-3 flex flex-col items-center gap-1.5 text-[12.5px] font-medium no-underline text-ink-2 hover:border-input"><Icon size={18} className="text-teal" />{label}</Link>
        ))}
      </section>
      <div className="text-[11.5px] text-faint flex items-center gap-1 lg:col-span-2"><RefreshCw size={11} />Updates live while open. Install Medoro on your phone and use the “Owner view” shortcut.</div>
    </div>
  );
}
