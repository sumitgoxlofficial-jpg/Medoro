"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { BOARD_COLS, PRIORITIES, PROJECT_STATUS } from "@/staff/hrms/constants";
import { assignTask, deleteProject, deleteRisk, deleteSprint, moveTask, saveProject, saveRisk, saveSprint, setTaskSprint } from "../actions";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, Table, Tabs, btnCls, cx, dangerCls, dayLabel, inputCls, primaryCls, statusTone, tdCls, useRun } from "./kit";

type Proj = Data<"assignprojects">["projects"][number];
type View = "dashboard" | "board" | "timeline" | "list" | "sprints" | "risks";
const DAY = 86_400_000, ms = (iso: string) => new Date(iso + "T00:00:00Z").getTime();
const prioTone = (p: string) => (p === "High" ? "red" : p === "Medium" ? "amber" : "gray") as "red" | "amber" | "gray";

export function ProjectsScreen({ d }: { d: Data<"assignprojects"> }) {
  const { run, busy } = useRun();
  const [sel, setSel] = useState(d.projects[0]?.id ?? ""), [view, setView] = useState<View>("board"), [form, setForm] = useState<Partial<Proj> | null>(null);
  const p = d.projects.find((x) => x.id === sel) ?? d.projects[0];
  return <>
    <div className="flex gap-2 flex-wrap">{d.projects.map((x) => <button key={x.id} onClick={() => setSel(x.id)} className={cx("rounded-[10px] px-3.5 py-2 text-[13px] font-semibold cursor-pointer border", x.id === p?.id ? "bg-[#D6F3EF] border-[#14B8A6] text-[#0B5E5B]" : "bg-white border-[#CDD2D7]")}>{x.name}</button>)}<button className={btnCls} onClick={() => setForm({ name: "", client: "Internal", members: [], status: "Planning" })}>+ New project</button></div>
    {p ? <>
      <Card pad><div className="flex gap-3 items-center flex-wrap"><div className="flex-1"><h2 className="text-[18px] font-bold">{p.name}</h2><p className="text-[12.5px] text-[#64748B]">{p.client} · Lead: {p.lead || "—"} · {p.deadline ? `Deadline ${dayLabel(p.deadline)}` : "No deadline"} · {p.memberNames.join(", ") || "no members"}</p></div><Pill tone={statusTone(p.status)}>{p.status}</Pill><button className={btnCls} onClick={() => setForm(p)}>Edit</button><button className={dangerCls} onClick={() => { if (confirm(`Delete ${p.name} and its tasks?`)) run(() => deleteProject(p.id)); }}>Delete</button></div></Card>
      <Tabs value={view} onChange={setView} options={[["dashboard", "Dashboard"], ["board", "Board"], ["timeline", "Timeline"], ["list", "List"], ["sprints", `Sprints · ${p.sprints.length}`], ["risks", `Risks · ${p.risks.filter((r) => r.status === "open").length}`]]} />
      {view === "dashboard" ? <Dashboard p={p} /> : view === "board" ? <Board p={p} d={d} /> : view === "timeline" ? <Timeline p={p} /> : view === "list" ? <List p={p} /> : view === "sprints" ? <Sprints p={p} /> : <Risks p={p} d={d} />}
      {view === "board" ? <AddTask p={p} d={d} /> : null}
    </> : <Card pad><Empty>No projects yet. Create the first one.</Empty></Card>}
    {form ? <Modal title={form.id ? "Edit project" : "New project"} onClose={() => setForm(null)}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => saveProject({ id: form.id, name: form.name ?? "", client: form.client ?? "Internal", leadId: form.leadId || null, members: form.members ?? [], deadline: form.deadline ?? "", status: (form.status ?? "Planning") as "Planning" }), () => { setForm(null); }); }}>
        <Field label="Name"><input className={inputCls} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Client"><input className={inputCls} value={form.client ?? ""} onChange={(e) => setForm({ ...form, client: e.target.value })} /></Field><Field label="Deadline"><input className={inputCls} type="date" value={form.deadline ?? ""} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
          <Field label="Lead"><select className={inputCls} value={form.leadId ?? ""} onChange={(e) => setForm({ ...form, leadId: e.target.value })}><option value="">—</option>{d.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Status"><select className={inputCls} value={form.status ?? "Planning"} onChange={(e) => setForm({ ...form, status: e.target.value })}>{PROJECT_STATUS.map((s) => <option key={s}>{s}</option>)}</select></Field></div>
        <Field label="Members" hint="Hold Ctrl or Cmd to pick several"><select multiple className={cx(inputCls, "h-32")} value={form.members ?? []} onChange={(e) => setForm({ ...form, members: [...e.target.selectedOptions].map((o) => o.value) })}>{d.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <button className={primaryCls} disabled={busy}>Save project</button></form></Modal> : null}
  </>;
}

function Dashboard({ p }: { p: Proj }) {
  const open = p.tasks.filter((t) => !t.done), per = p.memberNames.map((n) => ({ n, c: open.filter((t) => t.assignee === n).length }));
  const max = Math.max(1, ...per.map((x) => x.c));
  return <>
    <Grid n={4}><Stat l="Total tasks" v={p.tasks.length} /><Stat l="Done" v={p.tasks.filter((t) => t.done).length} /><Stat l="Late" v={p.late} c={p.late ? "#DC2626" : "#0f172a"} /><Stat l="Progress" v={`${p.progress}%`} sub={p.deadline ? `Deadline ${dayLabel(p.deadline)}` : undefined} /></Grid>
    <Grid n={2}>
      <Card title="Tasks by stage" pad>{BOARD_COLS.map((c) => { const n = p.tasks.filter((t) => t.col === c.id).length; return <div key={c.id} className="flex items-center gap-3 py-1 text-[13px]"><span className="w-24">{c.label}</span><div className="flex-1 h-2 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${p.tasks.length ? (n * 100) / p.tasks.length : 0}%` }} /></div><strong className="w-6 text-right">{n}</strong></div>; })}</Card>
      <Card title="Open work per person" pad>{per.length ? per.map((x) => <div key={x.n} className="flex items-center gap-3 py-1 text-[13px]"><span className="w-32 truncate">{x.n}</span><div className="flex-1 h-2 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#0B5E5B] rounded-full" style={{ width: `${(x.c * 100) / max}%` }} /></div><strong className="w-6 text-right">{x.c}</strong></div>) : <Empty>No members yet.</Empty>}</Card>
    </Grid>
    <Card title="Needs attention" pad>{open.filter((t) => t.overdue).length || p.risks.some((r) => r.status === "open" && r.level === "High") ? <>
      {open.filter((t) => t.overdue).map((t) => <p key={t.id} className="text-[13px] py-1">⚠ <strong>{t.title}</strong> · {t.assignee} · was due {dayLabel(t.due!)}</p>)}
      {p.risks.filter((r) => r.status === "open" && r.level === "High").map((r) => <p key={r.id} className="text-[13px] py-1">🔺 High risk: <strong>{r.title}</strong>{r.owner ? ` · ${r.owner}` : ""}</p>)}</> : <Empty>Nothing is late and no high risks are open.</Empty>}</Card>
  </>;
}

function Board({ p }: { p: Proj; d: Data<"assignprojects"> }) {
  const { run } = useRun();
  return <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: "repeat(5,minmax(190px,1fr))" }}>
    {BOARD_COLS.map((c) => <div key={c.id} className="bg-[#EEF2F6] rounded-xl p-2.5 flex flex-col gap-2"><div className="text-[12px] font-bold text-[#475569] px-1">{c.label} · {p.tasks.filter((x) => x.col === c.id).length}</div>
      {p.tasks.filter((x) => x.col === c.id).map((x) => <div key={x.id} className="bg-white rounded-lg border border-[#E2E8F0] p-2.5 text-[12.5px]"><div className="font-semibold">{x.title}</div><div className="text-[11.5px] text-[#64748B] mt-1">{x.assignee}{x.due ? ` · ${dayLabel(x.due)}` : ""}</div><select className="mt-1.5 border border-[#CDD2D7] rounded px-1 py-0.5 text-[11.5px]" value={x.col} onChange={(e) => run(() => moveTask(x.id, e.target.value))} aria-label="Move task">{BOARD_COLS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>)}</div>)}
  </div>;
}
function AddTask({ p, d }: { p: Proj; d: Data<"assignprojects"> }) {
  const { run, busy } = useRun();
  const [t, setT] = useState(""), [who, setWho] = useState(""), [due, setDue] = useState(""), [prio, setPrio] = useState("Medium"), [sprint, setSprint] = useState("");
  const members = d.people.filter((x) => p.members.includes(x.id));
  return <Card title="Add a task to this project" pad>
    {members.length ? <form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); run(() => assignTask({ title: t, assigneeId: who || members[0].id, due, priority: prio as "High", projectId: p.id, sprintId: sprint || null, col: "todo" }), () => { setT(""); }); }}>
      <Field label="Task"><input className={cx(inputCls, "!w-72")} value={t} onChange={(e) => setT(e.target.value)} required /></Field>
      <Field label="For"><select className={inputCls} value={who || members[0].id} onChange={(e) => setWho(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Due"><input className={inputCls} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field label="Priority"><select className={inputCls} value={prio} onChange={(e) => setPrio(e.target.value)}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
      {p.sprints.length ? <Field label="Sprint"><select className={inputCls} value={sprint} onChange={(e) => setSprint(e.target.value)}><option value="">None</option>{p.sprints.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field> : null}
      <button className={primaryCls} disabled={busy}>Add</button></form> : <p className="text-[12.5px] text-[#B45309]">Add members to the project first.</p>}</Card>;
}

/** A bar for every task from when it was created to its due date (a week long when it has no due date). */
function Timeline({ p }: { p: Proj }) {
  const rows = p.tasks.map((t) => { const start = ms(t.start), end = Math.max(start + DAY, t.due ? ms(t.due) + DAY : start + 7 * DAY); return { t, start, end }; });
  if (!rows.length) return <Card pad><Empty>No tasks yet.</Empty></Card>;
  const from = Math.min(...rows.map((r) => r.start)), to = Math.max(...rows.map((r) => r.end), p.deadline ? ms(p.deadline) + DAY : 0), span = Math.max(DAY, to - from);
  const pos = (x: number) => `${((x - from) / span) * 100}%`, todayMs = ms(new Date().toISOString().slice(0, 10));
  const ticks = Array.from({ length: 6 }, (_, i) => from + (span * i) / 5);
  return <Card title="Timeline" sub="Each bar runs from when the task was created to its due date" pad>
    <div className="overflow-x-auto"><div style={{ minWidth: 640 }}>
      <div className="relative h-5 ml-[200px] text-[11px] text-[#64748B]">{ticks.map((x) => <span key={x} className="absolute -translate-x-1/2" style={{ left: pos(x) }}>{dayLabel(new Date(x).toISOString().slice(0, 10))}</span>)}</div>
      {rows.map(({ t, start, end }) => <div key={t.id} className="flex items-center h-8 border-t border-[#F1F5F9]"><div className="w-[200px] pr-3 text-[12.5px] truncate" title={t.title}>{t.title}<span className="text-[#94A3B8]"> · {t.assignee.split(" ")[0]}</span></div>
        <div className="relative flex-1 h-full">{todayMs >= from && todayMs <= to ? <div className="absolute top-0 bottom-0 w-px bg-[#14B8A6]" style={{ left: pos(todayMs) }} /> : null}
          <div className={cx("absolute top-2 h-4 rounded", t.done ? "bg-[#14B8A6]" : t.overdue ? "bg-[#DC2626]" : "bg-[#0B5E5B]")} style={{ left: pos(start), width: `calc(${pos(end)} - ${pos(start)})` }} title={`${dayLabel(t.start)} → ${t.due ? dayLabel(t.due) : "no due date"}`} /></div></div>)}
    </div></div>
    <div className="flex gap-4 text-[11.5px] text-[#64748B] mt-3"><span><i className="inline-block size-2.5 rounded bg-[#0B5E5B]" /> In progress</span><span><i className="inline-block size-2.5 rounded bg-[#14B8A6]" /> Done</span><span><i className="inline-block size-2.5 rounded bg-[#DC2626]" /> Late</span><span>| today</span></div>
  </Card>;
}

function List({ p }: { p: Proj }) {
  const { run } = useRun();
  return <Card title={`All tasks · ${p.tasks.length}`}><Table head={["Task", "Assigned to", "Due", "Priority", "Stage", "Sprint"]} empty={p.tasks.length ? undefined : "No tasks yet."}>
    {p.tasks.map((t) => <tr key={t.id}><td className={tdCls}>{t.title}</td><td className={tdCls}>{t.assignee}</td><td className={tdCls}>{t.due ? dayLabel(t.due) : "—"}{t.overdue ? " ⚠" : ""}</td><td className={tdCls}><Pill tone={prioTone(t.priority)}>{t.priority}</Pill></td>
      <td className={tdCls}><select aria-label={`Stage of ${t.title}`} className="border border-[#CDD2D7] rounded px-1 py-1 text-[12px] bg-white" value={t.col} onChange={(e) => run(() => moveTask(t.id, e.target.value))}>{BOARD_COLS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></td>
      <td className={tdCls}><select aria-label={`Sprint of ${t.title}`} className="border border-[#CDD2D7] rounded px-1 py-1 text-[12px] bg-white" value={t.sprintId ?? ""} onChange={(e) => run(() => setTaskSprint(t.id, e.target.value || null))}><option value="">—</option>{p.sprints.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td></tr>)}
  </Table></Card>;
}

function Sprints({ p }: { p: Proj }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ name: "", start: "", end: "", goal: "" });
  return <>
    <Card title="Plan a sprint" pad><form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); run(() => saveSprint({ projectId: p.id, ...f }), () => { setF({ name: "", start: "", end: "", goal: "" }); }); }}>
      <Field label="Name"><input className={cx(inputCls, "!w-44")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sprint 1" required /></Field>
      <Field label="Starts"><input className={inputCls} type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></Field>
      <Field label="Ends"><input className={inputCls} type="date" min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></Field>
      <Field label="Goal"><input className={cx(inputCls, "!w-72")} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} /></Field><button className={primaryCls} disabled={busy}>Add sprint</button></form></Card>
    {p.sprints.length ? p.sprints.map((x) => <Card key={x.id} pad><div className="flex items-center gap-3 flex-wrap"><div className="flex-1 min-w-[220px]"><strong className="text-[14.5px]">{x.name}</strong> <Pill tone={x.state === "active" ? "green" : x.state === "done" ? "gray" : "amber"}>{x.state}</Pill><div className="text-[12.5px] text-[#64748B]">{dayLabel(x.start)} – {dayLabel(x.end)}{x.goal ? ` · ${x.goal}` : ""}</div></div>
      <div className="w-48"><div className="h-2 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${x.total ? (x.done * 100) / x.total : 0}%` }} /></div><div className="text-[11.5px] text-[#64748B] mt-1">{x.done} of {x.total} tasks done</div></div>
      <button className={dangerCls} onClick={() => { if (confirm(`Delete ${x.name}? Its tasks stay in the project.`)) run(() => deleteSprint(x.id)); }}>Delete</button></div>
      {p.tasks.filter((t) => t.sprintId === x.id).map((t) => <div key={t.id} className="text-[12.5px] py-1 border-t border-[#F1F5F9] mt-1 flex gap-2"><span className="flex-1">{t.done ? "✓ " : ""}{t.title}</span><span className="text-[#64748B]">{t.assignee}</span></div>)}</Card>) : <Card pad><Empty>No sprints yet. Plan one above, then put tasks in it from the List view.</Empty></Card>}
  </>;
}

function Risks({ p, d }: { p: Proj; d: Data<"assignprojects"> }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ title: "", level: "Medium", ownerId: "", mitigation: "" });
  return <>
    <Card title="Add a risk" pad><form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); run(() => saveRisk({ projectId: p.id, title: f.title, level: f.level as "High", ownerId: f.ownerId || null, mitigation: f.mitigation }), () => { setF({ title: "", level: "Medium", ownerId: "", mitigation: "" }); }); }}>
      <Field label="Risk"><input className={cx(inputCls, "!w-72")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
      <Field label="Level"><select className={inputCls} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Owner"><select className={inputCls} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">—</option>{d.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="What we are doing about it"><input className={cx(inputCls, "!w-72")} value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} /></Field><button className={primaryCls} disabled={busy}>Add risk</button></form></Card>
    <Card title={`Risks · ${p.risks.length}`}><Table head={["Risk", "Level", "Owner", "Mitigation", "Status", ""]} empty={p.risks.length ? undefined : "No risks recorded."}>
      {p.risks.map((r) => <tr key={r.id}><td className={tdCls}>{r.title}</td><td className={tdCls}><Pill tone={prioTone(r.level)}>{r.level}</Pill></td><td className={tdCls}>{r.owner || "—"}</td><td className={tdCls}>{r.mitigation || "—"}</td>
        <td className={tdCls}><select aria-label={`Status of ${r.title}`} className="border border-[#CDD2D7] rounded px-1 py-1 text-[12px] bg-white" value={r.status} onChange={(e) => run(() => saveRisk({ id: r.id, projectId: p.id, title: r.title, level: r.level as "High", ownerId: r.ownerId, status: e.target.value as "open", mitigation: r.mitigation }))}><option value="open">Open</option><option value="mitigated">Mitigated</option><option value="closed">Closed</option></select></td>
        <td className={tdCls}><button className={dangerCls} onClick={() => run(() => deleteRisk(r.id))}>Delete</button></td></tr>)}
    </Table></Card>
  </>;
}
