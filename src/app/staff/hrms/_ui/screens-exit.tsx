"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { decideResignation, resign, saveExitInterview, tickClearance, withdrawResignation } from "../actions";
import { Avatar, Card, Empty, Field, Grid, Modal, Pill, Stat, btnCls, dangerCls, dayLabel, dayLong, inputCls, primaryCls, useRun } from "./kit";

type MyExit = Data<"profile">["exit"];
const STATUS: Record<string, [string, "amber" | "green" | "red" | "gray"]> = {
  requested: ["Waiting for HR", "amber"], accepted: ["Accepted", "green"], declined: ["Not accepted", "red"], withdrawn: ["Withdrawn", "gray"], recorded: ["Exit recorded", "green"], cancelled: ["Exit cancelled", "gray"],
};

/** My profile → Leaving Medoro: resign, see HR's decision, and fill in the exit interview. */
export function ResignCard({ x }: { x: MyExit }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ reason: "", lastDay: x.suggested });
  const e = x.exit;
  const st = e ? STATUS[e.status] : null;
  return (
    <Card title="Leaving Medoro" sub={`The notice period is ${x.noticeDays} days. Your manager and HR are told when you resign.`} pad>
      {e && st && e.status !== "withdrawn" ? <div className="flex flex-col gap-1.5 mb-3">
        <div className="flex items-center gap-2 flex-wrap"><span className="text-[13.5px] font-semibold">Resignation sent {dayLabel(e.createdAt)}</span><Pill tone={st[1]}>{st[0]}</Pill></div>
        {e.proposedLastDay ? <div className="text-[13px] text-[#475569]">Last working day you asked for: {dayLong(e.proposedLastDay)}</div> : null}
        {x.exitDate ? <div className="text-[13px] text-[#0f172a] font-semibold">Last working day: {dayLong(x.exitDate)}</div> : null}
        {e.decisionNote ? <div className="text-[13px] text-[#475569]">HR ({e.decidedBy}): “{e.decisionNote}”</div> : null}
        {e.status === "requested" ? <div><button className={dangerCls} disabled={busy} onClick={() => run(() => withdrawResignation())}>Withdraw resignation</button></div> : null}
      </div> : x.exitDate ? <div className="text-[13.5px] font-semibold mb-3">Your last working day is {dayLong(x.exitDate)}.</div> : null}
      {x.canResign ? <button className={btnCls} onClick={() => setOpen(true)}>Resign</button> : null}
      {x.interviewOpen ? <ExitInterview x={x} /> : x.exitDate && e?.interviewAt ? <p className="text-[13px] text-[#1E7F4F] mt-2">✓ Exit interview sent on {dayLabel(e.interviewAt)}. Thank you.</p> : null}
      {open ? <Modal title="Resign" onClose={() => setOpen(false)}>
        <form className="flex flex-col gap-3" onSubmit={(ev) => { ev.preventDefault(); run(() => resign(f), () => setOpen(false)); }}>
          <Field label="Why are you leaving?" hint="HR and your manager read this."><textarea className={inputCls} rows={4} value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} required minLength={10} /></Field>
          <Field label="Last working day you’d like" hint={`Serving the full notice period ends on ${dayLong(x.suggested)}. HR confirms the date.`}><input className={inputCls} type="date" min={x.today} value={f.lastDay} onChange={(ev) => setF({ ...f, lastDay: ev.target.value })} required /></Field>
          <button className={primaryCls} disabled={busy}>Send resignation to HR</button>
        </form>
      </Modal> : null}
    </Card>
  );
}

function ExitInterview({ x }: { x: MyExit }) {
  const { run, busy } = useRun();
  const [a, setA] = useState<Record<string, string | number>>({});
  return <form className="flex flex-col gap-3 mt-3 border-t border-[#E2E8F0] pt-3" onSubmit={(ev) => { ev.preventDefault(); run(() => saveExitInterview(a)); }}>
    <div><div className="text-[14px] font-bold">Exit interview</div><div className="text-[12.5px] text-[#64748B]">Only HR sees your answers. Please be honest: it helps us improve.</div></div>
    {x.questions.map((q) => <Field key={q.id} label={q.label}>{q.kind === "text"
      ? <textarea className={inputCls} rows={2} value={String(a[q.id] ?? "")} onChange={(ev) => setA({ ...a, [q.id]: ev.target.value })} />
      : q.kind === "rating"
        ? <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} aria-label={`${n} of 5`} className={a[q.id] === n ? primaryCls : btnCls} onClick={() => setA({ ...a, [q.id]: n })}>{n}</button>)}</div>
        : <select className={inputCls} value={String(a[q.id] ?? "")} onChange={(ev) => setA({ ...a, [q.id]: ev.target.value })} required={q.id === "reason"}><option value="">Choose…</option>{q.options.map((o) => <option key={o}>{o}</option>)}</select>}</Field>)}
    <div><button className={primaryCls} disabled={busy}>Send exit interview</button></div>
  </form>;
}

/** HR → Exits: decide resignations, tick clearance, read exit interviews. */
export function ExitsScreen({ d }: { d: Data<"hrexits"> }) {
  const { run, busy } = useRun();
  const [dec, setDec] = useState<{ id: string; name: string; accept: boolean; lastDay: string; note: string } | null>(null);
  const [talk, setTalk] = useState<(typeof d.leaving)[number] | null>(null);
  const active = d.leaving.filter((p) => !p.left);
  return <>
    <Grid n={3}><Stat l="Resignations waiting" v={d.requests.length} c={d.requests.length ? "#B45309" : undefined} /><Stat l="Serving notice" v={active.length} /><Stat l="Left in the last 30 days" v={d.leaving.length - active.length} /></Grid>
    <Card title="Resignations waiting for you" pad>{d.requests.length ? d.requests.map((r) => <div key={r.id} className="flex gap-3 items-start border border-[#E2E8F0] rounded-xl p-3 mb-2">
      <Avatar name={r.name} size={36} />
      <div className="flex-1 min-w-0"><div className="font-bold text-[14px]">{r.name} <span className="text-[12px] text-[#94A3B8] font-normal">{r.empNo}</span></div>
        <div className="text-[12px] text-[#64748B]">{r.designation}{r.dept ? ` · ${r.dept}` : ""} · resigned {dayLabel(r.createdAt)}</div>
        <div className="text-[13px] mt-1.5">“{r.reason}”</div>
        <div className="text-[12.5px] mt-1">Asked-for last working day: <strong>{r.proposedLastDay ? dayLong(r.proposedLastDay) : "—"}</strong>{r.short ? <> <Pill tone="amber">shorter than notice</Pill></> : null}</div></div>
      <div className="flex flex-col gap-1.5"><button className={primaryCls} onClick={() => setDec({ id: r.id, name: r.name, accept: true, lastDay: r.proposedLastDay ?? d.today, note: "" })}>Accept</button><button className={dangerCls} onClick={() => setDec({ id: r.id, name: r.name, accept: false, lastDay: "", note: "" })}>Decline</button></div>
    </div>) : <Empty>No resignations waiting.</Empty>}</Card>
    <Card title="Leaving and recently left" sub="Tick each item as it is done. Assets still issued are counted from the asset register." pad>{d.leaving.length ? <Grid n={2}>{d.leaving.map((p) => {
      const n = d.items.filter((i) => p.clearance[i.id]).length;
      return <div key={p.staffId} className="border border-[#E2E8F0] rounded-xl p-3">
        <div className="flex items-center gap-2.5"><Avatar name={p.name} size={34} /><div className="flex-1 min-w-0"><div className="font-bold text-[14px]">{p.name}</div><div className="text-[12px] text-[#64748B]">{p.designation} · last day {dayLabel(p.exitDate)}</div></div><Pill tone={p.left ? "gray" : "amber"}>{p.left ? "Left" : p.resigned ? "Resigned" : "Exit recorded"}</Pill></div>
        <div className="h-1.5 bg-[#E2E8F0] rounded-full mt-3"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${(n * 100) / d.items.length}%` }} /></div>
        <div className="text-[11.5px] text-[#64748B] mt-1 mb-1.5">Clearance: {n} of {d.items.length} done{p.assetsOut ? ` · ${p.assetsOut} asset${p.assetsOut > 1 ? "s" : ""} still issued` : ""}</div>
        {d.items.map((i) => <label key={i.id} className="flex items-center gap-2 py-0.5 text-[13px] cursor-pointer"><input type="checkbox" checked={!!p.clearance[i.id]} disabled={busy} onChange={(ev) => run(() => tickClearance(p.staffId, i.id, ev.target.checked))} />{i.label}{p.clearance[i.id] ? <span className="text-[11px] text-[#94A3B8]">· {p.clearance[i.id].by}</span> : null}</label>)}
        <div className="mt-2 text-[12.5px]">{p.interviewAt ? <button className={btnCls} onClick={() => setTalk(p)}>Read exit interview</button> : <span className="text-[#64748B]">Exit interview not filled in yet</span>}</div>
      </div>;
    })}</Grid> : <Empty>Nobody is leaving.</Empty>}</Card>
    {dec ? <Modal title={`${dec.accept ? "Accept" : "Decline"} ${dec.name}’s resignation`} onClose={() => setDec(null)}>
      <form className="flex flex-col gap-3" onSubmit={(ev) => { ev.preventDefault(); run(() => decideResignation(dec.id, { accept: dec.accept, lastDay: dec.accept ? dec.lastDay : undefined, note: dec.note }), () => setDec(null)); }}>
        {dec.accept ? <Field label="Last working day" hint="This records the exit. Payroll pays up to this day and adds the final settlement; they are signed out the day after."><input className={inputCls} type="date" min={d.today} value={dec.lastDay} onChange={(ev) => setDec({ ...dec, lastDay: ev.target.value })} required /></Field> : null}
        <Field label={dec.accept ? "Note to the employee (optional)" : "Why isn’t it accepted?"}><textarea className={inputCls} rows={3} value={dec.note} onChange={(ev) => setDec({ ...dec, note: ev.target.value })} required={!dec.accept} minLength={dec.accept ? 0 : 5} /></Field>
        <button className={dec.accept ? primaryCls : dangerCls} disabled={busy}>{dec.accept ? "Accept and record exit" : "Decline resignation"}</button>
      </form>
    </Modal> : null}
    {talk ? <Modal title={`Exit interview · ${talk.name}`} onClose={() => setTalk(null)}>
      {talk.reason ? <p className="text-[13px] text-[#475569]">Resignation reason: “{talk.reason}”</p> : null}
      <dl className="flex flex-col gap-2.5">{d.questions.map((q) => <div key={q.id}><dt className="text-[12px] font-semibold text-[#64748B]">{q.label}</dt><dd className="text-[13.5px]">{talk.interview[q.id] !== undefined ? String(talk.interview[q.id]) + (q.kind === "rating" ? " / 5" : "") : "—"}</dd></div>)}</dl>
    </Modal> : null}
  </>;
}
