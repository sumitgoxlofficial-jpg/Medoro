import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, need, notify, type Me } from "./auth";

// Learning for everyone (the Sales Academy stays the sales programme). HR (Employees module) writes a course: lessons,
// a quiz and a pass mark, for an audience (everyone, a department and/or a designation), mandatory or optional, with
// days to finish. Publishing enrols the audience; new people in the audience are enrolled when they open Learning.
// Quizzes are marked on the server: the correct answers never leave it. A pass completes the course; attempts are kept.

const MAX_ATTEMPTS = 3;
const lessonSchema = z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().min(10, "Write the lesson text.").max(20_000), url: z.string().trim().max(500).regex(/^$|^https:\/\//, "Links must start with https://").default("") });
const questionSchema = z.object({ q: z.string().trim().min(5).max(500), options: z.array(z.string().trim().min(1).max(200)).min(2).max(6), answer: z.coerce.number().int().min(0) }).refine((x) => x.answer < x.options.length, { message: "Pick the correct option of each question." });
const courseInput = z.object({
  title: z.string().trim().min(3, "Name the course.").max(120), summary: z.string().trim().max(500).default(""),
  dept: z.string().trim().max(60).default(""), designation: z.string().trim().max(80).default(""),
  mandatory: z.boolean().default(false), dueDays: z.coerce.number().int().min(1).max(365).default(14), passPct: z.coerce.number().int().min(0).max(100).default(70),
  lessons: z.array(lessonSchema).min(1, "Add at least one lesson.").max(30), questions: z.array(questionSchema).max(50).default([]),
});
type Lesson = z.output<typeof lessonSchema>; type Question = z.output<typeof questionSchema>;

export async function saveCourse(me: Me, id: string | null, raw: z.input<typeof courseInput>) {
  need(me, "employees");
  const i = courseInput.parse(raw);
  const data = { title: i.title, summary: i.summary, dept: i.dept, designation: i.designation, mandatory: i.mandatory, dueDays: i.dueDays, passPct: i.passPct, lessons: i.lessons as Prisma.InputJsonValue, questions: i.questions as Prisma.InputJsonValue, updatedBy: me.id };
  if (id) {
    const c = await db.hrCourse.findUnique({ where: { id } });
    if (!c) throw new UserError("Course not found.");
    // A published course's quiz changing makes earlier passes refer to another quiz: bump the version (kept on each attempt).
    await db.hrCourse.update({ where: { id }, data: { ...data, version: c.status === "published" ? { increment: 1 } : undefined } });
  } else id = (await db.hrCourse.create({ data: { ...data, createdBy: me.id } })).id;
  await audit(me, "Course saved", i.title);
  return id;
}

type Person = { id: string; dept: string; designation: string };
const inAudience = (c: { dept: string; designation: string }, p: Pick<Person, "dept" | "designation">) => (!c.dept || c.dept.toLowerCase() === p.dept.toLowerCase()) && (!c.designation || c.designation.toLowerCase() === p.designation.toLowerCase());
async function active(): Promise<Person[]> {
  const rows = await db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null }, select: { id: true, hr: { select: { dept: true, designation: true } } } });
  return rows.map((r) => ({ id: r.id, dept: r.hr?.dept ?? "", designation: r.hr?.designation ?? "" }));
}
/** Enrols people (not enrolled yet) in a published course. Returns who was added. */
async function enrol(courseId: string, ids: string[], by: string | null, dueDays: number) {
  if (!ids.length) return [];
  const have = new Set((await db.hrCourseEnrolment.findMany({ where: { courseId, staffId: { in: ids } }, select: { staffId: true } })).map((e) => e.staffId));
  const fresh = ids.filter((x) => !have.has(x));
  await db.hrCourseEnrolment.createMany({ data: fresh.map((staffId) => ({ courseId, staffId, assignedBy: by, dueOn: dateOnly(addDays(todayISO(), dueDays)) })), skipDuplicates: true });
  return fresh;
}

export async function publishCourse(me: Me, id: string) {
  need(me, "employees");
  const c = await db.hrCourse.findUnique({ where: { id } });
  if (!c) throw new UserError("Course not found.");
  if (c.status === "published") throw new UserError("This course is already published.");
  await db.hrCourse.update({ where: { id }, data: { status: "published", publishedAt: new Date() } });
  const added = await enrol(id, (await active()).filter((p) => inAudience(c, p)).map((p) => p.id), me.id, c.dueDays);
  await notify(added, `New ${c.mandatory ? "required " : ""}course: ${c.title}. Find it in Learning${c.mandatory ? `; finish it within ${c.dueDays} days` : ""}.`, "learning");
  await audit(me, "Course published", `${c.title} · ${added.length} enrolled`);
  return added.length;
}
/** HR assigns a published course to particular people (outside its audience too). */
export async function assignCourse(me: Me, id: string, staffIds: string[]) {
  need(me, "employees");
  const c = await db.hrCourse.findUnique({ where: { id } });
  if (!c || c.status !== "published") throw new UserError("Publish the course first.");
  const ok = new Set((await active()).map((p) => p.id));
  const added = await enrol(id, staffIds.filter((x) => ok.has(x)), me.id, c.dueDays);
  await notify(added, `You were given a course: ${c.title}.`, "learning");
  await audit(me, "Course assigned", `${c.title} · ${added.length} people`);
  return added.length;
}
export async function archiveCourse(me: Me, id: string) {
  need(me, "employees");
  await db.hrCourse.update({ where: { id }, data: { status: "archived" } });
  await audit(me, "Course archived", id);
}

/** The learner's list (enrolling them first in published courses for their audience). */
export async function myLearning(me: Me) {
  const prof = await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { dept: true, designation: true } });
  const p = { dept: prof?.dept ?? "", designation: prof?.designation ?? "" };
  if (me.role !== "admin") {
    for (const c of (await db.hrCourse.findMany({ where: { status: "published" } })).filter((c) => inAudience(c, p))) await enrol(c.id, [me.id], null, c.dueDays);
  }
  const rows = await db.hrCourseEnrolment.findMany({ where: { staffId: me.id, course: { status: "published" } }, include: { course: true }, orderBy: [{ completedAt: "asc" }, { dueOn: "asc" }] });
  const today = todayISO();
  return rows.map((e) => ({ id: e.courseId, title: e.course.title, summary: e.course.summary, mandatory: e.course.mandatory, lessons: (e.course.lessons as Lesson[]).length, read: (e.lessonsRead as number[]).length, questions: (e.course.questions as Question[]).length, dueOn: isoOf(e.dueOn), overdue: !e.completedAt && isoOf(e.dueOn) < today, completedAt: e.completedAt?.toISOString() ?? null, score: e.score, attempts: e.attempts, passPct: e.course.passPct }));
}

/** A course for its learner: lessons and the quiz WITHOUT the answers. */
export async function openCourse(me: Me, courseId: string) {
  const e = await db.hrCourseEnrolment.findUnique({ where: { courseId_staffId: { courseId, staffId: me.id } }, include: { course: true } });
  if (!e || e.course.status !== "published") throw new UserError("This course isn’t assigned to you.");
  if (!e.startedAt) await db.hrCourseEnrolment.update({ where: { id: e.id }, data: { startedAt: new Date() } });
  return { id: courseId, title: e.course.title, summary: e.course.summary, passPct: e.course.passPct, lessons: e.course.lessons as Lesson[], read: e.lessonsRead as number[], questions: (e.course.questions as Question[]).map((q) => ({ q: q.q, options: q.options })), attemptsLeft: MAX_ATTEMPTS - e.attempts, completedAt: e.completedAt?.toISOString() ?? null, score: e.score };
}
export async function markLessonRead(me: Me, courseId: string, index: number) {
  const e = await db.hrCourseEnrolment.findUnique({ where: { courseId_staffId: { courseId, staffId: me.id } }, include: { course: true } });
  if (!e) throw new UserError("This course isn’t assigned to you.");
  const n = (e.course.lessons as Lesson[]).length;
  const i = z.number().int().min(0).max(n - 1).parse(index);
  const read = [...new Set([...(e.lessonsRead as number[]), i])].sort((a, b) => a - b);
  const finished = read.length === n && (e.course.questions as Question[]).length === 0 && !e.completedAt;
  await db.hrCourseEnrolment.update({ where: { id: e.id }, data: { lessonsRead: read, ...(finished ? { completedAt: new Date(), score: 100 } : {}) } });
  return { read: read.length, of: n, completed: finished || !!e.completedAt };
}

/** Marks a quiz on the server. All lessons must be read first; at most MAX_ATTEMPTS; a pass completes the course. */
export async function submitQuiz(me: Me, courseId: string, rawAnswers: number[]) {
  const e = await db.hrCourseEnrolment.findUnique({ where: { courseId_staffId: { courseId, staffId: me.id } }, include: { course: true } });
  if (!e || e.course.status !== "published") throw new UserError("This course isn’t assigned to you.");
  if (e.completedAt) throw new UserError("You have completed this course already.");
  const qs = e.course.questions as Question[], lessons = e.course.lessons as Lesson[];
  if (!qs.length) throw new UserError("This course has no quiz.");
  if ((e.lessonsRead as number[]).length < lessons.length) throw new UserError("Read every lesson before the quiz.");
  if (e.attempts >= MAX_ATTEMPTS) throw new UserError("No attempts left. Ask HR to reset your attempts.");
  const answers = z.array(z.number().int().min(0).max(5)).length(qs.length, "Answer every question.").parse(rawAnswers);
  const right = answers.filter((a, i) => a === qs[i].answer).length;
  const score = Math.round((right / qs.length) * 100), passed = score >= e.course.passPct;
  const claimed = await db.hrCourseEnrolment.updateMany({ where: { id: e.id, attempts: e.attempts, completedAt: null }, data: { attempts: { increment: 1 }, score: Math.max(score, e.score ?? 0), ...(passed ? { completedAt: new Date() } : {}) } });
  if (!claimed.count) throw new UserError("That attempt was already counted. Reload the page.");
  await db.hrCourseAttempt.create({ data: { enrolmentId: e.id, version: e.course.version, answers, score, passed } });
  if (passed) await audit(me, "Course completed", `${e.course.title} · ${score}%`);
  return { score, passed, right, of: qs.length, attemptsLeft: MAX_ATTEMPTS - e.attempts - 1, passPct: e.course.passPct };
}

/** HR lets someone try the quiz again. */
export async function resetAttempts(me: Me, courseId: string, staffId: string) {
  need(me, "employees");
  await db.hrCourseEnrolment.update({ where: { courseId_staffId: { courseId, staffId } }, data: { attempts: 0 } });
  await audit(me, "Course attempts reset", `${courseId} · ${staffId}`);
}

/** HR: every course with progress, and the people overdue on required ones. */
export async function learningAdmin(me: Me) {
  need(me, "employees");
  const courses = await db.hrCourse.findMany({ where: { status: { not: "archived" } }, include: { enrolments: { select: { staffId: true, completedAt: true, dueOn: true, score: true, attempts: true } } }, orderBy: { createdAt: "desc" } });
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: [...new Set(courses.flatMap((c) => c.enrolments.map((e) => e.staffId)))] } }, select: { id: true, name: true, empNo: true } })).map((u) => [u.id, u]));
  const today = todayISO();
  return courses.map((c) => ({
    id: c.id, title: c.title, summary: c.summary, status: c.status, mandatory: c.mandatory, dept: c.dept, designation: c.designation, dueDays: c.dueDays, passPct: c.passPct, version: c.version,
    lessons: c.lessons as Lesson[], questions: c.questions as Question[],
    enrolled: c.enrolments.length, completed: c.enrolments.filter((e) => e.completedAt).length,
    people: c.enrolments.map((e) => ({ staffId: e.staffId, name: names.get(e.staffId)?.name ?? "", empNo: names.get(e.staffId)?.empNo ?? "", done: !!e.completedAt, score: e.score, attempts: e.attempts, overdue: !e.completedAt && isoOf(e.dueOn) < today, dueOn: isoOf(e.dueOn) })),
  }));
}

/** Daily: reminds people of required courses due in 3 days or overdue (once per stage). */
export async function learningTick(now = new Date()) {
  const soon = dateOnly(addDays(todayISO(now), 3));
  const rows = await db.hrCourseEnrolment.findMany({ where: { completedAt: null, dueOn: { lte: soon }, reminded: { lt: 2 }, course: { status: "published", mandatory: true } }, include: { course: { select: { title: true } } } });
  let n = 0;
  for (const e of rows) {
    const stage = isoOf(e.dueOn) < todayISO(now) ? 2 : 1;
    if (stage <= e.reminded) continue;
    const { count } = await db.hrCourseEnrolment.updateMany({ where: { id: e.id, reminded: e.reminded }, data: { reminded: stage } });
    if (!count) continue;
    await notify([e.staffId], stage === 2 ? `The required course “${e.course.title}” is overdue. Please finish it in Learning.` : `The required course “${e.course.title}” is due on ${isoOf(e.dueOn)}.`, "learning");
    n++;
  }
  return n;
}
