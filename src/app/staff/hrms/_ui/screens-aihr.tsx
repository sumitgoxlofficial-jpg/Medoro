"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Data } from "@/staff/hrms/screens";
import { aiHrAddScenario, aiHrApproveKnowledge, aiHrCallDetail, aiHrDecide, aiHrDeleteTranscript, aiHrManualCall, aiHrPlayground, aiHrRequestOvertime, aiHrRollbackKnowledge, aiHrRunEvaluation, aiHrSaveConfig, aiHrSaveKnowledge, aiHrTestRetrieval, aiHrToggleScenario } from "../actions";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, Table, Tabs, ago, btnCls, dangerCls, dayLabel, inputCls, primaryCls, statusTone, tdCls, timeLabel, useRun } from "./kit";

type D = Data<"aihr">;
type TabId = D["tab"];
const REASON: Record<string, string> = { late: "Late arrival", absent: "Absence", missing_checkout: "Missing check-out", overtime: "Overtime", manual: "HR follow-up" };
const TABS: [TabId, string][] = [["overview", "Overview"], ["calls", "Calls & responses"], ["escalations", "Escalations & review"], ["knowledge", "Knowledge base"], ["scenarios", "Scenarios & evaluation"], ["playground", "Playground"], ["status", "Model status"], ["settings", "Settings"]];

/** HR (Attendance & leave): the AI HR Assistant module. Every number here is counted from database rows. */
export function AiHrScreen({ d }: { d: D }) {
  const router = useRouter();
  const go = (tab: string, extra = "") => router.push(`/staff/hrms/aihr?tab=${tab}${extra}`);
  return <>
    <div className="flex flex-wrap gap-2 items-center"><Tabs value={d.tab} options={TABS.filter(([t]) => t !== "knowledge" || d.hr)} onChange={(t) => go(t)} /></div>
    {d.overview ? <Overview d={d} /> : null}
    {d.tab === "calls" && d.calls ? <Calls d={d} /> : null}
    {d.actions ? <Escalations d={d} /> : null}
    {d.knowledge ? <Knowledge k={d.knowledge} /> : null}
    {d.scenarios ? <Scenarios s={d.scenarios} /> : null}
    {d.tab === "playground" ? <Playground /> : null}
    {d.tab === "status" && d.status ? <Status s={d.status} /> : null}
    {d.tab === "settings" && d.status ? <Settings s={d.status} admin={d.admin} /> : null}
  </>;
}

function Overview({ d }: { d: D }) {
  const o = d.overview!;
  const router = useRouter();
  // Live: refresh the numbers and the waiting list every 15 seconds while the tab is visible.
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15_000); return () => clearInterval(t); }, [router]);
  const h = o.health;
  const live = (d.calls ?? []).filter((c) => c.status === "in_progress" || c.status === "notified");
  return <>
    {!o.enabled ? <Card pad><div className="text-[13px] text-[#B45309]"><strong>Automatic conversations are off.</strong> The super admin turns them on under Settings. Overtime requests and HR follow-ups can still be raised once it is on.</div></Card> : null}
    <Grid><Stat l="Conversations (30 days)" v={o.total} /><Stat l="Completed" v={o.completed} /><Stat l="Waiting / live" v={`${o.pending} / ${o.live}`} /><Stat l="No answer" v={o.noAnswer} c={o.noAnswer ? "#B45309" : undefined} /><Stat l="Failed" v={o.failed} c={o.failed ? "#DC2626" : undefined} /><Stat l="Cancelled / suppressed" v={o.suppressed} sub="checked in meanwhile, leave, or turned off" /></Grid>
    <Grid><Stat l="Late: coming (responses)" v={o.late} /><Stat l="Absent (responses)" v={o.absent} /><Stat l="Overtime accepted / declined" v={`${o.otAccepted} / ${o.otRejected}`} /><Stat l="Callback requests" v={o.callbacks} /><Stat l="HR escalations" v={o.escalations} c={o.escalations ? "#B45309" : undefined} /><Stat l="Asked to stop AI calls" v={o.stops} sub={`${o.consentsOff} people have AI conversations off`} /></Grid>
    <Grid n={3}>
      <Stat l="Open HR actions" v={o.openActions} sub={o.urgentOpen ? `${o.urgentOpen} urgent` : "none urgent"} c={o.urgentOpen ? "#DC2626" : undefined} />
      <Stat l="AI service" v={!h.configured ? "Not configured" : h.reachable ? (h.ok ? "Healthy" : "Degraded") : "Unreachable"} c={h.reachable && h.ok ? undefined : "#B45309"} sub={h.configured ? (h.ms ? `${h.ms} ms` : h.error) : "text conversations still work"} />
      <Stat l="Knowledge / scenarios" v={`${o.knowledge.approved ?? 0} / ${o.scenarios.total + o.scenarios.custom}`} sub={o.lastEval ? `last evaluation ${o.lastEval.passed}/${o.lastEval.total}, ${ago(o.lastEval.at)}` : "no evaluation run yet"} />
    </Grid>
    <RaiseForms people={d.people} enabled={o.enabled} />
    <Card title="Live and waiting" sub="Conversations the employee hasn't finished yet.">
      <Table head={["Person", "About", "Status", "Attempts", "Since"]} empty="Nothing waiting.">{live.map((c) => <tr key={c.id}><td className={tdCls}>{c.name} <span className="text-[12px] text-[#94A3B8]">{c.empNo}</span></td><td className={tdCls}>{REASON[c.reason]}</td><td className={tdCls}><Pill tone={c.status === "in_progress" ? "blue" : "amber"}>{c.status.replace("_", " ")}</Pill></td><td className={tdCls}>{c.attempts}</td><td className={tdCls}>{ago(c.createdAt)}</td></tr>)}</Table>
    </Card>
  </>;
}

function RaiseForms({ people, enabled }: { people: D["people"]; enabled: boolean }) {
  const { run, busy } = useRun();
  const [ot, setOt] = useState({ staffId: "", date: "", hours: "2", from: "18:30", reason: "" });
  const [fu, setFu] = useState({ staffId: "", topic: "" });
  return <Grid n={2}>
    <Card title="Ask about overtime" sub="The employee is asked in the HRMS. Only an explicit yes counts; you still decide.">
      <form className="flex flex-col gap-2.5 px-5 pb-4" onSubmit={(e) => { e.preventDefault(); run(() => aiHrRequestOvertime({ ...ot, hours: Number(ot.hours) })); }}>
        <Field label="Employee"><select className={inputCls} value={ot.staffId} onChange={(e) => setOt({ ...ot, staffId: e.target.value })} required><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.empNo})</option>)}</select></Field>
        <Grid n={4}><Field label="Date"><input type="date" className={inputCls} value={ot.date} onChange={(e) => setOt({ ...ot, date: e.target.value })} required /></Field><Field label="Hours"><input className={inputCls} inputMode="decimal" value={ot.hours} onChange={(e) => setOt({ ...ot, hours: e.target.value })} /></Field><Field label="From"><input type="time" className={inputCls} value={ot.from} onChange={(e) => setOt({ ...ot, from: e.target.value })} /></Field></Grid>
        <Field label="What for"><input className={inputCls} value={ot.reason} onChange={(e) => setOt({ ...ot, reason: e.target.value })} placeholder="Month-end stock count" required /></Field>
        <div><button className={primaryCls} disabled={busy || !enabled}>Send request</button></div>
      </form>
    </Card>
    <Card title="Ask the assistant to follow up" sub="A general HR follow-up; the employee can ask questions answered from approved knowledge.">
      <form className="flex flex-col gap-2.5 px-5 pb-4" onSubmit={(e) => { e.preventDefault(); run(() => aiHrManualCall(fu.staffId, fu.topic)); }}>
        <Field label="Employee"><select className={inputCls} value={fu.staffId} onChange={(e) => setFu({ ...fu, staffId: e.target.value })} required><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.empNo})</option>)}</select></Field>
        <Field label="About"><input className={inputCls} value={fu.topic} onChange={(e) => setFu({ ...fu, topic: e.target.value })} placeholder="Pending document verification" required /></Field>
        <div><button className={btnCls} disabled={busy || !enabled}>Schedule follow-up</button></div>
      </form>
    </Card>
  </Grid>;
}

function CallModal({ id, onClose, admin }: { id: string; onClose: () => void; admin: boolean }) {
  const { run, busy, toast } = useRun();
  const [data, setData] = useState<Awaited<ReturnType<typeof aiHrCallDetail>> | null>(null);
  useEffect(() => {
    let live = true;
    void aiHrCallDetail(id).then((r) => { if (!live) return; setData(r); if (!r.ok) toast(r.error, "red"); });
    return () => { live = false; };
  }, [id, toast]);
  if (!data) return <Modal title="Conversation" onClose={onClose}><Empty>Opening… (this is recorded in the audit log)</Empty></Modal>;
  if (!data.ok) return <Modal title="Conversation" onClose={onClose}><Empty>{data.error}</Empty></Modal>;
  const c = data.data, r = c.response;
  return <Modal title={`${c.name} · ${REASON[c.reason]} · ${dayLabel(c.day)}`} onClose={onClose} wide>
    <div className="flex flex-col gap-3">
      {r ? <div className="grid grid-cols-2 gap-2 text-[12.5px] bg-[#F8FAFC] rounded-lg p-3">
        <div><strong>Response:</strong> {r.employeeResponse.replace(/_/g, " ")}</div><div><strong>Reason:</strong> {r.reasonCategory || "not given"}</div>
        <div><strong>Expected:</strong> {r.expectedArrival || "—"}</div><div><strong>Overtime:</strong> {r.overtimeResponse || "—"}</div>
        <div><strong>Callback:</strong> {r.callbackRequested ? r.callbackTime || "yes, no time" : "no"}</div><div><strong>Escalation:</strong> {r.humanEscalationRequired ? "yes" : "no"} · <strong>Stop:</strong> {r.employeeRequestedStop ? "yes" : "no"}</div>
        <div className="col-span-2"><strong>Summary:</strong> {r.summary} · confidence {Math.round(r.confidence * 100)}%</div>
        <div className="col-span-2 text-[11.5px] text-[#64748B]">What the employee said is kept apart from what the assistant inferred and recommended. Nothing here changed attendance, leave or pay.</div>
      </div> : <div className="text-[12.5px] text-[#64748B]">No outcome yet ({c.status.replace("_", " ")}).</div>}
      <div className="flex flex-col gap-1.5 max-h-[360px] overflow-auto">{c.turns.length ? c.turns.map((t, i) => <div key={i} className={t.who === "ai" ? "self-start bg-[#E6F4F2] rounded-lg px-3 py-2 text-[13px] max-w-[85%]" : "self-end bg-[#EEF2FF] rounded-lg px-3 py-2 text-[13px] max-w-[85%]"}><div>{t.text || <em className="text-[#94A3B8]">(silence)</em>}</div><div className="text-[10.5px] text-[#94A3B8] mt-0.5">{t.who === "ai" ? "Assistant" : "Employee"} · {timeLabel(t.at)} · {t.lang}{t.intent ? ` · ${t.intent}` : ""}{t.sttMs ? ` · STT ${t.sttMs}ms` : ""}{t.llmMs ? ` · LLM ${t.llmMs}ms` : ""}{t.ttsMs ? ` · TTS ${t.ttsMs}ms` : ""}</div></div>) : <Empty>No transcript (not started, or deleted after retention).</Empty>}</div>
      <Table head={["Attempt", "Outcome", "Detail", "At"]}>{c.attempts.map((a, i) => <tr key={i}><td className={tdCls}>{a.n}</td><td className={tdCls}>{a.outcome}</td><td className={tdCls}>{a.detail}</td><td className={tdCls}>{ago(a.at)}</td></tr>)}</Table>
      <div className="flex gap-2 items-center text-[12px] text-[#64748B]">{c.retainUntil ? `Transcript kept until ${dayLabel(c.retainUntil)}.` : ""}{admin && c.turns.length ? <button className={dangerCls} disabled={busy} onClick={() => run(() => aiHrDeleteTranscript(c.id), () => { onClose(); })}>Delete transcript now</button> : null}</div>
    </div>
  </Modal>;
}

function Calls({ d }: { d: D }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const rows = d.calls!;
  return <Card title="Conversations" sub="Late arrival, absence, overtime and missing check-out, with each employee's structured response." right={<div className="flex gap-1.5 flex-wrap">{["", "late", "absent", "overtime", "missing_checkout", "manual"].map((r) => <button key={r} className={d.reason === r ? primaryCls : btnCls} onClick={() => router.push(`/staff/hrms/aihr?tab=calls${r ? "&reason=" + r : ""}`)}>{r ? REASON[r] : "All"}</button>)}</div>}>
    <Table head={["Person", "About", "Day", "Status", "Response", "Summary", ""]} empty="No conversations in the last 30 days.">
      {rows.map((c) => <tr key={c.id}><td className={tdCls}>{c.name} <span className="text-[12px] text-[#94A3B8]">{c.empNo}</span></td><td className={tdCls}>{REASON[c.reason]}</td><td className={tdCls}>{dayLabel(c.day)}</td><td className={tdCls}><Pill tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Pill>{c.suppressReason ? <div className="text-[11px] text-[#94A3B8]">{c.suppressReason}</div> : null}</td>
        <td className={tdCls}>{c.response ? <>{c.response.employeeResponse.replace(/_/g, " ")}{c.response.eta ? ` · ${c.response.eta}` : ""}{c.response.escalate ? <> <Pill tone="red">HR</Pill></> : null}{c.response.stop ? <> <Pill tone="gray">stop</Pill></> : null}</> : "—"}</td>
        <td className={tdCls + " max-w-[320px] text-[12px] text-[#475569]"}>{c.response?.summary ?? ""}</td><td className={tdCls}><button className={btnCls} onClick={() => setOpen(c.id)}>Open</button></td></tr>)}
    </Table>
    {open ? <CallModal id={open} admin={d.admin} onClose={() => setOpen(null)} /> : null}
  </Card>;
}

function Escalations({ d }: { d: D }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [rej, setRej] = useState<{ id: string; note: string } | null>(null);
  const [lv, setLv] = useState<{ id: string; type: string; half: boolean } | null>(null);
  const rows = d.actions!;
  const label: Record<string, string> = { leave_draft: "Leave draft", hr_followup: "HR follow-up", escalation: "Escalation", callback: "Callback", overtime_response: "Overtime answer", expected_arrival: "Expected arrival", stop_calls: "Stop AI calls", wfh_request: "Work-from-home request", half_day_request: "Half-day request", harassment_report: "Harassment report", accident_report: "Accident / injury", emergency: "Emergency", human_requested: "Asked for HR", grievance: "Grievance", upset_employee: "Upset employee", question_for_hr: "Question for HR", attendance_check: "Check attendance record", attendance_system_issue: "Attendance system problem", attendance_dispute: "Attendance dispute", checkout_correction: "Check-out correction", leave_pending: "Leave pending", roster_check: "Check roster / calendar", unclear: "Unclear conversation", incomplete: "Incomplete conversation", no_answer: "No answer", declined_to_talk: "Declined to talk", absent_no_leave: "Absent, no leave", eta_unknown: "Time unknown", overtime_question: "Overtime question", callback_time_unknown: "Callback, no time" };
  return <Card title="Escalations and HR review" sub="Everything the assistant proposed or flagged. Urgent items first. Approving records your decision and tells the employee; apply leave, corrections or pay changes in their own screens." right={<button className={btnCls} onClick={() => router.push(`/staff/hrms/aihr?tab=escalations${d.actions && rows.every((r) => r.status === "open") ? "&all=1" : ""}`)}>{rows.every((r) => r.status === "open") ? "Show decided too" : "Open only"}</button>}>
    <Table head={["", "Person", "What", "Detail", "Raised", "Status", ""]} empty="Nothing waiting for HR.">
      {rows.map((a) => <tr key={a.id}><td className={tdCls}>{a.priority === "urgent" ? <Pill tone="red">urgent</Pill> : null}</td><td className={tdCls}>{a.name} <span className="text-[12px] text-[#94A3B8]">{a.empNo}</span></td><td className={tdCls}>{label[a.kind] ?? a.kind}</td><td className={tdCls + " max-w-[340px] text-[12px]"}>{a.detail}{a.note ? <div className="text-[#64748B]">Note: {a.note}</div> : null}</td><td className={tdCls}>{ago(a.createdAt)}</td><td className={tdCls}><Pill tone={statusTone(a.status)}>{a.status}</Pill></td>
        <td className={tdCls}><div className="flex gap-1.5">{a.callId ? <button className={btnCls} onClick={() => setOpen(a.callId!)}>Transcript</button> : null}{a.status === "open" ? <><button className={primaryCls} disabled={busy} onClick={() => ["leave_draft", "half_day_request"].includes(a.kind) ? setLv({ id: a.id, type: ["illness", "medical"].includes(a.reason) ? "sick" : "casual", half: a.kind === "half_day_request" }) : run(() => aiHrDecide(a.id, true))}>{["leave_draft", "wfh_request", "half_day_request"].includes(a.kind) ? "Approve" : "Done"}</button><button className={dangerCls} disabled={busy} onClick={() => setRej({ id: a.id, note: "" })}>Reject</button></> : null}</div></td></tr>)}
    </Table>
    {open ? <CallModal id={open} admin={d.admin} onClose={() => setOpen(null)} /> : null}
    {lv ? <Modal title={lv.half ? "Approve half-day leave" : "Approve leave"} onClose={() => setLv(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => aiHrDecide(lv.id, true, "", lv.type), () => setLv(null)); }}>
      <div className="text-[13px] text-[#475569]">This files the leave for the day of the conversation and approves it, with the usual checks (balance, overlap, weekends and holidays). The employee is notified.</div>
      <Field label="Leave type"><select className={inputCls} value={lv.type} onChange={(e) => setLv({ ...lv, type: e.target.value })}>{[["casual", "Casual Leave"], ["sick", "Sick Leave"], ["privilege", "Privilege Leave"], ["comp", "Comp Off"], ["unpaid", "Unpaid Leave (loss of pay)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <div><button className={primaryCls} disabled={busy}>Approve and record leave</button></div></form></Modal> : null}
    {rej ? <Modal title="Reject" onClose={() => setRej(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => aiHrDecide(rej.id, false, rej.note), () => setRej(null)); }}><Field label="Why (the employee sees this for requests)"><input className={inputCls} value={rej.note} onChange={(e) => setRej({ ...rej, note: e.target.value })} required /></Field><div><button className={dangerCls} disabled={busy}>Reject</button></div></form></Modal> : null}
  </Card>;
}

type K = NonNullable<D["knowledge"]>;
function Knowledge({ k }: { k: K }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const blank = { docKey: "", title: "", body: "", scope: "organisation" as "product" | "organisation", kind: "policy" as "module" | "policy" | "faq" | "procedure" | "rule", source: "", effectiveFrom: "" };
  const [edit, setEdit] = useState<typeof blank | null>(null);
  const [q, setQ] = useState("");
  const [test, setTest] = useState({ q: "", res: null as null | { hits: { title: string; source: string; scope: string; score: number; coverage: number; passage: string }[]; answer: { answer: string; source: string } | null } });
  const n = (status: string, scope?: string) => k.counts.filter((c) => c.status === status && (!scope || c.scope === scope)).reduce((a, c) => a + c.n, 0);
  return <>
    <Grid><Stat l="Approved records" v={n("approved")} sub={`${n("approved", "product")} product · ${n("approved", "organisation")} organisation`} /><Stat l="Drafts waiting" v={n("draft")} c={n("draft") ? "#B45309" : undefined} /><Stat l="Archived versions" v={n("archived")} /><Stat l="Live organisation facts" v={k.live.length} sub="Settings, calendar, published policies" /></Grid>
    <Card title="Test retrieval" sub="See what the assistant would answer, and from which record. Below the confidence bar it says HR needs to confirm.">
      <form className="flex gap-2 px-5 pb-3" onSubmit={(e) => { e.preventDefault(); run(() => aiHrTestRetrieval(test.q), (r) => { setTest({ ...test, res: r }); }); }}><input className={inputCls} value={test.q} onChange={(e) => setTest({ ...test, q: e.target.value })} placeholder="Leave cancel kaise karte hain?" /><button className={btnCls} disabled={busy}>Ask</button></form>
      {test.res ? <div className="px-5 pb-4 text-[13px]"><div className="mb-2"><strong>Answer:</strong> {test.res.answer ? <>{test.res.answer.answer} <Pill tone="green">{test.res.answer.source}</Pill></> : <Pill tone="amber">no confident answer: routed to HR</Pill>}</div><Table head={["Record", "Scope", "Score", "Coverage", "Passage"]}>{test.res.hits.map((h, i) => <tr key={i}><td className={tdCls}>{h.title}<div className="text-[11px] text-[#94A3B8]">{h.source}</div></td><td className={tdCls}>{h.scope}</td><td className={tdCls}>{h.score}</td><td className={tdCls}>{h.coverage}%</td><td className={tdCls + " text-[12px]"}>{h.passage}</td></tr>)}</Table></div> : null}
    </Card>
    <Card title="Knowledge records" sub="Product knowledge (how the HRMS works) and organisation knowledge (your approved policies) are kept apart. A new version is a draft until someone else approves it; earlier versions stay for rollback." right={<><form onSubmit={(e) => { e.preventDefault(); router.push(`/staff/hrms/aihr?tab=knowledge&q=${encodeURIComponent(q)}`); }}><input className={inputCls + " !w-[200px]"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></form><button className={primaryCls} onClick={() => setEdit(blank)}>Add policy / FAQ</button></>}>
      <Table head={["Title", "Scope", "Kind", "Version", "Status", "Source", ""]} empty="No records match.">
        {k.rows.map((r) => <tr key={r.id}><td className={tdCls + " max-w-[300px]"}><strong>{r.title}</strong><div className="text-[11.5px] text-[#64748B] line-clamp-2">{r.body}</div></td><td className={tdCls}>{r.scope}</td><td className={tdCls}>{r.kind}</td><td className={tdCls}>v{r.version}</td><td className={tdCls}><Pill tone={r.status === "approved" ? "green" : r.status === "draft" ? "amber" : "gray"}>{r.status}</Pill></td><td className={tdCls + " text-[11.5px] text-[#64748B] max-w-[200px]"}>{r.source}</td>
          <td className={tdCls}><div className="flex gap-1.5">{r.status === "draft" ? <button className={primaryCls} disabled={busy} onClick={() => run(() => aiHrApproveKnowledge(r.id))}>Approve</button> : null}{r.status === "archived" ? <button className={btnCls} disabled={busy} onClick={() => run(() => aiHrRollbackKnowledge(r.docKey, r.version))}>Restore v{r.version}</button> : null}{r.status === "approved" ? <><button className={btnCls} onClick={() => setEdit({ docKey: r.docKey, title: r.title, body: r.body, scope: r.scope as "product" | "organisation", kind: r.kind as typeof blank.kind, source: r.source, effectiveFrom: r.effectiveFrom })}>New version</button><button className={dangerCls} disabled={busy} onClick={() => run(() => aiHrRollbackKnowledge(r.docKey, 0))}>Withdraw</button></> : null}</div></td></tr>)}
      </Table>
    </Card>
    <Card title="Live organisation facts" sub="Read from Settings, the calendar and published policies each time; change them there.">
      <Table head={["Fact", "Source", "Text"]}>{k.live.map((f, i) => <tr key={i}><td className={tdCls}>{f.title}</td><td className={tdCls + " text-[12px]"}>{f.source}</td><td className={tdCls + " text-[12px]"}>{f.body.slice(0, 220)}</td></tr>)}</Table>
    </Card>
    {edit ? <Modal title={edit.docKey ? "New version" : "Add knowledge"} onClose={() => setEdit(null)} wide>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => aiHrSaveKnowledge(edit), () => setEdit(null)); }}>
        <Field label="Title"><input className={inputCls} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></Field>
        <Grid n={4}><Field label="Scope"><select className={inputCls} value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value as typeof edit.scope })}><option value="organisation">Organisation policy</option><option value="product">HRMS product</option></select></Field><Field label="Kind"><select className={inputCls} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as typeof edit.kind })}>{["policy", "faq", "procedure", "rule", "module"].map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Effective from (optional)"><input type="date" className={inputCls} value={edit.effectiveFrom} onChange={(e) => setEdit({ ...edit, effectiveFrom: e.target.value })} /></Field></Grid>
        <Field label="Text (what the assistant may quote)"><textarea className={inputCls + " min-h-[160px]"} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} required /></Field>
        <Field label="Source" hint="Where this comes from: the policy document and version, an HR circular…"><input className={inputCls} value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} required /></Field>
        <div><button className={primaryCls} disabled={busy}>Save draft</button></div>
      </form>
    </Modal> : null}
  </>;
}

type S = NonNullable<D["scenarios"]>;
function Scenarios({ s }: { s: S }) {
  const { run, busy } = useRun();
  const [add, setAdd] = useState({ category: "", utterance: "", callReason: "late" as "late" | "absent" | "missing_checkout" | "overtime" | "manual", expect: "" });
  const last = s.runs[0];
  const raw = (last?.metrics ?? {}) as Record<string, unknown>;
  const m = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "bySplit")) as Record<string, { checked: number; ok: number; rate: number }>;
  const split = raw.bySplit as Record<string, { total: number; passed: number }> | undefined;
  return <>
    <Grid><Stat l="Library scenarios" v={s.validation.total} sub={`version ${s.version}`} /><Stat l="Categories" v={s.validation.categories} /><Stat l="Structurally valid" v={s.validation.valid} c={s.validation.valid === s.validation.total ? undefined : "#DC2626"} /><Stat l="Your scenarios" v={s.custom.filter((c) => !c.disabled).length} /></Grid>
    <Card title="Evaluation" sub="Runs every scenario through the conversation engine and checks intent, times, escalation, stop compliance, language, structure and grounding. Results are measured, never assumed." right={<button className={primaryCls} disabled={busy} onClick={() => run(() => aiHrRunEvaluation(), (r) => `Evaluation finished: ${r.passed}/${r.total} passed.`)}>Run evaluation</button>}>
      {last ? <div className="px-5 pb-4 flex flex-col gap-3">
        <div className="text-[13px]">Last run {ago(last.at)}: <strong>{last.passed}/{last.total}</strong> passed{split ? <> · tuning {split.tuning?.passed}/{split.tuning?.total} · held-out {split.held_out?.passed}/{split.held_out?.total}</> : null}</div>
        <Table head={["Check", "Passed", "Rate"]}>{Object.entries(m).map(([k, v]) => <tr key={k}><td className={tdCls}>{k.replace(/_/g, " ")}</td><td className={tdCls}>{v.ok}/{v.checked}</td><td className={tdCls}><Pill tone={v.rate >= 95 ? "green" : v.rate >= 90 ? "amber" : "red"}>{v.rate}%</Pill></td></tr>)}</Table>
        <details><summary className="cursor-pointer text-[13px] font-semibold">Failed scenarios ({(last.failures as { id: string; failed: string[] }[]).length})</summary><ul className="text-[12px] mt-2 flex flex-col gap-1">{(last.failures as { id: string; failed: string[] }[]).map((f) => <li key={f.id}><strong>{f.id}</strong>: {f.failed.join("; ")}</li>)}</ul></details>
      </div> : <Empty>No evaluation yet. Run one to see the results.</Empty>}
    </Card>
    <Card title="Add a scenario" sub="Something an employee really said that the assistant should handle. Expectation keys: s= (response), eta=, why=, cb=, esc=1|urgent, leave=1, next=, kb=any, stop=1. Separate turns with ||.">
      <form className="flex flex-col gap-2.5 px-5 pb-4" onSubmit={(e) => { e.preventDefault(); run(() => aiHrAddScenario(add), () => setAdd({ ...add, utterance: "", expect: "" })); }}>
        <Grid n={3}><Field label="Category"><input className={inputCls} value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })} required /></Field><Field label="Call about"><select className={inputCls} value={add.callReason} onChange={(e) => setAdd({ ...add, callReason: e.target.value as typeof add.callReason })}>{Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field><Field label="Expected"><input className={inputCls} value={add.expect} onChange={(e) => setAdd({ ...add, expect: e.target.value })} placeholder="s=coming eta=11:00" required /></Field></Grid>
        <Field label="What the employee says"><input className={inputCls} value={add.utterance} onChange={(e) => setAdd({ ...add, utterance: e.target.value })} placeholder="Traffic mein hoon || 11 baje" required /></Field>
        <div><button className={btnCls} disabled={busy}>Add</button></div>
      </form>
      {s.custom.length ? <Table head={["Category", "About", "Says", "Expected", ""]}>{s.custom.map((c) => <tr key={c.id}><td className={tdCls}>{c.category}</td><td className={tdCls}>{REASON[c.callReason]}</td><td className={tdCls}>{c.utterance}</td><td className={tdCls + " text-[12px]"}>{Object.entries(c.expect as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(" ")}</td><td className={tdCls}><button className={btnCls} disabled={busy} onClick={() => run(() => aiHrToggleScenario(c.id, !c.disabled))}>{c.disabled ? "Enable" : "Disable"}</button></td></tr>)}</Table> : null}
    </Card>
    <Card title="Library sample (every tenth scenario)" sub="The full library is version-controlled in src/staff/hrms/ai-hr/scenarios.">
      <Table head={["Id", "Category", "Hinglish / primary", "English", "Hindi", "Expected", "Split"]}>{s.sample.map((x) => <tr key={x.id}><td className={tdCls + " text-[11.5px]"}>{x.id}</td><td className={tdCls}>{x.category}</td><td className={tdCls}>{x.opening}</td><td className={tdCls + " text-[12px]"}>{x.english}</td><td className={tdCls + " text-[12px]"}>{x.hindi}</td><td className={tdCls + " text-[11.5px]"}>{Object.entries(x.expect).map(([k, v]) => `${k}=${v}`).join(" ")}</td><td className={tdCls}>{x.split === "held_out" ? <Pill tone="purple">held-out</Pill> : "tuning"}</td></tr>)}</Table>
    </Card>
  </>;
}

function Playground() {
  const { run, busy } = useRun();
  const [reason, setReason] = useState<"late" | "absent" | "missing_checkout" | "overtime" | "manual">("late");
  const [lines, setLines] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [res, setRes] = useState<Awaited<ReturnType<typeof aiHrPlayground>> extends infer R ? (R extends { ok: true; data: infer T } ? T : never) | null : never>(null);
  const play = (next: string[]) => run(() => aiHrPlayground({ reason, lines: next }), (r) => { setRes(r); });
  return <Card title="Conversation playground" sub="Talk to the assistant as an employee would. Nobody is contacted and nothing is saved." right={<select className={inputCls + " !w-auto"} value={reason} onChange={(e) => { setReason(e.target.value as typeof reason); setLines([]); setRes(null); }}>{Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
    <div className="px-5 pb-4 flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">{(res?.turns ?? []).map((t, i) => <div key={i} className={t.who === "ai" ? "self-start bg-[#E6F4F2] rounded-lg px-3 py-2 text-[13px] max-w-[85%]" : "self-end bg-[#EEF2FF] rounded-lg px-3 py-2 text-[13px] max-w-[85%]"}>{t.text || <em>(silence)</em>}</div>)}</div>
      {!res ? <button className={btnCls} disabled={busy} onClick={() => play([])}>Start</button> : null}
      {res && res.output.callStatus !== "completed" ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = [...lines, draft]; setLines(n); setDraft(""); play(n); }}><input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Haan, traffic mein hoon (empty = silence)" /><button className={primaryCls} disabled={busy}>Send</button></form> : null}
      {res ? <details open={res.output.callStatus === "completed"}><summary className="cursor-pointer text-[13px] font-semibold">Structured output</summary><pre className="text-[11.5px] bg-[#F8FAFC] p-3 rounded-lg overflow-auto max-h-[320px]">{JSON.stringify({ ...res.output, transcript: undefined }, null, 2)}</pre></details> : null}
      {res ? <div><button className={btnCls} onClick={() => { setLines([]); setRes(null); }}>Reset</button></div> : null}
    </div>
  </Card>;
}

type St = NonNullable<D["status"]>;
function Status({ s }: { s: St }) {
  const h = s.health;
  return <>
    <Card title="Local AI service" sub="Self-hosted Faster-Whisper (speech to text), Piper (Hindi female voice) and Ollama (local model) behind an authenticated API. No paid AI service is used, and nothing falls back to one.">
      <div className="px-5 pb-4 flex flex-col gap-2 text-[13px]">
        {!h.configured ? <div className="text-[#B45309]">{h.error}</div> : !h.reachable ? <div className="text-[#DC2626]">Unreachable: {h.error}. Conversations continue as text with the rule engine; attendance events stay queued.</div> : null}
        {h.reachable ? <Grid><Stat l="Overall" v={h.ok ? "Healthy" : "Degraded"} sub={`${h.ms} ms · ${h.version ?? ""}`} /><Stat l="Speech to text" v={h.stt?.ok ? "Ready" : "Down"} sub={h.stt?.model} /><Stat l="Voice" v={h.tts?.ok ? "Ready" : "Down"} sub={h.tts?.voice} /><Stat l="Local model" v={h.llm?.ok ? "Ready" : "Down"} sub={h.llm?.model ?? h.llm?.error} /><Stat l="Memory free" v={h.memory?.available_mb ? `${Math.round(h.memory.available_mb)} MB` : "—"} sub={h.memory?.total_mb ? `of ${Math.round(h.memory.total_mb)} MB · service ${Math.round(h.memory.process_rss_mb ?? 0)} MB` : ""} /><Stat l="CPU load" v={h.cpu?.load1 ?? "—"} sub={h.cpu?.count ? `${h.cpu.count} cores` : ""} /></Grid> : null}
        <div className="text-[12px] text-[#64748B]">Mobile calling (SIP/PSTN): {s.sip ? "enabled" : "not configured. Real phone calls need a licensed telecom provider and cost money; conversations happen in the HRMS instead"}.</div>
      </div>
    </Card>
  </>;
}

function Settings({ s, admin }: { s: St; admin: boolean }) {
  const { run, busy } = useRun();
  const [c, setC] = useState(s.config);
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const ruleRow = (k: "late" | "absent" | "missing_checkout", label: string, hint: string) => <tr><td className={tdCls}><label className="flex gap-2 items-center"><input type="checkbox" checked={c.rules[k].enabled} disabled={!admin} onChange={(e) => setC({ ...c, rules: { ...c.rules, [k]: { ...c.rules[k], enabled: e.target.checked } } })} />{label}</label></td><td className={tdCls}><input className={inputCls + " !w-[90px]"} inputMode="numeric" disabled={!admin} value={c.rules[k].afterMin} onChange={(e) => setC({ ...c, rules: { ...c.rules, [k]: { ...c.rules[k], afterMin: num(e.target.value) } } })} /> min</td><td className={tdCls + " text-[12px] text-[#64748B]"}>{hint}</td></tr>;
  return <>
    <Card title="Automation rules" sub={admin ? "Only the super admin changes these. Tell your team before switching on." : "Only the super admin can change these."}>
      <div className="px-5 pb-2"><label className="flex gap-2 items-center text-[13.5px] font-semibold"><input type="checkbox" checked={c.enabled} disabled={!admin} onChange={(e) => setC({ ...c, enabled: e.target.checked })} />Automatic AI conversations on</label></div>
      <Table head={["Rule", "After", "When"]}>
        {ruleRow("late", "Late arrival", "minutes after the shift start with no check-in")}
        {ruleRow("absent", "Absence", "minutes after the shift start with no check-in, no approved leave, not a holiday or weekly off")}
        {ruleRow("missing_checkout", "Missing check-out", "minutes after the shift end with no check-out")}
        <tr><td className={tdCls}><label className="flex gap-2 items-center"><input type="checkbox" checked={c.rules.overtime.enabled} disabled={!admin} onChange={(e) => setC({ ...c, rules: { ...c.rules, overtime: { enabled: e.target.checked } } })} />Overtime</label></td><td className={tdCls}>—</td><td className={tdCls + " text-[12px] text-[#64748B]"}>only when a manager or HR raises a request</td></tr>
      </Table>
      <div className="px-5 py-3"><Grid n={4}>
        <Field label="Attempts (incl. retries)"><input className={inputCls} inputMode="numeric" disabled={!admin} value={c.maxAttempts} onChange={(e) => setC({ ...c, maxAttempts: Math.min(3, Math.max(1, num(e.target.value))) })} /></Field>
        <Field label="Minutes between attempts"><input className={inputCls} inputMode="numeric" disabled={!admin} value={c.retryGapMin} onChange={(e) => setC({ ...c, retryGapMin: num(e.target.value) })} /></Field>
        <Field label="Contact from"><input type="time" className={inputCls} disabled={!admin} value={c.callingFrom} onChange={(e) => setC({ ...c, callingFrom: e.target.value })} /></Field>
        <Field label="Contact until"><input type="time" className={inputCls} disabled={!admin} value={c.callingTo} onChange={(e) => setC({ ...c, callingTo: e.target.value })} /></Field>
        <Field label="Keep transcripts (days)"><input className={inputCls} inputMode="numeric" disabled={!admin} value={c.retentionDays} onChange={(e) => setC({ ...c, retentionDays: num(e.target.value) })} /></Field>
      </Grid></div>
    </Card>
    <Card title="Voice, language and personality" sub="Female, professional Indian HR assistant; Hinglish by default, follows Hindi or English when the employee uses it; says it is an AI; one question at a time.">
      <div className="px-5 pb-4 flex flex-col gap-2 text-[13px]">
        <Grid n={3}>
          <Field label="Voice" hint={c.speech === "browser" ? "Free: recognition runs on the employee's device and the device's own Hindi voice speaks. Nothing to host." : c.speech === "server" ? "Uses your own AI host (ai-service/) for recognition and the Piper Hindi voice." : "Employees type; the assistant replies in text."}>
            <select className={inputCls} disabled={!admin} value={c.speech} onChange={(e) => setC({ ...c, speech: e.target.value as typeof c.speech })}><option value="browser">On the employee&apos;s device (free)</option><option value="server">Our AI host</option><option value="off">Off (text only)</option></select>
          </Field>
          {c.speech === "browser" ? <Field label="Recognition model" hint="Downloaded once per device and cached.">
            <select className={inputCls} disabled={!admin} value={c.sttModel} onChange={(e) => setC({ ...c, sttModel: e.target.value as typeof c.sttModel })}><option value="whisper-base">Whisper base: ~80 MB, faster</option><option value="whisper-small">Whisper small: ~250 MB, better Hindi</option></select>
          </Field> : null}
        </Grid>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={c.llmAssist} disabled={!admin} onChange={(e) => setC({ ...c, llmAssist: e.target.checked })} />Let the local model place answers the rules don&apos;t understand (it can only choose one of the assistant&apos;s own intents; safety requests are always handled by rules)</label>
        <div className="text-[12px] text-[#64748B]">Audio is never stored. Transcripts are sealed with the server key and deleted after the retention period. The assistant cannot approve leave or overtime, change attendance or pay, or take disciplinary decisions.</div>
      </div>
    </Card>
    {admin ? <div><button className={primaryCls} disabled={busy} onClick={() => run(() => aiHrSaveConfig(c))}>Save settings</button></div> : null}
  </>;
}
