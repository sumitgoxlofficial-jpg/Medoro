import Link from "next/link";
import { requireGrowth } from "@/staff/growth/access";
import { dashboard, trends } from "@/staff/growth/analytics";
import { rupees } from "@/staff/growth/constants";
import { distributionOverview } from "@/staff/growth/distribution";
import { Kpi, Panel } from "../../ui";
import { Funnel, HBar, Trend } from "../charts";

export default async function Overview() {
  const a = await requireGrowth("analytics.view");
  const [d, t, dist] = await Promise.all([dashboard(a), trends(a), a.perms.includes("assign") ? distributionOverview(a) : null]);
  const k = d.kpi;
  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1100px]:grid-cols-4">
        <Kpi l="Pharmacy leads" v={k.total.toLocaleString("en-IN")} d={`${k.newLeads} new in the last 30 days`} />
        <Kpi l="Verified leads" v={k.verified.toLocaleString("en-IN")} d={`${k.assigned.toLocaleString("en-IN")} assigned · ${dist?.unassigned ?? "—"} waiting`} />
        <Kpi l="Calls reported (30 days)" v={k.reported.toLocaleString("en-IN")} d={`${k.connected} connected · ${k.launches} dialer opens`} />
        <Kpi l="Converted (30 days)" v={String(k.conversions)} d={`${rupees(k.revenuePaise)} · ${k.demos} demos · ${k.trials} trials`} c="#18794E" />
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Panel title="Calling funnel" sub="Last 30 days. A dialer open is not a call; calls are employees’ reports.">
          <Funnel steps={d.callingFunnel} />
        </Panel>
        <Panel title="Lead acquisition" sub="New leads per week, last 12 weeks">
          <Trend data={t.weeklyLeads} x="week" y="n" label="New leads" />
        </Panel>
        <Panel title="Leads by state" right={<Link className="text-[12.5px] text-teal font-semibold" href="/staff/growth/analytics">Analytics →</Link>}>
          <HBar data={d.byState} />
        </Panel>
        <Panel title="Sales pipeline" sub="Current stage of every lead">
          <HBar data={d.salesFunnel.filter((s) => s.n)} />
        </Panel>
      </div>
      {dist?.inactive.length ? (
        <Panel title="Leads held by inactive employees" sub="Reassign them in Lead distribution">
          <ul className="p-4 text-[13.5px] list-disc pl-8">{dist.inactive.map((x) => <li key={x.staffId}>{x.name}: {x.leads} active leads</li>)}</ul>
        </Panel>
      ) : null}
    </>
  );
}
