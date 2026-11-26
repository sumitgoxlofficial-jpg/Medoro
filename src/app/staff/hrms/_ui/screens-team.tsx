"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { assignTask, decideLeave } from "../actions";
import { Avatar, Card, Empty, Field, Grid, Pill, Stat, Table, btnCls, dangerCls, dayLabel, inputCls, primaryCls, tdCls, useRun } from "./kit";

const TODAY_TONE: Record<string, "green" | "amber" | "gray" | "red" | "blue"> = { Present: "green", "Checked out": "green", Late: "amber", "On leave": "blue", "Day off": "gray", "Not in yet": "red" };

/** My Team (anyone with direct reports): today, leave approvals, who's out, tasks and this month. */
export function TeamScreen({ d }: { d: Data<"myteam"> }) {
  const { run, busy } = useRun();
  const [t, setT] = useState({ title: "", assigneeId: "", due: "", priority: "Medium" });
  if (!d.people.length) return <Card pad><Empty>Nobody reports to you yet. HR sets “Reports to” on each employee.</Empty></Card>;
  const n = (s: string) => d.people.filter((p) => p.today === s).length;
  return <>
    <Grid n={4}><Stat l="Team" v={d.people.length} /><Stat l="In today" v={n("Present") + n("Late") + n("Checked out")} sub={n("Late") ? `${n("Late")} late` : undefined} /><Stat l="Leave to decide" v={d.requests.length} c={d.requests.length ? "#B45309" : undefined} /><Stat l="Overdue tasks" v={d.tasks.filter((x) => x.overdue).length} c="#DC2626" /></Grid>
    <Grid n={2}>
      <Card title="Today" pad>{d.people.map((p) => <div key={p.id} className="flex items-center gap-2.5 py-1.5"><Avatar name={p.name} size={30} /><div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold">{p.name}</div><div className="text-[11.5px] text-[#64748B]">{p.designation}{p.inAt ? ` · in ${p.inAt}` : ""}{p.outAt ? ` · out ${p.outAt}` : ""}</div></div><Pill tone={TODAY_TONE[p.today] ?? "gray"}>{p.today}</Pill></div>)}</Card>
      <Card title="Leave requests from your team" sub="You or HR can decide each one" pad>{d.requests.length ? d.requests.map((r) => <div key={r.id} className="flex items-center gap-2 border-b border-[#F1F5F9] py-2 last:border-0"><div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold">{r.name}</div><div className="text-[12px] text-[#64748B]">{r.text}{r.note ? ` · “${r.note}”` : ""}</div></div><button className={primaryCls} disabled={busy} onClick={() => run(() => decideLeave(r.id, true))}>Approve</button><button className={dangerCls} disabled={busy} onClick={() => run(() => decideLeave(r.id, false))}>Reject</button></div>) : <Empty>Nothing waiting.</Empty>}</Card>
    </Grid>
    <Grid n={2}>
      <Card title="Out in the next 2 weeks" pad>{d.out.length ? d.out.map((o) => <div key={o.id} className="flex justify-between text-[13px] py-1.5 border-b border-[#F1F5F9] last:border-0"><span><strong>{o.name}</strong> · {o.type}{o.half ? " (half day)" : ""}</span><span className="text-[#64748B]">{dayLabel(o.from)}{o.to !== o.from ? ` – ${dayLabel(o.to)}` : ""}</span></div>) : <Empty>Everyone is in.</Empty>}</Card>
      <Card title="Give a task" sub="To someone who reports to you" pad>
        <form className="flex flex-col gap-2.5" onSubmit={(e) => { e.preventDefault(); run(() => assignTask({ title: t.title, assigneeId: t.assigneeId, due: t.due, priority: t.priority as never }), () => setT({ ...t, title: "", due: "" })); }}>
          <Field label="Task"><input className={inputCls} value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} required minLength={3} /></Field>
          <div className="grid grid-cols-3 gap-2"><Field label="For"><select className={inputCls} value={t.assigneeId} onChange={(e) => setT({ ...t, assigneeId: e.target.value })} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Due"><input className={inputCls} type="date" value={t.due} onChange={(e) => setT({ ...t, due: e.target.value })} /></Field>
            <Field label="Priority"><select className={inputCls} value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value })}>{d.priorities.map((x) => <option key={x}>{x}</option>)}</select></Field></div>
          <div><button className={primaryCls} disabled={busy}>Assign task</button></div>
        </form>
      </Card>
    </Grid>
    <Card title={`Open tasks · ${d.tasks.length}`}><Table head={["Task", "Who", "Due", "Priority"]} empty={d.tasks.length ? undefined : "No open tasks."}>{d.tasks.map((x) => <tr key={x.id}><td className={tdCls}>{x.title}</td><td className={tdCls}>{x.who}</td><td className={tdCls}>{x.due ? dayLabel(x.due) : "—"}{x.overdue ? <> <Pill tone="red">overdue</Pill></> : null}</td><td className={tdCls}><Pill tone={x.priority === "High" ? "red" : x.priority === "Medium" ? "amber" : "gray"}>{x.priority}</Pill></td></tr>)}</Table></Card>
    <Card title="This month" sub="Days checked in, late days and tasks for each person"><Table head={["Person", "Days in", "Late", "Tasks done", "On time", "Open", "Overdue"]}>{d.people.map((p) => <tr key={p.id}><td className={tdCls}><strong>{p.name}</strong> <span className="text-[#94A3B8] text-[12px]">{p.empNo}</span></td><td className={tdCls}>{p.presentDays}</td><td className={tdCls}>{p.lateDays}</td><td className={tdCls}>{p.tasksDone}</td><td className={tdCls}>{p.onTimePct === null ? "—" : `${p.onTimePct}%`}</td><td className={tdCls}>{p.tasksOpen}</td><td className={tdCls}>{p.tasksOverdue ? <Pill tone="red">{p.tasksOverdue}</Pill> : 0}</td></tr>)}</Table></Card>
    <p className="text-[12px] text-[#64748B]"><button type="button" className={btnCls} onClick={() => window.print()}>Print</button> You see only work information about your direct reports: no pay, bank or personal details.</p>
  </>;
}
