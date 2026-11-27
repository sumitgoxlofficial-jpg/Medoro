import "server-only";
import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { audit, need, notify, type Me } from "./auth";

// Engagement pulse surveys. Anonymous surveys store no staff id with an answer: only a keyed hash (HMAC of the survey and
// the person, keyed with SESSION_SECRET) to stop a second answer, and the department for breakdowns. Results are shown
// only for groups of at least MIN_GROUP answers, and free-text answers only when the whole survey has that many, so
// nobody can be singled out. The limit: someone with both the database and the server secret could recompute the hash.

export const MIN_GROUP = 5;
const questionSchema = z.object({ text: z.string().trim().min(5).max(300), kind: z.enum(["scale", "nps", "text"]) });
const surveyInput = z.object({
  title: z.string().trim().min(3).max(120), intro: z.string().trim().max(500).default(""),
  anonymous: z.boolean().default(true), dept: z.string().trim().max(60).default(""),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the closing day."),
  questions: z.array(questionSchema).min(1, "Add a question.").max(20),
});
type Q = z.output<typeof questionSchema>;
const respondentKey = (surveyId: string, staffId: string) => createHmac("sha256", process.env.SESSION_SECRET || "medoro-dev-only").update(`survey:${surveyId}:${staffId}`).digest("hex");

export async function createSurvey(me: Me, raw: z.input<typeof surveyInput>) {
  need(me, "employees");
  const i = surveyInput.parse(raw);
  const s = await db.hrSurvey.create({ data: { title: i.title, intro: i.intro, anonymous: i.anonymous, dept: i.dept, closesOn: new Date(`${i.closesOn}T23:59:59+05:30`), questions: i.questions as Prisma.InputJsonValue, createdBy: me.id } });
  const people = await db.staffUser.findMany({ where: { kind: "team", role: { notIn: ["partner", "super_admin"] }, status: "active", deletedAt: null, ...(i.dept ? { hr: { dept: i.dept } } : {}) }, select: { id: true } });
  await notify(people.map((p) => p.id), `New ${i.anonymous ? "anonymous " : ""}survey: ${i.title}. It takes a minute (Engagement).`, "engage");
  await audit(me, "Survey created", `${i.title} · ${i.anonymous ? "anonymous" : "named"} · ${people.length} people`);
  return s.id;
}
export async function closeSurvey(me: Me, id: string) {
  need(me, "employees");
  await db.hrSurvey.update({ where: { id }, data: { closesOn: new Date() } });
  await audit(me, "Survey closed", id);
}

const open = (s: { closesOn: Date }) => s.closesOn > new Date();
/** Surveys this person can answer (open, for their department or everyone), and whether they already did. */
export async function mySurveys(me: Me) {
  const dept = (await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { dept: true } }))?.dept ?? "";
  const rows = await db.hrSurvey.findMany({ where: { closesOn: { gt: new Date() }, OR: [{ dept: "" }, { dept }] }, orderBy: { closesOn: "asc" } });
  const done = new Set((await db.hrSurveyResponse.findMany({ where: { surveyId: { in: rows.map((r) => r.id) }, respondentKey: { in: rows.map((r) => respondentKey(r.id, me.id)) } }, select: { surveyId: true } })).map((r) => r.surveyId));
  return rows.map((r) => ({ id: r.id, title: r.title, intro: r.intro, anonymous: r.anonymous, closesOn: r.closesOn.toISOString(), questions: r.questions as Q[], answered: done.has(r.id) }));
}

export async function answerSurvey(me: Me, id: string, raw: unknown[]) {
  if (me.role === "admin") throw new UserError("Surveys are for employees.");
  const s = await db.hrSurvey.findUnique({ where: { id } });
  if (!s || !open(s)) throw new UserError("This survey is closed.");
  const dept = (await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { dept: true } }))?.dept ?? "";
  if (s.dept && s.dept !== dept) throw new UserError("This survey is for another department.");
  const qs = s.questions as Q[];
  if (!Array.isArray(raw) || raw.length !== qs.length) throw new UserError("Answer every question.");
  const answers = qs.map((q, i) => q.kind === "text" ? z.string().trim().max(1000).parse(raw[i] ?? "") : z.coerce.number().int().min(q.kind === "nps" ? 0 : 1, "Choose a value.").max(q.kind === "nps" ? 10 : 5).parse(raw[i]));
  try {
    await db.hrSurveyResponse.create({ data: { surveyId: id, respondentKey: respondentKey(id, me.id), staffId: s.anonymous ? null : me.id, dept, answers: answers as Prisma.InputJsonValue } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new UserError("You have answered this survey already.");
    throw e;
  }
}

/** HR's results: averages, eNPS and text answers, each only for groups of at least MIN_GROUP answers. */
export async function surveyResults(me: Me, id: string) {
  need(me, "employees");
  const s = await db.hrSurvey.findUnique({ where: { id }, include: { responses: true } });
  if (!s) throw new UserError("Survey not found.");
  const qs = s.questions as Q[], rs = s.responses;
  const enough = rs.length >= MIN_GROUP;
  const summarise = (rows: typeof rs) => qs.map((q, i) => {
    if (q.kind === "text") return { kind: q.kind, text: q.text, answers: enough && rows === rs ? rows.map((r) => String((r.answers as unknown[])[i] ?? "")).filter(Boolean) : [] };
    const v = rows.map((r) => Number((r.answers as unknown[])[i])).filter(Number.isFinite);
    if (q.kind === "nps") { const pro = v.filter((x) => x >= 9).length, det = v.filter((x) => x <= 6).length; return { kind: q.kind, text: q.text, n: v.length, enps: v.length ? Math.round(((pro - det) / v.length) * 100) : null }; }
    return { kind: q.kind, text: q.text, n: v.length, avg: v.length ? Math.round((v.reduce((a, x) => a + x, 0) / v.length) * 10) / 10 : null };
  });
  const byDept = new Map<string, typeof rs>();
  for (const r of rs) byDept.set(r.dept || "No department", [...(byDept.get(r.dept || "No department") ?? []), r]);
  await audit(me, "Survey results opened", s.title);
  return {
    id: s.id, title: s.title, anonymous: s.anonymous, open: open(s), responses: rs.length, minGroup: MIN_GROUP,
    overall: enough ? summarise(rs) : null,
    depts: [...byDept.entries()].map(([name, rows]) => ({ name, n: rows.length, results: rows.length >= MIN_GROUP ? summarise(rows) : null })),
    // Named surveys can show who answered; anonymous ones never can.
    respondents: s.anonymous ? null : (await db.staffUser.findMany({ where: { id: { in: rs.map((r) => r.staffId!).filter(Boolean) } }, select: { name: true } })).map((u) => u.name),
  };
}

export async function surveysAdmin(me: Me) {
  need(me, "employees");
  const rows = await db.hrSurvey.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { responses: true } } } });
  return rows.map((r) => ({ id: r.id, title: r.title, anonymous: r.anonymous, dept: r.dept, open: open(r), closesOn: r.closesOn.toISOString(), responses: r._count.responses }));
}
