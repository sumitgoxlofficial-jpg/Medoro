import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { customerIntel } from "@/domain/sales/customer-intel";
import { SEGMENT_HELP } from "@/domain/sales/customer-segments";
import { PageHead } from "@/components/page-head";

export const metadata = { title: "Customer intelligence" };
const rs = (p: number | null) => (p == null ? "–" : `₹${Math.round(p / 100).toLocaleString("en-IN")}`);
const card = "bg-white border border-line rounded-xl p-4";
const LABEL: Record<string, string> = { new: "New", loyal: "Loyal", regular: "Regular", occasional: "Occasional", at_risk: "At risk", lapsed: "Lapsed" };

export default async function Page({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const q = (await searchParams).branch;
  const branch = q && ctx.branches.some((b) => b.id === q) ? q : null;
  const d = await customerIntel(ctx, branch);
  return (
    <>
      <PageHead icon={Users} title="Customer intelligence" sub={`From real bills, with voids removed and returns netted off · ${d.scope.branchName}`} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        {ctx.branches.length > 1 ? (
          <nav aria-label="Branch" className="flex gap-2 flex-wrap text-[13px]">
            <Link href="/app/intelligence/customers" className={`rounded-lg border px-3 py-1 ${!branch ? "bg-slate-900 text-white" : "border-line"}`}>All my branches</Link>
            {ctx.branches.map((b) => <Link key={b.id} href={`/app/intelligence/customers?branch=${b.id}`} className={`rounded-lg border px-3 py-1 ${branch === b.id ? "bg-slate-900 text-white" : "border-line"}`}>{b.name}</Link>)}
          </nav>
        ) : null}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="cust-totals">
          {[["Customers with bills", String(d.totals.customers)], ["Bought in last 90 days", String(d.totals.activeLast90)], ["Repeat customers", d.totals.repeatPct == null ? "–" : `${d.totals.repeatPct}%`], ["Average basket", rs(d.totals.avgBasketPaise)]].map(([k, v]) => (
            <div key={k} className={card}><div className="text-[12px] text-slate-500">{k}</div><div className="text-[22px] font-semibold">{v}</div></div>
          ))}
        </section>

        <section className={card} data-testid="cust-segments">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Segments</h2>
          <ul className="m-0 p-0 list-none grid gap-1 text-[13px]">
            {d.segments.map((s) => <li key={s.segment}><strong>{LABEL[s.segment]}:</strong> {s.count} customers · {rs(s.netPaise)} lifetime spend <span className="text-slate-500">— {SEGMENT_HELP[s.segment]}</span></li>)}
          </ul>
        </section>

        <section className={card} data-testid="cust-retention">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Monthly spending and retention</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Retention = of last month’s buyers, the share who bought again this month. A month with no buyers last month has no rate.</p>
          <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse">
            <thead><tr className="text-left text-slate-500 border-b border-line"><th className="py-1 pr-3">Month</th><th className="pr-3">Buyers</th><th className="pr-3">Spend</th><th className="pr-3">Per buyer</th><th>Retention</th></tr></thead>
            <tbody>{d.monthly.map((m, i) => { const r = d.retention[i]; return (
              <tr key={m.month} className="border-b border-line/60"><td className="py-1 pr-3">{m.month}</td><td className="pr-3">{m.customers}</td><td className="pr-3">{rs(m.spendPaise)}</td><td className="pr-3">{rs(m.avgSpendPaise)}</td><td>{r.rate == null ? "–" : `${r.rate}% (${r.kept}/${r.base})`}</td></tr>
            ); })}</tbody></table></div>
        </section>

        <section className={card} data-testid="cust-lapsed">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Lapsed customers</h2>
          {d.lapsed.length ? <ul className="m-0 p-0 list-none grid gap-1 text-[13px]">{d.lapsed.map((c) => <li key={c.id}><strong>{c.name}</strong> {c.phone ? `· ${c.phone}` : ""} · last bought {c.lastDay} ({c.recencyDays} days ago){c.usualGapDays ? `, usually every ${c.usualGapDays} days` : ""} · lifetime {rs(c.netPaise)} · {c.marketingConsent ? "agreed to offers" : "no marketing consent: call or visit only"}</li>)}</ul> : <p className="m-0 text-[13px] text-slate-500">No lapsed customers.</p>}
        </section>

        <section className={card} data-testid="cust-top">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Top customers and 12-month value estimate</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">The estimate projects the customer’s current spending pace over 12 months. It is shown only with 3+ visit days over 90+ days of history, and is a projection, not a forecast guarantee.</p>
          <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse">
            <thead><tr className="text-left text-slate-500 border-b border-line"><th className="py-1 pr-3">Customer</th><th className="pr-3">Segment</th><th className="pr-3">Visits (12 m)</th><th className="pr-3">Avg basket</th><th className="pr-3">Lifetime</th><th>12-month estimate</th></tr></thead>
            <tbody>{d.top.map((c) => <tr key={c.id} className="border-b border-line/60"><td className="py-1 pr-3 font-medium">{c.name}</td><td className="pr-3">{LABEL[c.segment]}</td><td className="pr-3">{c.visits12m}</td><td className="pr-3">{rs(c.avgBasketPaise)}</td><td className="pr-3">{rs(c.netPaise)}</td><td>{c.value12mPaise == null ? "not enough history" : rs(c.value12mPaise)}</td></tr>)}</tbody></table></div>
        </section>

        <section className={card} data-testid="cust-refills">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Refill recommendations</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">From each customer’s own purchase gaps for a medicine (two or more purchases, gap of 5+ days), due within a week. Only customers marked “can message” have agreed to reminders; for the others, call or speak to them at the counter. Nothing is sent from this screen.</p>
          {d.refills.length ? <ul className="m-0 p-0 list-none grid gap-1 text-[13px]">{d.refills.map((r) => <li key={r.customerId + r.medicine}><strong>{r.customer}</strong> {r.phone ? `· ${r.phone}` : ""} · {r.medicine} · every ~{r.interval} days, due {r.due} ({r.inDays <= 0 ? `${-r.inDays} days overdue` : `in ${r.inDays} days`}) · {r.canMessage ? "can message" : "no message consent"}</li>)}</ul> : <p className="m-0 text-[13px] text-slate-500">Nothing due this week.</p>}
        </section>

        <section className={card} data-testid="cust-campaigns">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Campaign performance</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-500">Delivery counts come from the message log. “Buyers” had a bill within 14 days after their message: an association, not proof the message caused it. Campaigns still go only to customers who agreed to offers (set up under CRM).</p>
          {d.campaigns.length ? <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse">
            <thead><tr className="text-left text-slate-500 border-b border-line"><th className="py-1 pr-3">Campaign</th><th className="pr-3">Status</th><th className="pr-3">Messages</th><th className="pr-3">Delivered</th><th className="pr-3">Read</th><th className="pr-3">Failed</th><th className="pr-3">Buyers in 14 d</th><th>Their spend</th></tr></thead>
            <tbody>{d.campaigns.map((c) => <tr key={c.id} className="border-b border-line/60"><td className="py-1 pr-3 font-medium">{c.name}</td><td className="pr-3">{c.status}</td><td className="pr-3">{c.sent}</td><td className="pr-3">{c.delivered}</td><td className="pr-3">{c.read}</td><td className="pr-3">{c.failed}</td><td className="pr-3">{c.buyers}</td><td>{rs(c.revenuePaise)}</td></tr>)}</tbody></table></div> : <p className="m-0 text-[13px] text-slate-500">No campaigns yet.</p>}
        </section>
      </div>
    </>
  );
}
