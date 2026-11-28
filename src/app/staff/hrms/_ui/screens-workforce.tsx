"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Data } from "@/staff/hrms/screens";
import { acknowledgeMonitorPolicy, activityFor, decideActivityDispute, issueDeviceCode, raiseActivityDispute, revokeDevice, setAppCategory } from "../actions";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, Table, btnCls, dangerCls, dayLabel, inputCls, primaryCls, statusTone, tdCls, timeLabel, useRun } from "./kit";

type Day = Data<"myactivity">["activity"];
const CAT_TONE = { work: "green", neutral: "blue", personal: "amber", unknown: "gray" } as const;
const ago = (iso: string | null) => (iso ? `${dayLabel(iso)} ${timeLabel(iso)}` : "never");

/** One day of activity: totals, programs and spans. */
function DayView({ a }: { a: Day }) {
  return <>
    <Grid>
      <Stat l="Active" v={`${a.activeMin} min`} />
      <Stat l="Idle" v={`${a.idleMin} min`} c="#B45309" />
      <Stat l="Screen locked" v={`${a.lockedMin} min`} c="#475569" />
      <Stat l="First – last" v={a.first ? `${timeLabel(a.first)} – ${timeLabel(a.last!)}` : "—"} c="#475569" />
    </Grid>
    <p className="text-[12px] text-[#64748B]">{a.note}</p>
    <Grid n={2}>
      <Card title="Programs" sub="Active minutes per program, with HR’s category.">
        <Table head={["Program", "Minutes", "Category"]} empty="Nothing recorded on this day.">{a.apps.map((x) => <tr key={x.app}><td className={tdCls}>{x.app}</td><td className={tdCls}>{x.minutes}</td><td className={tdCls}><Pill tone={CAT_TONE[x.category as keyof typeof CAT_TONE] ?? "gray"}>{x.category}</Pill></td></tr>)}</Table>
      </Card>
      <Card title="Timeline" sub="Every span recorded. Struck-out spans were removed after a dispute.">
        <div className="max-h-[360px] overflow-auto px-5 pb-4">
          {a.spans.length ? <ol className="m-0 p-0 list-none text-[12.5px] flex flex-col gap-1">{a.spans.map((s) => <li key={s.id} className={s.excluded ? "line-through text-[#94A3B8]" : ""}>{timeLabel(s.from)}–{timeLabel(s.to)} · <strong>{s.kind}</strong>{s.app ? ` · ${s.app}` : ""} · {s.minutes} min</li>)}</ol> : <Empty>Nothing recorded.</Empty>}
        </div>
      </Card>
    </Grid>
  </>;
}

/** The employee: what can be recorded and why, the policy to accept, their PCs, their day, corrections and disputes. */
export function MyActivityScreen({ d }: { d: Data<"myactivity"> }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const [disp, setDisp] = useState<{ day: string; from: string; to: string; reason: string } | null>(null);
  return <>
    <Card title={d.state === "ok" ? "Your company PC is recording activity now" : "Nothing is being recorded now"} sub={d.message} right={<Pill tone={d.state === "ok" ? "green" : "gray"}>{d.tracking ? (d.state === "ok" ? "Recording" : "Paused") : "Tracking off"}</Pill>} pad>
      <div className="flex flex-col gap-2">
        <h4 className="text-[13.5px] font-bold m-0">{d.policy.title} · version {d.policyVersion}</h4>
        <ul className="m-0 pl-5 text-[13px] text-[#334155] flex flex-col gap-1">{d.policy.points.map((p) => <li key={p}>{p}</li>)}</ul>
        {d.acknowledged ? <p className="text-[12.5px] text-[#1E7F4F]">✓ You accepted this policy on {dayLabel(d.acknowledged)}.</p> : <div><button className={primaryCls} disabled={busy} onClick={() => run(() => acknowledgeMonitorPolicy())}>I have read and accept this policy</button></div>}
      </div>
    </Card>
    <Card title="My company PCs" sub="Only HR can enrol a PC, and only a company one. You can remove a PC at any time; it stops at once.">
      <Table head={["PC", "Enrolled", "Last contact", ""]} empty="No PC is enrolled for you.">
        {d.devices.map((x) => <tr key={x.id}><td className={tdCls}>{x.name} <span className="text-[12px] text-[#94A3B8]">{x.agentVersion}</span></td><td className={tdCls}>{dayLabel(x.enrolledAt)}</td><td className={tdCls}>{ago(x.lastSeenAt)}</td><td className={tdCls}>{x.revoked ? <Pill>Removed</Pill> : <button className={dangerCls} disabled={busy} onClick={() => { if (confirm(`Remove ${x.name}? It stops sending anything at once.`)) run(() => revokeDevice(x.id, "removed by the employee")); }}>Remove</button>}</td></tr>)}
      </Table>
    </Card>
    <Card title={`Recorded on ${dayLabel(d.activity.day)}`} right={<><input type="date" className={inputCls + " !w-auto"} value={d.activity.day} onChange={(e) => router.push(`/staff/hrms/myactivity?day=${e.target.value}`)} aria-label="Day" /><button className={btnCls} onClick={() => setDisp({ day: d.activity.day, from: "", to: "", reason: "" })}>Dispute part of this day</button></>} pad>
      <DayView a={d.activity} />
    </Card>
    <Card title="My disputes">
      <Table head={["Day", "Time", "Reason", "Status", "HR’s reply"]} empty="No disputes.">{d.disputes.map((x) => <tr key={x.id}><td className={tdCls}>{dayLabel(x.day)}</td><td className={tdCls}>{x.from}–{x.to}</td><td className={tdCls}>{x.reason}</td><td className={tdCls}><Pill tone={statusTone(x.status)}>{x.status}</Pill></td><td className={tdCls}>{x.reply}</td></tr>)}</Table>
    </Card>
    {disp ? <Modal title="Dispute recorded activity" onClose={() => setDisp(null)}>
      <p className="text-[12.5px] text-[#64748B]">For example: you were in a meeting away from the PC, or a program is wrongly counted. If HR accepts, the minutes in that window are removed from every total.</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => raiseActivityDispute(disp), () => setDisp(null)); }}>
        <Grid n={3}><Field label="Day"><input type="date" className={inputCls} value={disp.day} onChange={(e) => setDisp({ ...disp, day: e.target.value })} required /></Field><Field label="From (HH:MM)"><input type="time" className={inputCls} value={disp.from} onChange={(e) => setDisp({ ...disp, from: e.target.value })} required /></Field><Field label="To (HH:MM)"><input type="time" className={inputCls} value={disp.to} onChange={(e) => setDisp({ ...disp, to: e.target.value })} required /></Field></Grid>
        <Field label="What is wrong"><textarea className={inputCls} rows={3} value={disp.reason} onChange={(e) => setDisp({ ...disp, reason: e.target.value })} required minLength={10} /></Field>
        <div><button className={primaryCls} disabled={busy}>Send to HR</button></div>
      </form>
    </Modal> : null}
  </>;
}

/** HR (Attendance): enrol company PCs, remove them, decide disputes, see the team's day and classify programs. */
export function WorkforceScreen({ d }: { d: Data<"workforce"> }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const [who, setWho] = useState(""), [code, setCode] = useState<{ code: string; minutes: number; employee: string } | null>(null);
  const [open, setOpen] = useState<{ name: string; a: Day } | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  return <>
    {!d.tracking ? <Card pad><p className="text-[13px] text-[#B45309] m-0">Workforce tracking is switched off in Settings. Enrolled PCs send nothing until the super admin turns it on (and each employee accepts the policy).</p></Card> : null}
    <Card title="Enrol a company PC" sub="Creates a one-time code (15 minutes) for one employee. Enter it in the Medoro agent on that PC. Never enrol a personal device." pad>
      <form className="flex gap-2 items-end flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => issueDeviceCode(who), (r) => { setCode(r); return ""; }); }}>
        <Field label="Employee"><select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.empNo}</option>)}</select></Field>
        <button className={primaryCls} disabled={busy}>Create code</button>
      </form>
      {code ? <p className="text-[13.5px] mt-3">Code for {code.employee}: <strong className="text-[18px] tracking-[.1em]">{code.code}</strong> <span className="text-[12px] text-[#64748B]">· works once, for {code.minutes} minutes. It won’t be shown again.</span></p> : null}
    </Card>
    <Card title="Open disputes" sub="Accepting removes the window’s minutes from every total; the spans are kept, marked.">
      <Table head={["Person", "Day", "Time", "Reason", ""]} empty="No open disputes.">
        {d.disputes.map((x) => <tr key={x.id}><td className={tdCls}>{x.person}</td><td className={tdCls}>{dayLabel(x.day)}</td><td className={tdCls}>{x.from}–{x.to}</td><td className={tdCls}>{x.reason}</td><td className={tdCls}>{x.mine ? <span className="text-[12px] text-[#94A3B8]">Someone else decides</span> : <div className="flex gap-1.5 flex-wrap"><input className={inputCls + " !w-40"} placeholder="Reply (needed to reject)" value={reply[x.id] ?? ""} onChange={(e) => setReply({ ...reply, [x.id]: e.target.value })} /><button className={primaryCls} disabled={busy} onClick={() => run(() => decideActivityDispute(x.id, true, reply[x.id] ?? ""))}>Accept</button><button className={dangerCls} disabled={busy} onClick={() => run(() => decideActivityDispute(x.id, false, reply[x.id] ?? ""))}>Reject</button></div>}</td></tr>)}
      </Table>
    </Card>
    <Card title={`Team activity on ${dayLabel(d.day)}`} sub="Context for conversations, not a performance score. Opening a person’s detail is written to the audit log." right={<input type="date" className={inputCls + " !w-auto"} value={d.day} onChange={(e) => router.push(`/staff/hrms/workforce?day=${e.target.value}`)} aria-label="Day" />}>
      <Table head={["Person", "Active", "Idle", "Locked", ""]} empty="No activity recorded on this day.">
        {d.team.map((t) => <tr key={t.id}><td className={tdCls}>{t.name} <span className="text-[12px] text-[#94A3B8]">{t.empNo}</span></td><td className={tdCls}>{t.active} min</td><td className={tdCls}>{t.idle} min</td><td className={tdCls}>{t.locked} min</td><td className={tdCls}><button className={btnCls} disabled={busy} onClick={() => run(() => activityFor(t.id, d.day), (a) => { setOpen({ name: t.name, a }); return ""; })}>Detail</button></td></tr>)}
      </Table>
    </Card>
    <Grid n={2}>
      <Card title="Company PCs">
        <Table head={["PC", "Employee", "Last contact", ""]} empty="No PC enrolled yet.">
          {d.devices.map((x) => <tr key={x.id}><td className={tdCls}>{x.name} <span className="text-[12px] text-[#94A3B8]">{x.agentVersion}</span></td><td className={tdCls}>{x.person}</td><td className={tdCls}>{ago(x.lastSeenAt)}</td><td className={tdCls}>{x.revoked ? <Pill>Removed</Pill> : <button className={dangerCls} disabled={busy} onClick={() => { const why = prompt(`Remove ${x.name}? Reason:`); if (why !== null) run(() => revokeDevice(x.id, why)); }}>Remove</button>}</td></tr>)}
        </Table>
      </Card>
      <Card title="Programs seen (30 days)" sub="Classify programs so summaries can show work, neutral and personal time. A category is context, never a score.">
        <Table head={["Program", "Minutes", "Category"]} empty="No programs seen yet.">
          {d.apps.map((x) => <tr key={x.app}><td className={tdCls}>{x.app}</td><td className={tdCls}>{x.minutes}</td><td className={tdCls}><select aria-label={`Category of ${x.app}`} className={inputCls + " !w-auto !py-1"} value={x.category} disabled={busy} onChange={(e) => run(() => setAppCategory(x.app, e.target.value))}>{x.category === "unknown" ? <option value="unknown" disabled>Choose…</option> : null}<option value="work">work</option><option value="neutral">neutral</option><option value="personal">personal</option></select></td></tr>)}
        </Table>
      </Card>
    </Grid>
    {open ? <Modal title={`${open.name} · ${dayLabel(open.a.day)}`} onClose={() => setOpen(null)} wide><DayView a={open.a} /></Modal> : null}
  </>;
}
