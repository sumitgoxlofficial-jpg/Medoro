"use client";
import type { Data } from "@/staff/hrms/screens";
import { managementCsv } from "../actions";
import { Card, Grid, Pill, Stat, Table, btnCls, download, money, tdCls, useRun } from "./kit";

type D = Data<"mgmt">;
const p = (v: number | null) => (v === null ? "—" : `${v}%`);

/** One page for management: every number with its definition; small groups hidden; payroll cost only for Payroll. */
export function MgmtScreen({ d }: { d: D }) {
  const { run, busy } = useRun();
  const max = Math.max(1, ...d.trend.map((t) => t.headcount));
  return <>
    <div className="flex justify-end"><button className={btnCls} disabled={busy} onClick={() => run(() => managementCsv(), (f) => { download(f.name, f.text); return "Report downloaded."; })}>Download CSV</button></div>
    <Grid>
      <Stat l="Active headcount" v={d.headcount} />
      <Stat l="Attrition (12 months)" v={p(d.attrition.ratePct)} sub={`${d.attrition.exits12} exits`} c={d.attrition.ratePct && d.attrition.ratePct > 20 ? "#DC2626" : undefined} />
      <Stat l="Late check-ins this month" v={p(d.attendance.latePct)} sub={`${d.attendance.days} check-ins`} />
      <Stat l="Required learning done" v={p(d.learning.compliancePct)} sub={`${d.learning.overdue} overdue`} c={d.learning.overdue ? "#B45309" : undefined} />
      <Stat l="eNPS" v={d.engagement ? d.engagement.enps : "—"} sub={d.engagement ? `${d.engagement.title} · ${d.engagement.n} answers` : "No survey with 5+ answers"} />
      <Stat l="Approvals waiting" v={d.operations.approvals} sub={`${d.operations.overdueSteps} overdue`} c={d.operations.overdueSteps ? "#DC2626" : undefined} />
    </Grid>
    <Grid n={2}>
      <Card title="Headcount, joins and exits" sub="Month-end headcount from joining and last working days.">
        <Table head={["Month", "Headcount", "", "Joined", "Left"]}>{d.trend.map((t) => <tr key={t.month}><td className={tdCls}>{t.month}</td><td className={tdCls}>{t.headcount}</td><td className={tdCls}><span aria-hidden className="block h-2 rounded bg-[#14B8A6]" style={{ width: `${(t.headcount / max) * 120}px` }} /></td><td className={tdCls}>{t.joined}</td><td className={tdCls}>{t.left}</td></tr>)}</Table>
        <p className="text-[11.5px] text-[#64748B] px-5 pb-3">{d.attrition.definition}</p>
      </Card>
      <Card title={`KPIs · ${d.kpis.period}`} sub={d.kpis.definition}>
        <Table head={["Department", "People with a score", "Average"]} empty="No KPI results this period.">{d.kpis.depts.map((x) => <tr key={x.name}><td className={tdCls}>{x.name}</td><td className={tdCls}>{x.people}</td><td className={tdCls}>{x.avg === null ? <Pill>hidden (fewer than 5)</Pill> : <Pill tone={x.avg >= 80 ? "green" : x.avg >= 60 ? "amber" : "red"}>{x.avg}</Pill>}</td></tr>)}</Table>
      </Card>
    </Grid>
    <Grid n={2}>
      <Card title="People by department"><Table head={["Department", "People"]}>{d.depts.map((x) => <tr key={x.name}><td className={tdCls}>{x.name}</td><td className={tdCls}>{x.people}</td></tr>)}</Table></Card>
      {d.payroll ? <Card title={`Payroll gross · ${d.payroll.month}`} sub={`Total ${money(d.payroll.total)} (gross pay on the processed payslips).`}><Table head={["Department", "Gross", "People"]}>{d.payroll.depts.map((x) => <tr key={x.name}><td className={tdCls}>{x.name}</td><td className={tdCls}>{money(x.gross)}</td><td className={tdCls}>{x.people}</td></tr>)}</Table></Card>
        : <Card title="Operations" pad><ul className="m-0 pl-5 text-[13px]"><li>{d.operations.expiring} employee documents expired or expiring within 30 days</li><li>{d.operations.devices} company PCs enrolled for workforce tracking</li><li>{d.attendance.leaves} approved leave requests this month</li></ul></Card>}
    </Grid>
    <p className="text-[11.5px] text-[#64748B]">{d.attendance.definition} Data as of {d.asOf}. Workforce activity is not part of any number on this page.</p>
  </>;
}
