"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Data } from "@/staff/hrms/screens";
import { archiveShift, assignShift, saveShift } from "../actions";
import { Card, Field, Grid, Modal, Pill, Stat, Table, btnCls, dangerCls, dayLabel, inputCls, primaryCls, tdCls, useRun } from "./kit";

type D = Data<"hrshifts">;
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** HR (Attendance): shifts, the roster, overtime and payroll readiness. */
export function ShiftsScreen({ d }: { d: D }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const [edit, setEdit] = useState<{ id: string | null; name: string; start: string; end: string; graceMin: string; breakMin: string } | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState({ shiftId: d.shifts[0]?.id ?? "", from: d.day, to: "" });
  const [ot, setOt] = useState<D["overtime"]["people"][number] | null>(null);
  const shiftName = (id: string | null) => d.shifts.find((s) => s.id === id)?.name ?? "";
  const r = d.readiness;
  return <>
    {r ? <Card title={`Payroll readiness · ${d.month}`} sub="What would stop someone being paid (blocks) or could change pay (checks), before you process payroll." right={<input type="month" className={inputCls + " !w-auto"} value={d.month} onChange={(e) => router.push(`/staff/hrms/hrshifts?m=${e.target.value}`)} aria-label="Month" />}>
      <div className="px-5"><Grid><Stat l="People" v={r.people} /><Stat l="Blocks" v={r.blocks} c={r.blocks ? "#DC2626" : undefined} /><Stat l="Checks" v={r.checks} c={r.checks ? "#B45309" : undefined} /><Stat l="Ready" v={r.ready ? "Yes" : "No"} c={r.ready ? undefined : "#DC2626"} /></Grid></div>
      <Table head={["Person", "", "Issue"]} empty="Nothing to fix. Payroll is ready.">{r.items.map((x, i) => <tr key={i}><td className={tdCls}>{x.name} <span className="text-[12px] text-[#94A3B8]">{x.empNo}</span></td><td className={tdCls}><Pill tone={x.level === "block" ? "red" : "amber"}>{x.level}</Pill></td><td className={tdCls}>{x.issue}</td></tr>)}</Table>
    </Card> : null}
    <Card title="Shifts" sub="Late after start + grace. A shift ending before it starts runs past midnight." right={<button className={btnCls} onClick={() => setEdit({ id: null, name: "", start: "09:30", end: "18:30", graceMin: "10", breakMin: "30" })}>New shift</button>}>
      <Table head={["Shift", "Time", "Grace", "Break", "Expected work", "People today", ""]} empty="No shifts yet: everyone uses the company time in Settings or their own shift start.">
        {d.shifts.map((s) => <tr key={s.id}><td className={tdCls}><strong>{s.name}</strong>{s.overnight ? <Pill tone="purple">overnight</Pill> : null}</td><td className={tdCls}>{s.start}–{s.end}</td><td className={tdCls}>{s.graceMin} min</td><td className={tdCls}>{s.breakMin} min</td><td className={tdCls}>{hm(s.workMin)}</td><td className={tdCls}>{s.people}</td><td className={tdCls}><div className="flex gap-1.5"><button className={btnCls} onClick={() => setEdit({ id: s.id, name: s.name, start: s.start, end: s.end, graceMin: String(s.graceMin), breakMin: String(s.breakMin) })}>Edit</button><button className={dangerCls} disabled={busy} onClick={() => run(() => archiveShift(s.id))}>Archive</button></div></td></tr>)}
      </Table>
    </Card>
    <Card title={`Roster on ${dayLabel(d.day)}`} sub="Tick people, choose a shift and the days. A later entry replaces an earlier one from its first day; history is kept." right={<input type="date" className={inputCls + " !w-auto"} value={d.day} onChange={(e) => router.push(`/staff/hrms/hrshifts?day=${e.target.value}`)} aria-label="Day" />}>
      {d.shifts.length ? <form className="flex gap-2 items-end flex-wrap px-5 pb-3" onSubmit={(e) => { e.preventDefault(); run(() => assignShift({ staffIds: [...pick], ...roster }), () => setPick(new Set())); }}>
        <Field label="Shift"><select className={inputCls} value={roster.shiftId} onChange={(e) => setRoster({ ...roster, shiftId: e.target.value })}>{d.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}</select></Field>
        <Field label="From"><input type="date" className={inputCls} value={roster.from} onChange={(e) => setRoster({ ...roster, from: e.target.value })} required /></Field>
        <Field label="To (optional)"><input type="date" className={inputCls} value={roster.to} onChange={(e) => setRoster({ ...roster, to: e.target.value })} /></Field>
        <button className={primaryCls} disabled={busy || !pick.size}>Roster {pick.size || ""} {pick.size === 1 ? "person" : "people"}</button>
      </form> : null}
      <Table head={["", "Person", "Department", "Shift", "Since", "Until"]}>
        {d.people.map((p) => <tr key={p.id}><td className={tdCls}><input type="checkbox" aria-label={`Select ${p.name}`} checked={pick.has(p.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(p.id); else n.delete(p.id); setPick(n); }} /></td><td className={tdCls}>{p.name} <span className="text-[12px] text-[#94A3B8]">{p.empNo}</span></td><td className={tdCls}>{p.dept}</td><td className={tdCls}>{p.shiftId ? shiftName(p.shiftId) : <span className="text-[12px] text-[#94A3B8]">{p.ownStart ? `own start ${p.ownStart}` : "company time"}</span>}</td><td className={tdCls}>{p.from ? dayLabel(p.from) : ""}</td><td className={tdCls}>{p.to ? dayLabel(p.to) : p.from ? "open" : ""}</td></tr>)}
      </Table>
    </Card>
    <Card title={`Overtime · ${d.month}`} sub={d.overtime.rule}>
      <Table head={["Person", "Days counted", "Overtime", ""]} empty="No overtime this month.">
        {d.overtime.people.filter((p) => p.overtimeMin > 0).map((p) => <tr key={p.id}><td className={tdCls}>{p.name} <span className="text-[12px] text-[#94A3B8]">{p.empNo}</span></td><td className={tdCls}>{p.days}</td><td className={tdCls}>{hm(p.overtimeMin)}</td><td className={tdCls}><button className={btnCls} onClick={() => setOt(p)}>Days</button></td></tr>)}
      </Table>
    </Card>
    {ot ? <Modal title={`${ot.name} · overtime ${d.month}`} onClose={() => setOt(null)}><Table head={["Day", "Worked", "Expected", "Overtime"]}>{ot.lines.map((l) => <tr key={l.day}><td className={tdCls}>{dayLabel(l.day)}</td><td className={tdCls}>{hm(l.workedMin)}</td><td className={tdCls}>{hm(l.expectedMin)}</td><td className={tdCls}>{hm(l.overtimeMin)}</td></tr>)}</Table></Modal> : null}
    {edit ? <Modal title={edit.id ? "Edit shift" : "New shift"} onClose={() => setEdit(null)}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => saveShift(edit.id, { name: edit.name, start: edit.start, end: edit.end, graceMin: Number(edit.graceMin), breakMin: Number(edit.breakMin) }), () => setEdit(null)); }}>
        <Field label="Name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
        <Grid n={4}><Field label="Starts"><input type="time" className={inputCls} value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} required /></Field><Field label="Ends"><input type="time" className={inputCls} value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} required /></Field><Field label="Grace (min)"><input className={inputCls} inputMode="numeric" value={edit.graceMin} onChange={(e) => setEdit({ ...edit, graceMin: e.target.value })} /></Field><Field label="Break (min)"><input className={inputCls} inputMode="numeric" value={edit.breakMin} onChange={(e) => setEdit({ ...edit, breakMin: e.target.value })} /></Field></Grid>
        <div><button className={primaryCls} disabled={busy}>Save shift</button></div>
      </form>
    </Modal> : null}
  </>;
}
