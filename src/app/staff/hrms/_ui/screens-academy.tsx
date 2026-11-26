"use client";
import { useEffect, useMemo, useState } from "react";
import { Award, CheckCircle2, Circle, Download, ExternalLink, FileText, Plus, Upload } from "lucide-react";
import type { Data } from "@/staff/hrms/screens";
import type { Participant } from "@/staff/hrms/training/service";
import { AREAS, RUBRICS, STATUS_LABEL, areaLabel, clock12, practicalLabel, type PracticalKind, type Slide } from "@/staff/hrms/training/shared";
import { trAddLink, trAssign, trAttendance, trCreateBatch, trCreateLesson, trGrantAttempt, trHrDecide, trInstall, trMove, trRemoveResource, trReopen, trReport, trRestore, trRevoke, trSaveLesson, trSaveModule, trSaveQuestion, trSaveScenario, trSaveSchedule, trSaveSettings, trScore, trTrainerDecide, trUnassign, trUpdateBatch, trUpload, trVersions } from "../training-actions";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, Table, Tabs, btnCls, cx, dangerCls, dayLabel, dayLong, download, inputCls, primaryCls, tdCls, useRun } from "./kit";

type A = Extract<Data<"academy">, { installed: true }>;
type Desk = Data<"trdesk">;
const tone = (s: string) => (s === "certified" ? "green" : s === "rejected" || s === "failed" ? "red" : s === "not_started" ? "gray" : s === "hr" || s === "trainer" || s === "review" ? "purple" : "amber");
const TABS = [["overview", "Training Overview"], ["employees", "Employees"], ["batches", "Training Batches"], ["builder", "Course Builder"], ["library", "Video & PPT Library"], ["quizzes", "Quiz Management"], ["practicals", "Practical Assessments"], ["certs", "Certificate Management"], ["reports", "Training Reports"], ["settings", "Settings"]] as const;
type TabId = (typeof TABS)[number][0];

export function AcademyScreen({ d }: { d: Data<"academy"> }) {
  const { run, busy } = useRun();
  const [tab, setTab] = useState<TabId>("overview");
  if (!d.installed) return (
    <Card title="Install the Medoro Sales Training Academy" pad>
      <div className="flex flex-col gap-3 pt-1 text-[13.5px] text-[#334155] max-w-[720px]">
        <p>This puts the standard one-day programme into the HRMS database: the 10:00 AM–6:30 PM timetable, the official 26-chapter product tour with sales notes for every chapter, nine Hinglish sales lectures with slides and narration scripts, the feature-to-benefit table, the objection library, cold-calling scripts, 7 role-play scenarios, lesson checks, a 26-question product knowledge quiz and the final exam.</p>
        <p>Everything stays editable in the Course Builder afterwards. Installing assigns nobody.</p>
        <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trInstall(), (r) => `Installed: ${r.lessons} lessons, ${r.questions} questions, ${r.scenarios} scenarios.`)}>Install the standard course</button>
      </div>
    </Card>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto -mx-1 px-1"><Tabs value={tab} onChange={setTab} options={TABS.map((x) => [x[0], x[1]])} /></div>
      {tab === "overview" ? <Overview d={d} go={setTab} /> : null}
      {tab === "employees" ? <People rows={d.rows} batches={d.batches} manage meId={d.meId} /> : null}
      {tab === "batches" ? <Batches d={d} /> : null}
      {tab === "builder" ? <Builder d={d} /> : null}
      {tab === "library" ? <Library d={d} /> : null}
      {tab === "quizzes" ? <Quizzes d={d} /> : null}
      {tab === "practicals" ? <PracticalsTab rows={d.rows} scenarios={d.scenarios} meId={d.meId} /> : null}
      {tab === "certs" ? <Certs d={d} /> : null}
      {tab === "reports" ? <Reports d={d} /> : null}
      {tab === "settings" ? <SettingsTab d={d} /> : null}
    </div>
  );
}

function Overview({ d, go }: { d: A; go: (t: TabId) => void }) {
  const count = (s: string[]) => d.rows.filter((r) => s.includes(r.status)).length;
  const waitingHr = d.rows.filter((r) => r.status === "hr");
  const avg = d.rows.length ? Math.round(d.rows.reduce((a, r) => a + r.score, 0) / d.rows.length) : 0;
  return (
    <div className="flex flex-col gap-4">
      <Grid n={4}>
        <Stat l="Assigned" v={d.rows.length} sub={`${d.batches.length} batch${d.batches.length === 1 ? "" : "es"}`} />
        <Stat l="Learning" v={count(["not_started", "learning", "practicals"])} sub="still in progress" c="#B45309" />
        <Stat l="Needs review" v={count(["review", "trainer", "hr"])} sub="trainer or HR action" c="#5B45B0" />
        <Stat l="Certified" v={count(["certified"])} sub={`average score ${avg}/100`} />
      </Grid>
      <Card title="Waiting for HR approval" sub={d.settings.hrApproval ? "Trainer approved; every requirement met" : "HR approval is switched off in Settings"}>
        {waitingHr.length ? <ul className="px-5 pb-4 flex flex-col gap-2">{waitingHr.map((r) => <HrApproveRow key={r.id} r={r} meId={d.meId} />)}</ul> : <Empty>Nothing waiting.</Empty>}
      </Card>
      <Grid n={2}>
        <Card title="Batches" right={<button className={btnCls} onClick={() => go("batches")}>Manage</button>}>
          {d.batches.length ? <ul className="px-5 pb-4 flex flex-col gap-1.5">{d.batches.slice(0, 6).map((b) => <li key={b.id} className="flex gap-3 text-[13px]"><span className="flex-1 font-semibold">{b.name}</span><span className="text-[#64748B]">{dayLabel(b.date)} · {b.trainer} · {b.count} people</span></li>)}</ul> : <Empty>No batches yet. Create one under Training Batches.</Empty>}
        </Card>
        <Card title="Today’s timetable" right={<button className={btnCls} onClick={() => go("builder")}>Edit</button>}>
          <ul className="px-5 pb-4 flex flex-col gap-1">{d.sessions.map((s) => <li key={s.start} className="flex gap-3 text-[12.5px]"><span className="w-[70px] text-[#64748B] tabular-nums">{clock12(s.start)}</span><span>{s.title}</span></li>)}</ul>
        </Card>
      </Grid>
    </div>
  );
}

function HrApproveRow({ r, meId }: { r: Participant; meId: string }) {
  const { run, busy } = useRun();
  const [note, setNote] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-2 first:border-t-0">
      <span className="flex-1 min-w-[180px] text-[13px]"><strong>{r.name}</strong> ({r.empNo}) · {r.batch} · score <strong>{r.score}</strong>/100 · trainer: {r.trainer}</span>
      <input className={inputCls + " max-w-[240px]"} placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={primaryCls} disabled={busy || r.staffId === meId} onClick={() => run(() => trHrDecide(r.id, true, note), (x) => (x.issued ? `Certificate ${x.certNo} issued.` : "Approved."))}>Approve & issue</button>
      <button className={dangerCls} disabled={busy || r.staffId === meId} onClick={() => run(() => trHrDecide(r.id, false, note), () => "Not approved. The employee sees your note.")}>Reject</button>
    </li>
  );
}

// ── People (HR and trainers)
function People({ rows, batches, manage, meId, rubrics }: { rows: Participant[]; batches: { id: string; name: string; date: string }[]; manage: boolean; meId: string; rubrics?: Desk["rubrics"] }) {
  const [q, setQ] = useState(""), [dept, setDept] = useState(""), [batch, setBatch] = useState(""), [date, setDate] = useState(""), [comp, setComp] = useState(""), [assess, setAssess] = useState(""), [cert, setCert] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const depts = [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort();
  const list = rows.filter((r) => (!q || (r.name + r.empNo).toLowerCase().includes(q.toLowerCase())) && (!dept || r.dept === dept) && (!batch || r.batchId === batch) && (!date || r.date === date)
    && (!comp || (comp === "done" ? r.lessonsDone === r.lessonsTotal : comp === "progress" ? r.lessonsDone > 0 && r.lessonsDone < r.lessonsTotal : r.lessonsDone === 0))
    && (!assess || (assess === "passed" ? r.score >= 80 && r.ready : assess === "review" ? ["review", "trainer", "hr"].includes(r.status) : assess === "failed" ? r.status === "failed" || r.status === "rejected" : r.finalPct === null))
    && (!cert || (cert === "issued" ? !!r.certificate && !r.certificate.revoked : cert === "revoked" ? !!r.certificate?.revoked : !r.certificate)));
  const sel = rows.find((r) => r.id === open);
  return (
    <Card title="Employees in training" sub={`${list.length} of ${rows.length}`}>
      <div className="px-5 pb-3 grid gap-2 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        <input className={inputCls} placeholder="Search employee" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employee" />
        <select className={inputCls} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((x) => <option key={x}>{x}</option>)}</select>
        <select className={inputCls} value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch"><option value="">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Training date" />
        <select className={inputCls} value={comp} onChange={(e) => setComp(e.target.value)} aria-label="Completion"><option value="">Any completion</option><option value="none">Not started</option><option value="progress">In progress</option><option value="done">Lessons complete</option></select>
        <select className={inputCls} value={assess} onChange={(e) => setAssess(e.target.value)} aria-label="Assessment"><option value="">Any assessment</option><option value="pending">Final exam not taken</option><option value="review">Needs review/approval</option><option value="passed">Ready / passed</option><option value="failed">Below pass / rejected</option></select>
        <select className={inputCls} value={cert} onChange={(e) => setCert(e.target.value)} aria-label="Certificate"><option value="">Any certificate</option><option value="none">Not issued</option><option value="issued">Issued</option><option value="revoked">Revoked</option></select>
      </div>
      <Table head={["Employee", "Batch", "Progress", "Tour", "Product quiz", "Final", "Practicals", "Score", "Status", ""]} empty={list.length ? undefined : "No one matches."}>
        {list.map((r) => (
          <tr key={r.id}>
            <td className={tdCls}><div className="font-semibold">{r.name}</div><div className="text-[11.5px] text-[#64748B]">{r.empNo} · {r.dept || "—"}</div></td>
            <td className={tdCls}><div>{r.batch}</div><div className="text-[11.5px] text-[#64748B]">{dayLabel(r.date)}{r.attendance ? ` · ${r.attendance}` : ""}</div></td>
            <td className={tdCls + " min-w-[110px]"}><div className="text-[12px]">{r.lessonsDone}/{r.lessonsTotal} ({r.pct}%)</div><div className="h-1.5 bg-[#E2E8F0] rounded-full mt-1"><div className="h-full bg-[#0B5E5B] rounded-full" style={{ width: `${r.pct}%` }} /></div></td>
            <td className={tdCls}>{r.tourDone}/{r.tourTotal}</td>
            <td className={tdCls}>{r.productPct ?? "—"}{r.productPct !== null ? "%" : ""}</td>
            <td className={tdCls}>{r.finalPct ?? "—"}{r.finalPct !== null ? "%" : ""}</td>
            <td className={tdCls + " text-[12px]"}>Call {r.mock || "—"}<br />Demo {r.demo || "—"}</td>
            <td className={tdCls + " font-bold"}>{r.score}</td>
            <td className={tdCls}><Pill tone={tone(r.status)}>{STATUS_LABEL[r.status]}</Pill>{r.certificate ? <div className="text-[11px] text-[#64748B] mt-0.5">{r.certificate.certNo}</div> : null}</td>
            <td className={tdCls}><button className={btnCls} onClick={() => setOpen(r.id)}>Open</button></td>
          </tr>
        ))}
      </Table>
      {sel ? <ParticipantModal r={sel} batches={batches} manage={manage} meId={meId} rubrics={rubrics} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}

function ParticipantModal({ r, batches, manage, meId, onClose }: { r: Participant; batches: { id: string; name: string }[]; manage: boolean; meId: string; rubrics?: Desk["rubrics"]; onClose: () => void }) {
  const { run, busy } = useRun();
  const [fb, setFb] = useState(r.trainerFeedback), [note, setNote] = useState(""), [move, setMove] = useState(r.batchId);
  const [score, setScore] = useState<Participant["practicals"][number] | null>(null);
  const self = r.staffId === meId;
  return (
    <Modal title={`${r.name} · ${r.empNo}`} onClose={onClose} wide>
      <div className="flex flex-wrap gap-2 items-center text-[13px]"><Pill tone={tone(r.status)}>{STATUS_LABEL[r.status]}</Pill><span>Score <strong>{r.score}</strong>/100</span><span className="text-[#64748B]">· {r.batch} · {dayLong(r.date)} · trainer {r.trainer}</span></div>
      {self ? <div className="text-[13px] text-[#B45309]">This is your own training: you can’t assess or approve it.</div> : null}
      <div className="grid gap-4 min-[760px]:grid-cols-2">
        <div>
          <h4 className="text-[13px] font-bold mb-1.5">Requirements</h4>
          <ul className="flex flex-col gap-1.5">{r.req.map((x) => <li key={x.id} className="flex gap-2 text-[12.5px]">{x.ok ? <CheckCircle2 size={15} className="text-[#0B5E5B] flex-none" /> : <Circle size={15} className="text-[#94A3B8] flex-none" />}<span className="flex-1">{x.label}</span><span className="text-[#64748B]">{x.detail}</span></li>)}</ul>
          <h4 className="text-[13px] font-bold mt-3 mb-1.5">Marks</h4>
          <ul className="flex flex-col gap-1">{AREAS.map((a) => <li key={a.id} className="flex text-[12.5px]"><span className="flex-1">{a.label}</span><span className="tabular-nums">{r.marks[a.id].toFixed(1)} / {a.marks}</span></li>)}</ul>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]"><strong>Attendance:</strong>
            {(["present", "absent"] as const).map((v) => <button key={v} disabled={busy || self} className={cx(btnCls, r.attendance === v && "!bg-[#0B5E5B] !text-white")} onClick={() => run(() => trAttendance(r.id, v))}>{v === "present" ? "Present" : "Absent"}</button>)}
          </div>
          <div>
            <h4 className="text-[13px] font-bold mb-1.5">Practicals</h4>
            {r.practicals.length ? r.practicals.map((p) => (
              <div key={p.id} className="rounded-lg border border-[#E2E8F0] p-2 mb-2 text-[12.5px]">
                <div className="flex items-center gap-2"><strong>{practicalLabel(p.kind)} #{p.attemptNo}</strong>{p.evaluatedAt ? <Pill tone={p.passed ? "green" : "red"}>{p.score}/{p.maxScore}</Pill> : <Pill tone="purple">Waiting</Pill>}{!p.evaluatedAt && !self ? <button className={btnCls + " ml-auto"} onClick={() => setScore(p)}>Score</button> : null}</div>
                <p className="mt-1 whitespace-pre-wrap text-[#334155] max-h-28 overflow-auto">{p.submission}</p>
                {p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-[#0B5E5B] underline">Recording</a> : null}
                {p.feedback ? <p className="mt-1 text-[#475569]"><strong>Feedback:</strong> {p.feedback}</p> : null}
              </div>
            )) : <div className="text-[12.5px] text-[#64748B]">Nothing submitted yet.</div>}
          </div>
        </div>
      </div>
      {!self ? (
        <div className="border-t border-[#E2E8F0] pt-3 flex flex-col gap-2">
          <Field label="Trainer feedback / recommendation"><textarea className={inputCls + " min-h-[70px]"} value={fb} onChange={(e) => setFb(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <button className={primaryCls} disabled={busy || !r.ready || r.status === "certified"} onClick={() => run(() => trTrainerDecide(r.id, true, fb), (x) => (x.issued ? "Approved and certificate issued." : "Recommended for certification."))}>Recommend for certificate</button>
            <button className={dangerCls} disabled={busy || r.status === "certified"} onClick={() => run(() => trTrainerDecide(r.id, false, fb), () => "Saved. The employee sees your feedback.")}>Not ready</button>
            {r.trainerDecision || r.hrDecision ? <button className={btnCls} disabled={busy || r.status === "certified"} onClick={() => run(() => trReopen(r.id))}>Reopen</button> : null}
          </div>
          {!r.ready ? <span className="text-[12px] text-[#64748B]">Recommendation opens once every requirement is met.</span> : null}
        </div>
      ) : null}
      {manage && !self ? (
        <div className="border-t border-[#E2E8F0] pt-3 flex flex-wrap gap-2 items-end">
          {r.status === "hr" ? <><input className={inputCls + " max-w-[260px]"} placeholder="HR note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} /><button className={primaryCls} disabled={busy} onClick={() => run(() => trHrDecide(r.id, true, note), (x) => (x.issued ? `Certificate ${x.certNo} issued.` : "Approved."))}>HR approve</button><button className={dangerCls} disabled={busy} onClick={() => run(() => trHrDecide(r.id, false, note))}>HR reject</button></> : null}
          <button className={btnCls} disabled={busy} onClick={() => run(() => trGrantAttempt(r.id))}>Allow one more attempt</button>
          <select className={inputCls + " max-w-[200px]"} value={move} onChange={(e) => setMove(e.target.value)} aria-label="Move to batch">{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <button className={btnCls} disabled={busy || move === r.batchId} onClick={() => run(() => trMove(r.id, move))}>Move</button>
          <button className={dangerCls} disabled={busy} onClick={() => { if (confirm("Remove this person from the programme? Only possible before they start.")) run(() => trUnassign(r.id), () => { onClose(); }); }}>Remove</button>
        </div>
      ) : null}
      {score ? <ScoreModal p={score} onClose={() => setScore(null)} /> : null}
    </Modal>
  );
}

function ScoreModal({ p, onClose }: { p: { id: string; kind: string; submission: string }; onClose: () => void }) {
  const { run, busy } = useRun();
  const rubric = RUBRICS[p.kind as PracticalKind];
  const [v, setV] = useState<Record<string, number>>(() => Object.fromEntries(rubric.map((c) => [c.id, 0])));
  const [fb, setFb] = useState("");
  const total = Object.values(v).reduce((a, b) => a + b, 0), max = rubric.reduce((a, c) => a + c.max, 0);
  return (
    <Modal title={`Score: ${practicalLabel(p.kind)}`} onClose={onClose} wide>
      <p className="text-[12.5px] text-[#334155] whitespace-pre-wrap max-h-40 overflow-auto rounded-lg bg-[#F8FAFC] p-2">{p.submission}</p>
      <div className="flex flex-col gap-2">
        {rubric.map((c) => (
          <label key={c.id} className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="flex-1 min-w-[220px]">{c.label} <span className="text-[#64748B]">({areaLabel(c.area)})</span></span>
            <input type="range" min={0} max={c.max} value={v[c.id]} onChange={(e) => setV((x) => ({ ...x, [c.id]: Number(e.target.value) }))} className="accent-[#0B5E5B] w-[160px]" aria-label={c.label} />
            <span className="w-[48px] tabular-nums text-right font-semibold">{v[c.id]}/{c.max}</span>
          </label>
        ))}
      </div>
      <div className="text-[14px] font-bold">Total {total}/{max}</div>
      <Field label="Feedback for the employee"><textarea className={inputCls + " min-h-[80px]"} value={fb} onChange={(e) => setFb(e.target.value)} placeholder="What went well, what to improve" /></Field>
      <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trScore(p.id, v, fb), () => { onClose(); })}>Save score</button>
    </Modal>
  );
}

function PracticalsTab({ rows, scenarios, meId }: { rows: Participant[]; scenarios: A["scenarios"]; meId: string }) {
  const pending = rows.flatMap((r) => r.practicals.filter((p) => !p.evaluatedAt).map((p) => ({ ...p, r })));
  const [score, setScore] = useState<(typeof pending)[number] | null>(null);
  const [edit, setEdit] = useState<A["scenarios"][number] | "new" | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Waiting to be scored" sub="The batch trainer usually scores; HR can too">
        {pending.length ? <ul className="px-5 pb-4 flex flex-col gap-2">{pending.map((p) => <li key={p.id} className="flex flex-wrap gap-2 items-center text-[13px] border-t border-[#F1F5F9] pt-2 first:border-t-0"><span className="flex-1"><strong>{p.r.name}</strong> · {practicalLabel(p.kind)} #{p.attemptNo} · {dayLabel(p.submittedAt)} · trainer {p.r.trainer}</span><button className={btnCls} disabled={p.r.staffId === meId} onClick={() => setScore(p)}>Score</button></li>)}</ul> : <Empty>Nothing waiting.</Empty>}
      </Card>
      <Card title="Role-play scenarios" sub="Used for the mock sales call" right={<button className={btnCls} onClick={() => setEdit("new")}><Plus size={14} />Add scenario</button>}>
        <ul className="px-5 pb-4 flex flex-col gap-2">{scenarios.map((s) => <li key={s.id} className="flex gap-2 items-center text-[13px] border-t border-[#F1F5F9] pt-2 first:border-t-0"><span className="flex-1"><strong>{s.title}</strong> <span className="text-[#64748B]">· {s.persona}</span></span>{s.status !== "published" ? <Pill>Draft</Pill> : null}<button className={btnCls} onClick={() => setEdit(s)}>Edit</button></li>)}</ul>
      </Card>
      <Card title="Rubrics" sub="Fixed by the programme’s 100-mark weighting">
        <div className="px-5 pb-4 grid gap-4 min-[760px]:grid-cols-2">{(Object.keys(RUBRICS) as PracticalKind[]).map((k) => <div key={k}><div className="font-bold text-[13px] mb-1">{practicalLabel(k)}</div><ul className="text-[12.5px] flex flex-col gap-0.5">{RUBRICS[k].map((c) => <li key={c.id}>{c.label}: {c.max} ({areaLabel(c.area)})</li>)}</ul></div>)}</div>
      </Card>
      {score ? <ScoreModal p={score} onClose={() => setScore(null)} /> : null}
      {edit ? <ScenarioModal s={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}
function ScenarioModal({ s, onClose }: { s: A["scenarios"][number] | null; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ title: s?.title ?? "", persona: s?.persona ?? "", situation: s?.situation ?? "", status: s?.status ?? "published", script: (s?.script ?? []).map((x) => `${x.who === "coach" ? "Coach" : "Customer"}: ${x.text}`).join("\n"), goals: (s?.goals ?? []).join("\n") });
  const save = () => run(() => trSaveScenario(s?.id ?? null, { title: v.title, persona: v.persona, situation: v.situation, status: v.status, goals: v.goals.split("\n").map((x) => x.trim()).filter(Boolean), script: v.script.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => /^coach:/i.test(x) ? { who: "coach", text: x.replace(/^coach:\s*/i, "") } : { who: "customer", text: x.replace(/^customer:\s*/i, "") }) }), () => { onClose(); });
  return (
    <Modal title={s ? "Edit scenario" : "New scenario"} onClose={onClose} wide>
      <Field label="Title"><input className={inputCls} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Customer persona"><input className={inputCls} value={v.persona} onChange={(e) => setV({ ...v, persona: e.target.value })} /></Field>
      <Field label="Situation"><textarea className={inputCls} value={v.situation} onChange={(e) => setV({ ...v, situation: e.target.value })} /></Field>
      <Field label="Customer lines" hint="One per line. Start a line with “Coach:” for a note to the trainee."><textarea className={inputCls + " min-h-[110px]"} value={v.script} onChange={(e) => setV({ ...v, script: e.target.value })} /></Field>
      <Field label="Goals (one per line)"><textarea className={inputCls} value={v.goals} onChange={(e) => setV({ ...v, goals: e.target.value })} /></Field>
      <Field label="Status"><select className={inputCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="published">Published</option><option value="draft">Draft</option></select></Field>
      <button className={primaryCls + " self-start"} disabled={busy} onClick={save}>Save</button>
    </Modal>
  );
}

// ── Batches
function Batches({ d }: { d: A }) {
  const { run, busy } = useRun();
  const [v, setV] = useState(() => ({ name: "", date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), trainerId: "", note: "" }));
  const [pick, setPick] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [edit, setEdit] = useState<A["batches"][number] | null>(null);
  const assigned = new Set(d.rows.map((r) => r.staffId));
  const candidates = d.staff.filter((s) => (showAll || s.sales) && !assigned.has(s.id));
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const report = (r: { added: string[]; skipped: { name: string; why: string }[] }) => `${r.added.length} assigned${r.skipped.length ? `; skipped: ${r.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}` : ""}.`;
  return (
    <div className="flex flex-col gap-4">
      <Card title="New training batch" sub="Pick the date, the trainer and the sales employees">
        <div className="px-5 pb-4 flex flex-col gap-3">
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            <Field label="Batch name"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Sales Batch – Dec 2026" /></Field>
            <Field label="Training date"><input type="date" className={inputCls} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
            <Field label="Trainer"><select className={inputCls} value={v.trainerId} onChange={(e) => setV({ ...v, trainerId: e.target.value })}><option value="">Choose…</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.empNo}</option>)}</select></Field>
          </div>
          <Field label="Note (optional)"><input className={inputCls} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <div>
            <div className="flex items-center gap-3 mb-1.5"><span className="text-[12px] font-semibold text-[#475569]">Employees ({pick.length} selected)</span><label className="text-[12px] flex items-center gap-1.5 ml-auto"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show everyone (only Sales role / Sales department can be assigned)</label></div>
            <div className="max-h-[240px] overflow-y-auto border border-[#E2E8F0] rounded-lg p-2 grid gap-1 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
              {candidates.length ? candidates.map((s) => <label key={s.id} className={cx("flex gap-2 items-center text-[13px] rounded-md px-2 py-1 cursor-pointer", pick.includes(s.id) ? "bg-[#D6F3EF]" : "hover:bg-[#F8FAFC]")}><input type="checkbox" checked={pick.includes(s.id)} onChange={() => toggle(s.id)} className="accent-[#0B5E5B]" /><span className="flex-1">{s.name}<span className="text-[#64748B]"> · {s.empNo} · {s.dept || s.role}</span></span>{!s.sales ? <Pill tone="amber">not sales</Pill> : null}</label>) : <span className="text-[13px] text-[#64748B] p-2">Everyone in the sales team is already assigned.</span>}
            </div>
          </div>
          <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trCreateBatch(v, pick), (r) => { setPick([]); setV({ ...v, name: "" }); return "Batch created. " + report(r); })}>Create batch & assign</button>
        </div>
      </Card>
      <Card title="Batches">
        <Table head={["Batch", "Date", "Trainer", "People", "Status", ""]} empty={d.batches.length ? undefined : "No batches yet."}>
          {d.batches.map((b) => <tr key={b.id}><td className={tdCls + " font-semibold"}>{b.name}</td><td className={tdCls}>{dayLong(b.date)}</td><td className={tdCls}>{b.trainer}</td><td className={tdCls}>{b.count}</td><td className={tdCls}><Pill tone={b.status === "closed" ? "gray" : "green"}>{b.status}</Pill></td><td className={tdCls}><button className={btnCls} onClick={() => setEdit(b)}>Edit / add people</button></td></tr>)}
        </Table>
      </Card>
      {edit ? <BatchModal b={edit} d={d} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}
function BatchModal({ b, d, onClose }: { b: A["batches"][number]; d: A; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ name: b.name, date: b.date, trainerId: b.trainerId, note: b.note });
  const [status, setStatus] = useState<"scheduled" | "closed">(b.status === "closed" ? "closed" : "scheduled");
  const [pick, setPick] = useState<string[]>([]);
  const assigned = new Set(d.rows.map((r) => r.staffId));
  return (
    <Modal title={`Batch: ${b.name}`} onClose={onClose} wide>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <Field label="Name"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Trainer"><select className={inputCls} value={v.trainerId} onChange={(e) => setV({ ...v, trainerId: e.target.value })}>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Status"><select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as "scheduled" | "closed")}><option value="scheduled">Scheduled</option><option value="closed">Closed</option></select></Field>
      </div>
      <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trUpdateBatch(b.id, v, status))}>Save batch</button>
      <div className="border-t border-[#E2E8F0] pt-3">
        <div className="text-[12px] font-semibold text-[#475569] mb-1.5">Add sales employees</div>
        <div className="max-h-[200px] overflow-y-auto border border-[#E2E8F0] rounded-lg p-2 grid gap-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {d.staff.filter((s) => s.sales && !assigned.has(s.id)).map((s) => <label key={s.id} className="flex gap-2 items-center text-[13px]"><input type="checkbox" checked={pick.includes(s.id)} onChange={() => setPick((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />{s.name} · {s.empNo}</label>)}
        </div>
        <button className={btnCls + " mt-2"} disabled={busy || !pick.length} onClick={() => run(() => trAssign(b.id, pick), (r) => { setPick([]); return `${r.added.length} assigned${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}` : ""}.`; })}>Assign selected</button>
      </div>
    </Modal>
  );
}

// ── Course builder
function Builder({ d }: { d: A }) {
  const { run, busy } = useRun();
  const [lesson, setLesson] = useState<string | null>(null);
  const [mod, setMod] = useState<A["modules"][number] | "new" | null>(null);
  const [sched, setSched] = useState(false);
  const [newTitle, setNewTitle] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-4">
      <Card title="Timetable" sub={`${d.sessions.length} sessions · ${clock12(d.sessions[0]?.start ?? "10:00")} to ${clock12(d.sessions[d.sessions.length - 1]?.end ?? "18:30")}`} right={<button className={btnCls} onClick={() => setSched(true)}>Edit timetable</button>}><div /></Card>
      <div className="flex justify-end"><button className={btnCls} onClick={() => setMod("new")}><Plus size={14} />Add module</button></div>
      {d.modules.map((m) => (
        <Card key={m.id} title={<span className="flex items-center gap-2">{m.title}{m.status !== "published" ? <Pill>Draft</Pill> : null}</span>} sub={m.description} right={<button className={btnCls} onClick={() => setMod(m)}>Edit module</button>}>
          <ul className="px-5 pb-3 flex flex-col">
            {d.lessons.filter((l) => l.moduleId === m.id).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 py-1.5 border-t border-[#F1F5F9] first:border-t-0 text-[13px]">
                <span className="flex-1 min-w-[200px] font-semibold">{l.title}</span>
                <span className="text-[11.5px] text-[#64748B]">{l.video ? (l.video.official ? "Official video" : "Video") : "Slides"} · {l.slides.length} slides · v{l.version}</span>
                {l.status !== "published" ? <Pill tone="amber">Draft</Pill> : null}{!l.mandatory ? <Pill>Optional</Pill> : null}
                <button className={btnCls} onClick={() => setLesson(l.id)}>Edit</button>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-4 flex gap-2"><input className={inputCls + " max-w-[320px]"} placeholder="New lesson title" value={newTitle[m.id] ?? ""} onChange={(e) => setNewTitle({ ...newTitle, [m.id]: e.target.value })} /><button className={btnCls} disabled={busy} onClick={() => run(() => trCreateLesson(m.id, newTitle[m.id] ?? ""), () => { setNewTitle({ ...newTitle, [m.id]: "" }); })}><Plus size={14} />Add draft lesson</button></div>
        </Card>
      ))}
      {lesson ? <LessonEditor l={d.lessons.find((x) => x.id === lesson)!} parts={d.officialParts} onClose={() => setLesson(null)} /> : null}
      {mod ? <ModuleModal m={mod === "new" ? null : mod} onClose={() => setMod(null)} /> : null}
      {sched ? <ScheduleModal rows={d.sessions} modules={d.modules} onClose={() => setSched(false)} /> : null}
    </div>
  );
}
function ModuleModal({ m, onClose }: { m: A["modules"][number] | null; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ title: m?.title ?? "", description: m?.description ?? "", order: m?.order ?? 99, status: m?.status ?? "published" });
  return (
    <Modal title={m ? "Edit module" : "New module"} onClose={onClose}>
      <Field label="Title"><input className={inputCls} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Description"><textarea className={inputCls} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Order"><input type="number" className={inputCls} value={v.order} onChange={(e) => setV({ ...v, order: Number(e.target.value) })} /></Field><Field label="Status"><select className={inputCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="published">Published</option><option value="draft">Draft</option></select></Field></div>
      <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trSaveModule(m?.id ?? null, v), () => { onClose(); })}>Save</button>
    </Modal>
  );
}
function ScheduleModal({ rows, modules, onClose }: { rows: A["sessions"]; modules: A["modules"]; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState(rows.map((r) => ({ ...r })));
  const set = (k: number, f: string, val: string) => setV((x) => x.map((r, i) => (i === k ? { ...r, [f]: val } : r)));
  return (
    <Modal title="Training timetable" onClose={onClose} wide>
      <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
        {v.map((r, k) => (
          <div key={k} className="grid gap-2 items-center grid-cols-[90px_90px_1fr_120px_160px_32px] max-[760px]:grid-cols-2">
            <input type="time" className={inputCls} value={r.start} onChange={(e) => set(k, "start", e.target.value)} aria-label="Start" />
            <input type="time" className={inputCls} value={r.end} onChange={(e) => set(k, "end", e.target.value)} aria-label="End" />
            <input className={inputCls} value={r.title} onChange={(e) => set(k, "title", e.target.value)} aria-label="Title" />
            <select className={inputCls} value={r.kind} onChange={(e) => set(k, "kind", e.target.value)} aria-label="Kind">{["session", "quiz", "break", "practical", "assessment"].map((x) => <option key={x}>{x}</option>)}</select>
            <select className={inputCls} value={r.moduleSlug} onChange={(e) => set(k, "moduleSlug", e.target.value)} aria-label="Module"><option value="">No module</option>{modules.map((m) => <option key={m.slug} value={m.slug}>{m.title}</option>)}</select>
            <button className={dangerCls} onClick={() => setV((x) => x.filter((_, i) => i !== k))} aria-label="Remove">×</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2"><button className={btnCls} onClick={() => setV((x) => [...x, { start: "18:30", end: "18:45", title: "New session", kind: "session", moduleSlug: "" }])}><Plus size={14} />Add row</button><button className={primaryCls} disabled={busy} onClick={() => run(() => trSaveSchedule(v), () => { onClose(); })}>Save timetable</button></div>
    </Modal>
  );
}

function LessonEditor({ l, parts, onClose }: { l: A["lessons"][number]; parts: A["officialParts"]; onClose: () => void }) {
  const { run, busy, toast } = useRun();
  const [v, setV] = useState({ title: l.title, summary: l.summary, mandatory: l.mandatory, status: l.status, order: l.order, durationMin: l.durationMin, videoKind: l.videoKind, videoRef: l.videoRef, videoSeconds: l.videoSeconds, completionPct: l.completionPct, transcript: l.transcript });
  const [slides, setSlides] = useState<Slide[]>(l.slides);
  const [content, setContent] = useState(JSON.stringify(l.content ?? {}, null, 2));
  const [versions, setVersions] = useState<{ id: string; version: number; at: string; title: string }[] | null>(null);
  const setSlide = (k: number, s: Partial<Slide>) => setSlides((x) => x.map((y, i) => (i === k ? { ...y, ...s } : y)));
  const save = () => {
    let c: unknown;
    try { c = JSON.parse(content || "{}"); } catch { toast("The structured content isn’t valid JSON.", "red"); return; }
    run(() => trSaveLesson(l.id, { ...v, slides, content: c }), () => { onClose(); });
  };
  useEffect(() => { trVersions(l.id).then((r) => r.ok && setVersions(r.data)); }, [l.id]);
  return (
    <Modal title={`Edit lesson · v${l.version}`} onClose={onClose} wide>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <Field label="Title"><input className={inputCls} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Status"><select className={inputCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="published">Published</option><option value="draft">Draft</option></select></Field>
        <Field label="Order"><input type="number" className={inputCls} value={v.order} onChange={(e) => setV({ ...v, order: Number(e.target.value) })} /></Field>
        <Field label="Duration (min)"><input type="number" className={inputCls} value={v.durationMin} onChange={(e) => setV({ ...v, durationMin: Number(e.target.value) })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.mandatory} onChange={(e) => setV({ ...v, mandatory: e.target.checked })} />Mandatory for the certificate</label>
      <Field label="Summary"><textarea className={inputCls} value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} /></Field>
      <div className="rounded-xl border border-[#E2E8F0] p-3 flex flex-col gap-2">
        <div className="text-[13px] font-bold">Video</div>
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          <Field label="Source"><select className={inputCls} value={v.videoKind} onChange={(e) => setV({ ...v, videoKind: e.target.value, videoRef: e.target.value === "official" ? parts[0].slug : "" })}><option value="none">No video (slides only)</option><option value="official">Official product tour part</option><option value="file">Video file link (MP4/WebM)</option><option value="youtube">YouTube</option></select></Field>
          {v.videoKind === "official" ? <Field label="Tour part"><select className={inputCls} value={v.videoRef} onChange={(e) => setV({ ...v, videoRef: e.target.value })}>{parts.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</select></Field> : null}
          {v.videoKind === "file" || v.videoKind === "youtube" ? <Field label={v.videoKind === "file" ? "Video URL" : "YouTube link or ID"} hint={v.videoKind === "file" ? "This site (/path.mp4) or the configured video host" : undefined}><input className={inputCls} value={v.videoRef} onChange={(e) => setV({ ...v, videoRef: e.target.value })} /></Field> : null}
          {v.videoKind === "file" || v.videoKind === "youtube" ? <Field label="Length (seconds)" hint="0 = learnt from the player"><input type="number" className={inputCls} value={v.videoSeconds} onChange={(e) => setV({ ...v, videoSeconds: Number(e.target.value) })} /></Field> : null}
          {v.videoKind !== "none" ? <Field label="Must watch (%)"><input type="number" min={50} max={100} className={inputCls} value={v.completionPct} onChange={(e) => setV({ ...v, completionPct: Number(e.target.value) })} /></Field> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center"><span className="text-[13px] font-bold flex-1">Slides ({slides.length})</span><button className={btnCls} onClick={() => setSlides((x) => [...x, { title: "New slide", bullets: [], narration: "" }])}><Plus size={14} />Add slide</button></div>
        <div className="flex flex-col gap-2 max-h-[46vh] overflow-y-auto pr-1">
          {slides.map((s, k) => (
            <div key={k} className="rounded-xl border border-[#E2E8F0] p-3 flex flex-col gap-2">
              <div className="flex gap-2"><span className="text-[12px] font-bold text-[#64748B] pt-2">{k + 1}</span><input className={inputCls} value={s.title} onChange={(e) => setSlide(k, { title: e.target.value })} aria-label="Slide title" />
                <button className={btnCls} disabled={k === 0} onClick={() => setSlides((x) => { const y = [...x]; [y[k - 1], y[k]] = [y[k], y[k - 1]]; return y; })} aria-label="Move up">↑</button>
                <button className={dangerCls} onClick={() => setSlides((x) => x.filter((_, i) => i !== k))} aria-label="Remove slide">×</button></div>
              <textarea className={inputCls + " min-h-[64px]"} value={s.bullets.join("\n")} onChange={(e) => setSlide(k, { bullets: e.target.value.split("\n") })} placeholder="Bullet points, one per line" aria-label="Bullets" />
              <textarea className={inputCls + " min-h-[64px]"} value={s.narration} onChange={(e) => setSlide(k, { narration: e.target.value })} placeholder="Hinglish narration script" aria-label="Narration" />
            </div>
          ))}
        </div>
      </div>
      <Field label="Transcript / subtitles (Hinglish)"><textarea className={inputCls + " min-h-[90px]"} value={v.transcript} onChange={(e) => setV({ ...v, transcript: e.target.value })} /></Field>
      <details><summary className="cursor-pointer text-[13px] font-semibold">Structured content (objectives, key points, Q&A, objection and feature tables) – JSON</summary><textarea className={inputCls + " min-h-[220px] font-mono text-[12px] mt-2"} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} /></details>
      <div className="flex gap-2 items-center"><button className={primaryCls} disabled={busy} onClick={save}>Save as v{l.version + 1}</button><a className={btnCls + " no-underline"} href={`/staff/hrms/training/notes/${l.id}`} target="_blank" rel="noopener"><FileText size={14} />Preview PDF</a></div>
      {versions?.length ? (
        <details><summary className="cursor-pointer text-[13px] font-semibold">Earlier versions ({versions.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">{versions.map((x) => <li key={x.id} className="flex items-center gap-2 text-[12.5px]"><span className="flex-1">v{x.version} · {x.title} · {dayLong(x.at)}</span><button className={btnCls} disabled={busy} onClick={() => { if (confirm(`Restore v${x.version}? The current text is kept as a version too.`)) run(() => trRestore(x.id), () => { onClose(); }); }}>Restore</button></li>)}</ul>
        </details>
      ) : null}
    </Modal>
  );
}

function Library({ d }: { d: A }) {
  const { run, busy } = useRun();
  const [link, setLink] = useState<Record<string, { name: string; url: string }>>({});
  return (
    <Card title="Video & PPT library" sub="Upload PDF or PowerPoint (.pptx) notes, or add links. Videos are set in the Course Builder.">
      <Table head={["Lesson", "Video", "Files", "Add"]}>
        {d.lessons.map((l) => (
          <tr key={l.id}>
            <td className={tdCls + " font-semibold max-w-[260px]"}>{l.title}</td>
            <td className={tdCls + " text-[12px]"}>{l.videoKind === "official" ? "Official tour part" : l.videoKind === "file" ? <span className="break-all">{l.videoRef}</span> : l.videoKind === "youtube" ? `YouTube ${l.videoRef}` : "—"}</td>
            <td className={tdCls}>
              <div className="flex flex-col gap-1">
                <a className="text-[12px] text-[#0B5E5B] underline" href={`/staff/hrms/training/notes/${l.id}`} target="_blank" rel="noopener">Generated slides & notes (PDF)</a>
                {l.resources.map((r, k) => <span key={k} className="flex items-center gap-1.5 text-[12px]"><a className="text-[#0B5E5B] underline" href={r.href} target="_blank" rel="noopener">{r.name}</a><button className="text-[#B3261E] bg-transparent border-0 cursor-pointer" disabled={busy} onClick={() => run(() => trRemoveResource(l.id, k))} aria-label={`Remove ${r.name}`}>×</button></span>)}
              </div>
            </td>
            <td className={tdCls}>
              <div className="flex flex-col gap-1.5 min-w-[220px]">
                <label className={btnCls + " self-start"}><Upload size={13} />Upload PDF / PPTX<input type="file" className="hidden" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.set("file", f); run(() => trUpload(l.id, fd)); e.target.value = ""; }} /></label>
                <div className="flex gap-1"><input className={inputCls} placeholder="Link name" value={link[l.id]?.name ?? ""} onChange={(e) => setLink({ ...link, [l.id]: { name: e.target.value, url: link[l.id]?.url ?? "" } })} /><input className={inputCls} placeholder="https://" value={link[l.id]?.url ?? ""} onChange={(e) => setLink({ ...link, [l.id]: { name: link[l.id]?.name ?? "", url: e.target.value } })} /><button className={btnCls} disabled={busy} onClick={() => run(() => trAddLink(l.id, link[l.id]?.name ?? "", link[l.id]?.url ?? ""), () => { setLink({ ...link, [l.id]: { name: "", url: "" } }); })}>Add</button></div>
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Quizzes({ d }: { d: A }) {
  const [scope, setScope] = useState<"product" | "final" | "lesson">("product");
  const [edit, setEdit] = useState<A["questions"][number] | "new" | null>(null);
  const list = d.questions.filter((q) => q.scope === scope);
  const lessonTitle = (id: string | null) => d.lessons.find((l) => l.id === id)?.title ?? "";
  return (
    <Card title="Quiz management" sub={`${list.filter((q) => q.status === "published").length} published`} right={<button className={btnCls} onClick={() => setEdit("new")}><Plus size={14} />Add question</button>}>
      <div className="px-5 pb-3"><Tabs value={scope} onChange={setScope} options={[["product", "Product knowledge quiz"], ["final", "Final exam"], ["lesson", "Lesson checks"]]} /></div>
      <ol className="px-5 pb-4 flex flex-col gap-2">
        {list.map((q, k) => (
          <li key={q.id} className={cx("rounded-xl border border-[#E2E8F0] p-3 text-[13px]", q.status !== "published" && "opacity-60")}>
            <div className="flex gap-2"><span className="flex-1 font-semibold">{k + 1}. {q.prompt}</span><Pill tone="blue">{areaLabel(q.area)}</Pill>{q.status !== "published" ? <Pill>Archived</Pill> : null}<button className={btnCls} onClick={() => setEdit(q)}>Edit</button></div>
            {q.lessonId ? <div className="text-[11.5px] text-[#64748B]">{lessonTitle(q.lessonId)}</div> : null}
            <ul className="mt-1 text-[12.5px]">{q.options.map((o, i) => <li key={i} className={i === q.answer ? "text-[#0B5E5B] font-semibold" : ""}>{i === q.answer ? "✓ " : "· "}{o}</li>)}</ul>
          </li>
        ))}
      </ol>
      {edit ? <QuestionModal q={edit === "new" ? null : edit} scope={scope} lessons={d.lessons} onClose={() => setEdit(null)} /> : null}
    </Card>
  );
}
function QuestionModal({ q, scope, lessons, onClose }: { q: A["questions"][number] | null; scope: string; lessons: A["lessons"]; onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ scope: q?.scope ?? scope, lessonId: q?.lessonId ?? (scope === "lesson" ? lessons[0]?.id ?? null : null), area: q?.area ?? (scope === "final" ? "communication" : "product"), prompt: q?.prompt ?? "", options: q?.options ?? ["", "", "", ""], answer: q?.answer ?? 0, explanation: q?.explanation ?? "", status: q?.status ?? "published", order: q?.order ?? 99 });
  return (
    <Modal title={q ? "Edit question" : "New question"} onClose={onClose} wide>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <Field label="Quiz"><select className={inputCls} value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })}><option value="product">Product knowledge quiz</option><option value="final">Final exam</option><option value="lesson">Lesson check</option></select></Field>
        {v.scope !== "final" ? <Field label="Lesson / chapter"><select className={inputCls} value={v.lessonId ?? ""} onChange={(e) => setV({ ...v, lessonId: e.target.value || null })}><option value="">—</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></Field> : null}
        <Field label="Assessment area"><select className={inputCls} value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })}>{AREAS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
        <Field label="Status"><select className={inputCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="published">Published</option><option value="archived">Archived</option></select></Field>
      </div>
      {v.scope === "final" ? <div className="text-[12px] text-[#64748B]">Final-exam marks: Communication-area questions give the 15 Sales Communication marks, CRM-area questions the 5 CRM marks.</div> : null}
      <Field label="Question"><textarea className={inputCls} value={v.prompt} onChange={(e) => setV({ ...v, prompt: e.target.value })} /></Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-[#475569]">Options (select the correct one)</span>
        {v.options.map((o, i) => <div key={i} className="flex gap-2 items-center"><input type="radio" checked={v.answer === i} onChange={() => setV({ ...v, answer: i })} aria-label={`Option ${i + 1} is correct`} className="accent-[#0B5E5B]" /><input className={inputCls} value={o} onChange={(e) => setV({ ...v, options: v.options.map((x, j) => (j === i ? e.target.value : x)) })} />{v.options.length > 2 ? <button className={dangerCls} onClick={() => setV({ ...v, options: v.options.filter((_, j) => j !== i), answer: v.answer >= i && v.answer > 0 ? v.answer - 1 : v.answer })} aria-label="Remove option">×</button> : null}</div>)}
        {v.options.length < 6 ? <button className={btnCls + " self-start"} onClick={() => setV({ ...v, options: [...v.options, ""] })}><Plus size={13} />Option</button> : null}
      </div>
      <Field label="Explanation (shown after grading)"><textarea className={inputCls} value={v.explanation} onChange={(e) => setV({ ...v, explanation: e.target.value })} /></Field>
      <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trSaveQuestion(q?.id ?? null, v), () => { onClose(); })}>Save question</button>
    </Modal>
  );
}

function Certs({ d }: { d: A }) {
  const { run, busy } = useRun();
  const [why, setWhy] = useState<Record<string, string>>({});
  const site = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Card title="Certificate management" sub="Issued automatically after every requirement and approval">
      <Table head={["Certificate", "Employee", "Score", "Issued", "Status", ""]} empty={d.certificates.length ? undefined : "No certificates yet."}>
        {d.certificates.map((c) => (
          <tr key={c.id}>
            <td className={tdCls + " font-semibold"}>{c.certNo}</td><td className={tdCls}>{c.name} <span className="text-[#64748B]">· {c.empNo}</span></td><td className={tdCls}>{c.score}/100</td><td className={tdCls}>{dayLabel(c.issuedAt)}</td>
            <td className={tdCls}>{c.revoked ? <span title={c.revokedReason}><Pill tone="red">Revoked</Pill></span> : <Pill tone="green">Valid</Pill>}</td>
            <td className={tdCls}>
              <div className="flex flex-wrap gap-1.5 items-center">
                <a className={btnCls + " no-underline"} href={`/staff/hrms/training/certificate/${c.id}`} target="_blank" rel="noopener"><Download size={13} />PDF</a>
                <a className={btnCls + " no-underline"} href={`${site}/certificate/verify/${c.verifyCode}`} target="_blank" rel="noopener"><ExternalLink size={13} />Verify</a>
                {!c.revoked ? <><input className={inputCls + " max-w-[160px]"} placeholder="Reason to revoke" value={why[c.id] ?? ""} onChange={(e) => setWhy({ ...why, [c.id]: e.target.value })} /><button className={dangerCls} disabled={busy} onClick={() => { if (confirm(`Revoke ${c.certNo}? Verification will show it as revoked.`)) run(() => trRevoke(c.id, why[c.id] ?? "")); }}>Revoke</button></> : null}
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Reports({ d }: { d: A }) {
  const { run, busy } = useRun();
  const byBatch = useMemo(() => d.batches.map((b) => { const rs = d.rows.filter((r) => r.batchId === b.id); return { ...b, n: rs.length, done: rs.filter((r) => r.lessonsDone === r.lessonsTotal).length, cert: rs.filter((r) => r.status === "certified").length, avg: rs.length ? Math.round(rs.reduce((a, r) => a + r.score, 0) / rs.length) : 0 }; }), [d]);
  const areaAvg = AREAS.map((a) => ({ ...a, avg: d.rows.length ? d.rows.reduce((t, r) => t + r.marks[a.id], 0) / d.rows.length : 0 }));
  return (
    <div className="flex flex-col gap-4">
      <Card title="Training reports" right={<button className={primaryCls} disabled={busy} onClick={() => run(() => trReport(), (csv) => { download(`sales-academy-report-${new Date().toISOString().slice(0, 10)}.csv`, csv); return "Report downloaded."; })}><Download size={14} />Download employee-wise report (CSV)</button>}>
        <Table head={["Batch", "Date", "Trainer", "People", "Lessons complete", "Certified", "Average score"]} empty={byBatch.length ? undefined : "No batches yet."}>
          {byBatch.map((b) => <tr key={b.id}><td className={tdCls + " font-semibold"}>{b.name}</td><td className={tdCls}>{dayLabel(b.date)}</td><td className={tdCls}>{b.trainer}</td><td className={tdCls}>{b.n}</td><td className={tdCls}>{b.done}</td><td className={tdCls}>{b.cert}</td><td className={tdCls}>{b.avg}/100</td></tr>)}
        </Table>
      </Card>
      <Card title="Average marks by area" sub="Across everyone assigned">
        <div className="px-5 pb-4 flex flex-col gap-2.5">{areaAvg.map((a) => <div key={a.id}><div className="flex text-[12.5px] mb-1"><span className="flex-1 font-semibold">{a.label}</span><span className="tabular-nums">{a.avg.toFixed(1)} / {a.marks}</span></div><div className="h-2 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#0B5E5B] rounded-full" style={{ width: `${(a.avg / a.marks) * 100}%` }} /></div></div>)}</div>
      </Card>
    </div>
  );
}

function SettingsTab({ d }: { d: A }) {
  const { run, busy } = useRun();
  const [v, setV] = useState(d.settings);
  const rule = !d.isAdmin;
  const num = (k: keyof typeof v, label: string, hint?: string) => <Field label={label} hint={hint}><input type="number" className={inputCls} value={v[k] as number} disabled={rule} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></Field>;
  return (
    <Card title="Assessment rules and approved pricing" sub={rule ? "Assessment rules are set by the super admin. You can edit the pricing note and the signatory." : "Changes are written to the audit log"}>
      <div className="px-5 pb-4 flex flex-col gap-3">
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
          {num("passPct", "Final score to pass (/100)")}{num("productQuizPct", "Product quiz pass %")}{num("lessonQuizPct", "Lesson check pass %")}{num("practicalPassPct", "Practical pass % (of rubric)")}
          {num("maxAttempts", "Attempts: product quiz & final exam")}{num("maxPracticalAttempts", "Attempts: each practical")}{num("minSlideSeconds", "Least seconds per slide")}
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.hrApproval} disabled={rule} onChange={(e) => setV({ ...v, hrApproval: e.target.checked })} />HR approval required after the trainer</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.attendanceRequired} disabled={rule} onChange={(e) => setV({ ...v, attendanceRequired: e.target.checked })} />Attendance must be marked present</label>
        <Field label="Approved pricing and offers (shown to trainees)" hint="Only what sales staff may quote. Leave empty to point them to the live pricing page."><textarea className={inputCls + " min-h-[90px]"} value={v.pricingNote} onChange={(e) => setV({ ...v, pricingNote: e.target.value })} /></Field>
        <Field label="Authorised signatory on certificates"><input className={inputCls} value={v.signatory} onChange={(e) => setV({ ...v, signatory: e.target.value })} placeholder="e.g. Head of HR" /></Field>
        <div className="text-[12px] text-[#64748B]">Weighting (fixed): {AREAS.map((a) => `${a.label} ${a.marks}`).join(" · ")}.</div>
        <button className={primaryCls + " self-start"} disabled={busy} onClick={() => run(() => trSaveSettings(v))}>Save</button>
      </div>
    </Card>
  );
}

// ── Trainer Desk
export function TrainerDeskScreen({ d }: { d: Desk }) {
  const pending = d.rows.flatMap((r) => r.practicals.filter((p) => !p.evaluatedAt).map((p) => ({ ...p, r })));
  const [score, setScore] = useState<(typeof pending)[number] | null>(null);
  const ready = d.rows.filter((r) => r.status === "trainer");
  if (!d.batches.length) return <Card pad><Empty>You aren’t the trainer of any Sales Academy batch.</Empty></Card>;
  return (
    <div className="flex flex-col gap-4">
      <Grid n={4}>
        <Stat l="Your batches" v={d.batches.length} />
        <Stat l="Participants" v={d.rows.length} />
        <Stat l="To score" v={pending.length} c="#5B45B0" />
        <Stat l="Ready to recommend" v={ready.length} />
      </Grid>
      <Card title="Practicals waiting for your score">
        {pending.length ? <ul className="px-5 pb-4 flex flex-col gap-2">{pending.map((p) => <li key={p.id} className="flex flex-wrap gap-2 items-center text-[13px] border-t border-[#F1F5F9] pt-2 first:border-t-0"><span className="flex-1"><strong>{p.r.name}</strong> · {practicalLabel(p.kind)} #{p.attemptNo}{p.scenarioId ? ` · ${d.scenarios.find((s) => s.id === p.scenarioId)?.title ?? ""}` : ""}</span><button className={primaryCls} onClick={() => setScore(p)}><Award size={14} />Score</button></li>)}</ul> : <Empty>Nothing to score.</Empty>}
      </Card>
      <People rows={d.rows} batches={d.batches} manage={false} meId="" rubrics={d.rubrics} />
      {score ? <ScoreModal p={score} onClose={() => setScore(null)} /> : null}
    </div>
  );
}
