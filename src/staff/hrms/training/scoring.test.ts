import { describe, expect, it } from "vitest";
import { creditSlide, creditVideo, evaluate, grade, scorePractical, type EvalInput } from "./scoring";
import { DEFAULT_TRAINING_SETTINGS, RUBRICS } from "./shared";
import { standardCourse } from "./content";

describe("training scoring", () => {
  it("credits only continuous playback", () => {
    let r = creditVideo("", 100, 0, 10, 10);
    expect(r.watchedPct).toBe(10);
    r = creditVideo(r.segs, 100, 10, 90, 10); // a seek
    expect(r.watchedPct).toBe(10);
    r = creditVideo(r.segs, 100, 10, 30, 10); // 2x speed is fine
    expect(r.watchedPct).toBe(30);
    expect(creditVideo(r.segs, 100, 30, 40, 0).watchedPct).toBe(30); // paused / hidden
  });
  it("needs time on every slide", () => {
    const slides = [{ title: "a", bullets: ["x"], narration: "" }, { title: "b", bullets: ["y"], narration: "" }];
    expect(creditSlide([], slides, 0, 30, 12).done).toBe(false);
    expect(creditSlide([30], slides, 1, 30, 12).done).toBe(true);
  });
  it("grades and refuses unanswered questions", () => {
    const qs = [{ id: "a", area: "crm", answer: 1, options: [0, 1] }, { id: "b", area: "communication", answer: 0, options: [0, 1] }];
    expect(grade(qs, { a: 1, b: 1 })).toMatchObject({ score: 1, pct: 50, areas: { crm: [1, 1], communication: [0, 1] } });
    expect(() => grade(qs, { a: 1 })).toThrow();
    expect(() => grade(qs, { a: 1, b: 5 })).toThrow();
  });
  it("weights 100 marks and needs every requirement and approval", () => {
    const full = (k: "mock_call" | "demo") => Object.fromEntries(RUBRICS[k].map((c) => [c.id, c.max]));
    const base: EvalInput = {
      settings: DEFAULT_TRAINING_SETTINGS, lessons: [{ id: "t", mandatory: true, tour: true }, { id: "s", mandatory: true, tour: false }], completed: new Set(["t", "s"]),
      attempts: [{ kind: "product", pct: 100, passed: true, areas: {}, at: "1" }, { kind: "final", pct: 100, passed: true, areas: { communication: [10, 10] as [number, number], crm: [5, 5] as [number, number] }, at: "1" }],
      practicals: [{ kind: "mock_call", score: 40, maxScore: 40, passed: true, evaluatedAt: "x", submittedAt: "1", rubric: full("mock_call") }, { kind: "demo", score: 20, maxScore: 20, passed: true, evaluatedAt: "x", submittedAt: "1", rubric: full("demo") }],
      attendance: "present", trainerDecision: "", hrDecision: "", certified: false,
    };
    const e = evaluate(base);
    expect(e.score).toBe(100);
    expect(e).toMatchObject({ ready: true, eligible: false, status: "trainer" });
    expect(evaluate({ ...base, trainerDecision: "approved" }).status).toBe("hr");
    expect(evaluate({ ...base, trainerDecision: "approved", hrDecision: "approved" }).eligible).toBe(true);
    expect(evaluate({ ...base, attendance: "" }).ready).toBe(false);
    expect(evaluate({ ...base, completed: new Set(["s"]) }).req.find((r) => r.id === "tour")!.ok).toBe(false);
  });
  it("scores practicals against the rubric", () => {
    expect(scorePractical("demo", { preparation: 4, flow: 4, relevance: 3, benefits: 3, next_step: 0 }, 70)).toMatchObject({ score: 14, passed: true });
    expect(() => scorePractical("demo", { preparation: 5, flow: 4, relevance: 3, benefits: 3, next_step: 0 }, 70)).toThrow();
  });
  it("standard course is complete and consistent", () => {
    const c = standardCourse();
    const tour = c.modules.find((m) => m.kind === "tour")!;
    expect(tour.lessons).toHaveLength(26);
    expect(c.productQuiz).toHaveLength(26);
    expect(new Set(c.productQuiz.map((q) => q.lessonSlug)).size).toBe(26);
    const objections = c.modules.flatMap((m) => m.lessons).find((l) => l.slug === "objection-handling")!.content.objections!;
    expect(objections).toHaveLength(12);
    expect(c.modules.flatMap((m) => m.lessons).find((l) => l.slug === "cold-calling")!.content.scripts!.length).toBeGreaterThanOrEqual(5);
    expect(c.modules.flatMap((m) => m.lessons).find((l) => l.slug === "features-benefits")!.content.features).toHaveLength(25);
    for (const q of [...c.productQuiz, ...c.finalExam, ...c.modules.flatMap((m) => m.lessons.flatMap((l) => l.quiz))]) expect(q.answer).toBeLessThan(q.options.length);
    const slugs = new Set(c.modules.map((m) => m.slug));
    for (const s of c.sessions) if (s.moduleSlug) expect(slugs.has(s.moduleSlug)).toBe(true);
    for (const l of tour.lessons) expect(l.transcript!.length).toBeGreaterThan(100);
  });
});
