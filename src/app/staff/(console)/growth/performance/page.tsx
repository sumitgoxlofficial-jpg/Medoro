import Link from "next/link";
import { assignableStaff, requireGrowth } from "@/staff/growth/access";
import { employeePerformance } from "@/staff/growth/analytics";
import { rupees } from "@/staff/growth/constants";
import { Empty, Panel, btn, btnPrimary, fieldCls, lbl, td, th } from "../../ui";
import { HBar } from "../charts";

export default async function Performance({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; staffId?: string }> }) {
  const a = await requireGrowth("performance.view");
  const sp = await searchParams;
  const [p, staff] = await Promise.all([employeePerformance(a, { from: sp.from || undefined, to: sp.to || undefined, staffId: sp.staffId || undefined }), a.growthRole === "analyst" ? Promise.resolve([]) : assignableStaff(a)]);
  const pct = (v: number | null, t: number | null) => (t === null ? "—" : `${v ?? 0}%`);
  const cols: [string, string][] = [["assigned", "Assigned"], ["launches", "Dialer opens"], ["reported", "Reported calls"], ["connected", "Connected"], ["interested", "Interested"], ["demosScheduled", "Demos booked"], ["demosCompleted", "Demos done"], ["trials", "Trials"], ["conversions", "Converted"], ["pendingFollowUps", "Pending follow-ups"], ["overdueFollowUps", "Overdue"]];
  return (
    <>
      <Panel title="Employee performance" sub={`${new Date(p.from).toLocaleDateString("en-IN")} – ${new Date(new Date(p.to).getTime() - 1).toLocaleDateString("en-IN")}. Dialer opens are not counted as calls; calls are employees’ reports.`}>
        <form method="get" className="flex gap-2.5 p-4 flex-wrap items-end">
          {staff.length ? <label className={lbl}>Employee<select name="staffId" defaultValue={sp.staffId ?? ""} className={fieldCls}><option value="">Everyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
          <label className={lbl}>From<input type="date" name="from" defaultValue={sp.from} className={fieldCls} /></label>
          <label className={lbl}>To<input type="date" name="to" defaultValue={sp.to} className={fieldCls} /></label>
          <button className={btnPrimary}>Apply</button><Link className={btn} href="/staff/growth/performance">Last 30 days</Link>
        </form>
        {p.rows.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[1300px] text-[13px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Employee</th>{cols.map(([, l]) => <th key={l} className={th + " text-right"}>{l}</th>)}<th className={th + " text-right"}>Today vs target</th><th className={th + " text-right"}>This week</th><th className={th + " text-right"}>Month conversion</th><th className={th + " text-right"}>Revenue</th></tr></thead>
            <tbody>{p.rows.map((r) => (
              <tr key={r.id}>
                <td className={td}><strong>{r.name}</strong><div className="text-muted text-[11.5px]">{r.empNo}{r.status !== "active" ? ` · ${r.status}` : ""}</div></td>
                {cols.map(([k]) => <td key={k} className={td + " text-right tnum"}>{r[k as keyof typeof r] as number}</td>)}
                <td className={td + " text-right tnum"}>{r.today}{r.dailyTarget !== null ? <span className="text-muted"> / {r.dailyTarget} · {pct(r.dailyPct, r.dailyTarget)}</span> : null}</td>
                <td className={td + " text-right tnum"}>{r.week}{r.weeklyTarget !== null ? <span className="text-muted"> / {r.weeklyTarget} · {pct(r.weeklyPct, r.weeklyTarget)}</span> : null}</td>
                <td className={td + " text-right tnum"}>{r.monthConversionRate === null ? "—" : `${r.monthConversionRate}%`}<div className="text-muted text-[11px]">{r.monthConversions} of {r.monthConnectedLeads} connected</div></td>
                <td className={td + " text-right tnum"}>{rupees(r.revenuePaise)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No employees in view.</Empty>}
      </Panel>
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        <Panel title="Reported calls by employee"><HBar data={p.rows.map((r) => ({ name: r.name, n: r.reported }))} /></Panel>
        <Panel title="Conversions by employee"><HBar data={p.rows.map((r) => ({ name: r.name, n: r.conversions }))} color="#18794E" /></Panel>
      </div>
    </>
  );
}
