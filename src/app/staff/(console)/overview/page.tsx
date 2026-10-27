import { requireStaff } from "@/staff/auth";
import { overview } from "@/staff/support";
import { rupees } from "@/staff/constants";
import { Kpi, Panel, Empty, th, td } from "../ui";

export default async function Overview() {
  await requireStaff(["super_admin"]);
  const o = await overview();
  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1100px]:grid-cols-4">
        <Kpi l="Active pharmacies" v={String(o.active)} d={`${o.trial} on trial · ${o.grace} in grace`} />
        <Kpi l="Sales this month (ex-GST)" v={rupees(o.monthRevenue)} d={`${o.monthCount} sale${o.monthCount === 1 ? "" : "s"} logged`} />
        <Kpi l="Commission owed" v={rupees(o.owed)} d={`${rupees(o.pendingCommission)} awaiting verification`} />
        <Kpi l="Open tickets" v={String(o.openTickets)} d={`${o.highTickets} high priority`} />
      </div>
      <Panel title="Sales team this month">
        {o.leaders.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[640px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Salesperson</th><th className={th}>Sales</th><th className={th + " text-right"}>Revenue (ex-GST)</th><th className={th + " text-right"}>Commission</th><th className={th + " text-right"}>Pending payout</th></tr></thead>
            <tbody>{o.leaders.map((r) => (
              <tr key={r.name}><td className={td}><strong className="font-semibold">{r.name}</strong>{r.team ? <span className="text-muted"> · {r.team}</span> : null}</td><td className={td}>{r.n}</td><td className={td + " text-right tnum"}>{rupees(r.revenue)}</td><td className={td + " text-right tnum font-semibold text-teal"}>{rupees(r.commission)}</td><td className={td + " text-right tnum"}>{rupees(r.pending)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No salespeople yet. Approve or create sales profiles under Employees.</Empty>}
      </Panel>
    </>
  );
}
