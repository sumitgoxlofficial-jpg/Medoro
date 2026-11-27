"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { answerSurvey, archiveCourse, assignCourse, closeSurvey, createSurvey, markLessonRead, openCourse, publishCourse, resetCourseAttempts, saveCourse, submitQuiz, surveyResults } from "../actions";
import { Card, Empty, Field, Grid, Modal, Pill, Table, btnCls, dangerCls, dayLabel, inputCls, primaryCls, tdCls, useRun } from "./kit";

type L = Data<"learning">;
type Opened = { id: string; title: string; summary: string; passPct: number; lessons: { title: string; body: string; url: string }[]; read: number[]; questions: { q: string; options: string[] }[]; attemptsLeft: number; completedAt: string | null; score: number | null };
type Draft = { title: string; summary: string; dept: string; designation: string; mandatory: boolean; dueDays: string; passPct: string; lessons: { title: string; body: string; url: string }[]; questions: { q: string; options: string[]; answer: number }[] };
const emptyDraft = (): Draft => ({ title: "", summary: "", dept: "", designation: "", mandatory: false, dueDays: "14", passPct: "70", lessons: [{ title: "", body: "", url: "" }], questions: [] });

/** Learning: my courses (lessons, then the quiz marked on the server); HR builds, publishes and follows them. */
export function LearningScreen({ d }: { d: L }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState<Opened | null>(null), [lesson, setLesson] = useState(0), [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{ score: number; passed: boolean; right: number; of: number; attemptsLeft: number; passPct: number } | null>(null);
  const [draft, setDraft] = useState<{ id: string | null; v: Draft } | null>(null);
  const [assign, setAssign] = useState<{ id: string; ids: Set<string> } | null>(null);
  const [follow, setFollow] = useState<NonNullable<L["admin"]>[number] | null>(null);
  const start = (id: string) => run(() => openCourse(id), (c) => { setOpen(c); setLesson(0); setAnswers(c.questions.map(() => -1)); setResult(null); return ""; });
  const setV = (p: Partial<Draft>) => draft && setDraft({ ...draft, v: { ...draft.v, ...p } });
  return <>
    {d.mine.length || !d.admin ? <Card title="My courses">
      <Table head={["Course", "Progress", "Due", ""]} empty="No courses for you yet.">
        {d.mine.map((c) => <tr key={c.id}><td className={tdCls}><strong>{c.title}</strong>{c.mandatory ? <Pill tone="amber">required</Pill> : null}<div className="text-[12px] text-[#64748B]">{c.summary}</div></td><td className={tdCls}>{c.completedAt ? <Pill tone="green">Done{c.score !== null ? ` · ${c.score}%` : ""}</Pill> : `${c.read} of ${c.lessons} lessons`}</td><td className={tdCls}>{c.completedAt ? dayLabel(c.completedAt) : <span className={c.overdue ? "text-[#DC2626] font-semibold" : ""}>{dayLabel(c.dueOn)}{c.overdue ? " · overdue" : ""}</span>}</td><td className={tdCls}><button className={primaryCls} disabled={busy} onClick={() => start(c.id)}>{c.completedAt ? "Review" : c.read ? "Continue" : "Start"}</button></td></tr>)}
      </Table>
    </Card> : null}
    {d.admin ? <Card title="Courses" sub="For everyone, or a department and/or designation. Publishing enrols the audience; people who join it later are enrolled when they open Learning." right={<button className={btnCls} onClick={() => setDraft({ id: null, v: emptyDraft() })}>New course</button>}>
      <Table head={["Course", "For", "Status", "Completed", ""]} empty="No courses yet.">
        {d.admin.map((c) => <tr key={c.id}><td className={tdCls}><strong>{c.title}</strong>{c.mandatory ? <Pill tone="amber">required</Pill> : null}<div className="text-[11.5px] text-[#94A3B8]">{c.lessons.length} lessons · {c.questions.length} questions · pass {c.passPct}% · v{c.version}</div></td><td className={tdCls}>{[c.dept, c.designation].filter(Boolean).join(" · ") || "Everyone"}</td><td className={tdCls}><Pill tone={c.status === "published" ? "green" : "gray"}>{c.status}</Pill></td><td className={tdCls}>{c.completed} of {c.enrolled}{c.people.some((p) => p.overdue) ? <span className="text-[#DC2626] text-[12px]"> · {c.people.filter((p) => p.overdue).length} overdue</span> : null}</td><td className={tdCls}><div className="flex gap-1.5 flex-wrap">
          <button className={btnCls} onClick={() => setDraft({ id: c.id, v: { title: c.title, summary: c.summary, dept: c.dept, designation: c.designation, mandatory: c.mandatory, dueDays: String(c.dueDays), passPct: String(c.passPct), lessons: c.lessons, questions: c.questions } })}>Edit</button>
          {c.status === "draft" ? <button className={primaryCls} disabled={busy} onClick={() => run(() => publishCourse(c.id), (n) => `Published. ${n} people enrolled.`)}>Publish</button> : <><button className={btnCls} onClick={() => setAssign({ id: c.id, ids: new Set() })}>Assign</button><button className={btnCls} onClick={() => setFollow(c)}>Progress</button></>}
          <button className={dangerCls} disabled={busy} onClick={() => run(() => archiveCourse(c.id))}>Archive</button>
        </div></td></tr>)}
      </Table>
    </Card> : null}

    {open ? <Modal title={open.title} onClose={() => setOpen(null)} wide>
      <div className="flex gap-1.5 flex-wrap">{open.lessons.map((l, i) => <button key={i} className={i === lesson ? primaryCls : btnCls} onClick={() => setLesson(i)}>{open.read.includes(i) ? "✓ " : ""}{i + 1}. {l.title}</button>)}{open.questions.length ? <button className={lesson === -1 ? primaryCls : btnCls} onClick={() => setLesson(-1)}>Quiz</button> : null}</div>
      {lesson >= 0 ? <div className="flex flex-col gap-3">
        <h4 className="text-[15px] font-bold m-0">{open.lessons[lesson].title}</h4>
        <div className="text-[13.5px] whitespace-pre-line leading-relaxed">{open.lessons[lesson].body}</div>
        {open.lessons[lesson].url ? <a className="text-[13px] text-[#0B5E5B] underline" href={open.lessons[lesson].url} target="_blank" rel="noreferrer noopener">Open the linked material</a> : null}
        {!open.read.includes(lesson) ? <div><button className={primaryCls} disabled={busy} onClick={() => run(() => markLessonRead(open.id, lesson), (r) => { setOpen({ ...open, read: [...open.read, lesson], completedAt: r.completed ? new Date().toISOString() : open.completedAt }); if (lesson + 1 < open.lessons.length) setLesson(lesson + 1); else if (open.questions.length) setLesson(-1); return r.completed && !open.questions.length ? "Course completed." : ""; })}>I have read this</button></div> : null}
      </div> : <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => submitQuiz(open.id, answers), (r) => { setResult(r); return ""; }); }}>
        {open.completedAt ? <p className="text-[13px] text-[#1E7F4F]">✓ Completed{open.score !== null ? ` with ${open.score}%` : ""}.</p> : open.read.length < open.lessons.length ? <p className="text-[13px] text-[#B45309]">Read every lesson first.</p> : <p className="text-[12.5px] text-[#64748B]">Pass mark {open.passPct}%. {open.attemptsLeft} attempt{open.attemptsLeft === 1 ? "" : "s"} left.</p>}
        {open.questions.map((q, i) => <fieldset key={i} className="border border-[#E2E8F0] rounded-xl p-3"><legend className="text-[13.5px] font-semibold px-1">{i + 1}. {q.q}</legend>{q.options.map((o, j) => <label key={j} className="flex gap-2 text-[13px] py-0.5"><input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers(answers.map((a, k) => (k === i ? j : a)))} disabled={!!open.completedAt} />{o}</label>)}</fieldset>)}
        {result ? <p className={result.passed ? "text-[13.5px] text-[#1E7F4F] font-semibold" : "text-[13.5px] text-[#DC2626] font-semibold"}>{result.right} of {result.of} right · {result.score}% · {result.passed ? "Passed. Course completed." : `Not passed (needs ${result.passPct}%). ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`}</p> : null}
        {!open.completedAt && open.read.length === open.lessons.length && !result?.passed ? <div><button className={primaryCls} disabled={busy || answers.some((a) => a < 0) || open.attemptsLeft <= 0}>Submit answers</button></div> : null}
      </form>}
    </Modal> : null}

    {draft ? <Modal title={draft.id ? "Edit course" : "New course"} onClose={() => setDraft(null)} wide>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => saveCourse(draft.id, { ...draft.v, dueDays: Number(draft.v.dueDays), passPct: Number(draft.v.passPct) }), () => setDraft(null)); }}>
        <Grid n={2}><Field label="Title"><input className={inputCls} value={draft.v.title} onChange={(e) => setV({ title: e.target.value })} required /></Field><Field label="Summary"><input className={inputCls} value={draft.v.summary} onChange={(e) => setV({ summary: e.target.value })} /></Field></Grid>
        <Grid n={4}><Field label="Department (empty = any)"><input className={inputCls} value={draft.v.dept} onChange={(e) => setV({ dept: e.target.value })} /></Field><Field label="Designation (empty = any)"><input className={inputCls} value={draft.v.designation} onChange={(e) => setV({ designation: e.target.value })} /></Field><Field label="Days to finish"><input className={inputCls} inputMode="numeric" value={draft.v.dueDays} onChange={(e) => setV({ dueDays: e.target.value })} /></Field><Field label="Pass mark %"><input className={inputCls} inputMode="numeric" value={draft.v.passPct} onChange={(e) => setV({ passPct: e.target.value })} /></Field></Grid>
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={draft.v.mandatory} onChange={(e) => setV({ mandatory: e.target.checked })} />Required (reminders before the deadline and when overdue)</label>
        <h4 className="text-[13.5px] font-bold m-0">Lessons</h4>
        {draft.v.lessons.map((l, i) => <div key={i} className="border border-[#E2E8F0] rounded-xl p-3 flex flex-col gap-2"><Grid n={2}><Field label={`Lesson ${i + 1} title`}><input className={inputCls} value={l.title} onChange={(e) => setV({ lessons: draft.v.lessons.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} required /></Field><Field label="Link (optional, https)"><input className={inputCls} value={l.url} onChange={(e) => setV({ lessons: draft.v.lessons.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)) })} /></Field></Grid><Field label="Text"><textarea className={inputCls} rows={4} value={l.body} onChange={(e) => setV({ lessons: draft.v.lessons.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)) })} required /></Field>{draft.v.lessons.length > 1 ? <div><button type="button" className={dangerCls} onClick={() => setV({ lessons: draft.v.lessons.filter((_, k) => k !== i) })}>Remove lesson</button></div> : null}</div>)}
        <div><button type="button" className={btnCls} onClick={() => setV({ lessons: [...draft.v.lessons, { title: "", body: "", url: "" }] })}>Add lesson</button></div>
        <h4 className="text-[13.5px] font-bold m-0">Quiz (optional)</h4>
        {draft.v.questions.map((q, i) => <div key={i} className="border border-[#E2E8F0] rounded-xl p-3 flex flex-col gap-2"><Field label={`Question ${i + 1}`}><input className={inputCls} value={q.q} onChange={(e) => setV({ questions: draft.v.questions.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)) })} required /></Field>{q.options.map((o, j) => <label key={j} className="flex gap-2 items-center text-[13px]"><input type="radio" name={`ans${i}`} aria-label="Correct answer" checked={q.answer === j} onChange={() => setV({ questions: draft.v.questions.map((x, k) => (k === i ? { ...x, answer: j } : x)) })} /><input className={inputCls} value={o} placeholder={`Option ${j + 1}`} onChange={(e) => setV({ questions: draft.v.questions.map((x, k) => (k === i ? { ...x, options: x.options.map((y, m) => (m === j ? e.target.value : y)) } : x)) })} required /></label>)}<div className="flex gap-1.5">{q.options.length < 6 ? <button type="button" className={btnCls} onClick={() => setV({ questions: draft.v.questions.map((x, k) => (k === i ? { ...x, options: [...x.options, ""] } : x)) })}>Add option</button> : null}<button type="button" className={dangerCls} onClick={() => setV({ questions: draft.v.questions.filter((_, k) => k !== i) })}>Remove question</button></div></div>)}
        <div><button type="button" className={btnCls} onClick={() => setV({ questions: [...draft.v.questions, { q: "", options: ["", ""], answer: 0 }] })}>Add question</button></div>
        <p className="text-[12px] text-[#64748B] m-0">The selected option is the correct one. Answers are checked on the server and never shown to learners.</p>
        <div><button className={primaryCls} disabled={busy}>Save course</button></div>
      </form>
    </Modal> : null}
    {assign ? <Modal title="Assign course" onClose={() => setAssign(null)}>
      <div className="max-h-[360px] overflow-auto flex flex-col gap-1">{d.people.map((p) => <label key={p.id} className="flex gap-2 text-[13px]"><input type="checkbox" checked={assign.ids.has(p.id)} onChange={(e) => { const n = new Set(assign.ids); if (e.target.checked) n.add(p.id); else n.delete(p.id); setAssign({ ...assign, ids: n }); }} />{p.name} <span className="text-[#94A3B8]">{p.empNo}</span></label>)}</div>
      <div><button className={primaryCls} disabled={busy || !assign.ids.size} onClick={() => run(() => assignCourse(assign.id, [...assign.ids]), (n) => { setAssign(null); return `${n} people enrolled.`; })}>Assign to {assign.ids.size}</button></div>
    </Modal> : null}
    {follow ? <Modal title={`${follow.title} · progress`} onClose={() => setFollow(null)} wide>
      <Table head={["Person", "Status", "Score", "Attempts", "Due", ""]} empty="Nobody enrolled.">{follow.people.map((p) => <tr key={p.staffId}><td className={tdCls}>{p.name} <span className="text-[12px] text-[#94A3B8]">{p.empNo}</span></td><td className={tdCls}><Pill tone={p.done ? "green" : p.overdue ? "red" : "amber"}>{p.done ? "done" : p.overdue ? "overdue" : "in progress"}</Pill></td><td className={tdCls}>{p.score ?? "—"}</td><td className={tdCls}>{p.attempts}</td><td className={tdCls}>{dayLabel(p.dueOn)}</td><td className={tdCls}>{!p.done && p.attempts >= 3 ? <button className={btnCls} disabled={busy} onClick={() => run(() => resetCourseAttempts(follow.id, p.staffId))}>Reset attempts</button> : null}</td></tr>)}</Table>
    </Modal> : null}
  </>;
}

type E = Data<"engage">;
type Results = { id: string; title: string; anonymous: boolean; open: boolean; responses: number; minGroup: number; overall: ({ kind: string; text: string; n?: number; avg?: number | null; enps?: number | null; answers?: string[] })[] | null; depts: { name: string; n: number; results: unknown[] | null }[]; respondents: string[] | null };

/** Engagement: answer open surveys; HR creates them and reads results (only for groups of at least five). */
export function EngageScreen({ d }: { d: E }) {
  const { run, busy } = useRun();
  const [ans, setAns] = useState<Record<string, unknown[]>>({});
  const [make, setMake] = useState<{ title: string; intro: string; anonymous: boolean; dept: string; closesOn: string; questions: { text: string; kind: "scale" | "nps" | "text" }[] } | null>(null);
  const [res, setRes] = useState<Results | null>(null);
  return <>
    <Card title="Surveys for you" sub="Anonymous surveys keep no name with your answer, and results are shown only for groups of five or more.">
      {d.mine.length ? <div className="flex flex-col gap-3 px-5 pb-4">{d.mine.map((s) => <div key={s.id} className="border border-[#E2E8F0] rounded-xl p-3.5 flex flex-col gap-2">
        <div className="flex gap-2 items-center flex-wrap"><strong>{s.title}</strong><Pill tone={s.anonymous ? "green" : "blue"}>{s.anonymous ? "anonymous" : "named"}</Pill><span className="text-[12px] text-[#64748B]">closes {dayLabel(s.closesOn)}</span></div>
        {s.intro ? <p className="text-[13px] m-0">{s.intro}</p> : null}
        {s.answered ? <p className="text-[13px] text-[#1E7F4F] m-0">✓ Thank you, you answered this survey.</p> : <form className="flex flex-col gap-2.5" onSubmit={(e) => { e.preventDefault(); run(() => answerSurvey(s.id, s.questions.map((_, i) => ans[s.id]?.[i] ?? ""))); }}>
          {s.questions.map((q, i) => <Field key={i} label={`${i + 1}. ${q.text}`}>{q.kind === "text" ? <textarea className={inputCls} rows={2} onChange={(e) => setAns({ ...ans, [s.id]: Object.assign([...(ans[s.id] ?? [])], { [i]: e.target.value }) })} /> : <div className="flex gap-1 flex-wrap">{Array.from({ length: q.kind === "nps" ? 11 : 5 }, (_, k) => q.kind === "nps" ? k : k + 1).map((v) => <button type="button" key={v} className={(ans[s.id]?.[i] === v ? primaryCls : btnCls) + " !px-2.5"} onClick={() => setAns({ ...ans, [s.id]: Object.assign([...(ans[s.id] ?? [])], { [i]: v }) })}>{v}</button>)}<span className="text-[11.5px] text-[#94A3B8] self-center">{q.kind === "nps" ? "0 not at all likely · 10 extremely likely" : "1 strongly disagree · 5 strongly agree"}</span></div>}</Field>)}
          <div><button className={primaryCls} disabled={busy}>Send</button></div>
        </form>}
      </div>)}</div> : <Empty>No open surveys.</Empty>}
    </Card>
    {d.admin ? <Card title="All surveys" right={<button className={btnCls} onClick={() => setMake({ title: "", intro: "", anonymous: true, dept: "", closesOn: "", questions: [{ text: "I would recommend Medoro as a place to work.", kind: "nps" }, { text: "I have what I need to do my job well.", kind: "scale" }, { text: "One thing we should change:", kind: "text" }] })}>New survey</button>}>
      <Table head={["Survey", "Audience", "Responses", "Status", ""]} empty="No surveys yet.">{d.admin.map((s) => <tr key={s.id}><td className={tdCls}><strong>{s.title}</strong> <Pill tone={s.anonymous ? "green" : "blue"}>{s.anonymous ? "anonymous" : "named"}</Pill></td><td className={tdCls}>{s.dept || "Everyone"}</td><td className={tdCls}>{s.responses}</td><td className={tdCls}>{s.open ? `open until ${dayLabel(s.closesOn)}` : "closed"}</td><td className={tdCls}><div className="flex gap-1.5"><button className={btnCls} disabled={busy} onClick={() => run(() => surveyResults(s.id), (r) => { setRes(r as Results); return ""; })}>Results</button>{s.open ? <button className={dangerCls} disabled={busy} onClick={() => run(() => closeSurvey(s.id))}>Close</button> : null}</div></td></tr>)}</Table>
    </Card> : null}
    {make ? <Modal title="New survey" onClose={() => setMake(null)} wide>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => createSurvey(make), () => setMake(null)); }}>
        <Grid n={3}><Field label="Title"><input className={inputCls} value={make.title} onChange={(e) => setMake({ ...make, title: e.target.value })} required /></Field><Field label="Department (empty = everyone)"><input className={inputCls} value={make.dept} onChange={(e) => setMake({ ...make, dept: e.target.value })} /></Field><Field label="Closes on"><input type="date" className={inputCls} value={make.closesOn} onChange={(e) => setMake({ ...make, closesOn: e.target.value })} required /></Field></Grid>
        <Field label="Introduction"><input className={inputCls} value={make.intro} onChange={(e) => setMake({ ...make, intro: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={make.anonymous} onChange={(e) => setMake({ ...make, anonymous: e.target.checked })} />Anonymous (no name is stored with an answer)</label>
        {make.questions.map((q, i) => <div key={i} className="flex gap-2 items-end"><Field label={`Question ${i + 1}`}><input className={inputCls} value={q.text} onChange={(e) => setMake({ ...make, questions: make.questions.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} required /></Field><select aria-label="Answer type" className={inputCls + " !w-auto"} value={q.kind} onChange={(e) => setMake({ ...make, questions: make.questions.map((x, k) => (k === i ? { ...x, kind: e.target.value as "scale" | "nps" | "text" } : x)) })}><option value="scale">1–5 agree</option><option value="nps">0–10 recommend (eNPS)</option><option value="text">Text</option></select><button type="button" className={dangerCls} onClick={() => setMake({ ...make, questions: make.questions.filter((_, k) => k !== i) })}>Remove</button></div>)}
        <div className="flex gap-2"><button type="button" className={btnCls} onClick={() => setMake({ ...make, questions: [...make.questions, { text: "", kind: "scale" }] })}>Add question</button><button className={primaryCls} disabled={busy}>Send survey</button></div>
      </form>
    </Modal> : null}
    {res ? <Modal title={`${res.title} · ${res.responses} responses`} onClose={() => setRes(null)} wide>
      {res.overall ? <Table head={["Question", "Result"]}>{res.overall.map((q, i) => <tr key={i}><td className={tdCls}>{q.text}</td><td className={tdCls}>{q.kind === "text" ? (q.answers?.length ? <ul className="m-0 pl-5 text-[12.5px]">{q.answers.map((a, k) => <li key={k}>{a}</li>)}</ul> : "—") : q.kind === "nps" ? `eNPS ${q.enps ?? "—"} (${q.n})` : `${q.avg ?? "—"} / 5 (${q.n})`}</td></tr>)}</Table> : <p className="text-[13px] text-[#B45309]">Fewer than {res.minGroup} responses: results stay hidden so nobody can be identified.</p>}
      <h4 className="text-[13px] font-bold m-0">By department</h4>
      <ul className="m-0 pl-5 text-[12.5px]">{res.depts.map((x) => <li key={x.name}>{x.name}: {x.n} response{x.n === 1 ? "" : "s"}{x.results ? "" : ` (hidden: fewer than ${res.minGroup})`}</li>)}</ul>
      {res.respondents ? <p className="text-[12px] text-[#64748B]">Named survey. Answered: {res.respondents.join(", ")}.</p> : null}
    </Modal> : null}
  </>;
}
