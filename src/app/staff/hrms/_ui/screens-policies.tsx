"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { POLICY_CATEGORIES } from "@/staff/hrms/constants";
import { acknowledgePolicy, archivePolicy, remindPolicy, savePolicy } from "../actions";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, btnCls, dangerCls, dayLabel, inputCls, primaryCls, useRun } from "./kit";

/** Policy text: a blank line starts a paragraph; lines starting with "- " are bullets. Rendered as text, never HTML. */
function PolicyText({ body }: { body: string }) {
  return <div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-[#1f2937]">{body.split(/\n\s*\n/).map((block, i) => {
    const lines = block.split("\n").filter((l) => l.trim());
    return lines.every((l) => l.trim().startsWith("- "))
      ? <ul key={i} className="list-disc pl-5 flex flex-col gap-1">{lines.map((l, j) => <li key={j}>{l.trim().slice(2)}</li>)}</ul>
      : <p key={i} className="whitespace-pre-line">{block.trim()}</p>;
  })}</div>;
}

/** Everyone → Company policies: read the handbook and acknowledge each mandatory policy. */
export function PoliciesScreen({ d }: { d: Data<"policies"> }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState<string | null>(null);
  const pending = d.policies.filter((p) => p.mandatory && !p.acked);
  const p = d.policies.find((x) => x.id === open) ?? null;
  return <>
    {pending.length ? <Card pad><div className="flex items-center gap-2 text-[13.5px]"><Pill tone="amber">{pending.length} to acknowledge</Pill>Please read {pending.length === 1 ? "this policy" : "these policies"} and confirm you accept {pending.length === 1 ? "it" : "them"}.</div></Card> : null}
    {d.policies.length ? <Grid n={2}>{d.policies.map((x) => <Card key={x.id} pad>
      <div className="flex items-start gap-2"><div className="flex-1 min-w-0"><div className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#64748B]">{x.category}</div><div className="font-bold text-[15px]">{x.title}</div><div className="text-[12px] text-[#64748B]">Version {x.version} · updated {dayLabel(x.updatedAt)}</div></div>
        {x.mandatory ? <Pill tone={x.acked ? "green" : "amber"}>{x.acked ? "Acknowledged" : x.ackedBefore ? "Updated: acknowledge again" : "To acknowledge"}</Pill> : <Pill tone="gray">For information</Pill>}</div>
      <div className="mt-3"><button className={btnCls} onClick={() => setOpen(x.id)}>Read policy</button></div>
    </Card>)}</Grid> : <Card pad><Empty>HR hasn’t published any policies yet.</Empty></Card>}
    {p ? <Modal title={p.title} onClose={() => setOpen(null)} wide>
      <div className="text-[12px] text-[#64748B]">{p.category} · version {p.version} · updated {dayLabel(p.updatedAt)}</div>
      <div className="max-h-[60vh] overflow-auto pr-1"><PolicyText body={p.body} /></div>
      {p.mandatory ? p.acked ? <p className="text-[13px] text-[#1E7F4F]">✓ You have acknowledged this version.</p>
        : <button className={primaryCls} disabled={busy} onClick={() => run(() => acknowledgePolicy(p.id), () => setOpen(null))}>I have read and accept this policy</button> : null}
    </Modal> : null}
  </>;
}

type Form = { id: string | null; title: string; category: string; body: string; mandatory: boolean; reack: boolean };
const blank: Form = { id: null, title: "", category: POLICY_CATEGORIES[0], body: "", mandatory: true, reack: false };

/** HR → Policies: publish, edit and archive policies; see who has acknowledged the current version. */
export function HrPoliciesScreen({ d }: { d: Data<"hrpolicies"> }) {
  const { run, busy } = useRun();
  const [f, setF] = useState<Form | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const live = d.policies.filter((p) => !p.archived);
  const w = d.policies.find((p) => p.id === who) ?? null;
  return <>
    <Grid n={3}><Stat l="Live policies" v={live.length} /><Stat l="Mandatory" v={live.filter((p) => p.mandatory).length} /><Stat l="Acknowledgements missing" v={live.filter((p) => p.mandatory).reduce((a, p) => a + p.pending.length, 0)} c="#B45309" /></Grid>
    <Card title="Company handbook" right={<button className={primaryCls} onClick={() => setF(blank)}>+ New policy</button>} pad>{d.policies.length ? <div className="flex flex-col gap-2">{d.policies.map((p) => {
      const total = p.acked.length + p.pending.length;
      return <div key={p.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl p-3 flex-wrap">
        <div className="flex-1 min-w-[220px]"><div className="font-bold text-[14px]">{p.title} {p.archived ? <Pill tone="gray">Archived</Pill> : null}</div><div className="text-[12px] text-[#64748B]">{p.category} · v{p.version} · by {p.publishedBy || "—"} · {dayLabel(p.updatedAt)}{p.mandatory ? "" : " · for information"}</div></div>
        {p.mandatory && !p.archived ? <button className={btnCls} onClick={() => setWho(p.id)}>{p.acked.length} of {total} acknowledged</button> : null}
        <div className="flex gap-1.5">
          {!p.archived ? <button className={btnCls} onClick={() => setF({ id: p.id, title: p.title, category: p.category, body: p.body, mandatory: p.mandatory, reack: false })}>Edit</button> : null}
          {p.mandatory && !p.archived && p.pending.length ? <button className={btnCls} disabled={busy} onClick={() => run(() => remindPolicy(p.id))}>Remind</button> : null}
          <button className={p.archived ? btnCls : dangerCls} disabled={busy} onClick={() => run(() => archivePolicy(p.id, !p.archived))}>{p.archived ? "Restore" : "Archive"}</button>
        </div>
      </div>;
    })}</div> : <Empty>No policies yet. Publish the first one: leave, attendance, code of conduct…</Empty>}</Card>
    {f ? <Modal title={f.id ? "Edit policy" : "New policy"} onClose={() => setF(null)} wide>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => savePolicy(f.id, { title: f.title, category: f.category, body: f.body, mandatory: f.mandatory, reack: f.reack }), () => setF(null)); }}>
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]"><Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} /></Field>
          <Field label="Category"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{POLICY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field></div>
        <Field label="Policy text" hint="A blank line starts a new paragraph. Start a line with “- ” for a bullet."><textarea className={inputCls} rows={14} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required minLength={20} /></Field>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} />Everyone must read and acknowledge it</label>
        {f.id && f.mandatory ? <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.reack} onChange={(e) => setF({ ...f, reack: e.target.checked })} />This is an important change: ask everyone to acknowledge it again (new version)</label> : null}
        <button className={primaryCls} disabled={busy}>{f.id ? "Save" : "Publish and tell everyone"}</button>
      </form>
    </Modal> : null}
    {w ? <Modal title={`${w.title} · v${w.version}`} onClose={() => setWho(null)}>
      <div className="text-[13px] font-semibold">Not acknowledged yet ({w.pending.length})</div>
      <div className="flex flex-wrap gap-1.5">{w.pending.length ? w.pending.map((x) => <Pill key={x.empNo} tone="amber">{x.name}</Pill>) : <span className="text-[13px] text-[#64748B]">Everyone has acknowledged it.</span>}</div>
      <div className="text-[13px] font-semibold mt-2">Acknowledged ({w.acked.length})</div>
      <div className="flex flex-col gap-1 text-[13px]">{w.acked.map((x) => <div key={x.empNo}>{x.name} <span className="text-[#94A3B8]">· {dayLabel(x.at)}</span></div>)}</div>
    </Modal> : null}
  </>;
}
