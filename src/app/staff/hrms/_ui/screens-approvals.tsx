"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { addAccessGrant, cancelApproval, cancelDelegation, decideApproval, delegateApprovals, requestApproval, revokeAccessGrant } from "../actions";
import { Card, Field, Grid, Modal, Pill, Table, btnCls, dangerCls, dayLabel, inputCls, primaryCls, statusTone, tdCls, useRun } from "./kit";

type D = Data<"approvals">;
type A = D["waiting"][number];
const STEP_TONE: Record<string, "green" | "amber" | "red" | "gray" | "blue"> = { approved: "green", pending: "amber", rejected: "red", skipped: "gray", waiting: "blue" };

function Steps({ a }: { a: A }) {
  return <ol className="m-0 p-0 list-none flex flex-wrap gap-1.5">{a.steps.map((s) => <li key={s.seq}><Pill tone={s.overdue ? "red" : STEP_TONE[s.status] ?? "gray"}>{s.seq}. {s.label}: {s.status}{s.by ? ` · ${s.by}` : ""}{s.overdue ? " · overdue" : ""}</Pill></li>)}</ol>;
}

/** Approvals: decide what waits on me, follow and withdraw my requests, ask for access, delegate, and (super admin) individual access. */
export function ApprovalsHubScreen({ d }: { d: D }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState<A | null>(null), [comment, setComment] = useState("");
  const [form, setForm] = useState<"ctc" | "access" | "delegate" | "grant" | null>(null);
  const [ctc, setCtc] = useState({ staffId: "", toCtc: "", reason: "" });
  const [acc, setAcc] = useState<{ module: string; days: string; reason: string }>({ module: d.modules[0]?.id ?? "", days: "7", reason: "" });
  const [del, setDel] = useState({ toId: "", from: "", to: "", reason: "" });
  const [gr, setGr] = useState<{ staffId: string; module: string; effect: string; reason: string; until: string }>({ staffId: "", module: d.allModules[0]?.id ?? "", effect: "grant", reason: "", until: "" });
  const close = () => setForm(null);
  return <>
    <Card title="Waiting for you" sub="Requests where you are the next approver (or decide for someone who delegated to you). You never decide your own requests or ones about you." right={<>
      {d.canCtc ? <button className={btnCls} onClick={() => setForm("ctc")}>Propose a salary change</button> : null}
      {d.modules.length ? <button className={btnCls} onClick={() => setForm("access")}>Ask for access</button> : null}
      <button className={btnCls} onClick={() => setForm("delegate")}>Delegate my approvals</button>
    </>}>
      <Table head={["Request", "From", "Steps", ""]} empty="Nothing is waiting for you.">
        {d.waiting.map((a) => <tr key={a.id}><td className={tdCls}><strong>{a.label}</strong><div className="text-[12.5px]">{a.title}</div></td><td className={tdCls}>{a.by}<div className="text-[11.5px] text-[#94A3B8]">{dayLabel(a.at)}</div></td><td className={tdCls}><Steps a={a} /></td><td className={tdCls}><button className={primaryCls} onClick={() => { setOpen(a); setComment(""); }}>Review</button></td></tr>)}
      </Table>
    </Card>
    <Card title="My requests">
      <Table head={["Request", "Status", "Steps", ""]} empty="You haven’t asked for anything yet.">
        {d.mine.map((a) => <tr key={a.id}><td className={tdCls}><strong>{a.label}</strong><div className="text-[12.5px]">{a.title}</div><div className="text-[11.5px] text-[#94A3B8]">{dayLabel(a.at)}</div></td><td className={tdCls}><Pill tone={statusTone(a.status)}>{a.status}</Pill></td><td className={tdCls}><Steps a={a} /></td><td className={tdCls}>{a.status === "pending" ? <button className={dangerCls} disabled={busy} onClick={() => run(() => cancelApproval(a.id))}>Withdraw</button> : null}</td></tr>)}
      </Table>
    </Card>
    <Card title="Delegation" sub="While you are away, a colleague can decide the approvals that wait on you. Both of you can then decide; each decision records who made it.">
      <Table head={["From", "To", "Period", "Reason", ""]} empty="No delegation in force.">
        {d.delegations.map((x) => <tr key={x.id}><td className={tdCls}>{x.from}</td><td className={tdCls}>{x.to}</td><td className={tdCls}>{dayLabel(x.fromDay)} – {dayLabel(x.toDay)}</td><td className={tdCls}>{x.reason}</td><td className={tdCls}>{x.mine ? <button className={dangerCls} disabled={busy} onClick={() => run(() => cancelDelegation(x.id))}>Cancel</button> : null}</td></tr>)}
      </Table>
    </Card>
    {d.grants ? <Card title="Individual access" sub="Give one person a module their role doesn’t have, or take one away, with a reason and an end date. A removal always wins. Every change is in Audit Logs." right={<button className={btnCls} onClick={() => setForm("grant")}>Change someone’s access</button>}>
      <Table head={["Person", "Change", "Reason", "Until", ""]} empty="No individual access changes.">
        {d.grants.map((g) => <tr key={g.id}><td className={tdCls}>{g.name} <span className="text-[12px] text-[#94A3B8]">{g.empNo}</span></td><td className={tdCls}><Pill tone={g.effect === "grant" ? "green" : "red"}>{g.effect === "grant" ? "+ " : "− "}{d.allModules.find((m) => m.id === g.module)?.label ?? g.module}</Pill>{g.live ? null : <span className="text-[11.5px] text-[#94A3B8]"> {g.revoked ? "ended" : "expired"}</span>}</td><td className={tdCls}>{g.reason}</td><td className={tdCls}>{g.until ? dayLabel(g.until) : "No end"}</td><td className={tdCls}>{g.live ? <button className={dangerCls} disabled={busy} onClick={() => run(() => revokeAccessGrant(g.id))}>End now</button> : null}</td></tr>)}
      </Table>
    </Card> : null}

    {open ? <Modal title={`${open.label}: ${open.title}`} onClose={() => setOpen(null)}>
      <p className="text-[13px]"><strong>Asked by:</strong> {open.by} on {dayLabel(open.at)}</p>
      {open.reason ? <p className="text-[13px] whitespace-pre-line"><strong>Reason:</strong> {open.reason}</p> : null}
      <Steps a={open} />
      <Field label="Comment" hint="Needed when you reject."><textarea className={inputCls} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="flex gap-2"><button className={primaryCls} disabled={busy} onClick={() => run(() => decideApproval(open.id, true, comment), () => setOpen(null))}>Approve</button><button className={dangerCls} disabled={busy} onClick={() => run(() => decideApproval(open.id, false, comment), () => setOpen(null))}>Reject</button></div>
    </Modal> : null}

    {form === "ctc" ? <Modal title="Propose a salary change" onClose={close}>
      <p className="text-[12.5px] text-[#64748B]">The person’s reporting manager and then the super admin approve it. The new CTC is saved, with a salary revision, only after the last approval.{d.ctcNeedsApproval ? " Settings require this route for every salary change." : ""}</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => requestApproval("ctc_change", ctc), close); }}>
        <Field label="Employee"><select className={inputCls} value={ctc.staffId} onChange={(e) => setCtc({ ...ctc, staffId: e.target.value })} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.empNo}</option>)}</select></Field>
        <Field label="New annual CTC (₹)"><input className={inputCls} inputMode="numeric" value={ctc.toCtc} onChange={(e) => setCtc({ ...ctc, toCtc: e.target.value.replace(/\D/g, "") })} required /></Field>
        <Field label="Reason"><textarea className={inputCls} rows={3} value={ctc.reason} onChange={(e) => setCtc({ ...ctc, reason: e.target.value })} required minLength={10} /></Field>
        <div><button className={primaryCls} disabled={busy}>Send for approval</button></div>
      </form>
    </Modal> : null}
    {form === "access" ? <Modal title="Ask for access" onClose={close}>
      <p className="text-[12.5px] text-[#64748B]">For a few days only (cover for a colleague, a one-off task). Your manager and then the super admin approve it; it ends by itself.</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => requestApproval("access", acc), close); }}>
        <Grid n={2}><Field label="Module"><select className={inputCls} value={acc.module} onChange={(e) => setAcc({ ...acc, module: e.target.value })}>{d.modules.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
        <Field label="Days (1–30)"><input className={inputCls} inputMode="numeric" value={acc.days} onChange={(e) => setAcc({ ...acc, days: e.target.value.replace(/\D/g, "") })} required /></Field></Grid>
        <Field label="What you need it for"><textarea className={inputCls} rows={3} value={acc.reason} onChange={(e) => setAcc({ ...acc, reason: e.target.value })} required minLength={10} /></Field>
        <div><button className={primaryCls} disabled={busy}>Send request</button></div>
      </form>
    </Modal> : null}
    {form === "delegate" ? <Modal title="Delegate my approvals" onClose={close}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => delegateApprovals(del), close); }}>
        <Field label="Colleague"><select className={inputCls} value={del.toId} onChange={(e) => setDel({ ...del, toId: e.target.value })} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.empNo}</option>)}</select></Field>
        <Grid n={2}><Field label="From"><input type="date" className={inputCls} value={del.from} onChange={(e) => setDel({ ...del, from: e.target.value })} required /></Field><Field label="To"><input type="date" className={inputCls} value={del.to} onChange={(e) => setDel({ ...del, to: e.target.value })} required /></Field></Grid>
        <Field label="Reason (optional)"><input className={inputCls} value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value })} /></Field>
        <div><button className={primaryCls} disabled={busy}>Delegate</button></div>
      </form>
    </Modal> : null}
    {form === "grant" && d.grants ? <Modal title="Change one person’s access" onClose={close}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => addAccessGrant(gr), close); }}>
        <Field label="Employee"><select className={inputCls} value={gr.staffId} onChange={(e) => setGr({ ...gr, staffId: e.target.value })} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.empNo}</option>)}</select></Field>
        <Grid n={2}><Field label="Module"><select className={inputCls} value={gr.module} onChange={(e) => setGr({ ...gr, module: e.target.value })}>{d.allModules.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
        <Field label="Change"><select className={inputCls} value={gr.effect} onChange={(e) => setGr({ ...gr, effect: e.target.value })}><option value="grant">Give this module</option><option value="deny">Take this module away</option></select></Field></Grid>
        <Field label="Last day (optional)"><input type="date" className={inputCls} value={gr.until} onChange={(e) => setGr({ ...gr, until: e.target.value })} /></Field>
        <Field label="Reason"><input className={inputCls} value={gr.reason} onChange={(e) => setGr({ ...gr, reason: e.target.value })} required minLength={5} /></Field>
        <div><button className={primaryCls} disabled={busy}>Save</button></div>
      </form>
    </Modal> : null}
  </>;
}
