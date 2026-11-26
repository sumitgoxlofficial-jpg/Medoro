// Pure scoring and certification rules (no server imports), shared by the server and its tests.
import { AREAS, RUBRICS, SEG, rubricMax, segCount, slideNeed, type AreaId, type PracticalKind, type Slide, type TrainingSettings } from "./shared";

export type EvalInput = {
  settings: TrainingSettings;
  lessons: { id: string; mandatory: boolean; tour: boolean }[];
  completed: Set<string>; // lesson ids with completedAt
  attempts: { kind: string; pct: number; passed: boolean; areas: Record<string, [number, number]>; at: string }[];
  practicals: { kind: string; score: number | null; maxScore: number; passed: boolean | null; evaluatedAt: string | null; submittedAt: string; rubric: Record<string, number> }[];
  attendance: string;
  trainerDecision: string;
  hrDecision: string;
  certified: boolean;
  /** Any learning evidence recorded yet (a heartbeat or an attempt). */
  started?: boolean;
};

export type Requirement = { id: string; label: string; ok: boolean; detail: string };

/** Best final-exam result per area, as a share 0..1 (from the attempt with the best overall score). */
function bestFinal(attempts: EvalInput["attempts"]) {
  const finals = attempts.filter((a) => a.kind === "final").sort((a, b) => b.pct - a.pct || a.at.localeCompare(b.at));
  return finals[0] ?? null;
}
const share = (pair?: [number, number]) => (pair && pair[1] > 0 ? pair[0] / pair[1] : 0);

/** Latest evaluated attempt of a practical. */
export function latestPractical(ps: EvalInput["practicals"], kind: PracticalKind) {
  return ps.filter((p) => p.kind === kind && p.evaluatedAt).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null;
}

export function evaluate(i: EvalInput) {
  const s = i.settings;
  const mandatory = i.lessons.filter((l) => l.mandatory);
  const tour = i.lessons.filter((l) => l.tour && l.mandatory);
  const lessonsDone = mandatory.filter((l) => i.completed.has(l.id)).length;
  const tourDone = tour.filter((l) => i.completed.has(l.id)).length;
  const product = i.attempts.filter((a) => a.kind === "product").sort((a, b) => b.pct - a.pct)[0] ?? null;
  const final = bestFinal(i.attempts);
  const mock = latestPractical(i.practicals, "mock_call"), demo = latestPractical(i.practicals, "demo");

  // Marks per area out of the published weighting.
  const marks: Record<AreaId, number> = { product: 0, communication: 0, cold_calling: 0, demo: 0, objection: 0, crm: 0, professionalism: 0 };
  const area = (id: AreaId) => AREAS.find((a) => a.id === id)!.marks;
  if (product) marks.product = area("product") * (product.pct / 100);
  if (final) { marks.communication = area("communication") * share(final.areas.communication); marks.crm = area("crm") * share(final.areas.crm); }
  const fromRubric = (p: typeof mock, kind: PracticalKind) => {
    if (!p) return;
    for (const a of AREAS) {
      const crit = RUBRICS[kind].filter((c) => c.area === a.id);
      if (!crit.length) continue;
      const got = crit.reduce((t, c) => t + Math.max(0, Math.min(c.max, Number(p.rubric[c.id] ?? 0))), 0), max = crit.reduce((t, c) => t + c.max, 0);
      marks[a.id] = area(a.id) * (got / max);
    }
  };
  fromRubric(mock, "mock_call"); fromRubric(demo, "demo");
  const score = Math.round(Object.values(marks).reduce((a, b) => a + b, 0));

  const req: Requirement[] = [
    ...(s.attendanceRequired ? [{ id: "attendance", label: "Attendance marked present", ok: i.attendance === "present", detail: i.attendance === "absent" ? "Marked absent" : i.attendance ? "Present" : "Not marked yet" }] : []),
    { id: "tour", label: "Official product tour completed", ok: tour.length > 0 && tourDone === tour.length, detail: `${tourDone}/${tour.length} chapters` },
    { id: "lessons", label: "All mandatory lessons completed", ok: mandatory.length > 0 && lessonsDone === mandatory.length, detail: `${lessonsDone}/${mandatory.length} lessons` },
    { id: "product", label: `Product knowledge quiz passed (${s.productQuizPct}%)`, ok: !!product && product.pct >= s.productQuizPct, detail: product ? `Best ${product.pct}%` : "Not attempted" },
    { id: "final", label: "Final exam attempted", ok: !!final, detail: final ? `Best ${final.pct}%` : "Not attempted" },
    { id: "mock_call", label: "Mock sales call passed", ok: !!mock?.passed, detail: mock ? `${mock.score}/${mock.maxScore}${mock.passed ? "" : " (below pass)"}` : i.practicals.some((p) => p.kind === "mock_call" && !p.evaluatedAt) ? "Waiting for trainer" : "Not submitted" },
    { id: "demo", label: "Product demonstration passed", ok: !!demo?.passed, detail: demo ? `${demo.score}/${demo.maxScore}${demo.passed ? "" : " (below pass)"}` : i.practicals.some((p) => p.kind === "demo" && !p.evaluatedAt) ? "Waiting for trainer" : "Not submitted" },
    { id: "score", label: `Final score at least ${s.passPct}/100`, ok: score >= s.passPct, detail: `${score}/100` },
  ];
  const ready = req.every((r) => r.ok);
  const approvals: Requirement[] = [
    { id: "trainer", label: "Trainer approval", ok: i.trainerDecision === "approved", detail: i.trainerDecision || "Waiting" },
    ...(s.hrApproval ? [{ id: "hr", label: "HR approval", ok: i.hrDecision === "approved", detail: i.hrDecision || "Waiting" }] : []),
  ];
  const eligible = ready && approvals.every((a) => a.ok);

  const pendingReview = i.practicals.some((p) => !p.evaluatedAt);
  const everythingTried = !!product && !!final && !!mock && !!demo;
  const status = i.certified ? "certified"
    : i.trainerDecision === "rejected" || i.hrDecision === "rejected" ? "rejected"
    : ready && i.trainerDecision === "approved" && s.hrApproval && !i.hrDecision ? "hr"
    : ready && !i.trainerDecision ? "trainer"
    : pendingReview ? "review"
    : everythingTried && !ready && lessonsDone === mandatory.length ? "failed"
    : lessonsDone === mandatory.length && mandatory.length > 0 ? "practicals"
    : lessonsDone > 0 || i.attempts.length > 0 || i.started ? "learning" : "not_started";
  const pct = mandatory.length ? Math.round((lessonsDone / mandatory.length) * 100) : 0;
  return { score, marks, req, approvals, ready, eligible, status, lessonsDone, lessonsTotal: mandatory.length, tourDone, tourTotal: tour.length, pct, product, final, mock, demo };
}
export type Evaluation = ReturnType<typeof evaluate>;

// ── Learning evidence

/** Marks the segments a stretch of real playback covered. A jump further than the time that passed (at up to 2× speed) is a seek and counts for nothing. */
export function creditVideo(segs: string, seconds: number, lastPos: number, pos: number, creditSec: number) {
  const n = segCount(seconds);
  const arr = (segs.padEnd(n, "0").slice(0, n)).split("");
  const moved = pos - lastPos;
  let counted = 0;
  if (creditSec > 0 && moved > 0 && moved <= creditSec * 2 + SEG) {
    const from = Math.floor(Math.max(0, lastPos) / SEG), to = Math.min(n - 1, Math.floor(Math.max(0, pos - 0.001) / SEG));
    for (let k = from; k <= to; k++) if (arr[k] !== "1") { arr[k] = "1"; counted++; }
  }
  const out = arr.join("");
  return { segs: out, counted, watchedPct: Math.round((out.split("").filter((c) => c === "1").length / n) * 100) };
}

/** Adds time to the slide on screen; returns whether every slide has had its minimum. */
export function creditSlide(slideSecs: number[], slides: Slide[], unit: number, creditSec: number, minSec: number) {
  const secs = slides.map((_, k) => Math.max(0, Number(slideSecs[k] ?? 0)));
  if (unit >= 0 && unit < slides.length && creditSec > 0) secs[unit] = Math.min(600, secs[unit] + creditSec);
  const need = slides.map((s) => slideNeed(s, minSec));
  const seen = secs.filter((v, k) => v >= need[k]).length;
  return { secs, done: slides.length > 0 && seen === slides.length, seen, pct: slides.length ? Math.round((seen / slides.length) * 100) : 0, need };
}

/** Grades answers against the key. Every question must be answered. */
export function grade(questions: { id: string; area: string; answer: number; options: unknown[] }[], chosen: Record<string, number>) {
  const answers = questions.map((q) => {
    const c = chosen[q.id];
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= q.options.length) throw new Error("unanswered");
    return { q: q.id, chose: c, correct: c === q.answer };
  });
  const areas: Record<string, [number, number]> = {};
  for (const [k, q] of questions.entries()) { const a = (areas[q.area] ??= [0, 0]); a[1]++; if (answers[k].correct) a[0]++; }
  const score = answers.filter((a) => a.correct).length, total = questions.length;
  return { answers, areas, score, total, pct: total ? Math.round((score / total) * 100) : 0 };
}

export function scorePractical(kind: PracticalKind, rubric: Record<string, number>, passPct: number) {
  const clean: Record<string, number> = {};
  for (const c of RUBRICS[kind]) {
    const v = rubric[c.id];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > c.max) throw new Error(`Score "${c.label}" from 0 to ${c.max}.`);
    clean[c.id] = v;
  }
  const score = Object.values(clean).reduce((a, b) => a + b, 0), max = rubricMax(kind);
  return { rubric: clean, score, max, passed: score * 100 >= passPct * max };
}
