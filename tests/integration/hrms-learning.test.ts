import { beforeAll, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 7: courses for every role (audience, server-marked quiz, attempts, reminders), anonymous pulse
// surveys with a minimum group size, and Ally answering from the company's policies, KPIs, courses and shift.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { assignCourse, learningTick, markLessonRead, myLearning, openCourse, publishCourse, saveCourse, submitQuiz } from "@/staff/hrms/learning";
import { answerSurvey, createSurvey, mySurveys, surveyResults } from "@/staff/hrms/surveys";
import { ask } from "@/staff/hrms/ally";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";

let hr: Me; const ops: Me[] = []; let sales: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: u.hr!.dept, designation: u.hr!.designation, photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (name: string, role: "hr" | "employee", dept: string) => (await db.staffUser.create({ data: { empNo: `MS-${600 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}${n}@medoro.in`, kind: "team", phone: "92000000" + String(n).padStart(2, "0"), role: "employee", status: "active", hr: { create: { role, dept, designation: "Executive", profileDone: true } } } })).id;
const course = { title: "Data protection basics", summary: "DPDP for everyone", dept: "Ops", mandatory: true, dueDays: 7, passPct: 70, lessons: [{ title: "Personal data", body: "Personal data is any data about an identifiable person." }, { title: "Breaches", body: "Report a suspected breach to HR within one hour." }], questions: [{ q: "When do you report a breach?", options: ["Within a week", "Within one hour"], answer: 1 }, { q: "Is a phone number personal data?", options: ["Yes", "No"], answer: 0 }] };

describe("HRMS learning, engagement and Ally (Phase 7)", () => {
  beforeAll(async () => {
    await resetDb();
    hr = await me(await mk("Hari HR", "hr", "HR"));
    for (const x of ["Asha", "Bela", "Chand", "Dev", "Ela", "Farid"]) ops.push(await me(await mk(`${x} Ops`, "employee", "Ops")));
    sales = await me(await mk("Sam Sales", "employee", "Sales"));
  });

  describe("courses", () => {
    let id = "";
    it("only HR writes courses; publishing enrols the audience only", async () => {
      await expect(saveCourse(ops[0], null, course)).rejects.toThrow(/role can’t/);
      await expect(saveCourse(hr, null, { ...course, lessons: [] })).rejects.toThrow(/at least one lesson/);
      await expect(saveCourse(hr, null, { ...course, questions: [{ q: "Bad question", options: ["a", "b"], answer: 5 }] })).rejects.toThrow(/correct option/);
      id = await saveCourse(hr, null, course);
      expect(await publishCourse(hr, id)).toBe(6);
      expect(await db.hrCourseEnrolment.count({ where: { staffId: sales.id } })).toBe(0);
      expect((await myLearning(sales)).length).toBe(0);
      expect(await assignCourse(hr, id, [sales.id])).toBe(1);
      expect((await myLearning(sales))[0]).toMatchObject({ title: "Data protection basics", mandatory: true });
    });
    it("never sends the answers, needs every lesson read, marks on the server and limits attempts", async () => {
      const c = await openCourse(ops[0], id);
      expect(JSON.stringify(c.questions)).not.toContain("answer");
      await expect(submitQuiz(ops[0], id, [1, 0])).rejects.toThrow(/Read every lesson/);
      await markLessonRead(ops[0], id, 0); await markLessonRead(ops[0], id, 1);
      await expect(submitQuiz(ops[0], id, [1])).rejects.toThrow(/every question/);
      expect(await submitQuiz(ops[0], id, [0, 1])).toMatchObject({ score: 0, passed: false, attemptsLeft: 2 });
      expect(await submitQuiz(ops[0], id, [1, 1])).toMatchObject({ score: 50, passed: false, attemptsLeft: 1 });
      expect(await submitQuiz(ops[0], id, [1, 0])).toMatchObject({ score: 100, passed: true });
      await expect(submitQuiz(ops[0], id, [1, 0])).rejects.toThrow(/completed this course/);
      const e = await db.hrCourseEnrolment.findUniqueOrThrow({ where: { courseId_staffId: { courseId: id, staffId: ops[0].id } }, include: { history: true } });
      expect(e.history.map((h) => h.score)).toEqual([0, 50, 100]);
      await expect(db.hrCourseAttempt.delete({ where: { id: e.history[0].id } })).rejects.toThrow(/append-only/);
      await markLessonRead(ops[1], id, 0); await markLessonRead(ops[1], id, 1);
      for (let i = 0; i < 3; i++) await submitQuiz(ops[1], id, [0, 1]);
      await expect(submitQuiz(ops[1], id, [1, 0])).rejects.toThrow(/No attempts left/);
      await expect(openCourse(hr, id)).rejects.toThrow(/isn’t assigned/);
    });
    it("reminds people of required courses once when due soon and once when overdue", async () => {
      await db.hrCourseEnrolment.updateMany({ where: { courseId: id, completedAt: null }, data: { dueOn: dateOnly(addDays(todayISO(), 2)) } });
      expect(await learningTick()).toBe(6); // everyone but the one who passed
      expect(await learningTick()).toBe(0);
      await db.hrCourseEnrolment.updateMany({ where: { courseId: id, completedAt: null }, data: { dueOn: dateOnly(addDays(todayISO(), -1)) } });
      expect(await learningTick()).toBe(6);
      expect((await myLearning(ops[2]))[0].overdue).toBe(true);
    });
  });

  describe("pulse surveys", () => {
    it("anonymous: no name stored, one answer each, results only for groups of five or more", async () => {
      const id = await createSurvey(hr, { title: "November pulse", closesOn: addDays(todayISO(), 5), questions: [{ text: "I would recommend Medoro as a place to work.", kind: "nps" }, { text: "I have what I need to do my job.", kind: "scale" }, { text: "One thing to change:", kind: "text" }] });
      await answerSurvey(ops[0], id, [10, 5, "More training"]);
      await expect(answerSurvey(ops[0], id, [0, 1, ""])).rejects.toThrow(/answered this survey already/);
      await expect(answerSurvey(ops[1], id, [11, 5, ""])).rejects.toThrow();
      expect((await mySurveys(ops[0]))[0].answered).toBe(true);
      expect(await db.hrSurveyResponse.count({ where: { surveyId: id, staffId: { not: null } } })).toBe(0);
      expect((await surveyResults(hr, id)).overall).toBeNull(); // 1 answer: hidden
      for (const [i, v] of [[1, 9], [2, 8], [3, 6], [4, 10]] as const) await answerSurvey(ops[i], id, [v, 4, ""]);
      await answerSurvey(sales, id, [3, 2, "Sales targets"]);
      const r = await surveyResults(hr, id);
      expect(r.responses).toBe(6);
      expect(r.overall![0]).toMatchObject({ kind: "nps", n: 6, enps: 17 }); // 3 promoters (10, 9, 10) − 2 detractors (6, 3) of 6
      expect(r.overall![1]).toMatchObject({ avg: 3.8 });
      expect(r.overall![2].answers).toEqual(["More training", "Sales targets"]);
      expect(r.depts.find((x) => x.name === "Ops")!.results).not.toBeNull(); // 5 answers
      expect(r.depts.find((x) => x.name === "Sales")!.results).toBeNull(); // 1 answer: hidden
      expect(r.respondents).toBeNull();
      await expect(surveyResults(ops[0], id)).rejects.toThrow(/role can’t/);
    });
    it("a department survey is only for that department; a named one lists who answered", async () => {
      const id = await createSurvey(hr, { title: "Ops tools", anonymous: false, dept: "Ops", closesOn: addDays(todayISO(), 5), questions: [{ text: "The new rostering works well.", kind: "scale" }] });
      expect((await mySurveys(sales)).find((s) => s.id === id)).toBeUndefined();
      await expect(answerSurvey(sales, id, [4])).rejects.toThrow(/another department/);
      await answerSurvey(ops[0], id, [4]);
      expect((await surveyResults(hr, id)).respondents).toEqual(["Asha Ops"]);
    });
  });

  it("Ally answers from the company's own policies, with the source, and from the person's courses", async () => {
    await db.hrPolicy.create({ data: { title: "Work from home", category: "Attendance", body: "Employees may work from home two days a week with their manager's approval.\n\nAsk in Leave & Approvals a day before." } });
    const a = await ask(ops[2], "How many days a week can I work from home?");
    expect(a.text).toContain("two days a week");
    expect(a.text).toContain("— Work from home");
    expect((await ask(ops[2], "Which courses do I have to finish?")).text).toContain("Data protection basics (required)");
    expect((await ask(ops[2], "What are my KPIs?")).text).toMatch(/No KPIs apply/);
  });
});
