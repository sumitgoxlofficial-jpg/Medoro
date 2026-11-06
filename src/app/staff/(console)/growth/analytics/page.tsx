import Link from "next/link";
import { requireGrowth } from "@/staff/growth/access";
import { dashboard, employeePerformance, trends } from "@/staff/growth/analytics";
import { INDIAN_STATES, rupees } from "@/staff/growth/constants";
import { Kpi, Panel, btn, btnPrimary, fieldCls, lbl, td, th } from "../../ui";
import { Funnel, HBar, Trend, VBar } from "../charts";

export default async function Analytics({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; state?: string }> }) {
  const a = await requireGrowth("analytics.view");
  const sp = await searchParams;
  const range = { from: sp.from || undefined, to: sp.to || undefined };
  const [d, t, p] = await Promise.all([dashboard(a, range), trends(a, { state: sp.state || undefined }), employeePerformance(a, range)]);
  const k = d.kpi;
  return (
    <>
      <Panel title="Analytics" sub="Counted from database records. Calls are employees’ reports; dialer opens are shown separately.">
        <form method="get" className="flex gap-2.5 p-4 flex-wrap items-end">
          <label className={lbl}>From<input type="date" name="from" defaultValue={sp.from} className={fieldCls} /></label>
          <label className={lbl}>To<input type="date" name="to" defaultValue={sp.to} className={fieldCls} /></label>
          <label className={lbl}>Districts of<select name="state" defaultValue={sp.state ?? ""} className={fieldCls}><option value="">Choose state</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <button className={btnPrimary}>Apply</button><Link className={btn} href="/staff/growth/analytics">Last 30 days</Link>
        </form>
      </Panel>
      <div className="grid gap-3 grid-cols-2 min-[900px]:grid-cols-3 min-[1300px]:grid-cols-6">
        <Kpi l="Total leads" v={k.total.toLocaleString("en-IN")} d={`${k.newLeads} new in range`} />
        <Kpi l="Verified" v={k.verified.toLocaleString("en-IN")} d={`${k.assigned.toLocaleString("en-IN")} assigned`} />
        <Kpi l="Calls reported" v={k.reported.toLocaleString("en-IN")} d={`${k.launches} dialer opens`} />
        <Kpi l="Interested" v={String(k.interested)} d={`${k.connected} connected`} />
        <Kpi l="Demos · trials" v={`${k.demos} · ${k.trials}`} />
        <Kpi l="Converted" v={String(k.conversions)} d={rupees(k.revenuePaise)} c="#18794E" />
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Panel title="Calling funnel"><Funnel steps={d.callingFunnel} /></Panel>
        <Panel title="Sales conversion funnel" sub="Leads by current stage"><Funnel steps={d.salesFunnel.filter((s) => !["LOST", "FOLLOW_UP_LATER", "DO_NOT_CONTACT"].includes(s.id))} /></Panel>
        <Panel title="Lead acquisition trend" sub="New leads per week"><Trend data={t.weeklyLeads} x="week" y="n" label="New leads" /></Panel>
        <Panel title="Monthly revenue (₹)" sub="From recorded conversions"><VBar data={t.monthlyRevenue} x="month" y="rupees" label="Revenue ₹" color="#18794E" /></Panel>
        <Panel title="Leads by state"><HBar data={d.byState} /></Panel>
        <Panel title={sp.state ? `Districts in ${sp.state}` : "Leads by district"} sub={sp.state ? undefined : "Choose a state above"}><HBar data={t.districts} /></Panel>
        <Panel title="Leads by source"><HBar data={d.bySource} color="#0B3A78" /></Panel>
        <Panel title="Employee comparison" sub="Reported calls in range"><HBar data={p.rows.map((r) => ({ name: r.name, n: r.reported }))} /></Panel>
      </div>
      <Panel title="Campaign performance">
        {t.campaigns.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[700px] text-[13px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Campaign</th>{["Sent", "Delivered", "Read", "Replied", "Failed", "Skipped"].map((h) => <th key={h} className={th + " text-right"}>{h}</th>)}</tr></thead>
            <tbody>{t.campaigns.map((c) => <tr key={c.name}><td className={td}>{c.name}</td>{[c.sent, c.delivered, c.read, c.replied, c.failed, c.skipped].map((n, i) => <td key={i} className={td + " text-right tnum"}>{n}</td>)}</tr>)}</tbody>
          </table></div>
        ) : <div className="px-4 py-6 text-center text-muted text-[13px]">No campaigns yet.</div>}
      </Panel>
    </>
  );
}
