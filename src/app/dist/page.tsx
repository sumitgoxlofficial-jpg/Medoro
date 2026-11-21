import Link from "next/link";
import { BadgeIndianRupee, CalendarRange, IndianRupee, PackageCheck, Wallet } from "lucide-react";
import { requireDistCtx } from "@/domain/distribution/context";
import { distDashboard } from "@/domain/distribution/reports";
import { inr, inrShort } from "@/lib/money";
import { DataTable, PageHead, Panel, Pill, Stat, STATUS_TONE } from "./_ui/ui";
import { TrendChart } from "./_ui/charts";
import { AGE_BUCKETS } from "@/domain/distribution/rules/ageing";
import { ageingTotals } from "@/domain/distribution/receivables";

export const metadata = { title: "Dashboard" };

export default async function Page() {
  const ctx = await requireDistCtx();
  const d = await distDashboard(ctx);
  const money = ctx.perms.includes("payments") || ctx.perms.includes("reports");
  const ag = ageingTotals(d.receivable.top);
  return (
    <>
      <PageHead title="Distributor dashboard" sub={`${ctx.branchName} · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}`} />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat d={0} icon={IndianRupee} label="Sales today" paise={d.today.sales} note={`${d.today.invoices} invoices`} href="/dist/invoices" />
        <Stat d={1} icon={CalendarRange} tone="blue" label="Sales this month" paise={d.month.sales} note={money ? `Gross margin ${d.month.marginPct}%` : undefined} />
        <Stat d={2} icon={BadgeIndianRupee} tone="green" label="Collected today" paise={d.today.collections} href="/dist/collections" />
        {money ? <Stat d={3} icon={Wallet} tone={d.receivable.overdue ? "amber" : "navy"} label="Receivable" paise={d.receivable.total} note={`${inrShort(d.receivable.overdue)} overdue`} href="/dist/credit" /> : <Stat d={3} icon={PackageCheck} label="Open pick lists" value={d.pipeline.openPicks} href="/dist/warehouse" />}
      </div>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3 mb-4">
        <Panel d={3} title="Sales, last 30 days" sub="Incl. GST · cancelled invoices excluded" className="lg:col-span-2"><TrendChart data={d.trend} /></Panel>
        <Panel d={4} title="Order pipeline">
          <ul className="m-0 p-0 list-none flex flex-col gap-2.5 text-[13.5px]">
            {[["Awaiting approval", d.pipeline.pending, "pending", "/dist/orders?status=pending"], ["Approved, to pick", d.pipeline.approved, "approved", "/dist/warehouse"], ["Being picked", d.pipeline.picking, "picking", "/dist/warehouse"], ["Packed, to invoice", d.pipeline.packed, "packed", "/dist/orders?status=packed"], ["Invoiced, to dispatch", d.pipeline.toDispatch, "planned", "/dist/dispatch"], ["Out for delivery", d.pipeline.out, "out", "/dist/dispatch"]].map(([l, n, s, h]) => (
              <li key={l as string} className="flex items-center gap-2">
                <Link href={h as string} className="flex-1 text-ink hover:text-teal">{l}</Link>
                <Pill tone={Number(n) ? STATUS_TONE[s as string] : "gray"}>{String(n)}</Pill>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-line-soft flex flex-col gap-1.5 text-[13px]">
            <Link href="/dist/expiry" className="flex justify-between"><span>Batches expiring in 90 days</span><Pill tone={d.alerts.nearExpiry ? "amber" : "gray"}>{String(d.alerts.nearExpiry)}</Pill></Link>
            <Link href="/dist/insights?tab=purchase" className="flex justify-between"><span>Products below reorder level</span><Pill tone={d.alerts.lowStock ? "red" : "gray"}>{String(d.alerts.lowStock)}</Pill></Link>
          </div>
        </Panel>
      </div>
      {money ? (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          <Panel title="Top outstanding" className="lg:col-span-2" pad={false} right={<Link href="/dist/credit" className="text-[12.5px]">Credit control →</Link>}>
            <DataTable cols={[{ label: "Chemist" }, { label: "Balance", num: true }, { label: "Overdue", num: true }, { label: "Oldest", num: true }, { label: "Risk" }]}
              rows={d.receivable.top.filter((r) => r.balance > 0).map((r) => [<Link key="n" href={`/dist/chemists/${r.customerId}`}>{r.name}</Link>, inr(r.balance), inr(r.overdue), `${r.oldestDays} d`, <Pill key="r" tone={STATUS_TONE[r.risk.level]}>{r.risk.level}</Pill>])} empty="No dues. Every chemist is paid up." />
          </Panel>
          <Panel title="Ageing (top accounts)">
            <ul className="m-0 p-0 list-none flex flex-col gap-2">
              {AGE_BUCKETS.map((b) => {
                const tot = Object.values(ag).reduce((a, x) => a + x, 0) || 1;
                return (
                  <li key={b}>
                    <div className="flex justify-between text-[12.5px]"><span>{b} days</span><span className="tnum">{inr(ag[b])}</span></div>
                    <div className="h-1.5 rounded bg-line-soft mt-1"><div className="h-1.5 rounded" style={{ width: `${(ag[b] / tot) * 100}%`, background: b === "0-30" ? "#0B5E5B" : b === "120+" ? "#B3261E" : "#C98A1B" }} /></div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
