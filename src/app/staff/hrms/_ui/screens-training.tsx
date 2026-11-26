"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Award, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, Coffee, Download, ExternalLink, FileText, Lock, Mic, PlayCircle, Sparkles, Trophy, Volume2, VolumeX } from "lucide-react";
import type { Data } from "@/staff/hrms/screens";
import { AREAS, RUBRICS, STATUS_LABEL, clock12, type LessonContent } from "@/staff/hrms/training/shared";
import { trAttempt, trBeat, trExam, trSubmitPractical, trSubmitQuiz } from "../training-actions";
import { useNow } from "@/lib/use-now";
import { AreaBars, Burst, CertificatePreview, JourneyMap, ResultRing, ScoreGauge, type Step } from "./training-art";
import { Card, Empty, Field, Grid, Modal, Pill, Stat, Tabs, btnCls, cx, dayLong, inputCls, primaryCls, useRun } from "./kit";

type T = NonNullable<Data<"training">["t"]>;
type L = NonNullable<Data<"training">["lesson"]>;
type Review = { prompt: string; options: string[]; chose: number; answer: number; correct: boolean; explanation: string }[];

const TABS = [["overview", "My Training"], ["schedule", "Training Schedule"], ["modules", "Learning Modules"], ["tour", "Product Tour"], ["assess", "Assessments"], ["cert", "My Certificates"]] as const;
type TabId = (typeof TABS)[number][0];
const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const href = (q: Record<string, string>) => `/staff/hrms/training?${new URLSearchParams(q).toString()}`;

export function TrainingScreen({ d }: { d: Data<"training"> }) {
  if (!d.t) return <Card title="My Sales Training" pad><Empty>No training has been assigned to you. HR assigns the Medoro Sales Training Academy to the sales team from Sales Academy.</Empty></Card>;
  if (d.lesson) return <LessonPlayer t={d.t} l={d.lesson} />;
  return <TrainingHome t={d.t} tab={(TABS.some((x) => x[0] === d.tab) ? d.tab : "overview") as TabId} />;
}

function TrainingHome({ t, tab: initial }: { t: T; tab: TabId }) {
  const [tab, setTab] = useState<TabId>(initial);
  return (
    <div className="flex flex-col gap-4">
      <Hero t={t} />
      <div className="overflow-x-auto -mx-1 px-1"><Tabs value={tab} onChange={setTab} options={TABS.map((x) => [x[0], x[1]])} /></div>
      {tab === "overview" ? <Overview t={t} go={setTab} /> : null}
      {tab === "schedule" ? <Schedule t={t} /> : null}
      {tab === "modules" ? <Modules t={t} kind="learn" /> : null}
      {tab === "tour" ? <Modules t={t} kind="tour" /> : null}
      {tab === "assess" ? <Assessments t={t} /> : null}
      {tab === "cert" ? <Certificate t={t} /> : null}
    </div>
  );
}

function Ring({ pct, size = 64, light }: { pct: number; size?: number; light?: boolean }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? "rgba(255,255,255,.18)" : "#E2E8F0"} strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? "#F5C451" : "#0B5E5B"} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="tr-arc" style={{ ["--len" as string]: c }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 4.4} fontWeight="800" fill={light ? "#fff" : "#0f172a"}>{pct}%</text>
    </svg>
  );
}

/** Where the learner stands on the five steps to the certificate. */
function stepsOf(t: T): Step[] {
  const ev = t.evaluation, other = ev.lessonsTotal - ev.tourTotal, otherDone = ev.lessonsDone - ev.tourDone;
  const passedPractical = (k: string) => t.practicals.some((p) => p.kind === k && p.passed);
  const raw: [string, string, boolean, string][] = [
    ["learn", "Lessons", otherDone >= other && other > 0, `${otherDone}/${other} lectures`],
    ["tour", "Product tour", ev.tourDone >= ev.tourTotal && ev.tourTotal > 0, `${ev.tourDone}/${ev.tourTotal} chapters`],
    ["quiz", "Quiz & exam", !!ev.product && ev.product.pct >= t.settings.productQuizPct && !!ev.final, ev.final ? `exam ${ev.final.pct}%` : ev.product ? `quiz ${ev.product.pct}%` : "not taken"],
    ["practical", "Practicals", passedPractical("mock_call") && passedPractical("demo"), `${[passedPractical("mock_call"), passedPractical("demo")].filter(Boolean).length}/2 passed`],
    ["cert", "Certificate", !!t.certificate && !t.certificate.revoked, t.certificate ? t.certificate.certNo : "after approval"],
  ];
  let current = false;
  return raw.map(([id, label, done, detail]) => { const state = done ? "done" : current ? "todo" : ((current = true), "current"); return { id, label, detail, state: state as Step["state"] }; });
}

function Hero({ t }: { t: T }) {
  const ev = t.evaluation;
  return (
    <section className="tr-hero relative overflow-hidden rounded-2xl text-white px-[clamp(16px,3vw,30px)] pt-5 pb-4 shadow-[0_24px_50px_-30px_rgba(11,94,91,.9)]">
      <div aria-hidden className="tr-hero-grid absolute inset-0" />
      <div aria-hidden className="tr-float absolute -right-20 -top-24 size-72 rounded-full bg-[#14B8A6]/30 blur-3xl" />
      <div aria-hidden className="tr-float absolute -left-16 bottom-[-90px] size-56 rounded-full bg-[#F5C451]/15 blur-3xl" style={{ animationDelay: "-4s" }} />
      <div className="relative flex flex-wrap gap-5 items-center">
        <div className="flex-1 min-w-[240px]">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/12 border border-white/20 px-2.5 py-1 text-[11px] font-semibold tracking-[.05em] uppercase">
            <Sparkles size={12} className="text-[#F5C451]" />{t.batch.name} · {dayLong(t.batch.date)}{t.batch.isToday ? " · Today" : ""}
          </div>
          <h2 className="text-[clamp(20px,2.6vw,28px)] font-extrabold mt-2 leading-tight">{t.programme.title}</h2>
          <div className="text-[13px] text-white/75 mt-1">Trainer <strong className="text-white">{t.batch.trainer || "—"}</strong> · {ev.lessonsDone}/{ev.lessonsTotal} lessons · score {ev.score}/100 · pass mark {t.settings.passPct}</div>
          <span className={cx("inline-block mt-2.5 rounded-full px-3 py-1 text-[12px] font-bold", ev.status === "certified" ? "bg-[#F5C451] text-[#4A3500]" : ev.status === "rejected" || ev.status === "failed" ? "bg-[#FEE2E2] text-[#B3261E]" : "bg-white text-[#0B5E5B]")}>{STATUS_LABEL[ev.status] ?? ev.status}</span>
        </div>
        <Ring pct={ev.pct} size={104} light />
      </div>
      <div className="relative mt-4"><JourneyMap steps={stepsOf(t)} /></div>
    </section>
  );
}
const Bar = ({ pct, tone = "#0B5E5B" }: { pct: number; tone?: string }) => (
  <div className="h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tone }} /></div>
);

/** India time "HH:MM" for a moment. */
const istHHMM = (ms: number) => { const d = new Date(ms + 5.5 * 3600_000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** Eight sessions around the one running now (or the first eight). */
function windowOf<S extends { start: string }>(all: S[], current?: S) {
  const k = current ? all.findIndex((s) => s.start === current.start) : 0;
  const from = Math.max(0, Math.min(k - 2, all.length - 8));
  return all.slice(from, from + 8);
}

function Overview({ t, go }: { t: T; go: (t: TabId) => void }) {
  const ev = t.evaluation;
  const lessons = t.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.title, tour: m.kind === "tour" })));
  const next = lessons.find((l) => l.mandatory && !t.progress[l.id]?.done);
  const now = istHHMM(useNow(60_000));
  const current = t.batch.isToday ? t.sessions.find((s) => s.start <= now && now < s.end) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <Grid n={4}>
        <Stat l="Overall completion" v={`${ev.pct}%`} sub={`${ev.lessonsDone}/${ev.lessonsTotal} mandatory lessons`} />
        <Stat l="Product tour" v={`${ev.tourDone}/${ev.tourTotal}`} sub="official chapters completed" />
        <Stat l="Current score" v={`${ev.score}/100`} sub={`Pass mark ${t.settings.passPct}`} c={ev.score >= t.settings.passPct ? "#0B5E5B" : "#B45309"} />
        <Stat l="Certificate" v={t.certificate ? (t.certificate.revoked ? "Revoked" : "Issued") : "Not yet"} sub={t.certificate ? t.certificate.certNo : STATUS_LABEL[ev.status]} c={t.certificate && !t.certificate.revoked ? "#0B5E5B" : "#64748B"} />
      </Grid>
      <Grid n={2}>
        <Card title={t.batch.isToday ? "Today’s sessions" : `Sessions on ${dayLong(t.batch.date)}`} sub={current ? `Now: ${current.title}` : "10:00 AM – 6:30 PM"} right={<button className={btnCls} onClick={() => go("schedule")}>Full schedule</button>}>
          <ol className="px-5 pb-4 relative">
            <span aria-hidden className="absolute left-[29px] top-1 bottom-6 w-px bg-[#D6E2E0]" />
            {windowOf(t.sessions, current).map((s) => { const on = current?.start === s.start, past = t.batch.isToday && s.end <= now; return (
              <li key={s.start} className={cx("relative flex gap-3 items-center text-[13px] rounded-lg pl-1 pr-2 py-1.5", on && "bg-[#D6F3EF] font-semibold")}>
                <span className={cx("relative z-[1] size-[11px] rounded-full border-2 flex-none ml-[3px]", on ? "bg-[#14B8A6] border-[#14B8A6] hr-current" : past ? "bg-[#0B5E5B] border-[#0B5E5B]" : "bg-white border-[#94A3B8]")} />
                <span className="w-[66px] flex-none text-[#64748B] tabular-nums text-[12px]">{clock12(s.start)}</span><span className={cx("flex-1", past && !on && "text-[#64748B]")}>{s.title}</span>{on ? <span className="text-[10.5px] font-bold text-[#0B5E5B] uppercase">Now</span> : null}
              </li>); })}
            {t.sessions.length > 8 ? <li className="text-[12px] text-[#64748B] pl-8 pt-1">{t.sessions.length} sessions in all · see the full schedule</li> : null}
          </ol>
        </Card>
        <Card title="Continue learning" pad>
          {next ? (
            <div className="flex flex-col gap-3 pt-1">
              {next.thumb ? (
                <div className="relative aspect-video rounded-xl overflow-hidden bg-[#0f172a]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={next.thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/15"><span className="size-14 rounded-full bg-white/95 flex items-center justify-center text-[#0B5E5B] shadow-xl hr-breathe"><PlayCircle size={30} /></span></span>
                </div>
              ) : (
                <div className="relative h-24 rounded-xl overflow-hidden tr-hero flex items-center px-5 text-white"><div aria-hidden className="tr-hero-grid absolute inset-0" /><BookOpen size={30} className="relative hr-bob" /><span className="relative ml-3 text-[13px] text-white/85">Slide lecture with Hinglish narration</span></div>
              )}
              <div className="text-[12px] text-[#64748B]">{next.module}</div>
              <div className="text-[15px] font-bold">{next.title}</div>
              <div className="text-[13px] text-[#475569]">{next.summary}</div>
              <Link href={href({ lesson: next.id })} className={primaryCls + " self-start no-underline"}><PlayCircle size={16} />{t.progress[next.id] ? "Resume" : "Start"} lesson</Link>
            </div>
          ) : <div className="text-[13.5px] text-[#475569] py-2">All mandatory lessons are complete. Next: <button className="underline text-[#0B5E5B] font-semibold bg-transparent border-0 cursor-pointer p-0" onClick={() => go("assess")}>assessments</button>.</div>}
        </Card>
      </Grid>
      <Grid n={2}>
        <Card title="Certificate requirements" sub="Every item must be met, then approved">
          <ul className="px-5 pb-4 flex flex-col gap-2">
            {[...ev.req, ...ev.approvals].map((r) => <li key={r.id} className="flex items-start gap-2 text-[13px]">{r.ok ? <CheckCircle2 size={17} className="text-[#0B5E5B] flex-none mt-px" /> : <Circle size={17} className="text-[#94A3B8] flex-none mt-px" />}<span className="flex-1">{r.label}</span><span className="text-[12px] text-[#64748B] text-right">{r.detail}</span></li>)}
          </ul>
        </Card>
        <Card title="Score breakdown" sub="Marks out of 100 · hover a bar for where it comes from">
          <div className="px-5 pb-5 flex flex-col items-center gap-4">
            <ScoreGauge score={ev.score} pass={t.settings.passPct} />
            <div className="w-full"><AreaBars rows={AREAS.map((a) => ({ id: a.id, label: a.label, got: ev.marks[a.id], max: a.marks, from: a.from }))} /></div>
          </div>
        </Card>
      </Grid>
      {t.assignment.trainerFeedback || t.assignment.decisionNote ? (
        <Card title="Trainer and HR feedback" pad>
          {t.assignment.trainerFeedback ? <p className="text-[13.5px] whitespace-pre-wrap pt-1"><strong>Trainer{t.assignment.trainerDecision ? ` (${t.assignment.trainerDecision})` : ""}:</strong> {t.assignment.trainerFeedback}</p> : null}
          {t.assignment.decisionNote ? <p className="text-[13.5px] whitespace-pre-wrap pt-2"><strong>HR{t.assignment.hrDecision ? ` (${t.assignment.hrDecision})` : ""}:</strong> {t.assignment.decisionNote}</p> : null}
        </Card>
      ) : null}
      <Card title="Approved pricing for customer conversations" pad>
        <p className="text-[13.5px] whitespace-pre-wrap pt-1 text-[#334155]">{t.settings.pricingNote || "HR hasn’t added an approved price note. Point customers to the live pricing page (medoro.in/pricing) and never promise a discount yourself."}</p>
      </Card>
    </div>
  );
}

const KIND_ICON = { session: BookOpen, quiz: ClipboardIcon, break: Coffee, practical: Mic, assessment: Trophy } as const;
function ClipboardIcon(p: { size?: number; className?: string }) { return <CheckCircle2 {...p} />; }

function Schedule({ t }: { t: T }) {
  const mods = new Map(t.modules.map((m) => [m.slug, m]));
  const now = istHHMM(useNow(30_000));
  const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  return (
    <Card title="Training schedule" sub={`${dayLong(t.batch.date)} · India time${t.batch.isToday ? " · live" : ""}`}>
      <ol className="px-4 pb-4 relative tr-stagger">
        <span aria-hidden className="absolute left-[39px] top-3 bottom-8 w-[2px] bg-gradient-to-b from-[#14B8A6] via-[#D6E2E0] to-[#F5C451] rounded-full" />
        {t.sessions.map((s, k) => {
          const m = s.moduleSlug ? mods.get(s.moduleSlug) : undefined;
          const done = m ? m.lessons.filter((l) => l.mandatory).every((l) => t.progress[l.id]?.done) : false;
          const on = t.batch.isToday && s.start <= now && now < s.end, past = t.batch.isToday && s.end <= now;
          const Icon = KIND_ICON[s.kind as keyof typeof KIND_ICON] ?? BookOpen;
          const pct = on ? Math.round(((toMin(now) - toMin(s.start)) / Math.max(1, toMin(s.end) - toMin(s.start))) * 100) : 0;
          return (
            <li key={s.start} style={{ ["--i" as string]: k }} className={cx("relative flex flex-wrap gap-x-4 gap-y-1 items-center pl-1 pr-2 py-2.5 rounded-xl", on && "bg-[#E9F8F5] ring-1 ring-[#9ADBD0]", s.kind === "break" && !on && "opacity-80")}>
              <span className={cx("relative z-[1] size-9 rounded-full flex items-center justify-center flex-none ml-[6px] border-2", done || past ? "bg-[#0B5E5B] border-[#0B5E5B] text-white" : on ? "bg-white border-[#14B8A6] text-[#0B5E5B] hr-current" : s.kind === "break" ? "bg-[#FEF3C7] border-[#FDE68A] text-[#B45309]" : "bg-white border-[#CBD5E1] text-[#64748B]")}>{done ? <CheckCircle2 size={17} /> : <Icon size={16} />}</span>
              <span className="w-[140px] flex-none text-[12.5px] text-[#475569] tabular-nums">{clock12(s.start)} – {clock12(s.end)}</span>
              <span className="flex-1 min-w-[170px]">
                <span className="block text-[13.5px] font-semibold">{s.title}</span>
                {on ? <span className="mt-1.5 block h-1.5 rounded-full bg-white overflow-hidden"><span className="tr-now block h-full rounded-full bg-gradient-to-r from-[#14B8A6] to-[#0B5E5B]" style={{ width: `${pct}%` }} /></span> : null}
              </span>
              {on ? <Pill tone="green">Now</Pill> : null}
              {s.kind !== "session" ? <Pill tone={s.kind === "break" ? "amber" : "purple"}>{s.kind === "quiz" ? "Quiz" : s.kind === "break" ? "Break" : s.kind === "practical" ? "Practical" : "Assessment"}</Pill> : null}
              {m ? <span className="flex items-center gap-2">{done ? <Pill tone="green">Done</Pill> : null}<Link className={btnCls + " no-underline"} href={href({ lesson: m.lessons.find((l) => !t.progress[l.id]?.done)?.id ?? m.lessons[0]?.id ?? "" })}>{done ? "Review" : "Open"}</Link></span> : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Modules({ t, kind }: { t: T; kind: "learn" | "tour" }) {
  const picked = t.modules.filter((m) => (kind === "tour" ? m.kind === "tour" : m.kind !== "tour"));
  // The lectures are one lesson per module: show them together as one course grid.
  const mods = kind === "tour" || !picked.length ? picked : [{ ...picked[0], id: "lectures", title: "Sales skills lectures", description: "Classroom lectures with slides and Hinglish narration, in the order of the day.", lessons: picked.flatMap((m) => m.lessons) }];
  if (!mods.length) return <Card pad><Empty>No lessons published yet.</Empty></Card>;
  return (
    <div className="flex flex-col gap-4">
      {kind === "tour" ? (
        <Card pad>
          <div className="flex flex-wrap gap-3 items-center pt-2">
            <div className="flex-1 min-w-[240px] text-[13.5px] text-[#334155]"><strong>Medoro Pharmacy – Complete Product Knowledge.</strong> The official product tour (about 50 minutes, 26 chapters), embedded unchanged. Each chapter counts as done only after you have really watched it and passed its check. The tour uses a demo pharmacy with made-up data.</div>
            <a href="/videos/complete-product-tour" target="_blank" rel="noopener" className={btnCls + " no-underline"}><ExternalLink size={14} />Official tour page</a>
          </div>
        </Card>
      ) : null}
      {mods.map((m) => {
        const req = m.lessons.filter((l) => l.mandatory), doneN = req.filter((l) => t.progress[l.id]?.done).length;
        return (
        <Card key={m.id} title={m.title} sub={m.description} right={req.length ? <span className="flex items-center gap-2 text-[12px] text-[#475569]"><span className="w-24"><Bar pct={(doneN / req.length) * 100} /></span>{doneN}/{req.length}</span> : undefined}>
          <div className={cx("px-5 pb-5 grid gap-4 tr-stagger", kind === "tour" ? "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(260px,1fr))]")}>
            {m.lessons.map((l, k) => {
              const p = t.progress[l.id];
              return (
                <Link key={l.id} href={href({ lesson: l.id })} style={{ ["--i" as string]: k }} className="tr-lift group rounded-2xl border border-[#D5DCE3] bg-white no-underline text-[#0f172a] overflow-hidden flex flex-col">
                  <div className="relative aspect-video overflow-hidden bg-[#0f172a]">
                    {l.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.thumb} alt="" className="tr-zoom absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="tr-zoom absolute inset-0 tr-hero flex flex-col justify-between p-4 text-white">
                        <div aria-hidden className="tr-hero-grid absolute inset-0" />
                        <span className="relative text-[11px] font-semibold tracking-[.12em] uppercase text-white/65">Lecture · {l.durationMin} min</span>
                        <span aria-hidden className="relative text-[52px] font-extrabold leading-none text-white/90 tabular-nums">{String(k + 1).padStart(2, "0")}<span className="text-[#F5C451]">.</span></span>
                        <BookOpen aria-hidden size={64} className="absolute right-4 bottom-4 text-white/12 hr-bob" />
                      </div>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors"><span className="size-12 rounded-full bg-white/95 text-[#0B5E5B] flex items-center justify-center shadow-xl scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-300"><PlayCircle size={26} /></span></span>
                    {l.videoSeconds ? <span className="absolute right-2 bottom-2 rounded-md bg-black/80 text-white text-[11px] font-semibold px-1.5 py-px">{mins(l.videoSeconds)}</span> : null}
                    {p?.done ? <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#0B5E5B] text-white text-[11px] font-bold px-2 py-0.5"><CheckCircle2 size={12} />Completed</span> : p ? <span className="absolute right-2 top-2 rounded-full bg-white/95 text-[#B45309] text-[11px] font-bold px-2 py-0.5">In progress</span> : null}
                  </div>
                  <div className="p-3.5 flex flex-col gap-1.5 flex-1">
                    <span className="text-[13.5px] font-bold leading-snug">{l.title}</span>
                    {!l.thumb ? <div className="text-[12px] text-[#64748B] line-clamp-2">{l.summary}</div> : null}
                    <div className="mt-auto pt-1 flex items-center gap-2 text-[11.5px] text-[#64748B]"><Clock size={12} />{l.durationMin} min{l.questions ? ` · ${l.questions}-question check` : ""}{l.mandatory ? "" : " · optional"}</div>
                    {p && !p.done && l.videoKind !== "none" ? <Bar pct={p.watched} tone="#14B8A6" /> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
        );
      })}
    </div>
  );
}

// ── Lesson player
function LessonPlayer({ t, l }: { t: T; l: L }) {
  const [prog, setProg] = useState(l.progress);
  const [view, setView] = useState<"video" | "slides">(l.video ? "video" : "slides");
  const all = t.modules.flatMap((m) => m.lessons);
  const idx = all.findIndex((x) => x.id === l.id), next = all[idx + 1], prev = all[idx - 1];
  const content = l.content ?? {};
  // Completion can come from a heartbeat or from passing the check (which refreshes the page data): either counts.
  const done = prog.done || l.progress.done;
  const [doneAtOpen] = useState(l.progress.done);
  const evidence = l.video ? Math.min(100, Math.round((prog.watchedPct / l.completionPct) * 100)) : prog.slidesPct;
  return (
    <div className="flex flex-col gap-4">
      <div className="hr-sect relative overflow-hidden rounded-2xl bg-white border border-[#a8b6c8] shadow-[0_2px_6px_rgba(15,23,42,.12)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={href({ tab: content.chapter ? "tour" : "modules" })} className={btnCls + " no-underline"}><ArrowLeft size={14} />Back</Link>
          <div className="flex-1 min-w-[200px]"><div className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-[#64748B]">{l.module}</div><h2 className="text-[18px] font-extrabold leading-tight">{l.title}</h2></div>
          {done ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0B5E5B] text-white text-[12px] font-bold px-3 py-1"><CheckCircle2 size={14} />Completed</span>
            : <span className="text-[12px] text-[#475569] text-right">{l.video ? `Watched ${prog.watchedPct}% · need ${l.completionPct}%` : `Slides studied ${prog.slidesSeen}/${l.slides.length}`}{l.questions.length ? " · then pass the check" : ""}</span>}
        </div>
        <div className="mt-2.5 h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden" role="progressbar" aria-valuenow={done ? 100 : evidence} aria-valuemin={0} aria-valuemax={100} aria-label="Lesson evidence"><div className="h-full rounded-full bg-gradient-to-r from-[#14B8A6] to-[#0B5E5B] transition-[width] duration-700" style={{ width: `${done ? 100 : evidence}%` }} /></div>
      </div>
      {done && !doneAtOpen ? (
        <div role="status" className="relative overflow-hidden rounded-2xl tr-hero text-white px-5 py-4 flex items-center gap-4">
          <Burst />
          <span className="relative size-12 rounded-full bg-[#F5C451] text-[#4A3500] flex items-center justify-center flex-none hr-breathe"><Trophy size={24} /></span>
          <div className="relative flex-1"><div className="text-[16px] font-extrabold">Lesson complete!</div><div className="text-[13px] text-white/80">Shabaash! It now counts towards your certificate.</div></div>
          {next ? <Link href={href({ lesson: next.id })} className="relative rounded-lg bg-white text-[#0B5E5B] font-bold text-[13px] px-3.5 py-2 no-underline inline-flex items-center gap-1">Next lesson<ChevronRight size={15} /></Link> : null}
        </div>
      ) : null}
      {l.video && l.slides.length ? <Tabs value={view} onChange={setView} options={[["video", "Video lecture"], ["slides", "Slides & notes"]]} /> : null}
      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4 min-w-0">
          {l.video && view === "video" ? <VideoBox l={l} onProgress={setProg} /> : null}
          {view === "slides" && l.slides.length ? <SlideDeck l={l} prog={prog} track={!l.video} onProgress={setProg} /> : null}
          <LessonBody content={content} />
          <LessonQuiz l={l} />
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          <Card title="About this lesson" pad>
            <p className="text-[13px] text-[#334155] pt-1">{l.summary}</p>
            <ul className="text-[12.5px] text-[#475569] mt-2 flex flex-col gap-1">
              <li>Duration: about {l.durationMin} minutes</li>
              <li>Completes when: {l.video ? `you have watched ${l.completionPct}% of the video` : "every slide has been studied"}{l.questions.length ? ` and passed the check (${l.quizPct}%)` : ""}</li>
              {content.chapter ? <li>Official tour: part {content.chapter.part} of 26, starts at {mins(content.chapter.startsAt)} in the complete tour</li> : null}
            </ul>
          </Card>
          <Card title="Downloads" pad>
            <div className="flex flex-col gap-2 pt-1">
              {l.slides.length ? <a className={btnCls + " no-underline self-start"} href={`/staff/hrms/training/notes/${l.id}`} target="_blank" rel="noopener"><FileText size={14} />Slides & notes (PDF)</a> : null}
              {l.resources.map((r) => <a key={r.href} className={btnCls + " no-underline self-start"} href={r.href} target="_blank" rel="noopener">{r.kind === "link" ? <ExternalLink size={14} /> : <Download size={14} />}{r.name}</a>)}
              {!l.slides.length && !l.resources.length ? <span className="text-[12.5px] text-[#64748B]">No files for this lesson.</span> : null}
            </div>
          </Card>
          {l.transcript ? (
            <Card title="Hinglish transcript" pad>
              <div className="text-[12.5px] leading-[1.6] text-[#334155] whitespace-pre-wrap max-h-[420px] overflow-y-auto pt-1">{l.transcript}</div>
            </Card>
          ) : null}
          <div className="flex gap-2">
            {prev ? <Link className={btnCls + " no-underline flex-1 justify-center"} href={href({ lesson: prev.id })}><ChevronLeft size={14} />Previous</Link> : null}
            {next ? <Link className={btnCls + " no-underline flex-1 justify-center"} href={href({ lesson: next.id })}>Next<ChevronRight size={14} /></Link> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type Prog = L["progress"];
/** Sends learning heartbeats. The server decides what counts. */
function useBeats(lessonId: string, onProgress: (p: Prog) => void) {
  const busy = useRef(false);
  return useCallback(async (mode: "video" | "slides", pos: number, playing: boolean, duration?: number) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await trBeat({ lessonId, mode, pos: Math.max(0, pos), playing, visible: document.visibilityState === "visible", duration });
      if (r.ok) onProgress(r.data as Prog);
    } catch { /* a dropped heartbeat only loses its own few seconds */ } finally { busy.current = false; }
  }, [lessonId, onProgress]);
}

function VideoBox({ l, onProgress }: { l: L; onProgress: (p: Prog) => void }) {
  const send = useBeats(l.id, onProgress);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const v = l.video!;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-[0_12px_40px_rgba(15,23,42,.25)]">
        {v.kind === "youtube" ? <YouTubeBox id={v.src} start={l.progress.lastPos} speed={speed} send={send} onFail={() => setFailed(true)} /> : <FileBox src={v.src} poster={l.thumb} start={l.progress.lastPos} speed={speed} send={send} official={v.official} onFail={() => setFailed(true)} />}
        {failed ? <div role="alert" className="absolute inset-x-3 bottom-14 rounded-lg bg-black/80 text-white text-[13px] px-3 py-2">The video couldn’t load (network or file problem). Your progress so far is saved. Try again in a moment{v.official ? <>, or open the <a className="underline text-white" href="/videos/complete-product-tour" target="_blank" rel="noopener">official tour page</a></> : null}.</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-[#475569]">
        <label className="flex items-center gap-1.5">Speed
          <select className="border border-[#CDD2D7] rounded-md px-1.5 py-0.5 bg-white" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        </label>
        <span>{v.official ? "Official Medoro product tour, Hinglish subtitles in the video. Demo pharmacy, made-up data." : "Hinglish transcript below."}</span>
      </div>
    </div>
  );
}

function FileBox({ src, poster, start, speed, send, official, onFail }: { src: string; poster: string; start: number; speed: number; send: ReturnType<typeof useBeats>; official: boolean; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tick = () => send("video", el.currentTime, !el.paused && !el.ended, el.duration || undefined);
    send("video", start, false);
    const id = setInterval(tick, 10_000);
    const vis = () => tick();
    el.addEventListener("pause", tick); el.addEventListener("ended", tick); document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); el.removeEventListener("pause", tick); el.removeEventListener("ended", tick); document.removeEventListener("visibilitychange", vis); tick(); };
  }, [send, start]);
  return (
    <video ref={ref} src={src} poster={poster || undefined} controls playsInline preload="metadata" className="absolute inset-0 w-full h-full bg-black" controlsList={official ? "nodownload" : undefined}
      onLoadedMetadata={(e) => { const el = e.currentTarget; if (start > 0 && start < el.duration - 5) el.currentTime = start; el.playbackRate = speed; }}
      onError={onFail} />
  );
}

type YTP = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; setPlaybackRate(r: number): void; destroy(): void };
type YTNS = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YTP };
let ytLoad: Promise<YTNS> | null = null;
function loadYT(): Promise<YTNS> {
  const w = window as unknown as { YT?: YTNS; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  ytLoad ??= new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT!); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { ytLoad = null; reject(new Error("YouTube blocked")); };
    document.head.appendChild(s);
  });
  return ytLoad;
}
function YouTubeBox({ id, start, speed, send, onFail }: { id: string; start: number; speed: number; send: ReturnType<typeof useBeats>; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null), player = useRef<YTP | null>(null);
  useEffect(() => { player.current?.setPlaybackRate(speed); }, [speed]);
  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setInterval> | undefined;
    loadYT().then((YT) => {
      if (dead || !host.current) return;
      player.current = new YT.Player(host.current, { videoId: id, width: "100%", height: "100%", playerVars: { start: Math.floor(start), rel: 0, modestbranding: 1, playsinline: 1 }, events: { onError: onFail } });
      send("video", start, false);
      timer = setInterval(() => { const p = player.current; if (p?.getCurrentTime) send("video", p.getCurrentTime(), p.getPlayerState() === 1, p.getDuration() || undefined); }, 10_000);
    }).catch(onFail);
    return () => { dead = true; if (timer) clearInterval(timer); player.current?.destroy(); player.current = null; };
  }, [id, start, send, onFail]);
  return <div className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full"><div ref={host} /></div>;
}

function SlideDeck({ l, prog, track, onProgress }: { l: L; prog: Prog; track: boolean; onProgress: (p: Prog) => void }) {
  const send = useBeats(l.id, onProgress);
  const [i, setI] = useState(() => (track ? Math.min(Math.max(0, Math.round(prog.lastPos)), l.slides.length - 1) : 0));
  const [speaking, setSpeaking] = useState(false);
  const s = l.slides[i];
  // Time on a slide counts while the tab is visible: a heartbeat every 10 s, and one for the old slide when moving on.
  useEffect(() => {
    if (!track) return;
    send("slides", i, false);
    const id = setInterval(() => send("slides", i, true), 10_000);
    return () => { clearInterval(id); send("slides", i, true); };
  }, [i, track, send]);
  useEffect(() => () => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }, []);
  const speak = () => {
    if (typeof speechSynthesis === "undefined") return;
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(s.narration || s.bullets.join(". "));
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang === "hi-IN") ?? voices.find((v) => v.lang.endsWith("-IN"));
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-IN";
    u.rate = 0.95; u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    speechSynthesis.cancel(); speechSynthesis.speak(u); setSpeaking(true);
  };
  const [dir, setDir] = useState(1);
  const go = useCallback((k: number) => {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false); setDir(k >= i ? 1 : -1); setI(Math.max(0, Math.min(l.slides.length - 1, k)));
  }, [i, l.slides.length]);
  // ← and → move between slides, unless the person is typing in a field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "ArrowRight") go(i + 1); else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, i]);
  const seen = (k: number) => (prog.slideSecs[k] ?? 0) >= (l.slideNeeds[k] ?? 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="tr-hero relative w-full aspect-[16/9] max-[640px]:aspect-auto max-[640px]:min-h-[360px] rounded-2xl overflow-hidden text-white shadow-[0_18px_44px_-18px_rgba(11,94,91,.75)]">
        <div aria-hidden className="tr-hero-grid absolute inset-0" />
        <div aria-hidden className="tr-float absolute -right-24 -bottom-24 size-80 rounded-full bg-[#14B8A6]/30 blur-3xl" />
        <svg aria-hidden className="absolute right-[4%] top-[18%] w-[22%] max-w-[220px] opacity-[.13] hr-spin-slow" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="1.5"><circle cx="50" cy="50" r="46" strokeDasharray="4 6" /><circle cx="50" cy="50" r="30" /><circle cx="50" cy="50" r="12" fill="#F5C451" stroke="none" /></svg>
        <div className="absolute inset-x-0 top-0 h-1 bg-white/15"><div className="h-full bg-[#F5C451] transition-[width] duration-500" style={{ width: `${((i + 1) / l.slides.length) * 100}%` }} /></div>
        <div key={i} className="tr-slide absolute inset-0 p-[clamp(18px,4vw,44px)] flex flex-col" style={{ ["--dir" as string]: `${dir * 28}px` }}>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[.14em] text-white/65">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/medoro-mark.png" alt="" className="size-6 rounded bg-white p-px" />Medoro Sales Academy
            <span className="ml-auto flex items-center gap-2 tabular-nums">{seen(i) ? <span className="inline-flex items-center gap-1 rounded-full bg-[#F5C451] text-[#4A3500] normal-case tracking-normal font-bold px-2 py-px"><CheckCircle2 size={11} />Studied</span> : null}{i + 1} / {l.slides.length}</span>
          </div>
          <h3 className="mt-[clamp(12px,3vw,28px)] text-[clamp(20px,2.8vw,34px)] font-extrabold leading-tight max-w-[78%] max-[640px]:max-w-full">{s.title}</h3>
          <span aria-hidden className="mt-3 block h-1 w-14 rounded-full bg-[#F5C451]" />
          <ul className="mt-[clamp(10px,2vw,20px)] flex flex-col gap-[clamp(6px,1vw,12px)] text-[clamp(13px,1.45vw,18px)] leading-snug overflow-y-auto max-w-[80%] max-[640px]:max-w-full">
            {s.bullets.filter(Boolean).map((b, k) => <li key={k} style={{ ["--i" as string]: k }} className="flex gap-3"><span className="mt-[.2em] size-[1.15em] rounded-md bg-white/15 border border-white/25 text-[#F5C451] text-[.7em] font-bold flex items-center justify-center flex-none">{k + 1}</span>{b}</li>)}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnCls} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide"><ChevronLeft size={14} /></button>
        <div className="flex gap-1 flex-wrap" aria-label="Slides">{l.slides.map((_, k) => <button key={k} onClick={() => go(k)} aria-label={`Slide ${k + 1}${seen(k) ? ", studied" : ""}`} aria-current={k === i ? "true" : undefined} className={cx("h-2.5 rounded-full border-0 cursor-pointer", k === i ? "w-6 bg-[#0B5E5B]" : "w-2.5", k !== i && (seen(k) ? "bg-[#14B8A6]" : "bg-[#CBD5E1]"))} />)}</div>
        <button className={btnCls} onClick={() => go(i + 1)} disabled={i === l.slides.length - 1} aria-label="Next slide"><ChevronRight size={14} /></button>
        <button className={cx(btnCls, "ml-auto")} onClick={speak}>{speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}{speaking ? "Stop narration" : "Play narration"}</button>
      </div>
      {s.narration ? <div className="rounded-xl bg-white border border-[#E2E8F0] px-4 py-3 text-[13px] leading-[1.6] text-[#334155]"><span className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#64748B] block mb-1">Trainer narration (Hinglish)</span>{s.narration}</div> : null}
      {track ? (() => {
        const left = l.slides.map((_, k) => k).filter((k) => !seen(k));
        return (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#64748B]">
            <span>Each slide counts after about {l.slideNeeds[i]} seconds on it with this tab open. {prog.slidesSeen}/{l.slides.length} studied.</span>
            {left.length && left.some((k) => k !== i) ? <button className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#FEF3C7] text-[#92400E] font-semibold px-2.5 py-1 border-0 cursor-pointer" onClick={() => go(left.find((k) => k !== i)!)}>Not studied yet: slide {left.map((k) => k + 1).join(", ")} · Go<ChevronRight size={13} /></button> : null}
          </div>
        );
      })() : null}
    </div>
  );
}

function LessonBody({ content: c }: { content: LessonContent }) {
  const ch = c.chapter;
  return (
    <>
      {ch ? (
        <Grid n={2}>
          <Card title="What the software does" pad><ul className="list-disc pl-5 text-[13px] flex flex-col gap-1 pt-1">{ch.functions.map((f) => <li key={f}>{f}</li>)}</ul></Card>
          <Card title="Pharmacy problem → customer benefit" pad><p className="text-[13px] pt-1"><strong>Problem:</strong> {ch.problem}</p><ul className="list-disc pl-5 text-[13px] flex flex-col gap-1 mt-2">{ch.benefits.map((b) => <li key={b}>{b}</li>)}</ul></Card>
        </Grid>
      ) : null}
      {ch ? <Card title="How to explain it to a customer" pad><p className="text-[13.5px] italic pt-1 text-[#0B5E5B]">“{ch.explain}”</p></Card> : null}
      {c.objectives?.length && !ch ? <Card title="Learning objectives" pad><ul className="list-disc pl-5 text-[13px] flex flex-col gap-1 pt-1">{c.objectives.map((o) => <li key={o}>{o}</li>)}</ul></Card> : null}
      {c.keyPoints?.length ? <Card title="Important points" pad><ul className="list-disc pl-5 text-[13px] flex flex-col gap-1 pt-1">{c.keyPoints.map((o) => <li key={o}>{o}</li>)}</ul></Card> : null}
      {c.scripts?.length ? (
        <Card title="Opening scripts (Hinglish)">
          <div className="px-5 pb-4 grid gap-3 min-[900px]:grid-cols-2">
            {c.scripts.map((s) => <div key={s.name} className="rounded-xl border border-[#E2E8F0] p-3"><div className="text-[13.5px] font-bold">{s.name}</div><div className="text-[11.5px] text-[#64748B] mb-2">When: {s.when}</div><ol className="list-decimal pl-5 text-[13px] flex flex-col gap-1.5">{s.lines.map((x, k) => <li key={k}>{x}</li>)}</ol></div>)}
          </div>
        </Card>
      ) : null}
      {c.objections?.length ? (
        <Card title="Objection handling library" sub={`${c.objections.length} real objections`}>
          <div className="px-5 pb-4 flex flex-col gap-2">
            {c.objections.map((o, k) => (
              <details key={k} className="rounded-xl border border-[#E2E8F0] px-3 py-2 group">
                <summary className="cursor-pointer text-[13.5px] font-bold list-none flex gap-2"><span className="text-[#0B5E5B]">{k + 1}.</span>“{o.statement}”</summary>
                <dl className="mt-2 grid gap-x-3 gap-y-1.5 text-[13px] min-[700px]:grid-cols-[170px_1fr]">
                  <dt className="font-semibold text-[#64748B]">What they mean</dt><dd>{o.meaning}</dd>
                  <dt className="font-semibold text-[#B3261E]">Avoid saying</dt><dd className="text-[#B3261E]">{o.avoid}</dd>
                  <dt className="font-semibold text-[#0B5E5B]">Recommended reply</dt><dd className="text-[#0B5E5B]">{o.response}</dd>
                  <dt className="font-semibold text-[#64748B]">Follow-up question</dt><dd>{o.followUp}</dd>
                  <dt className="font-semibold text-[#64748B]">Next action</dt><dd>{o.next}</dd>
                </dl>
              </details>
            ))}
          </div>
        </Card>
      ) : null}
      {c.features?.length ? (
        <Card title="Feature → benefit table" sub={`${c.features.length} features`}>
          <div className="px-5 pb-4 flex flex-col gap-2">
            {c.features.map((f) => (
              <details key={f.feature} className="rounded-xl border border-[#E2E8F0] px-3 py-2">
                <summary className="cursor-pointer text-[13.5px] font-bold list-none">{f.feature}</summary>
                <dl className="mt-2 grid gap-x-3 gap-y-1.5 text-[13px] min-[700px]:grid-cols-[170px_1fr]">
                  <dt className="font-semibold text-[#64748B]">A. What it does</dt><dd>{f.does}</dd>
                  <dt className="font-semibold text-[#64748B]">B. Customer problem</dt><dd>{f.problem}</dd>
                  <dt className="font-semibold text-[#64748B]">C. Business benefit</dt><dd>{f.benefit}</dd>
                  <dt className="font-semibold text-[#0B5E5B]">D. Sales explanation</dt><dd className="text-[#0B5E5B]">{f.pitch}</dd>
                  <dt className="font-semibold text-[#64748B]">E. Customer question</dt><dd>{f.question}</dd>
                  <dt className="font-semibold text-[#64748B]">F. Suggested answer</dt><dd>{f.answer}</dd>
                </dl>
              </details>
            ))}
          </div>
        </Card>
      ) : null}
      {c.examples?.length ? <Card title="Real-life examples" pad><ul className="list-disc pl-5 text-[13px] flex flex-col gap-1.5 pt-1">{c.examples.map((o) => <li key={o}>{o}</li>)}</ul></Card> : null}
      {c.qa?.length ? <Card title="Customer questions and trainer answers" pad><dl className="text-[13px] flex flex-col gap-2 pt-1">{c.qa.map((x) => <div key={x.q}><dt className="font-semibold">Q: {x.q}</dt><dd className="text-[#334155]">A: {x.a}</dd></div>)}</dl></Card> : null}
      {c.takeaways?.length ? <Card title="Key takeaways" pad><ul className="flex flex-col gap-1 pt-1">{c.takeaways.map((o) => <li key={o} className="flex gap-2 text-[13px]"><CheckCircle2 size={16} className="text-[#0B5E5B] flex-none mt-px" />{o}</li>)}</ul></Card> : null}
    </>
  );
}

function QuizForm({ questions, onSubmit, busy, label }: { questions: { id: string; prompt: string; options: string[] }[]; onSubmit: (a: Record<string, number>) => void; busy: boolean; label: string }) {
  const [a, setA] = useState<Record<string, number>>({});
  const left = questions.filter((q) => a[q.id] === undefined).length;
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onSubmit(a); }}>
      {questions.map((q, k) => (
        <fieldset key={q.id} className="border border-[#E2E8F0] rounded-xl px-4 py-3">
          <legend className="px-1 text-[13.5px] font-semibold">{k + 1}. {q.prompt}</legend>
          <div className="flex flex-col gap-1.5 mt-1">
            {q.options.map((o, i) => <label key={i} className={cx("flex gap-2 items-start text-[13px] rounded-lg px-2 py-1.5 cursor-pointer", a[q.id] === i ? "bg-[#D6F3EF]" : "hover:bg-[#F8FAFC]")}><input type="radio" name={q.id} checked={a[q.id] === i} onChange={() => setA((p) => ({ ...p, [q.id]: i }))} className="mt-0.5 accent-[#0B5E5B]" />{o}</label>)}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center gap-3"><button className={primaryCls} disabled={busy || left > 0}>{label}</button>{left ? <span className="text-[12.5px] text-[#64748B]">{left} question{left > 1 ? "s" : ""} left</span> : null}</div>
    </form>
  );
}
function ReviewList({ review }: { review: Review }) {
  return (
    <ol className="flex flex-col gap-2">
      {review.map((r, k) => (
        <li key={k} className={cx("rounded-xl border px-3 py-2 text-[13px]", r.correct ? "border-[#B7E4DD] bg-[#F0FBF9]" : "border-[#F3C5C0] bg-[#FFF6F5]")}>
          <div className="font-semibold">{k + 1}. {r.prompt}</div>
          <div className="mt-1">Your answer: <strong className={r.correct ? "text-[#0B5E5B]" : "text-[#B3261E]"}>{r.options[r.chose] ?? "—"}</strong>{r.correct ? " ✓" : ""}</div>
          {!r.correct ? <div>Correct answer: <strong className="text-[#0B5E5B]">{r.options[r.answer] ?? "—"}</strong></div> : null}
          {r.explanation ? <div className="text-[#475569] mt-0.5">{r.explanation}</div> : null}
        </li>
      ))}
    </ol>
  );
}
type QuizResult = { pct: number; passed: boolean; passMark: number; score: number; total: number; review: Review };
function ResultBox({ r }: { r: QuizResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className={cx("relative overflow-hidden rounded-2xl px-5 py-4 flex items-center gap-4", r.passed ? "bg-[#E9F8F5] border border-[#9ADBD0]" : "bg-[#FFF6F5] border border-[#F3C5C0]")}>
        {r.passed ? <Burst /> : null}
        <ResultRing pct={r.pct} passed={r.passed} size={84} />
        <div className="relative">
          <div className={cx("text-[17px] font-extrabold flex items-center gap-1.5", r.passed ? "text-[#0B5E5B]" : "text-[#B3261E]")}>{r.passed ? <><Trophy size={18} />Passed!</> : "Not passed yet"}</div>
          <div className="text-[13px] text-[#334155]">{r.score} of {r.total} correct · pass mark {r.passMark}%</div>
          {!r.passed ? <div className="text-[12.5px] text-[#475569] mt-0.5">Read the explanations below, then try again.</div> : null}
        </div>
      </div>
      <ReviewList review={r.review} />
    </div>
  );
}

function LessonQuiz({ l }: { l: L }) {
  const { run, busy } = useRun();
  const [res, setRes] = useState<QuizResult | null>(null);
  const [retry, setRetry] = useState(0);
  if (!l.questions.length) return null;
  const passed = l.attempts.some((x) => x.passed);
  return (
    <Card title="Lesson check" sub={`${l.questions.length} questions · pass mark ${l.quizPct}%${passed ? " · passed" : ""}`}>
      <div className="px-5 pb-4">
        {res ? <div className="flex flex-col gap-3"><ResultBox r={res} />{!res.passed ? <button className={btnCls + " self-start"} onClick={() => { setRes(null); setRetry((n) => n + 1); }}>Try again</button> : null}</div>
          : passed && retry === 0 ? <div className="text-[13.5px] text-[#0B5E5B] flex items-center gap-2"><CheckCircle2 size={17} />You passed this check.</div>
          : <QuizForm key={retry} questions={l.questions} busy={busy} label="Submit answers" onSubmit={(answers) => run(() => trSubmitQuiz({ kind: "lesson", lessonId: l.id, answers }), (d) => { setRes(d as QuizResult); return ""; })} />}
      </div>
    </Card>
  );
}

// ── Assessments
function Assessments({ t }: { t: T }) {
  const ev = t.evaluation;
  const [exam, setExam] = useState<"product" | "final" | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const productPassed = !!ev.product && ev.product.pct >= t.settings.productQuizPct;
  return (
    <div className="flex flex-col gap-4">
      <Grid n={2}>
        <Card title="Product knowledge quiz" sub={`26 questions, one per tour chapter · pass ${t.settings.productQuizPct}% · 20 marks`} pad>
          <div className="flex flex-col gap-2 pt-1 text-[13px]">
            <div>Best: <strong>{ev.product ? `${ev.product.pct}%` : "not attempted"}</strong> · attempts left: {t.settings.attemptsLeft.product}</div>
            {productPassed ? <Pill tone="green">Passed</Pill>
              : ev.tourDone < ev.tourTotal ? <span className="flex items-center gap-1.5 text-[#64748B]"><Lock size={14} />Opens after the product tour ({ev.tourDone}/{ev.tourTotal})</span>
              : t.settings.attemptsLeft.product ? <button className={primaryCls + " self-start"} onClick={() => setExam("product")}>Start quiz</button>
              : <span className="text-[#B3261E]">No attempts left. Ask HR about a retest.</span>}
          </div>
        </Card>
        <Card title="Final exam" sub="Communication 15 marks · CRM 5 marks" pad>
          <div className="flex flex-col gap-2 pt-1 text-[13px]">
            <div>Best: <strong>{ev.final ? `${ev.final.pct}%` : "not attempted"}</strong> · attempts left: {t.settings.attemptsLeft.final}</div>
            {t.certificate ? <Pill tone="green">Certified</Pill>
              : ev.lessonsDone < ev.lessonsTotal ? <span className="flex items-center gap-1.5 text-[#64748B]"><Lock size={14} />Opens after all mandatory lessons ({ev.lessonsDone}/{ev.lessonsTotal})</span>
              : t.settings.attemptsLeft.final ? <button className={primaryCls + " self-start"} onClick={() => setExam("final")}>{ev.final ? "Retake exam" : "Start exam"}</button>
              : <span className="text-[#B3261E]">No attempts left. Ask HR about a retest.</span>}
          </div>
        </Card>
      </Grid>
      <Practicals t={t} />
      <Card title="Attempt history" sub="Every attempt is kept">
        {t.attempts.filter((a) => a.kind !== "lesson").length ? (
          <ul className="px-5 pb-4 flex flex-col gap-1.5">
            {t.attempts.filter((a) => a.kind !== "lesson").map((a) => <li key={a.id} className="flex flex-wrap items-center gap-3 text-[13px] border-t border-[#F1F5F9] pt-1.5 first:border-t-0"><span className="w-[150px] font-semibold">{a.kind === "product" ? "Product quiz" : "Final exam"} #{a.attemptNo}</span><span className="tabular-nums">{a.score}/{a.total} ({a.pct}%)</span><Pill tone={a.passed ? "green" : "red"}>{a.passed ? "Passed" : "Not passed"}</Pill><span className="text-[#64748B]">{dayLong(a.at)}</span><button className={btnCls + " ml-auto"} onClick={() => setReview(a.id)}>Review answers</button></li>)}
          </ul>
        ) : <Empty>No attempts yet.</Empty>}
      </Card>
      {exam ? <ExamModal kind={exam} onClose={() => setExam(null)} /> : null}
      {review ? <AttemptModal id={review} onClose={() => setReview(null)} /> : null}
    </div>
  );
}

function ExamModal({ kind, onClose }: { kind: "product" | "final"; onClose: () => void }) {
  const { run, busy, toast } = useRun();
  const [qs, setQs] = useState<{ id: string; prompt: string; options: string[] }[] | null>(null);
  const [res, setRes] = useState<QuizResult | null>(null);
  useEffect(() => { trExam(kind).then((r) => { if (r.ok) setQs(r.data); else { toast(r.error, "red"); onClose(); } }); }, [kind, toast, onClose]);
  return (
    <Modal title={kind === "product" ? "Product knowledge quiz" : "Final exam"} onClose={onClose} wide>
      {res ? <><ResultBox r={res} /><button className={primaryCls + " self-start"} onClick={onClose}>Close</button></>
        : qs ? <QuizForm questions={qs} busy={busy} label="Submit" onSubmit={(answers) => run(() => trSubmitQuiz({ kind, answers }), (d) => { setRes(d as QuizResult); return ""; })} />
        : <Empty>Loading questions…</Empty>}
    </Modal>
  );
}
function AttemptModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [r, setR] = useState<{ review: Review; pct: number } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { trAttempt(id).then((x) => (x.ok ? setR(x.data) : setErr(x.error))); }, [id]);
  return <Modal title="Your answers" onClose={onClose} wide>{err ? <Empty>{err}</Empty> : r ? <ReviewList review={r.review} /> : <Empty>Loading…</Empty>}</Modal>;
}

function Practicals({ t }: { t: T }) {
  const { run, busy } = useRun();
  const [kind, setKind] = useState<"mock_call" | "demo">("mock_call");
  const [scenario, setScenario] = useState(t.scenarios[0]?.id ?? "");
  const [text, setText] = useState(""), [link, setLink] = useState("");
  const sc = t.scenarios.find((s) => s.id === scenario);
  const mine = t.practicals.filter((p) => p.kind === kind);
  const waiting = mine.some((p) => !p.evaluatedAt), passed = mine.some((p) => p.passed);
  const left = t.settings.practicalAttemptsLeft[kind];
  return (
    <Card title="Practical examination" sub={`Scored by your trainer · pass ${t.settings.practicalPassPct}% of each rubric`}>
      <div className="px-5 pb-4 flex flex-col gap-4">
        <Tabs value={kind} onChange={setKind} options={[["mock_call", "Mock sales call (40)"], ["demo", "Product demonstration (20)"]]} />
        <div className="grid gap-4 min-[960px]:grid-cols-2">
          <div className="flex flex-col gap-3">
            {kind === "mock_call" ? (
              <>
                <Field label="Role-play scenario"><select className={inputCls} value={scenario} onChange={(e) => setScenario(e.target.value)}>{t.scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></Field>
                {sc ? (
                  <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-[13px] flex flex-col gap-1.5">
                    <div><strong>Customer:</strong> {sc.persona}</div><div><strong>Situation:</strong> {sc.situation}</div>
                    <ul className="flex flex-col gap-1 mt-1">{sc.script.map((x, k) => <li key={k} className={x.who === "coach" ? "text-[#5B45B0]" : ""}><strong>{x.who === "coach" ? "Coach" : "Customer"}:</strong> {x.text}</li>)}</ul>
                    <div className="mt-1"><strong>Goals:</strong> {sc.goals.join(" · ")}</div>
                  </div>
                ) : null}
              </>
            ) : <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-[13px]">Give your trainer a 15-minute demo on the demo account: dashboard → medicines → inventory/FEFO → purchase/GRN → billing → customer credit → reports. Say clearly that it is demo data, choose features for the customer’s needs, and end with a next step.</div>}
            <div className="text-[12.5px] text-[#475569]"><strong>Rubric:</strong> {RUBRICS[kind].map((c) => `${c.label} (${c.max})`).join(" · ")}</div>
          </div>
          <div className="flex flex-col gap-3">
            {passed ? <Pill tone="green">Passed</Pill> : waiting ? <div className="text-[13px] text-[#5B45B0]">Submitted. Waiting for your trainer to score it.</div> : left <= 0 ? <div className="text-[13px] text-[#B3261E]">No attempts left. Ask HR about a retake.</div> : (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => trSubmitPractical({ kind, scenarioId: kind === "mock_call" ? scenario : undefined, submission: text, link }), () => { setText(""); setLink(""); }); }}>
                <Field label="After the call / demo: what did you do?" hint="Opening, discovery answers, objections and how you handled them, the next step agreed."><textarea className={inputCls + " min-h-[150px]"} value={text} onChange={(e) => setText(e.target.value)} maxLength={6000} required /></Field>
                <Field label="Recording link (optional)" hint="Only if your company asked you to record it."><input className={inputCls} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></Field>
                <button className={primaryCls + " self-start"} disabled={busy}>Submit for scoring</button>
                <span className="text-[12px] text-[#64748B]">Attempts left: {left}</span>
              </form>
            )}
            {mine.map((p) => (
              <div key={p.id} className="rounded-xl border border-[#E2E8F0] p-3 text-[13px]">
                <div className="flex items-center gap-2"><strong>Attempt {p.attemptNo}</strong><span className="text-[#64748B]">{dayLong(p.submittedAt)}</span>{p.evaluatedAt ? <Pill tone={p.passed ? "green" : "red"}>{p.score}/{p.maxScore}</Pill> : <Pill tone="purple">Waiting</Pill>}</div>
                {p.feedback ? <p className="mt-1 whitespace-pre-wrap text-[#334155]"><strong>Feedback:</strong> {p.feedback}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Certificate({ t }: { t: T }) {
  const c = t.certificate, ev = t.evaluation;
  const missing = useMemo(() => [...ev.req, ...ev.approvals].filter((r) => !r.ok), [ev]);
  if (!c) return (
    <Card title="My certificates" sub="Issued automatically after the last approval">
      <div className="px-5 pb-5 grid gap-5 min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center">
      <div className="relative"><CertificatePreview name={t.me.name} programme={t.programme.title} certNo="Not issued yet" date="Your completion date" score={null} muted /><span className="absolute inset-0 flex items-center justify-center"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#0f172a]/85 text-white text-[12px] font-bold px-3 py-1.5"><Lock size={13} />Locked</span></span></div>
      <div className="flex flex-col gap-2 text-[13.5px]">
        <div className="flex items-center gap-2 text-[#475569]"><Award size={18} />Your certificate is issued automatically once everything below is done and approved.</div>
        <ul className="flex flex-col gap-1.5 mt-1">{missing.map((r) => <li key={r.id} className="flex gap-2 text-[13px] text-[#334155]"><Circle size={15} className="text-[#94A3B8] flex-none mt-0.5" /><span className="flex-1">{r.label}</span><span className="text-[#64748B] text-[12px]">{r.detail}</span></li>)}</ul>
      </div>
      </div>
    </Card>
  );
  return (
    <Card title="My certificates" sub={c.revoked ? "Revoked" : "Issued by Medoro HR"}>
      <div className="px-5 pb-5 grid gap-5 min-[860px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center">
        <CertificatePreview name={t.me.name} programme={t.programme.title} certNo={c.certNo} date={dayLong(c.issuedAt)} score={c.score} muted={c.revoked} />
        <div className="flex flex-col gap-3">
          <div className="text-[18px] font-extrabold">{c.revoked ? "This certificate was revoked" : "Congratulations, you are certified!"}</div>
          <div className="text-[13px] text-[#475569]">{c.certNo} · issued {dayLong(c.issuedAt)} · final score {c.score}/100</div>
          {c.revoked ? <div className="text-[13px] text-[#B3261E]">Reason: {c.revokedReason}</div> : <div className="text-[13px] text-[#475569]">The PDF carries a QR code: anyone can scan it to check that the certificate is genuine.</div>}
          {!c.revoked ? <a className={primaryCls + " no-underline self-start"} href={`/staff/hrms/training/certificate/${c.id}`} target="_blank" rel="noopener"><Download size={15} />Download PDF</a> : null}
        </div>
      </div>
    </Card>
  );
}
