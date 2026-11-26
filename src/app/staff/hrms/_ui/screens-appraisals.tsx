"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Data } from "@/staff/hrms/screens";
import { acknowledgeReview, closeReviewCycle, finalizeReview, openReviewCycle, submitManagerReview, submitSelfReview } from "../actions";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, Table, btnCls, dangerCls, dayLabel, download, inputCls, primaryCls, tdCls, useRun } from "./kit";

type Ratings = Data<"appraisal">["ratings"];
type Facts = { tasksDone: number; onTimePct: number | null; openOverdue: number; daysIn: number; lateDays: number };
const STATUS: Record<string, [string, "amber" | "blue" | "green" | "gray"]> = { self: ["Self-assessment due", "amber"], manager: ["With manager", "blue"], hr: ["With HR", "blue"], done: ["Complete", "green"] };
const label = (ratings: Ratings, v: number | null) => (v ? `${v} · ${ratings.find((r) => r.v === v)?.label ?? ""}` : "—");

function RatingPick({ ratings, value, onChange }: { ratings: Ratings; value: number; onChange: (v: number) => void }) {
  return <div className="flex flex-wrap gap-1.5" role="radiogroup">{ratings.map((r) => <button type="button" key={r.v} role="radio" aria-checked={value === r.v} aria-label={`${r.v} ${r.label}`} className={value === r.v ? primaryCls : btnCls} onClick={() => onChange(r.v)}>{r.v} · {r.label}</button>)}</div>;
}
function FactsLine({ f }: { f: Facts }) {
  return <div className="text-[12px] text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">In the review period: <strong>{f.tasksDone}</strong> tasks done{f.onTimePct !== null ? <> (<strong>{f.onTimePct}%</strong> on time)</> : null} · <strong>{f.openOverdue}</strong> open past due · <strong>{f.daysIn}</strong> days checked in, <strong>{f.lateDays}</strong> late</div>;
}
function Answers({ rows }: { rows: [string, string | undefined | null][] }) {
  return <dl className="flex flex-col gap-2">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-[11.5px] font-semibold text-[#64748B] uppercase tracking-[.04em]">{k}</dt><dd className="text-[13.5px] whitespace-pre-line">{v}</dd></div>)}</dl>;
}

/** My Review: my self-assessment and result; my direct reports' reviews when I am their manager. */
export function AppraisalScreen({ d }: { d: Data<"appraisal"> }) {
  const { run, busy } = useRun();
  const [self, setSelf] = useState({ rating: 0, achievements: "", challenges: "", goals: "" });
  const [mgrFor, setMgrFor] = useState<string | null>(null);
  const [mgr, setMgr] = useState({ rating: 0, strengths: "", improve: "", comments: "" });
  const m = d.team.find((x) => x.id === mgrFor) ?? null;
  return <>
    {d.mine.length ? d.mine.map((r) => <Card key={r.id} title={`${r.cycle} review`} sub={`Period ${dayLabel(r.periodFrom)} – ${dayLabel(r.periodTo)} · self-assessment due ${dayLabel(r.selfDue)}`} right={<Pill tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Pill>} pad>
      {r.status === "self" && r.cycleOpen ? <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => submitSelfReview(r.id, self)); }}>
        <Field label="How would you rate your own performance?"><RatingPick ratings={d.ratings} value={self.rating} onChange={(v) => setSelf({ ...self, rating: v })} /></Field>
        <Field label="Main achievements"><textarea className={inputCls} rows={4} value={self.achievements} onChange={(e) => setSelf({ ...self, achievements: e.target.value })} required minLength={20} /></Field>
        <Field label="Challenges (optional)"><textarea className={inputCls} rows={3} value={self.challenges} onChange={(e) => setSelf({ ...self, challenges: e.target.value })} /></Field>
        <Field label="Goals for the next period"><textarea className={inputCls} rows={3} value={self.goals} onChange={(e) => setSelf({ ...self, goals: e.target.value })} required minLength={10} /></Field>
        <div><button className={primaryCls} disabled={busy || !self.rating}>Send self-assessment</button></div>
      </form> : <div className="flex flex-col gap-3">
        {r.status === "done" ? <div className="border border-[#BFE6DF] bg-[#F0FAF8] rounded-xl p-3"><div className="text-[12px] text-[#64748B]">Final rating (by {r.finalBy})</div><div className="text-[18px] font-bold text-[#0B5E5B]">{label(d.ratings, r.finalRating)}</div>{r.hrNote ? <p className="text-[13px] mt-1">“{r.hrNote}”</p> : null}</div> : <p className="text-[13px] text-[#64748B]">Your self-assessment was sent{r.selfAt ? ` on ${dayLabel(r.selfAt)}` : ""}. {r.status === "manager" ? `Waiting for ${r.manager || "your manager"}.` : "Waiting for HR."}</p>}
        {r.status === "done" && r.mgrAt ? <><div className="text-[13px] font-bold">{r.mgrBy}’s review · {label(d.ratings, r.mgrRating)}</div><Answers rows={[["What went well", r.mgr.strengths], ["To improve", r.mgr.improve], ["Comments", r.mgr.comments]]} /></> : null}
        <details><summary className="text-[13px] font-semibold cursor-pointer">My self-assessment · {label(d.ratings, r.selfRating)}</summary><div className="mt-2"><Answers rows={[["Achievements", r.self.achievements], ["Challenges", r.self.challenges], ["Goals", r.self.goals]]} /></div></details>
        {r.status === "done" ? r.ackAt ? <p className="text-[12.5px] text-[#1E7F4F]">✓ You acknowledged this review on {dayLabel(r.ackAt)}.</p> : <div><button className={primaryCls} disabled={busy} onClick={() => run(() => acknowledgeReview(r.id))}>I have read my review</button></div> : null}
      </div>}
    </Card>) : <Card pad><Empty>No performance review for you yet. HR opens review cycles.</Empty></Card>}
    {d.team.length ? <Card title="Your team’s reviews" sub="People who report to you. Read their self-assessment, then give your rating and comments.">
      <Table head={["Person", "Self rating", "Your rating", "Status", ""]}>{d.team.map((x) => <tr key={x.id}><td className={tdCls}><strong>{x.name}</strong> <span className="text-[12px] text-[#94A3B8]">{x.cycle}</span></td><td className={tdCls}>{label(d.ratings, x.selfRating)}</td><td className={tdCls}>{label(d.ratings, x.mgrRating)}</td><td className={tdCls}><Pill tone={STATUS[x.status][1]}>{x.status === "manager" ? "Your review due" : STATUS[x.status][0]}</Pill></td><td className={tdCls}><button className={x.status === "manager" ? primaryCls : btnCls} onClick={() => { setMgrFor(x.id); setMgr({ rating: 0, strengths: "", improve: "", comments: "" }); }}>{x.status === "manager" ? "Review" : "Open"}</button></td></tr>)}</Table>
    </Card> : null}
    {m ? <Modal title={`${m.name} · ${m.cycle}`} onClose={() => setMgrFor(null)} wide>
      <FactsLine f={m.facts} />
      <div className="text-[13px] font-bold">Self-assessment · {label(d.ratings, m.selfRating)}</div>
      <Answers rows={[["Achievements", m.self.achievements], ["Challenges", m.self.challenges], ["Goals", m.self.goals]]} />
      {m.status === "manager" ? <form className="flex flex-col gap-3 border-t border-[#E2E8F0] pt-3" onSubmit={(e) => { e.preventDefault(); run(() => submitManagerReview(m.id, mgr), () => setMgrFor(null)); }}>
        <Field label="Your rating"><RatingPick ratings={d.ratings} value={mgr.rating} onChange={(v) => setMgr({ ...mgr, rating: v })} /></Field>
        <Field label="What went well"><textarea className={inputCls} rows={3} value={mgr.strengths} onChange={(e) => setMgr({ ...mgr, strengths: e.target.value })} required minLength={10} /></Field>
        <Field label="What to improve"><textarea className={inputCls} rows={3} value={mgr.improve} onChange={(e) => setMgr({ ...mgr, improve: e.target.value })} required minLength={10} /></Field>
        <Field label="Other comments (optional)"><textarea className={inputCls} rows={2} value={mgr.comments} onChange={(e) => setMgr({ ...mgr, comments: e.target.value })} /></Field>
        <div><button className={primaryCls} disabled={busy || !mgr.rating}>Send to HR</button></div>
      </form> : <><div className="text-[13px] font-bold">Your review · {label(d.ratings, m.mgrRating)}</div><Answers rows={[["What went well", m.mgr.strengths], ["To improve", m.mgr.improve], ["Comments", m.mgr.comments]]} /></>}
    </Modal> : null}
  </>;
}

/** HR → Appraisals: open and close cycles, follow progress, set final ratings, export. */
export function HrAppraisalsScreen({ d }: { d: Data<"hrappraisals"> }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const [newC, setNewC] = useState<{ name: string; periodFrom: string; periodTo: string; selfDue: string; managerDue: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [fin, setFin] = useState({ rating: 0, note: "" });
  const r = d.reviews.find((x) => x.id === open) ?? null;
  const n = (s: string) => d.reviews.filter((x) => x.status === s).length;
  const isOpen = d.cycle?.status === "open";
  const exportCsv = () => d.cycle && download(`review-${d.cycle.name.replace(/\W+/g, "-")}.csv`, ["Name,Manager,Status,Self rating,Manager rating,Final rating,Tasks done,On time %,Days in,Late days", ...d.reviews.map((x) => [x.name, x.manager, x.status, x.selfRating ?? "", x.mgrRating ?? "", x.finalRating ?? "", x.facts.tasksDone, x.facts.onTimePct ?? "", x.facts.daysIn, x.facts.lateDays].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n"));
  return <>
    <Card pad><div className="flex items-center gap-2 flex-wrap">
      {d.cycles.length ? <select aria-label="Review cycle" className={inputCls + " !w-auto"} value={d.cycle?.id ?? ""} onChange={(e) => router.push(`/staff/hrms/hrappraisals?c=${e.target.value}`)}>{d.cycles.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "open" ? " (open)" : ""}</option>)}</select> : <span className="text-[13.5px]">No review cycles yet.</span>}
      {d.cycle ? <span className="text-[12.5px] text-[#64748B]">Period {dayLabel(d.cycle.periodFrom)} – {dayLabel(d.cycle.periodTo)} · self due {dayLabel(d.cycle.selfDue)} · managers due {dayLabel(d.cycle.managerDue)}</span> : null}
      <div className="ml-auto flex gap-1.5">{d.cycle ? <button className={btnCls} onClick={exportCsv}>↓ Export CSV</button> : null}
        {isOpen ? <button className={dangerCls} disabled={busy} onClick={() => { if (confirm(`Close ${d.cycle!.name}? Nobody can change it afterwards.`)) run(() => closeReviewCycle(d.cycle!.id)); }}>Close cycle</button>
          : <button className={primaryCls} onClick={() => setNewC({ name: "", periodFrom: "", periodTo: d.today, selfDue: "", managerDue: "" })}>+ New review cycle</button>}</div>
    </div></Card>
    {d.cycle ? <>
      <Grid n={4}><Stat l="Self-assessment due" v={n("self")} c="#B45309" /><Stat l="With managers" v={n("manager")} /><Stat l="With HR" v={n("hr")} c={n("hr") ? "#B45309" : undefined} /><Stat l="Complete" v={n("done")} /></Grid>
      <Card title={`${d.cycle.name} · ${d.reviews.length} people`}><Table head={["Person", "Manager", "Self", "Manager", "Final", "Status", ""]}>{d.reviews.map((x) => <tr key={x.id}><td className={tdCls}><strong>{x.name}</strong></td><td className={tdCls}>{x.manager || <span className="text-[#94A3B8]">HR reviews</span>}</td><td className={tdCls}>{x.selfRating ?? "—"}</td><td className={tdCls}>{x.mgrRating ?? "—"}</td><td className={tdCls}>{x.finalRating ? <strong>{x.finalRating}</strong> : "—"}</td><td className={tdCls}><Pill tone={STATUS[x.status][1]}>{STATUS[x.status][0]}</Pill>{x.ackAt ? <span className="text-[11px] text-[#1E7F4F]"> ✓ seen</span> : null}</td><td className={tdCls}><button className={x.status === "hr" ? primaryCls : btnCls} onClick={() => { setOpen(x.id); setFin({ rating: x.mgrRating ?? x.selfRating ?? 0, note: "" }); }}>{x.status === "hr" ? "Finalise" : "Open"}</button></td></tr>)}</Table></Card>
    </> : <Card pad><Empty>Open a review cycle to start: everyone active gets a self-assessment, then their manager reviews them, then you set the final rating.</Empty></Card>}
    {newC ? <Modal title="New review cycle" onClose={() => setNewC(null)}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => openReviewCycle(newC), () => setNewC(null)); }}>
        <Field label="Name" hint="e.g. H2 2026 or FY 2026-27"><input className={inputCls} value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} required minLength={3} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Period from"><input className={inputCls} type="date" value={newC.periodFrom} onChange={(e) => setNewC({ ...newC, periodFrom: e.target.value })} required /></Field><Field label="Period to"><input className={inputCls} type="date" value={newC.periodTo} onChange={(e) => setNewC({ ...newC, periodTo: e.target.value })} required /></Field>
          <Field label="Self-assessments due"><input className={inputCls} type="date" min={d.today} value={newC.selfDue} onChange={(e) => setNewC({ ...newC, selfDue: e.target.value })} required /></Field><Field label="Manager reviews due"><input className={inputCls} type="date" min={newC.selfDue || d.today} value={newC.managerDue} onChange={(e) => setNewC({ ...newC, managerDue: e.target.value })} required /></Field></div>
        <p className="text-[12px] text-[#64748B]">Everyone active except the super admin gets a review and a notification. People whose reporting manager is the super admin (or who have none) go straight from self-assessment to HR.</p>
        <button className={primaryCls} disabled={busy}>Open cycle and tell everyone</button>
      </form>
    </Modal> : null}
    {r ? <Modal title={`${r.name} · ${r.cycle}`} onClose={() => setOpen(null)} wide>
      <FactsLine f={r.facts} />
      <div className="text-[13px] font-bold">Self-assessment · {label(d.ratings, r.selfRating)}</div>
      {r.selfAt ? <Answers rows={[["Achievements", r.self.achievements], ["Challenges", r.self.challenges], ["Goals", r.self.goals]]} /> : <p className="text-[13px] text-[#64748B]">Not sent yet.</p>}
      {r.managerId ? <><div className="text-[13px] font-bold">{r.manager}’s review · {label(d.ratings, r.mgrRating)}</div>{r.mgrAt ? <Answers rows={[["What went well", r.mgr.strengths], ["To improve", r.mgr.improve], ["Comments", r.mgr.comments]]} /> : <p className="text-[13px] text-[#64748B]">Not sent yet.</p>}</> : null}
      {r.status === "done" ? <div className="border-t border-[#E2E8F0] pt-3 text-[13.5px]"><strong>Final rating: {label(d.ratings, r.finalRating)}</strong> by {r.finalBy}{r.hrNote ? <p>“{r.hrNote}”</p> : null}</div>
        : isOpen && (r.status === "hr" || r.status === "manager") ? <form className="flex flex-col gap-3 border-t border-[#E2E8F0] pt-3" onSubmit={(e) => { e.preventDefault(); run(() => finalizeReview(r.id, fin), () => setOpen(null)); }}>
          {r.status === "manager" ? <p className="text-[12.5px] text-[#B45309]">The manager hasn’t reviewed yet. Only the super admin can finish it now.</p> : null}
          <Field label="Final rating"><RatingPick ratings={d.ratings} value={fin.rating} onChange={(v) => setFin({ ...fin, rating: v })} /></Field>
          <Field label="Note to the employee (optional)"><textarea className={inputCls} rows={3} value={fin.note} onChange={(e) => setFin({ ...fin, note: e.target.value })} /></Field>
          <div><button className={primaryCls} disabled={busy || !fin.rating}>Save final rating and tell them</button></div>
        </form> : null}
    </Modal> : null}
  </>;
}
