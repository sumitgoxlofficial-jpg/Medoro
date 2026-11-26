import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import * as tr from "@/staff/hrms/training/service";
import { RUBRICS } from "@/staff/hrms/training/shared";
import { resetDb } from "./helpers";

let hr: Me, trainer: Me, sam: Me, ops: Me, sia: Me, admin: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.role === "super_admin" ? "admin" : u.hr!.role, perms: await loadPerms(true), sessionId: "t", phone: u.phone, personalEmail: "", dept: u.hr!.dept, designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (n: number, name: string, role: "employee" | "hr" | "sales", dept: string, staffRole: "employee" | "sales" | "super_admin" = "employee") =>
  db.staffUser.create({ data: { empNo: `MS-3${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98410000${n}0`, role: staffRole, status: "active", hr: { create: { role, dept, profileDone: true, docsAcceptedAt: new Date() } } } });

/** Pretend time passed since the last heartbeat (instead of waiting). */
const age = (assignmentId: string, lessonId: string, sec: number) => db.trProgress.updateMany({ where: { assignmentId, lessonId }, data: { lastBeatAt: new Date(Date.now() - sec * 1000) } });
const assignmentOf = async (me: Me) => db.trAssignment.findFirstOrThrow({ where: { staffId: me.id } });
const answersFor = async (where: object) => Object.fromEntries((await db.trQuestion.findMany({ where: { ...where, status: "published" } })).map((q) => [q.id, q.answer]));
const wrongFor = async (where: object) => Object.fromEntries((await db.trQuestion.findMany({ where: { ...where, status: "published" } })).map((q) => [q.id, (q.answer + 1) % (q.options as string[]).length]));

/** Completes a lesson the honest way through the service: heartbeats that cover the whole video or every slide, then its quiz. */
async function study(me: Me, lessonId: string) {
  const a = await assignmentOf(me);
  const l = await db.trLesson.findUniqueOrThrow({ where: { id: lessonId } });
  await tr.beat(me, { lessonId, mode: l.videoKind === "none" ? "slides" : "video", pos: 0, playing: false, visible: true });
  if (l.videoKind !== "none") {
    for (let pos = 25; pos < l.videoSeconds + 25; pos += 25) { await age(a.id, lessonId, 25); await tr.beat(me, { lessonId, mode: "video", pos: Math.min(pos, l.videoSeconds), playing: true, visible: true }); }
  } else {
    for (const [k] of (l.slides as unknown[]).entries()) for (let t = 0; t < 2; t++) { await age(a.id, lessonId, 30); await tr.beat(me, { lessonId, mode: "slides", pos: k, playing: true, visible: true }); }
  }
  if (await db.trQuestion.count({ where: { lessonId, scope: "lesson" } })) await tr.submitQuiz(me, { kind: "lesson", lessonId, answers: await answersFor({ lessonId, scope: "lesson" }) });
}

beforeAll(async () => {
  await resetDb();
  admin = await mkMe((await mk(0, "Ada Admin", "employee", "Leadership", "super_admin")).id);
  hr = await mkMe((await mk(1, "Hema HR", "hr", "HR")).id);
  trainer = await mkMe((await mk(2, "Tarun Trainer", "employee", "Sales")).id);
  sam = await mkMe((await mk(3, "Sam Sales", "sales", "Sales", "sales")).id);
  ops = await mkMe((await mk(4, "Om Ops", "employee", "Operations")).id);
  sia = await mkMe((await mk(5, "Sia Sales", "employee", "Sales")).id);
});

describe("Sales Training Academy", () => {
  it("only the training module can install the course; the standard course has the 26 tour chapters and 26 product questions", async () => {
    await expect(tr.installStandardCourse(sam)).rejects.toThrow(/role/);
    const r = await tr.installStandardCourse(hr);
    expect(r.lessons).toBeGreaterThan(30);
    const tour = await db.trModule.findFirstOrThrow({ where: { slug: "tour" } });
    expect(await db.trLesson.count({ where: { moduleId: tour.id } })).toBe(26);
    expect(await db.trQuestion.count({ where: { scope: "product" } })).toBe(26);
    expect(await db.trQuestion.count({ where: { scope: "final" } })).toBeGreaterThanOrEqual(15);
    expect(await db.trScenario.count()).toBe(7);
    expect(await db.trSession.count()).toBe(17);
    const l = await db.trLesson.findFirstOrThrow({ where: { moduleId: tour.id, order: 0 } });
    expect(l.videoKind).toBe("official");
    expect(l.videoSeconds).toBeGreaterThan(30);
    // Re-running adds nothing and keeps HR's edits.
    expect(await tr.installStandardCourse(hr)).toMatchObject({ lessons: 0, questions: 0, scenarios: 0, sessions: 0 });
  });

  it("assigns sales staff only, once each, and tells them", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const b = await tr.createBatch(hr, { name: "Batch A", date, trainerId: trainer.id }, [sam.id, ops.id, sia.id, trainer.id]);
    expect(b.added.sort()).toEqual(["Sam Sales", "Sia Sales"]);
    expect(b.skipped.map((s) => s.name).sort()).toEqual(["Om Ops", "Tarun Trainer"]);
    const again = await tr.assign(hr, b.id, [sam.id]);
    expect(again.skipped[0].why).toBe("already assigned");
    expect(await db.trAssignment.count()).toBe(2);
    expect(await db.hrNotification.count({ where: { staffId: sam.id, screen: "training" } })).toBe(1);
    await expect(tr.assign(sam, b.id, [ops.id])).rejects.toThrow(/role/);
    expect(await tr.myTraining(ops)).toBeNull();
  });

  it("counts only video really played: seeking ahead or a hidden tab earns nothing, and the resume point is kept", async () => {
    const a = await assignmentOf(sam);
    const l = await db.trLesson.findFirstOrThrow({ where: { slug: "tour-04" } });
    await tr.beat(sam, { lessonId: l.id, mode: "video", pos: 0, playing: false, visible: true });
    await age(a.id, l.id, 10);
    let p = await tr.beat(sam, { lessonId: l.id, mode: "video", pos: 10, playing: true, visible: true });
    expect(p.watchedPct).toBeGreaterThan(0);
    const after10 = p.watchedPct;
    await age(a.id, l.id, 10);
    p = await tr.beat(sam, { lessonId: l.id, mode: "video", pos: 60, playing: true, visible: true }); // a seek
    expect(p.watchedPct).toBe(after10);
    expect(p.lastPos).toBe(60);
    await age(a.id, l.id, 10);
    p = await tr.beat(sam, { lessonId: l.id, mode: "video", pos: 65, playing: true, visible: false }); // tab hidden
    expect(p.watchedPct).toBe(after10);
    await age(a.id, l.id, 10); // 30 s of video in 10 s is faster than 2× speed: a skip, not viewing
    p = await tr.beat(sam, { lessonId: l.id, mode: "video", pos: 95, playing: true, visible: true });
    expect(p.watchedPct).toBe(after10);
    expect(p.done).toBe(false);
    expect((await tr.myTraining(sam))!.progress[l.id].lastPos).toBe(95);
  });

  it("a lesson completes only with its evidence and a passed quiz; failed answers show explanations", async () => {
    const l = await db.trLesson.findFirstOrThrow({ where: { slug: "welcome" } });
    const fail = await tr.submitQuiz(sam, { kind: "lesson", lessonId: l.id, answers: await wrongFor({ lessonId: l.id, scope: "lesson" }) });
    expect(fail.passed).toBe(false);
    expect(fail.review.every((r) => !r.correct && r.explanation)).toBe(true);
    await expect(tr.submitQuiz(sam, { kind: "lesson", lessonId: l.id, answers: {} })).rejects.toThrow(/every question/);
    await tr.submitQuiz(sam, { kind: "lesson", lessonId: l.id, answers: await answersFor({ lessonId: l.id, scope: "lesson" }) });
    const a = await assignmentOf(sam);
    expect((await db.trProgress.findUnique({ where: { assignmentId_lessonId: { assignmentId: a.id, lessonId: l.id } } }))?.completedAt ?? null).toBeNull();
    await study(sam, l.id);
    expect((await db.trProgress.findUniqueOrThrow({ where: { assignmentId_lessonId: { assignmentId: a.id, lessonId: l.id } } })).completedAt).not.toBeNull();
  });

  it("gates the product quiz behind the tour and limits attempts", async () => {
    await expect(tr.examForLearner(sam, "product")).rejects.toThrow(/product tour first/);
    const lessons = await db.trLesson.findMany({ where: { status: "published" }, orderBy: { order: "asc" } });
    for (const l of lessons) await study(sam, l.id);
    const qs = await tr.examForLearner(sam, "product");
    expect(qs).toHaveLength(26);
    expect(JSON.stringify(qs)).not.toContain("answer");
    const bad = await tr.submitQuiz(sam, { kind: "product", answers: await wrongFor({ scope: "product" }) });
    expect(bad.passed).toBe(false);
    const good = await tr.submitQuiz(sam, { kind: "product", answers: await answersFor({ scope: "product" }) });
    expect(good).toMatchObject({ passed: true, pct: 100 });
    await expect(tr.examForLearner(sam, "product")).rejects.toThrow(/already passed/);
    await tr.submitQuiz(sam, { kind: "final", answers: await answersFor({ scope: "final" }) });
    const ev = await tr.evaluationOf((await assignmentOf(sam)).id);
    expect(ev.tourDone).toBe(26);
    expect(ev.lessonsDone).toBe(ev.lessonsTotal);
    expect(ev.marks.product + ev.marks.communication + ev.marks.crm).toBe(40);
    expect(ev.ready).toBe(false);
  });

  it("practicals are scored by the trainer only, against the rubric", async () => {
    const sc = await db.trScenario.findFirstOrThrow();
    await expect(tr.submitPractical(sam, { kind: "mock_call", submission: "x".repeat(50) })).rejects.toThrow(/scenario/);
    await tr.submitPractical(sam, { kind: "mock_call", scenarioId: sc.id, submission: "Opened with permission, asked about expiry, handled price objection, booked a demo for Thursday." });
    await tr.submitPractical(sam, { kind: "demo", submission: "Demo: dashboard, FEFO, purchase GRN, F9 billing, credit and reports; told the owner it was demo data; booked trial." });
    await expect(tr.submitPractical(sam, { kind: "demo", submission: "y".repeat(60) })).rejects.toThrow(/waiting/);
    const [mock, demo] = await Promise.all([db.trPractical.findFirstOrThrow({ where: { kind: "mock_call" } }), db.trPractical.findFirstOrThrow({ where: { kind: "demo" } })]);
    const full = (k: "mock_call" | "demo") => Object.fromEntries(RUBRICS[k].map((c) => [c.id, c.max]));
    await expect(tr.evaluatePractical(sia, mock.id, full("mock_call"), "Great call overall, well done.")).rejects.toThrow(/trainer or HR/);
    await expect(tr.evaluatePractical(trainer, mock.id, { ...full("mock_call"), opening: 9 }, "Great call overall, well done.")).rejects.toThrow(/0 to 5/);
    // A low demo score fails, and a retake is possible.
    await tr.evaluatePractical(trainer, demo.id, { preparation: 1, flow: 1, relevance: 1, benefits: 1, next_step: 1 }, "Practise the flow and end with a next step.");
    await tr.evaluatePractical(trainer, mock.id, full("mock_call"), "Excellent opening and objection handling.");
    await expect(tr.evaluatePractical(trainer, mock.id, full("mock_call"), "Scoring twice should not work.")).rejects.toThrow(/already been scored/);
    await expect(tr.trainerDecide(trainer, (await assignmentOf(sam)).id, true, "")).rejects.toThrow(/Not ready/);
    await tr.submitPractical(sam, { kind: "demo", submission: "Second demo: followed the full flow, matched features to the owner's expiry problem, booked a trial." });
    const retake = await db.trPractical.findFirstOrThrow({ where: { kind: "demo", evaluatedAt: null } });
    expect(retake.attemptNo).toBe(2);
    await tr.evaluatePractical(trainer, retake.id, full("demo"), "Much better: clear flow and next step.");
  });

  it("issues the certificate only after attendance, the trainer and HR, exactly once", async () => {
    const a = await assignmentOf(sam);
    let ev = await tr.evaluationOf(a.id);
    expect(ev.req.find((r) => r.id === "attendance")!.ok).toBe(false);
    await expect(tr.markAttendance(sam, a.id, "present")).rejects.toThrow(/own training/);
    await tr.markAttendance(trainer, a.id, "present");
    ev = await tr.evaluationOf(a.id);
    expect(ev.ready).toBe(true);
    expect(ev.score).toBe(100);
    await expect(tr.hrDecide(hr, a.id, true, "")).rejects.toThrow(/trainer hasn’t approved/);
    const t = await tr.trainerDecide(trainer, a.id, true, "Ready for the field.");
    expect(t.issued).toBe(false); // HR approval is required by default
    expect(await db.trCertificate.count()).toBe(0);
    const h = await tr.hrDecide(hr, a.id, true, "");
    expect(h).toMatchObject({ issued: true });
    expect(await db.trCertificate.count()).toBe(1);
    await tr.hrDecide(hr, a.id, true, "");
    expect(await db.trCertificate.count()).toBe(1);
    const cert = await db.trCertificate.findFirstOrThrow();
    expect(cert.certNo).toMatch(/^MS-STA-\d{4}-0001$/);
    expect(await tr.certificateFor(sam, cert.id)).toMatchObject({ name: "Sam Sales", score: 100 });
    expect(await tr.certificateFor(sia, cert.id)).toBeNull();
    expect(await tr.verifyCertificate(cert.verifyCode)).toMatchObject({ certNo: cert.certNo, revoked: false });
    expect(await tr.verifyCertificate("nope-nope-nope")).toBeNull();
    expect((await tr.myTraining(sam))!.evaluation.status).toBe("certified");
    await expect(tr.submitQuiz(sam, { kind: "final", answers: await answersFor({ scope: "final" }) })).rejects.toThrow(/already certified/);
  });

  it("keeps people out of what isn't theirs and rules with the super admin", async () => {
    await expect(tr.academy(sam)).rejects.toThrow(/role/);
    await expect(tr.reportCsv(trainer)).rejects.toThrow(/role/);
    const s = await tr.trainingSettings();
    await expect(tr.saveTrainingSettings(hr, { ...s, passPct: 50 })).rejects.toThrow(/super admin/);
    await tr.saveTrainingSettings(hr, { ...s, pricingNote: "Starter / Professional / Multi-branch as on medoro.in/pricing. No discounts." });
    await tr.saveTrainingSettings(admin, { ...(await tr.trainingSettings()), maxAttempts: 2 });
    expect((await tr.trainingSettings()).maxAttempts).toBe(2);
    const sia_a = await assignmentOf(sia);
    await expect(tr.attemptReview(sia, (await db.trAttempt.findFirstOrThrow({ where: { assignmentId: (await assignmentOf(sam)).id } })).id)).rejects.toThrow(/Not found/);
    await expect(tr.unassign(hr, (await assignmentOf(sam)).id)).rejects.toThrow(/history is kept/);
    expect(await tr.resourceFor(ops, (await db.trLesson.findFirstOrThrow()).id, 0)).toBeNull();
    expect(await tr.lessonForNotes(ops, (await db.trLesson.findFirstOrThrow()).id)).toBeNull();
    expect(sia_a).toBeTruthy();
    const csv = await tr.reportCsv(hr);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("MS-STA-");
  });

  it("validates content edits and keeps versions", async () => {
    const l = await db.trLesson.findFirstOrThrow({ where: { slug: "communication" } });
    const base = { title: l.title, summary: l.summary, mandatory: true, status: "published", order: l.order, durationMin: 30, videoKind: "file", videoRef: "https://evil.example.com/v.mp4", videoSeconds: 0, completionPct: 90, slides: l.slides, transcript: l.transcript, content: l.content };
    await expect(tr.saveLesson(hr, l.id, base)).rejects.toThrow(/security policy/);
    await tr.saveLesson(hr, l.id, { ...base, videoKind: "youtube", videoRef: "https://youtu.be/dQw4w9WgXcQ" });
    const after = await db.trLesson.findUniqueOrThrow({ where: { id: l.id } });
    expect(after).toMatchObject({ videoRef: "dQw4w9WgXcQ", version: 2 });
    const versions = await tr.lessonVersions(hr, l.id);
    expect(versions[0].version).toBe(1);
    await tr.restoreVersion(hr, versions[0].id);
    expect((await db.trLesson.findUniqueOrThrow({ where: { id: l.id } })).videoKind).toBe("none");
    await expect(tr.saveSchedule(hr, [{ start: "10:00", end: "11:00", title: "Alpha", kind: "session", moduleSlug: "" }, { start: "10:30", end: "11:30", title: "Beta", kind: "session", moduleSlug: "" }])).rejects.toThrow(/overlaps/);
  });
});
