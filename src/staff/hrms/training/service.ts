import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { getObject, putObject } from "@/server/storage";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { TOUR_VIDEOS, partUrl, VIDEO_BASE } from "@/data/tour-videos";
import { audit, can, holders, need, notify, roleOf, type Me } from "../auth";
import { standardCourse } from "./content";
import { creditSlide, creditVideo, evaluate, grade, scorePractical, type EvalInput } from "./scoring";
import { DEFAULT_TRAINING_SETTINGS, PROGRAMME_SLUG, RUBRICS, SEG, practicalLabel, rubricMax, segCount, type LessonContent, type PracticalKind, type Resource, type Slide, type TrainingSettings } from "./shared";

// Sales Training Academy. HR (the "training" module) installs and edits the course, schedules batches and approves
// certificates; a batch's trainer marks attendance, scores practicals and recommends; an assigned employee learns.
// Learning evidence (video segments, slide time, graded attempts) is recorded only here, never trusted from the browser.

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const manager = (me: Me) => can(me, "training");
export function needManager(me: Me) { need(me, "training"); }

// ── Settings
export async function trainingSettings(): Promise<TrainingSettings> {
  const v = ((await db.hrSetting.findUnique({ where: { key: "training" } }))?.value ?? {}) as Partial<TrainingSettings>;
  return { ...DEFAULT_TRAINING_SETTINGS, ...v };
}
const pct = z.coerce.number().int().min(1).max(100);
const settingsSchema = z.object({
  passPct: pct, productQuizPct: pct, lessonQuizPct: pct, practicalPassPct: pct,
  maxAttempts: z.coerce.number().int().min(1).max(10), maxPracticalAttempts: z.coerce.number().int().min(1).max(10),
  hrApproval: z.boolean(), attendanceRequired: z.boolean(), minSlideSeconds: z.coerce.number().int().min(3).max(120),
  pricingNote: z.string().max(2000), signatory: z.string().max(80), autoEnrol: z.boolean(),
});
/** Assessment rules belong to the super admin; HR may change the approved pricing note and the signatory. */
export async function saveTrainingSettings(me: Me, raw: unknown) {
  needManager(me);
  const cur = await trainingSettings();
  const next = settingsSchema.parse(raw);
  const rules: (keyof TrainingSettings)[] = ["passPct", "productQuizPct", "lessonQuizPct", "practicalPassPct", "maxAttempts", "maxPracticalAttempts", "hrApproval", "attendanceRequired", "minSlideSeconds"];
  const changed = rules.filter((k) => next[k] !== cur[k]);
  if (changed.length && me.role !== "admin") throw new UserError("Only the super admin can change assessment rules. You can change the approved pricing note and the signatory.");
  await db.hrSetting.upsert({ where: { key: "training" }, create: { key: "training", value: json(next) }, update: { value: json(next) } });
  await audit(me, "Training · Settings saved", changed.length ? `rules: ${changed.join(", ")}` : "pricing note / signatory");
}

// ── Programme and content
export const programme = () => db.trProgramme.findUnique({ where: { slug: PROGRAMME_SLUG } });
async function needProgramme() {
  const p = await programme();
  if (!p) throw new UserError("The Sales Academy course isn’t installed yet. HR installs it from Sales Academy → Overview.");
  return p;
}

/** Installs the standard course, or adds the parts that are missing (matched by slug). HR edits are never overwritten. */
export async function installStandardCourse(me: Me) {
  needManager(me);
  const added = await installCourse(me.id);
  await audit(me, "Training · Standard course installed", JSON.stringify(added));
  return added;
}
/** The install itself. One at a time across every server (a database lock), so two first visits can't both install. */
async function installCourse(byId: string) {
  const c = standardCourse();
  const added = { modules: 0, lessons: 0, questions: 0, scenarios: 0, sessions: 0 };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('medoro-sales-academy-install'))`;
    const p = (await tx.trProgramme.findUnique({ where: { slug: c.slug } })) ?? (await tx.trProgramme.create({ data: { slug: c.slug, title: c.title, description: c.description } }));
    if (!(await tx.trSession.count({ where: { programmeId: p.id } }))) {
      await tx.trSession.createMany({ data: c.sessions.map((s, k) => ({ programmeId: p.id, order: k, start: s.start, end: s.end, title: s.title, kind: s.kind, moduleSlug: s.moduleSlug ?? "" })) });
      added.sessions = c.sessions.length;
    }
    const lessonIds = new Map<string, string>();
    for (const [mi, m] of c.modules.entries()) {
      let mod = await tx.trModule.findUnique({ where: { programmeId_slug: { programmeId: p.id, slug: m.slug } } });
      if (!mod) { mod = await tx.trModule.create({ data: { programmeId: p.id, order: mi, slug: m.slug, title: m.title, kind: m.kind, description: m.description } }); added.modules++; }
      for (const [li, l] of m.lessons.entries()) {
        let les = await tx.trLesson.findUnique({ where: { moduleId_slug: { moduleId: mod.id, slug: l.slug } } });
        if (!les) {
          const part = l.video ? TOUR_VIDEOS.find((v) => v.slug === l.video!.ref) : undefined;
          les = await tx.trLesson.create({ data: {
            programmeId: p.id, moduleId: mod.id, order: li, slug: l.slug, title: l.title, summary: l.summary, mandatory: l.mandatory ?? true, durationMin: l.durationMin,
            videoKind: l.video ? "official" : "none", videoRef: l.video?.ref ?? "", videoSeconds: part?.seconds ?? 0, completionPct: 90,
            slides: json(l.slides), transcript: l.transcript ?? l.slides.map((s) => s.narration).join("\n\n"), content: json(l.content), updatedById: byId,
          } });
          added.lessons++;
          await tx.trQuestion.createMany({ data: l.quiz.map((q, k) => ({ programmeId: p.id, scope: "lesson", lessonId: les!.id, area: q.area ?? "product", order: k, prompt: q.prompt, options: json(q.options), answer: q.answer, explanation: q.explanation })) });
          added.questions += l.quiz.length;
        }
        lessonIds.set(l.slug, les.id);
      }
    }
    if (!(await tx.trQuestion.count({ where: { programmeId: p.id, scope: "product" } }))) {
      await tx.trQuestion.createMany({ data: c.productQuiz.map((q, k) => ({ programmeId: p.id, scope: "product", lessonId: lessonIds.get(q.lessonSlug) ?? null, area: "product", order: k, prompt: q.prompt, options: json(q.options), answer: q.answer, explanation: q.explanation })) });
      added.questions += c.productQuiz.length;
    }
    if (!(await tx.trQuestion.count({ where: { programmeId: p.id, scope: "final" } }))) {
      await tx.trQuestion.createMany({ data: c.finalExam.map((q, k) => ({ programmeId: p.id, scope: "final", area: q.area ?? "communication", order: k, prompt: q.prompt, options: json(q.options), answer: q.answer, explanation: q.explanation })) });
      added.questions += c.finalExam.length;
    }
    for (const [k, s] of c.scenarios.entries()) {
      if (await tx.trScenario.findUnique({ where: { programmeId_slug: { programmeId: p.id, slug: s.slug } } })) continue;
      await tx.trScenario.create({ data: { programmeId: p.id, order: k, slug: s.slug, title: s.title, persona: s.persona, situation: s.situation, script: json(s.script), goals: json(s.goals) } });
      added.scenarios++;
    }
  }, { timeout: 60_000 });
  return added;
}

// ── Automatic: the course installs itself, and the sales team is enrolled without HR doing anything
const SYSTEM = { id: null, name: "System (automatic)" };
let installed = false; // per server instance: once the programme exists, stop checking
/** Makes sure the standard course exists. Cheap after the first call on a server; never throws into a page. */
export async function ensureAcademy() {
  if (installed) return true;
  try {
    if (!(await programme())) {
      const added = await installCourse("");
      if (added.lessons) await audit(SYSTEM, "Training · Standard course installed automatically", JSON.stringify(added));
    }
    installed = true;
  } catch (e) {
    log.error("sales academy auto-install failed", { err: e });
  }
  return installed;
}
const AUTO_BATCH_KEY = "trainingAutoBatch";
const autoBatchId = async () => ((await db.hrSetting.findUnique({ where: { key: AUTO_BATCH_KEY } }))?.value as { id?: string } | undefined)?.id ?? "";
/** The batch new sales employees join automatically ("self-paced"; HR can move people into dated batches). */
async function autoBatch(programmeId: string) {
  const saved = (await db.hrSetting.findUnique({ where: { key: AUTO_BATCH_KEY } }))?.value as { id?: string } | undefined;
  const found = saved?.id ? await db.trBatch.findUnique({ where: { id: saved.id } }) : null;
  if (found && found.programmeId === programmeId) return found;
  const b = await db.trBatch.create({ data: { programmeId, name: "Sales Academy · self-paced", trainingDate: dateOnly(todayISO()), trainerId: "", note: "Every sales employee joins this batch automatically. HR reviews practicals until a trainer is set; move people into a dated batch with a trainer when you schedule one.", createdById: "" } });
  await db.hrSetting.upsert({ where: { key: AUTO_BATCH_KEY }, create: { key: AUTO_BATCH_KEY, value: json({ id: b.id }) }, update: { value: json({ id: b.id }) } });
  await audit(SYSTEM, "Training · Self-paced batch created");
  return b;
}
/**
 * Enrols active sales employees (Sales role or Sales department) who aren't in the programme yet: everyone, or just the
 * listed people. Skipped when HR switched automatic enrolment off. Returns how many were enrolled.
 */
export async function autoEnrol(only?: string[]) {
  try {
    if (!(await trainingSettings()).autoEnrol) return 0;
    if (!(await ensureAcademy())) return 0;
    const p = await programme();
    if (!p) return 0;
    const people = (await staffRows(only)).filter((s) => s.status === "active" && isSalesPerson(s));
    if (!people.length) return 0;
    const have = new Set((await db.trAssignment.findMany({ where: { programmeId: p.id, staffId: { in: people.map((x) => x.id) } }, select: { staffId: true } })).map((a) => a.staffId));
    const todo = people.filter((x) => !have.has(x.id));
    if (!todo.length) return 0;
    const b = await autoBatch(p.id);
    const r = await db.trAssignment.createMany({ data: todo.map((x) => ({ batchId: b.id, programmeId: p.id, staffId: x.id, createdById: "" })), skipDuplicates: true });
    if (r.count) {
      await notify(todo.map((x) => x.id), "The Medoro Sales Training Academy is now in your HRMS. Open My Sales Training to start.", "training");
      await audit(SYSTEM, "Training · Sales employees enrolled automatically", todo.map((x) => x.name).join(", ").slice(0, 900));
    }
    return r.count;
  } catch (e) {
    log.error("sales academy auto-enrol failed", { err: e });
    return 0;
  }
}
/** Whether this signed-in person should be enrolled automatically (checked on each page; cheap). */
export const isSalesMe = (me: Me) => me.role === "sales" || me.dept.trim().toLowerCase() === "sales";

const slideSchema = z.object({ title: z.string().trim().min(1, "Every slide needs a title.").max(160), bullets: z.array(z.string().trim().max(600)).max(12), narration: z.string().max(4000) });
const lessonSchema = z.object({
  title: z.string().trim().min(2).max(160), summary: z.string().max(600), mandatory: z.boolean(), status: z.enum(["draft", "published"]),
  order: z.coerce.number().int().min(0).max(999), durationMin: z.coerce.number().int().min(1).max(240),
  videoKind: z.enum(["none", "official", "file", "youtube"]), videoRef: z.string().trim().max(500), videoSeconds: z.coerce.number().int().min(0).max(14_400),
  completionPct: z.coerce.number().int().min(50).max(100),
  slides: z.array(slideSchema).max(40), transcript: z.string().max(40_000), content: z.record(z.string(), z.unknown()),
});
const YT = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/;
/** Videos must be playable under the site's content-security policy: this site, the configured video host, or YouTube. */
function cleanVideo(kind: string, ref: string) {
  if (kind === "none") return "";
  if (kind === "official") { if (!TOUR_VIDEOS.some((v) => v.kind === "part" && v.slug === ref)) throw new UserError("Choose one of the 26 official tour parts."); return ref; }
  if (kind === "youtube") { const m = ref.match(YT); if (!m) throw new UserError("Paste a YouTube link or its 11-character video ID."); return m[1] ?? m[2]; }
  const base = VIDEO_BASE.startsWith("http") ? new URL(VIDEO_BASE).origin : "";
  if (!/\.(mp4|webm)(\?|$)/i.test(ref)) throw new UserError("Link an MP4 or WebM video file.");
  if (ref.startsWith("/") && !ref.startsWith("//")) return ref;
  if (base && ref.startsWith(base + "/")) return ref;
  throw new UserError(`Videos must be on this site (a path starting with /)${base ? ` or on ${base}` : ""}, or on YouTube. Other hosts are blocked by the security policy.`);
}
export async function saveLesson(me: Me, id: string, raw: unknown) {
  needManager(me);
  const i = lessonSchema.parse(raw);
  const videoRef = cleanVideo(i.videoKind, i.videoRef);
  if (i.status === "published" && i.videoKind === "none" && i.slides.length === 0) throw new UserError("A published lesson needs slides or a video.");
  const cur = await db.trLesson.findUnique({ where: { id } });
  if (!cur) throw new UserError("Lesson not found.");
  const official = i.videoKind === "official" ? TOUR_VIDEOS.find((v) => v.slug === videoRef)?.seconds ?? 0 : 0;
  await db.$transaction([
    db.trLessonVersion.create({ data: { lessonId: id, version: cur.version, byId: me.id, data: json({ title: cur.title, summary: cur.summary, mandatory: cur.mandatory, status: cur.status, order: cur.order, durationMin: cur.durationMin, videoKind: cur.videoKind, videoRef: cur.videoRef, videoSeconds: cur.videoSeconds, completionPct: cur.completionPct, slides: cur.slides, transcript: cur.transcript, content: cur.content }) } }),
    db.trLesson.update({ where: { id }, data: { ...i, videoRef, videoSeconds: official || i.videoSeconds, slides: json(i.slides), content: json(i.content), version: cur.version + 1, updatedById: me.id } }),
  ]);
  await audit(me, "Training · Lesson edited", `${cur.title} → v${cur.version + 1}`);
}
export async function lessonVersions(me: Me, lessonId: string) {
  needManager(me);
  return (await db.trLessonVersion.findMany({ where: { lessonId }, orderBy: { version: "desc" }, take: 30 })).map((v) => ({ id: v.id, version: v.version, at: v.at.toISOString(), title: String((v.data as { title?: string }).title ?? "") }));
}
export async function restoreVersion(me: Me, versionId: string) {
  needManager(me);
  const v = await db.trLessonVersion.findUnique({ where: { id: versionId } });
  if (!v) throw new UserError("Version not found.");
  await saveLesson(me, v.lessonId, v.data);
  await audit(me, "Training · Lesson version restored", `v${v.version}`);
}
export async function createLesson(me: Me, moduleId: string, title: string) {
  needManager(me);
  const m = await db.trModule.findUnique({ where: { id: moduleId } });
  if (!m) throw new UserError("Module not found.");
  const t = z.string().trim().min(2, "Give the lesson a title.").max(160).parse(title);
  const order = await db.trLesson.count({ where: { moduleId } });
  const slug = `custom-${Date.now().toString(36)}`;
  const l = await db.trLesson.create({ data: { programmeId: m.programmeId, moduleId, order, slug, title: t, status: "draft", updatedById: me.id } });
  await audit(me, "Training · Lesson created", t);
  return { id: l.id };
}
const moduleSchema = z.object({ title: z.string().trim().min(2).max(160), description: z.string().max(1000), order: z.coerce.number().int().min(0).max(999), status: z.enum(["draft", "published"]) });
export async function saveModule(me: Me, id: string | null, raw: unknown) {
  needManager(me);
  const i = moduleSchema.parse(raw);
  if (id) await db.trModule.update({ where: { id }, data: i });
  else { const p = await needProgramme(); await db.trModule.create({ data: { ...i, programmeId: p.id, slug: `custom-${Date.now().toString(36)}`, kind: "sales" } }); }
  await audit(me, id ? "Training · Module edited" : "Training · Module created", i.title);
}
const questionSchema = z.object({
  scope: z.enum(["lesson", "product", "final"]), lessonId: z.string().nullable(), area: z.enum(["product", "communication", "cold_calling", "demo", "objection", "crm", "professionalism"]),
  prompt: z.string().trim().min(5).max(600), options: z.array(z.string().trim().min(1).max(300)).min(2).max(6), answer: z.coerce.number().int().min(0),
  explanation: z.string().max(1000), status: z.enum(["published", "archived"]), order: z.coerce.number().int().min(0).max(999),
});
export async function saveQuestion(me: Me, id: string | null, raw: unknown) {
  needManager(me);
  const i = questionSchema.parse(raw);
  if (i.answer >= i.options.length) throw new UserError("Mark which option is correct.");
  if (i.scope === "lesson" && !i.lessonId) throw new UserError("Choose the lesson this question belongs to.");
  const p = await needProgramme();
  const data = { ...i, lessonId: i.scope === "final" ? null : i.lessonId, options: json(i.options) };
  if (id) await db.trQuestion.update({ where: { id }, data }); else await db.trQuestion.create({ data: { ...data, programmeId: p.id } });
  await audit(me, id ? "Training · Question edited" : "Training · Question added", `${i.scope}: ${i.prompt.slice(0, 60)}`);
}
const scenarioSchema = z.object({
  title: z.string().trim().min(3).max(160), persona: z.string().max(600), situation: z.string().max(1500), status: z.enum(["published", "draft"]),
  script: z.array(z.object({ who: z.enum(["customer", "coach"]), text: z.string().trim().min(1).max(800) })).max(30), goals: z.array(z.string().trim().min(1).max(300)).max(12),
});
export async function saveScenario(me: Me, id: string | null, raw: unknown) {
  needManager(me);
  const i = scenarioSchema.parse(raw);
  const p = await needProgramme();
  const data = { ...i, script: json(i.script), goals: json(i.goals) };
  if (id) await db.trScenario.update({ where: { id }, data });
  else await db.trScenario.create({ data: { ...data, programmeId: p.id, order: await db.trScenario.count({ where: { programmeId: p.id } }), slug: `custom-${Date.now().toString(36)}` } });
  await audit(me, id ? "Training · Scenario edited" : "Training · Scenario added", i.title);
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const sessionsSchema = z.array(z.object({ start: z.string().regex(HHMM, "Use HH:MM times."), end: z.string().regex(HHMM, "Use HH:MM times."), title: z.string().trim().min(2).max(160), kind: z.enum(["session", "quiz", "break", "practical", "assessment"]), moduleSlug: z.string().max(80) })).min(1).max(40);
export async function saveSchedule(me: Me, raw: unknown) {
  needManager(me);
  const rows = sessionsSchema.parse(raw);
  for (const r of rows) if (r.end <= r.start) throw new UserError(`“${r.title}” ends before it starts.`);
  const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start));
  for (let k = 1; k < sorted.length; k++) if (sorted[k].start < sorted[k - 1].end) throw new UserError(`“${sorted[k].title}” overlaps “${sorted[k - 1].title}”.`);
  const p = await needProgramme();
  await db.$transaction([db.trSession.deleteMany({ where: { programmeId: p.id } }), db.trSession.createMany({ data: sorted.map((r, k) => ({ ...r, order: k, programmeId: p.id })) })]);
  await audit(me, "Training · Schedule saved", `${sorted.length} sessions`);
}

const RES_TYPES: Record<string, "pdf" | "pptx"> = { "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx" };
const RES_MAX = (process.env.VERCEL ? 4 : 20) * 1024 * 1024;
export async function uploadResource(me: Me, lessonId: string, form: FormData) {
  needManager(me);
  const l = await db.trLesson.findUnique({ where: { id: lessonId } });
  if (!l) throw new UserError("Lesson not found.");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new UserError("Choose a file.");
  const kind = RES_TYPES[file.type];
  if (!kind) throw new UserError("Upload a PDF or a PowerPoint (.pptx) file.");
  if (file.size > RES_MAX) throw new UserError(`The file is too large (limit ${RES_MAX / 1024 / 1024} MB).`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const magic = kind === "pdf" ? bytes.subarray(0, 5).toString("latin1") === "%PDF-" : bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!magic) throw new UserError("That file isn’t really a " + (kind === "pdf" ? "PDF." : "PowerPoint file."));
  const key = `_hrms/training/${randomBytes(12).toString("hex")}.${kind}`;
  await putObject(key, bytes, file.type);
  const list = (l.resources as Resource[]) ?? [];
  if (list.length >= 10) throw new UserError("A lesson can hold up to 10 files.");
  const name = file.name.replace(/[^\w.\- ()]/g, "").slice(0, 100) || `notes.${kind}`;
  await db.trLesson.update({ where: { id: lessonId }, data: { resources: json([...list, { name, kind, key }]) } });
  await audit(me, "Training · File uploaded", `${l.title}: ${name}`);
}
export async function addResourceLink(me: Me, lessonId: string, name: string, url: string) {
  needManager(me);
  const l = await db.trLesson.findUnique({ where: { id: lessonId } });
  if (!l) throw new UserError("Lesson not found.");
  const u = z.string().trim().url("Paste a full link starting with https://").refine((x) => x.startsWith("https://"), "Links must start with https://").parse(url);
  const list = (l.resources as Resource[]) ?? [];
  await db.trLesson.update({ where: { id: lessonId }, data: { resources: json([...list, { name: z.string().trim().min(1, "Name the link.").max(100).parse(name), kind: "link", url: u }]) } });
  await audit(me, "Training · Link added", `${l.title}: ${u}`);
}
export async function removeResource(me: Me, lessonId: string, index: number) {
  needManager(me);
  const l = await db.trLesson.findUnique({ where: { id: lessonId } });
  if (!l) throw new UserError("Lesson not found.");
  const list = (l.resources as Resource[]) ?? [];
  if (!list[index]) throw new UserError("File not found.");
  await db.trLesson.update({ where: { id: lessonId }, data: { resources: json(list.filter((_, k) => k !== index)) } });
  await audit(me, "Training · File removed", `${l.title}: ${list[index].name}`);
}

// ── Batches and assignments
type StaffRow = { id: string; name: string; empNo: string; status: string; role: string; dept: string; hrRole: string };
async function staffRows(ids?: string[]): Promise<StaffRow[]> {
  const rows = await db.staffUser.findMany({ where: { kind: "team", role: { not: "partner" }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, name: true, empNo: true, status: true, role: true, hr: { select: { role: true, dept: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, empNo: r.empNo, status: r.status, role: r.role, dept: r.hr?.dept ?? "", hrRole: roleOf(r.role, r.hr?.role) }));
}
/** The programme is for the sales team: the Sales role or the Sales department. */
export const isSalesPerson = (s: StaffRow) => s.hrRole === "sales" || s.dept.trim().toLowerCase() === "sales";

const batchSchema = z.object({ name: z.string().trim().min(2, "Name the batch.").max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the training date."), trainerId: z.string(), note: z.string().max(500).default("") });
async function checkTrainer(trainerId: string) {
  const [t] = await staffRows([trainerId]);
  if (!t || t.status !== "active") throw new UserError("Choose an active team member as the trainer.");
  return t;
}
export async function createBatch(me: Me, raw: unknown, staffIds: string[]) {
  needManager(me);
  const i = batchSchema.parse(raw);
  if (!i.trainerId) throw new UserError("Choose a trainer.");
  const p = await needProgramme();
  const trainer = await checkTrainer(i.trainerId);
  const b = await db.trBatch.create({ data: { programmeId: p.id, name: i.name, trainingDate: dateOnly(i.date), trainerId: trainer.id, note: i.note, createdById: me.id } });
  await audit(me, "Training · Batch created", `${i.name} · ${i.date} · trainer ${trainer.name}`);
  await notify([trainer.id], `You are the trainer for the Sales Academy batch “${i.name}” on ${i.date}.`, "trdesk");
  const r = staffIds.length ? await assign(me, b.id, staffIds) : { added: [], skipped: [] };
  return { id: b.id, ...r };
}
export async function updateBatch(me: Me, id: string, raw: unknown, status: "scheduled" | "closed") {
  needManager(me);
  const i = batchSchema.parse(raw);
  const b = await db.trBatch.findUnique({ where: { id } });
  if (!b) throw new UserError("Batch not found.");
  // No trainer is allowed (HR reviews practicals), as on the self-paced batch.
  const trainer = i.trainerId ? await checkTrainer(i.trainerId) : null;
  await db.trBatch.update({ where: { id }, data: { name: i.name, trainingDate: dateOnly(i.date), trainerId: trainer?.id ?? "", note: i.note, status } });
  if (trainer && trainer.id !== b.trainerId) await notify([trainer.id], `You are now the trainer for the Sales Academy batch “${i.name}”.`, "trdesk");
  await audit(me, "Training · Batch updated", `${i.name} · ${i.date} · ${trainer?.name ?? "no trainer"} · ${status}`);
}
/** Adds people to a batch. Only active sales staff; someone in the self-paced batch is moved here; anyone else already assigned is skipped (one assignment per person keeps all their attempts together). */
export async function assign(me: Me, batchId: string, staffIds: string[]) {
  needManager(me);
  const b = await db.trBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new UserError("Batch not found.");
  const ids = [...new Set(z.array(z.string().min(1)).max(200).parse(staffIds))];
  if (!ids.length) throw new UserError("Choose at least one employee.");
  const people = await staffRows(ids);
  const existing = new Map((await db.trAssignment.findMany({ where: { programmeId: b.programmeId, staffId: { in: ids } }, select: { id: true, staffId: true, batchId: true } })).map((a) => [a.staffId, a]));
  const selfPaced = await autoBatchId();
  const added: string[] = [], skipped: { name: string; why: string }[] = [];
  for (const id of ids) {
    const s = people.find((x) => x.id === id);
    if (!s) { skipped.push({ name: id, why: "not found" }); continue; }
    if (s.status !== "active") { skipped.push({ name: s.name, why: "not active" }); continue; }
    if (!isSalesPerson(s)) { skipped.push({ name: s.name, why: "not in the sales team (Sales role or Sales department)" }); continue; }
    if (id === b.trainerId) { skipped.push({ name: s.name, why: "is this batch's trainer" }); continue; }
    const had = existing.get(id);
    if (had) {
      // Someone enrolled automatically moves from the self-paced batch into this one, keeping all their progress.
      if (had.batchId !== selfPaced || batchId === selfPaced) { skipped.push({ name: s.name, why: "already assigned" }); continue; }
      await db.trAssignment.update({ where: { id: had.id }, data: { batchId } });
      added.push(s.name);
      continue;
    }
    try {
      await db.trAssignment.create({ data: { batchId, programmeId: b.programmeId, staffId: id, createdById: me.id } });
      added.push(s.name);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { skipped.push({ name: s.name, why: "already assigned" }); continue; }
      throw e;
    }
  }
  if (added.length) {
    const addedIds = people.filter((p) => added.includes(p.name)).map((p) => p.id);
    await notify(addedIds, `You have been assigned the Medoro Sales Training Academy on ${isoOf(b.trainingDate)}. Open My Sales Training to start.`, "training");
    await audit(me, "Training · Employees assigned", `${b.name}: ${added.join(", ")}`);
  }
  return { added, skipped };
}
export async function moveAssignment(me: Me, assignmentId: string, batchId: string) {
  needManager(me);
  const [a, b] = await Promise.all([db.trAssignment.findUnique({ where: { id: assignmentId } }), db.trBatch.findUnique({ where: { id: batchId } })]);
  if (!a || !b || a.programmeId !== b.programmeId) throw new UserError("Batch not found.");
  if (b.trainerId === a.staffId) throw new UserError("Someone can’t be a participant in a batch they train.");
  await db.trAssignment.update({ where: { id: assignmentId }, data: { batchId } });
  await audit(me, "Training · Participant moved", `${a.staffId} → ${b.name}`);
}
/** Removes an assignment that has no evidence yet. Once someone has learnt, attempted or been evaluated, their history is kept. */
export async function unassign(me: Me, assignmentId: string) {
  needManager(me);
  const a = await db.trAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw new UserError("Assignment not found.");
  const [p, t, x] = await Promise.all([db.trProgress.count({ where: { assignmentId } }), db.trAttempt.count({ where: { assignmentId } }), db.trPractical.count({ where: { assignmentId } })]);
  if (p + t + x > 0) throw new UserError("This person has already started; their training history is kept. Move them to another batch instead.");
  await db.trAssignment.delete({ where: { id: assignmentId } });
  await audit(me, "Training · Participant removed", a.staffId);
}
export async function grantAttempt(me: Me, assignmentId: string) {
  needManager(me);
  const a = await db.trAssignment.update({ where: { id: assignmentId }, data: { extraAttempts: { increment: 1 } } }).catch(() => null);
  if (!a) throw new UserError("Assignment not found.");
  await notify([a.staffId], "HR allowed you one more attempt in the Sales Academy.", "training");
  await audit(me, "Training · Extra attempt granted", a.staffId);
}

// ── Loading an assignment's evidence
async function loadEval(assignmentIds: string[]) {
  if (!assignmentIds.length) return new Map<string, ReturnType<typeof evaluate>>();
  const as = await db.trAssignment.findMany({ where: { id: { in: assignmentIds } } });
  const progIds = [...new Set(as.map((a) => a.programmeId))];
  const [settings, lessons, mods, progress, attempts, practicals, certs] = await Promise.all([
    trainingSettings(),
    db.trLesson.findMany({ where: { programmeId: { in: progIds }, status: "published" }, select: { id: true, mandatory: true, moduleId: true, programmeId: true } }),
    db.trModule.findMany({ where: { programmeId: { in: progIds } }, select: { id: true, kind: true, status: true } }),
    db.trProgress.findMany({ where: { assignmentId: { in: assignmentIds }, completedAt: { not: null } }, select: { assignmentId: true, lessonId: true } }),
    db.trAttempt.findMany({ where: { assignmentId: { in: assignmentIds }, kind: { in: ["product", "final"] } } }),
    db.trPractical.findMany({ where: { assignmentId: { in: assignmentIds } } }),
    db.trCertificate.findMany({ where: { assignmentId: { in: assignmentIds }, revokedAt: null }, select: { assignmentId: true } }),
  ]);
  const active = new Set((await db.trProgress.groupBy({ by: ["assignmentId"], where: { assignmentId: { in: assignmentIds } } })).map((x) => x.assignmentId));
  const modOf = new Map(mods.map((m) => [m.id, m]));
  const out = new Map<string, ReturnType<typeof evaluate>>();
  for (const a of as) {
    const input: EvalInput = {
      settings,
      lessons: lessons.filter((l) => l.programmeId === a.programmeId && modOf.get(l.moduleId)?.status === "published").map((l) => ({ id: l.id, mandatory: l.mandatory, tour: modOf.get(l.moduleId)?.kind === "tour" })),
      completed: new Set(progress.filter((p) => p.assignmentId === a.id).map((p) => p.lessonId)),
      attempts: attempts.filter((t) => t.assignmentId === a.id).map((t) => ({ kind: t.kind, pct: t.pct, passed: t.passed, areas: t.areas as Record<string, [number, number]>, at: t.createdAt.toISOString() })),
      practicals: practicals.filter((p) => p.assignmentId === a.id).map((p) => ({ kind: p.kind, score: p.score, maxScore: p.maxScore, passed: p.passed, evaluatedAt: p.evaluatedAt?.toISOString() ?? null, submittedAt: p.submittedAt.toISOString(), rubric: p.rubric as Record<string, number> })),
      attendance: a.attendance, trainerDecision: a.trainerDecision, hrDecision: a.hrDecision, certified: certs.some((c) => c.assignmentId === a.id), started: active.has(a.id),
    };
    out.set(a.id, evaluate(input));
  }
  return out;
}
export async function evaluationOf(assignmentId: string) {
  const e = (await loadEval([assignmentId])).get(assignmentId);
  if (!e) throw new UserError("Assignment not found.");
  return e;
}

// ── The employee
async function myAssignment(me: Me) {
  const p = await programme();
  if (!p) return null;
  return db.trAssignment.findUnique({ where: { programmeId_staffId: { programmeId: p.id, staffId: me.id } } });
}
async function needMine(me: Me) {
  const a = await myAssignment(me);
  if (!a) throw new UserError("The Sales Academy hasn’t been assigned to you.");
  return a;
}
export const hasAssignment = async (staffId: string) => (await db.trAssignment.count({ where: { staffId } })) > 0;
export const isTrainer = async (staffId: string) => (await db.trBatch.count({ where: { trainerId: staffId } })) > 0;

/** Lesson outline for a learner: published modules and lessons, never question keys. */
async function outline(programmeId: string) {
  const [mods, lessons, qCounts] = await Promise.all([
    db.trModule.findMany({ where: { programmeId, status: "published" }, orderBy: { order: "asc" } }),
    db.trLesson.findMany({ where: { programmeId, status: "published" }, orderBy: { order: "asc" }, select: { id: true, moduleId: true, slug: true, title: true, summary: true, mandatory: true, durationMin: true, videoKind: true, videoRef: true, videoSeconds: true } }),
    db.trQuestion.groupBy({ by: ["lessonId"], where: { programmeId, scope: "lesson", status: "published" }, _count: true }),
  ]);
  const qc = new Map(qCounts.map((q) => [q.lessonId, q._count]));
  return mods.map((m) => ({ id: m.id, slug: m.slug, title: m.title, kind: m.kind, description: m.description, lessons: lessons.filter((l) => l.moduleId === m.id).map((l) => ({ ...l, questions: qc.get(l.id) ?? 0, thumb: l.videoKind === "official" ? `/videos/thumbs/${l.videoRef}.webp` : "" })) }));
}
const attemptRow = (t: { id: string; kind: string; lessonId: string | null; attemptNo: number; score: number; total: number; pct: number; passed: boolean; createdAt: Date }) => ({ id: t.id, kind: t.kind, lessonId: t.lessonId, attemptNo: t.attemptNo, score: t.score, total: t.total, pct: t.pct, passed: t.passed, at: t.createdAt.toISOString() });
const practicalRow = (p: { id: string; kind: string; scenarioId: string | null; attemptNo: number; submission: string; link: string; submittedAt: Date; score: number | null; maxScore: number; passed: boolean | null; feedback: string; evaluatedAt: Date | null; rubric: Prisma.JsonValue }) => ({ id: p.id, kind: p.kind, scenarioId: p.scenarioId, attemptNo: p.attemptNo, submission: p.submission, link: p.link, submittedAt: p.submittedAt.toISOString(), score: p.score, maxScore: p.maxScore, passed: p.passed, feedback: p.feedback, evaluatedAt: p.evaluatedAt?.toISOString() ?? null, rubric: p.rubric as Record<string, number> });

export async function myTraining(me: Me) {
  const a = await myAssignment(me);
  if (!a) return null;
  const [b, p, settings, mods, progress, attempts, practicals, cert, sessions, scenarios] = await Promise.all([
    db.trBatch.findUniqueOrThrow({ where: { id: a.batchId } }), db.trProgramme.findUniqueOrThrow({ where: { id: a.programmeId } }), trainingSettings(), outline(a.programmeId),
    db.trProgress.findMany({ where: { assignmentId: a.id } }), db.trAttempt.findMany({ where: { assignmentId: a.id }, orderBy: { createdAt: "desc" } }),
    db.trPractical.findMany({ where: { assignmentId: a.id }, orderBy: { submittedAt: "desc" } }), db.trCertificate.findUnique({ where: { assignmentId: a.id } }),
    db.trSession.findMany({ where: { programmeId: a.programmeId }, orderBy: { order: "asc" } }),
    db.trScenario.findMany({ where: { programmeId: a.programmeId, status: "published" }, orderBy: { order: "asc" } }),
  ]);
  const trainer = (await staffRows([b.trainerId]))[0];
  const ev = await evaluationOf(a.id);
  // The self-paced batch has no fixed day: its timetable is today's.
  const selfPaced = b.id === (await autoBatchId());
  const day = selfPaced ? todayISO() : isoOf(b.trainingDate);
  const prog = Object.fromEntries(progress.map((x) => [x.lessonId, { done: !!x.completedAt, lastPos: x.lastPos, watched: x.segs ? Math.round((x.segs.split("").filter((c) => c === "1").length / Math.max(1, x.segs.length)) * 100) : 0, seconds: x.seconds }]));
  const used = (k: string) => attempts.filter((t) => t.kind === k).length;
  return {
    me: { name: me.name },
    assignment: { id: a.id, attendance: a.attendance, trainerFeedback: a.trainerFeedback, trainerDecision: a.trainerDecision, hrDecision: a.hrDecision, decisionNote: a.decisionNote },
    batch: { name: b.name, date: day, selfPaced, trainer: trainer?.name ?? (b.trainerId ? "" : "HR (no trainer set yet)"), status: b.status, isToday: day === todayISO() },
    programme: { title: p.title, description: p.description },
    settings: { passPct: settings.passPct, productQuizPct: settings.productQuizPct, lessonQuizPct: settings.lessonQuizPct, practicalPassPct: settings.practicalPassPct, hrApproval: settings.hrApproval, pricingNote: settings.pricingNote, attemptsLeft: { product: Math.max(0, settings.maxAttempts + a.extraAttempts - used("product")), final: Math.max(0, settings.maxAttempts + a.extraAttempts - used("final")) }, practicalAttemptsLeft: { mock_call: Math.max(0, settings.maxPracticalAttempts + a.extraAttempts - practicals.filter((x) => x.kind === "mock_call").length), demo: Math.max(0, settings.maxPracticalAttempts + a.extraAttempts - practicals.filter((x) => x.kind === "demo").length) } },
    modules: mods, progress: prog,
    attempts: attempts.map(attemptRow), practicals: practicals.map(practicalRow),
    scenarios: scenarios.map((s) => ({ id: s.id, title: s.title, persona: s.persona, situation: s.situation, script: s.script as { who: string; text: string }[], goals: s.goals as string[] })),
    sessions: sessions.map((s) => ({ start: s.start, end: s.end, title: s.title, kind: s.kind, moduleSlug: s.moduleSlug })),
    evaluation: ev,
    certificate: cert ? { id: cert.id, certNo: cert.certNo, issuedAt: cert.issuedAt.toISOString(), revoked: !!cert.revokedAt, revokedReason: cert.revokedReason, score: cert.score } : null,
  };
}

/** Everything the lesson player needs. Lesson quizzes come without their answers. */
export async function lessonForLearner(me: Me, lessonId: string) {
  const a = await needMine(me);
  const l = await db.trLesson.findFirst({ where: { id: lessonId, programmeId: a.programmeId, status: "published" } });
  if (!l) throw new UserError("Lesson not found.");
  const [mod, progress, questions, attempts, settings] = await Promise.all([
    db.trModule.findUnique({ where: { id: l.moduleId } }), db.trProgress.findUnique({ where: { assignmentId_lessonId: { assignmentId: a.id, lessonId } } }),
    db.trQuestion.findMany({ where: { lessonId, scope: "lesson", status: "published" }, orderBy: { order: "asc" } }),
    db.trAttempt.findMany({ where: { assignmentId: a.id, kind: "lesson", lessonId }, orderBy: { createdAt: "desc" } }), trainingSettings(),
  ]);
  if (mod?.status !== "published") throw new UserError("Lesson not found.");
  return { ...lessonPublic(l, settings.minSlideSeconds), module: mod.title, progress: progressPublic(l, progress, settings.minSlideSeconds), questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options as string[] })), attempts: attempts.map(attemptRow), quizPct: settings.lessonQuizPct };
}
type LessonRow = NonNullable<Awaited<ReturnType<typeof db.trLesson.findUnique>>>;
export function lessonPublic(l: LessonRow, minSlide: number) {
  const slides = (l.slides as Slide[]) ?? [];
  const video = l.videoKind === "official" ? { kind: "file" as const, src: partUrl(l.videoRef), official: true } : l.videoKind === "file" ? { kind: "file" as const, src: l.videoRef, official: false } : l.videoKind === "youtube" ? { kind: "youtube" as const, src: l.videoRef, official: false } : null;
  return {
    id: l.id, title: l.title, summary: l.summary, mandatory: l.mandatory, durationMin: l.durationMin, version: l.version, video, videoSeconds: l.videoSeconds, completionPct: l.completionPct,
    slides, transcript: l.transcript, content: l.content as LessonContent, resources: ((l.resources as Resource[]) ?? []).map((r, k) => ({ name: r.name, kind: r.kind, href: r.kind === "link" ? r.url! : `/staff/hrms/training/file/${l.id}/${k}` })),
    slideNeeds: creditSlide([], slides, -1, 0, minSlide).need, thumb: l.videoKind === "official" ? `/videos/thumbs/${l.videoRef}.webp` : "",
  };
}
function progressPublic(l: LessonRow, p: Awaited<ReturnType<typeof db.trProgress.findUnique>>, minSlide: number) {
  const slides = (l.slides as Slide[]) ?? [];
  const s = creditSlide((p?.slideSecs as number[]) ?? [], slides, -1, 0, minSlide);
  const n = segCount(l.videoSeconds || 1), segs = p?.segs ?? "";
  return { done: !!p?.completedAt, lastPos: p?.lastPos ?? 0, watchedPct: l.videoSeconds ? Math.round((segs.split("").filter((c) => c === "1").length / n) * 100) : 0, slideSecs: s.secs, slidesSeen: s.seen, slidesPct: s.pct, seconds: p?.seconds ?? 0 };
}

const beatSchema = z.object({ lessonId: z.string().min(1), mode: z.enum(["video", "slides"]), pos: z.number().min(0).max(14_400), playing: z.boolean(), visible: z.boolean(), duration: z.number().min(0).max(14_400).optional() });
const MAX_CREDIT = 30; // seconds a single heartbeat can ever add

/**
 * A learning heartbeat (every ~10 s while a lesson is open). The server credits only the time that has really passed
 * since the last heartbeat, only while the video plays (or a slide is on screen) in a visible tab, and only for video
 * actually played through: jumping ahead marks nothing. A lesson completes when the evidence meets its threshold and its
 * quiz is passed.
 */
export async function beat(me: Me, raw: unknown) {
  const i = beatSchema.parse(raw);
  const a = await needMine(me);
  const l = await db.trLesson.findFirst({ where: { id: i.lessonId, programmeId: a.programmeId, status: "published" } });
  if (!l) throw new UserError("Lesson not found.");
  const settings = await trainingSettings();
  const now = new Date();
  const p = await db.trProgress.upsert({ where: { assignmentId_lessonId: { assignmentId: a.id, lessonId: l.id } }, create: { assignmentId: a.id, lessonId: l.id }, update: {} });
  const elapsed = p.lastBeatAt ? (now.getTime() - p.lastBeatAt.getTime()) / 1000 : 0;
  const credit = i.playing && i.visible ? Math.max(0, Math.min(elapsed, MAX_CREDIT)) : 0;
  let videoSeconds = l.videoSeconds;
  // A linked video whose length HR didn't enter: learn it once from the player.
  if (!videoSeconds && i.mode === "video" && i.duration && i.duration > 5 && l.videoKind !== "official") {
    videoSeconds = Math.round(i.duration);
    await db.trLesson.update({ where: { id: l.id }, data: { videoSeconds } });
  }
  const data: Prisma.TrProgressUpdateInput = { lastBeatAt: now, seconds: { increment: Math.round(credit) } };
  let watchOk = false;
  if (i.mode === "video" && l.videoKind !== "none" && videoSeconds) {
    const r = creditVideo(p.segs, videoSeconds, p.lastPos, Math.min(i.pos, videoSeconds), credit);
    data.segs = r.segs; data.lastPos = i.pos >= videoSeconds - SEG ? 0 : i.pos;
    watchOk = r.watchedPct >= l.completionPct;
  } else if (i.mode === "slides") {
    const slides = (l.slides as Slide[]) ?? [];
    const unit = Math.round(i.pos);
    const r = creditSlide((p.slideSecs as number[]) ?? [], slides, unit, credit, settings.minSlideSeconds);
    data.slideSecs = json(r.secs); data.lastPos = Math.max(0, Math.min(unit, slides.length - 1));
    watchOk = l.videoKind === "none" && r.done;
  }
  const updated = await db.trProgress.update({ where: { id: p.id }, data });
  if (!updated.completedAt) await maybeComplete(a.id, l, settings, watchOk ? true : undefined);
  return { ...progressPublic(l, await db.trProgress.findUnique({ where: { id: p.id } }), settings.minSlideSeconds) };
}
/** Evidence met? Then the lesson quiz decides. */
async function evidenceMet(l: LessonRow, p: { segs: string; slideSecs: Prisma.JsonValue }, minSlide: number) {
  if (l.videoKind !== "none" && l.videoSeconds) {
    const n = segCount(l.videoSeconds);
    return Math.round((p.segs.split("").filter((c) => c === "1").length / n) * 100) >= l.completionPct;
  }
  return creditSlide((p.slideSecs as number[]) ?? [], (l.slides as Slide[]) ?? [], -1, 0, minSlide).done;
}
async function maybeComplete(assignmentId: string, l: LessonRow, settings: TrainingSettings, watchOk?: boolean) {
  const p = await db.trProgress.findUnique({ where: { assignmentId_lessonId: { assignmentId, lessonId: l.id } } });
  if (!p || p.completedAt) return;
  const ok = watchOk ?? (await evidenceMet(l, p, settings.minSlideSeconds));
  if (!ok) return;
  const qs = await db.trQuestion.count({ where: { lessonId: l.id, scope: "lesson", status: "published" } });
  if (qs) {
    const passed = await db.trAttempt.count({ where: { assignmentId, kind: "lesson", lessonId: l.id, passed: true } });
    if (!passed) return;
  }
  await db.trProgress.update({ where: { id: p.id }, data: { completedAt: new Date() } });
}

const quizSchema = z.object({ kind: z.enum(["lesson", "product", "final"]), lessonId: z.string().optional(), answers: z.record(z.string(), z.number().int()) });
/** Questions for the product quiz or the final exam (no answers), if this person may take it now. */
export async function examForLearner(me: Me, kind: "product" | "final") {
  const a = await needMine(me);
  await examGate(a, kind);
  const qs = await db.trQuestion.findMany({ where: { programmeId: a.programmeId, scope: kind, status: "published" }, orderBy: { order: "asc" } });
  return qs.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options as string[] }));
}
async function examGate(a: { id: string; programmeId: string; extraAttempts: number }, kind: "product" | "final") {
  const settings = await trainingSettings();
  const ev = await evaluationOf(a.id);
  if (ev.status === "certified") throw new UserError("You are already certified.");
  if (kind === "product" && ev.tourDone < ev.tourTotal) throw new UserError(`Finish the official product tour first (${ev.tourDone}/${ev.tourTotal} chapters).`);
  if (kind === "final" && ev.lessonsDone < ev.lessonsTotal) throw new UserError(`Finish all mandatory lessons first (${ev.lessonsDone}/${ev.lessonsTotal}).`);
  const used = await db.trAttempt.count({ where: { assignmentId: a.id, kind } });
  if (used >= settings.maxAttempts + a.extraAttempts) throw new UserError("No attempts left. HR can allow a retest under company policy.");
  if (kind === "product" && ev.product && ev.product.pct >= settings.productQuizPct) throw new UserError("You have already passed the product knowledge quiz.");
  return { settings, used };
}
export async function submitQuiz(me: Me, raw: unknown) {
  const i = quizSchema.parse(raw);
  const a = await needMine(me);
  const settings = await trainingSettings();
  let lesson: LessonRow | null = null, attemptNo = 1;
  if (i.kind === "lesson") {
    lesson = await db.trLesson.findFirst({ where: { id: i.lessonId ?? "", programmeId: a.programmeId, status: "published" } });
    if (!lesson) throw new UserError("Lesson not found.");
    attemptNo = (await db.trAttempt.count({ where: { assignmentId: a.id, kind: "lesson", lessonId: lesson.id } })) + 1;
  } else attemptNo = (await examGate(a, i.kind)).used + 1;
  const qs = await db.trQuestion.findMany({ where: i.kind === "lesson" ? { lessonId: lesson!.id, scope: "lesson", status: "published" } : { programmeId: a.programmeId, scope: i.kind, status: "published" }, orderBy: { order: "asc" } });
  if (!qs.length) throw new UserError("This quiz has no questions yet.");
  let g: ReturnType<typeof grade>;
  try { g = grade(qs.map((q) => ({ id: q.id, area: q.area, answer: q.answer, options: q.options as unknown[] })), i.answers); }
  catch { throw new UserError("Answer every question before submitting."); }
  const passMark = i.kind === "lesson" ? settings.lessonQuizPct : i.kind === "product" ? settings.productQuizPct : settings.passPct;
  const passed = g.pct >= passMark;
  const t = await db.trAttempt.create({ data: { assignmentId: a.id, kind: i.kind, lessonId: lesson?.id ?? null, attemptNo, answers: json(g.answers), score: g.score, total: g.total, pct: g.pct, passed, areas: json(g.areas) } });
  if (lesson && passed) await maybeComplete(a.id, lesson, settings);
  if (i.kind !== "lesson") await audit(me, `Training · ${i.kind === "product" ? "Product quiz" : "Final exam"} attempt`, `#${attemptNo}: ${g.pct}%`);
  return {
    id: t.id, score: g.score, total: g.total, pct: g.pct, passed, passMark,
    review: qs.map((q, k) => ({ prompt: q.prompt, options: q.options as string[], chose: g.answers[k].chose, answer: q.answer, correct: g.answers[k].correct, explanation: q.explanation })),
  };
}
/** A past attempt with its answers and explanations, for the person who took it (or their trainer / HR). */
export async function attemptReview(me: Me, attemptId: string) {
  const t = await db.trAttempt.findUnique({ where: { id: attemptId } });
  if (!t) throw new UserError("Attempt not found.");
  await canSee(me, t.assignmentId);
  const answers = t.answers as { q: string; chose: number; correct: boolean }[];
  const qs = await db.trQuestion.findMany({ where: { id: { in: answers.map((x) => x.q) } } });
  return { ...attemptRow(t), review: answers.map((x) => { const q = qs.find((y) => y.id === x.q); return { prompt: q?.prompt ?? "(question removed)", options: (q?.options as string[]) ?? [], chose: x.chose, answer: q?.answer ?? -1, correct: x.correct, explanation: q?.explanation ?? "" }; }) };
}

const practicalSchema = z.object({ kind: z.enum(["mock_call", "demo"]), scenarioId: z.string().optional(), submission: z.string().trim().min(40, "Write what you did on the call or demo (at least a few lines).").max(6000), link: z.string().trim().max(500).default("") });
export async function submitPractical(me: Me, raw: unknown) {
  const i = practicalSchema.parse(raw);
  const a = await needMine(me);
  const settings = await trainingSettings();
  const ev = await evaluationOf(a.id);
  if (ev.status === "certified") throw new UserError("You are already certified.");
  if (i.link && !/^https:\/\//.test(i.link)) throw new UserError("A recording link must start with https://");
  if (i.kind === "mock_call") {
    const sc = await db.trScenario.findFirst({ where: { id: i.scenarioId ?? "", programmeId: a.programmeId, status: "published" } });
    if (!sc) throw new UserError("Choose the role-play scenario you practised.");
  }
  const prev = await db.trPractical.findMany({ where: { assignmentId: a.id, kind: i.kind } });
  if (prev.some((p) => !p.evaluatedAt)) throw new UserError("Your last submission is still waiting for the trainer.");
  if (prev.some((p) => p.passed)) throw new UserError(`You have already passed the ${practicalLabel(i.kind).toLowerCase()}.`);
  if (prev.length >= settings.maxPracticalAttempts + a.extraAttempts) throw new UserError("No attempts left. HR can allow a retake under company policy.");
  await db.trPractical.create({ data: { assignmentId: a.id, kind: i.kind, scenarioId: i.kind === "mock_call" ? i.scenarioId! : null, attemptNo: prev.length + 1, submission: i.submission, link: i.link, maxScore: rubricMax(i.kind) } });
  const b = await db.trBatch.findUniqueOrThrow({ where: { id: a.batchId } });
  // No trainer on the batch yet (the self-paced batch): HR with the training module scores it.
  const reviewers = b.trainerId ? [b.trainerId] : (await holders("training")).filter((x) => x !== me.id);
  await notify(reviewers, `${me.name} submitted the ${practicalLabel(i.kind).toLowerCase()} for review.`, b.trainerId ? "trdesk" : "academy");
}

// ── Trainer and HR
/** Who may see an assignment: the person, the batch's trainer, or HR with the training module. */
async function canSee(me: Me, assignmentId: string) {
  const a = await db.trAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw new UserError("Not found.");
  if (a.staffId === me.id || manager(me)) return a;
  const b = await db.trBatch.findUnique({ where: { id: a.batchId } });
  if (b?.trainerId === me.id) return a;
  throw new UserError("Not found.");
}
async function needTrainerOf(me: Me, assignmentId: string) {
  const a = await db.trAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw new UserError("Not found.");
  if (a.staffId === me.id) throw new UserError("You can’t assess or approve your own training.");
  const b = await db.trBatch.findUniqueOrThrow({ where: { id: a.batchId } });
  if (b.trainerId !== me.id && !manager(me)) throw new UserError("Only this batch’s trainer or HR can do that.");
  return { a, b };
}
export async function markAttendance(me: Me, assignmentId: string, value: "present" | "absent" | "") {
  const v = z.enum(["present", "absent", ""]).parse(value);
  const { a } = await needTrainerOf(me, assignmentId);
  await db.trAssignment.update({ where: { id: a.id }, data: { attendance: v, attendanceById: me.id, attendanceAt: new Date() } });
  await audit(me, "Training · Attendance", `${a.staffId}: ${v || "cleared"}`);
}
export async function evaluatePractical(me: Me, practicalId: string, rubric: Record<string, number>, feedback: string) {
  const x = await db.trPractical.findUnique({ where: { id: practicalId } });
  if (!x) throw new UserError("Submission not found.");
  const { a } = await needTrainerOf(me, x.assignmentId);
  if (x.evaluatedAt) throw new UserError("This submission has already been scored. The employee can submit a new attempt.");
  const settings = await trainingSettings();
  let r: ReturnType<typeof scorePractical>;
  try { r = scorePractical(x.kind as PracticalKind, rubric, settings.practicalPassPct); } catch (e) { throw new UserError((e as Error).message); }
  const fb = z.string().trim().min(10, "Write feedback for the employee (what went well, what to improve).").max(3000).parse(feedback);
  await db.trPractical.update({ where: { id: x.id, evaluatedAt: null }, data: { rubric: json(r.rubric), score: r.score, maxScore: r.max, passed: r.passed, feedback: fb, evaluatorId: me.id, evaluatedAt: new Date() } });
  await notify([a.staffId], `Your ${practicalLabel(x.kind).toLowerCase()} was scored: ${r.score}/${r.max}${r.passed ? " (passed)" : " (not passed yet)"}.`, "training");
  await audit(me, "Training · Practical scored", `${a.staffId} · ${x.kind} #${x.attemptNo}: ${r.score}/${r.max}`);
}
/** The trainer's recommendation. Approval needs every requirement met; a rejection needs a reason. */
export async function trainerDecide(me: Me, assignmentId: string, approve: boolean, feedback: string) {
  const { a } = await needTrainerOf(me, assignmentId);
  const fb = z.string().trim().max(3000).parse(feedback);
  const ev = await evaluationOf(a.id);
  if (ev.status === "certified") throw new UserError("Already certified.");
  if (approve && !ev.ready) throw new UserError(`Not ready yet: ${ev.req.filter((r) => !r.ok).map((r) => r.label.toLowerCase()).join("; ")}.`);
  if (!approve && fb.length < 10) throw new UserError("Say why, so the employee knows what to work on.");
  await db.trAssignment.update({ where: { id: a.id }, data: { trainerDecision: approve ? "approved" : "rejected", trainerFeedback: fb, trainerById: me.id, trainerAt: new Date(), hrDecision: "", hrById: "", hrAt: null } });
  await audit(me, approve ? "Training · Trainer approved" : "Training · Trainer did not approve", `${a.staffId} · score ${ev.score}`);
  const settings = await trainingSettings();
  if (approve && settings.hrApproval) {
    await notify((await holders("training")).filter((x) => x !== a.staffId), "A Sales Academy certificate is waiting for HR approval.", "academy");
  }
  if (!approve) await notify([a.staffId], "Your trainer left feedback on your Sales Academy training.", "training");
  return issueIfEligible(me, a.id);
}
/** Lets someone who wasn't approved continue: clears the decisions (evidence stays). */
export async function reopen(me: Me, assignmentId: string) {
  const { a } = await needTrainerOf(me, assignmentId);
  if (await db.trCertificate.findFirst({ where: { assignmentId: a.id, revokedAt: null } })) throw new UserError("Already certified.");
  await db.trAssignment.update({ where: { id: a.id }, data: { trainerDecision: "", hrDecision: "", decisionNote: "" } });
  await audit(me, "Training · Reopened", a.staffId);
}
export async function hrDecide(me: Me, assignmentId: string, approve: boolean, note: string) {
  needManager(me);
  const a = await db.trAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw new UserError("Not found.");
  if (a.staffId === me.id) throw new UserError("You can’t approve your own certificate.");
  if (a.trainerDecision !== "approved") throw new UserError("The trainer hasn’t approved this person yet.");
  const n = z.string().trim().max(1000).parse(note);
  if (!approve && n.length < 10) throw new UserError("Say why the certificate isn’t approved.");
  if (approve) { const ev = await evaluationOf(a.id); if (!ev.ready) throw new UserError("The requirements are no longer all met."); }
  await db.trAssignment.update({ where: { id: a.id }, data: { hrDecision: approve ? "approved" : "rejected", hrById: me.id, hrAt: new Date(), decisionNote: n } });
  await audit(me, approve ? "Training · HR approved" : "Training · HR did not approve", a.staffId);
  if (!approve) await notify([a.staffId], "HR reviewed your Sales Academy certificate. Open My Sales Training for the note.", "training");
  return issueIfEligible(me, a.id);
}

/** Issues the certificate when every rule holds (checked here again), once. */
async function issueIfEligible(me: Me, assignmentId: string) {
  const ev = await evaluationOf(assignmentId);
  if (!ev.eligible) return { issued: false as const };
  const a = await db.trAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
  const [b, p] = await Promise.all([db.trBatch.findUniqueOrThrow({ where: { id: a.batchId } }), db.trProgramme.findUniqueOrThrow({ where: { id: a.programmeId } })]);
  const trainer = (await staffRows([b.trainerId]))[0];
  const year = todayISO().slice(0, 4);
  for (let tries = 0; tries < 5; tries++) {
    try {
      const { cert, created } = await db.$transaction(async (tx: Tx) => {
        const existing = await tx.trCertificate.findUnique({ where: { assignmentId } });
        if (existing) return { cert: existing, created: false }; // issued once; a revoked certificate stays revoked (and on record)
        const n = (await tx.trCertificate.count({ where: { certNo: { startsWith: `MS-STA-${year}-` } } })) + 1 + tries;
        return { cert: await tx.trCertificate.create({ data: { assignmentId, staffId: a.staffId, certNo: `MS-STA-${year}-${String(n).padStart(4, "0")}`, verifyCode: randomBytes(9).toString("base64url"), programmeTitle: p.title, score: ev.score, trainerName: trainer?.name ?? "", completedOn: dateOnly(todayISO()) } }), created: true };
      });
      if (!created) return { issued: !cert.revokedAt, certNo: cert.certNo };
      await notify([a.staffId], `Congratulations! Your Medoro Sales Training Certificate (${cert.certNo}) is ready in My Sales Training.`, "training");
      await audit(me, "Training · Certificate issued", `${cert.certNo} · ${a.staffId} · ${ev.score}/100`);
      return { issued: true as const, certNo: cert.certNo };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new UserError("Couldn’t number the certificate. Try again.");
}
export async function revokeCertificate(me: Me, certId: string, reason: string) {
  needManager(me);
  const r = z.string().trim().min(10, "Give the reason.").max(500).parse(reason);
  const c = await db.trCertificate.findUnique({ where: { id: certId } });
  if (!c || c.revokedAt) throw new UserError("Certificate not found.");
  await db.trCertificate.update({ where: { id: c.id }, data: { revokedAt: new Date(), revokedReason: r } });
  await audit(me, "Training · Certificate revoked", `${c.certNo}: ${r}`);
}

// ── Screens' data
async function participantRows(where: Prisma.TrAssignmentWhereInput) {
  const as = await db.trAssignment.findMany({ where, orderBy: { createdAt: "asc" } });
  const [evs, people, batches, certs, pend] = await Promise.all([
    loadEval(as.map((a) => a.id)), staffRows(as.map((a) => a.staffId)),
    db.trBatch.findMany({ where: { id: { in: [...new Set(as.map((a) => a.batchId))] } } }),
    db.trCertificate.findMany({ where: { assignmentId: { in: as.map((a) => a.id) } } }),
    db.trPractical.findMany({ where: { assignmentId: { in: as.map((a) => a.id) } }, orderBy: { submittedAt: "desc" } }),
  ]);
  const trainers = await staffRows([...new Set(batches.map((b) => b.trainerId))]);
  return as.map((a) => {
    const ev = evs.get(a.id)!, s = people.find((p) => p.id === a.staffId), b = batches.find((x) => x.id === a.batchId)!, c = certs.find((x) => x.assignmentId === a.id);
    return {
      id: a.id, staffId: a.staffId, name: s?.name ?? "", empNo: s?.empNo ?? "", dept: s?.dept ?? "", batchId: b.id, batch: b.name, date: isoOf(b.trainingDate), trainer: trainers.find((t) => t.id === b.trainerId)?.name ?? (b.trainerId ? "" : "HR (no trainer yet)"), trainerId: b.trainerId,
      attendance: a.attendance, extraAttempts: a.extraAttempts, trainerDecision: a.trainerDecision, trainerFeedback: a.trainerFeedback, hrDecision: a.hrDecision, decisionNote: a.decisionNote,
      pct: ev.pct, lessonsDone: ev.lessonsDone, lessonsTotal: ev.lessonsTotal, tourDone: ev.tourDone, tourTotal: ev.tourTotal, score: ev.score, marks: ev.marks, status: ev.status, ready: ev.ready, req: ev.req,
      productPct: ev.product?.pct ?? null, finalPct: ev.final?.pct ?? null, mock: ev.mock ? `${ev.mock.score}/${ev.mock.maxScore}` : "", demo: ev.demo ? `${ev.demo.score}/${ev.demo.maxScore}` : "",
      certificate: c ? { id: c.id, certNo: c.certNo, revoked: !!c.revokedAt, issuedAt: c.issuedAt.toISOString() } : null,
      practicals: pend.filter((p) => p.assignmentId === a.id).map(practicalRow),
    };
  });
}
export type Participant = Awaited<ReturnType<typeof participantRows>>[number];

export async function trainerDesk(me: Me) {
  const batches = await db.trBatch.findMany({ where: { trainerId: me.id }, orderBy: { trainingDate: "desc" } });
  const p = await programme();
  const [rows, scenarios] = await Promise.all([participantRows({ batchId: { in: batches.map((b) => b.id) } }), p ? db.trScenario.findMany({ where: { programmeId: p.id } }) : []]);
  return { batches: batches.map((b) => ({ id: b.id, name: b.name, date: isoOf(b.trainingDate), status: b.status })), rows: rows.filter((r) => r.staffId !== me.id), scenarios: scenarios.map((s) => ({ id: s.id, title: s.title, goals: s.goals as string[] })), rubrics: RUBRICS };
}

export async function academy(me: Me) {
  needManager(me);
  await autoEnrol(); // installs the course if needed and enrols any sales employee not in it yet
  const selfPacedId = await autoBatchId();
  const p = await programme();
  const settings = await trainingSettings();
  const all = await staffRows();
  const staff = all.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name, empNo: s.empNo, dept: s.dept, role: s.hrRole, sales: isSalesPerson(s) }));
  if (!p) return { installed: false as const, settings, staff };
  const [mods, lessons, questions, scenarios, sessions, batches, rows] = await Promise.all([
    db.trModule.findMany({ where: { programmeId: p.id }, orderBy: { order: "asc" } }),
    db.trLesson.findMany({ where: { programmeId: p.id }, orderBy: { order: "asc" } }),
    db.trQuestion.findMany({ where: { programmeId: p.id }, orderBy: [{ scope: "asc" }, { order: "asc" }] }),
    db.trScenario.findMany({ where: { programmeId: p.id }, orderBy: { order: "asc" } }),
    db.trSession.findMany({ where: { programmeId: p.id }, orderBy: { order: "asc" } }),
    db.trBatch.findMany({ where: { programmeId: p.id }, orderBy: { trainingDate: "desc" } }),
    participantRows({ programmeId: p.id }),
  ]);
  const certs = await db.trCertificate.findMany({ where: { assignmentId: { in: rows.map((r) => r.id) } }, orderBy: { issuedAt: "desc" } });
  return {
    installed: true as const, settings, staff, isAdmin: me.role === "admin", meId: me.id,
    programme: { id: p.id, title: p.title, description: p.description },
    modules: mods.map((m) => ({ id: m.id, slug: m.slug, title: m.title, kind: m.kind, description: m.description, order: m.order, status: m.status })),
    lessons: lessons.map((l) => ({ ...lessonPublic(l, settings.minSlideSeconds), moduleId: l.moduleId, order: l.order, status: l.status, slug: l.slug, videoKind: l.videoKind, videoRef: l.videoRef, rawResources: (l.resources as Resource[]) ?? [], updatedAt: l.updatedAt.toISOString() })),
    questions: questions.map((q) => ({ id: q.id, scope: q.scope, lessonId: q.lessonId, area: q.area, order: q.order, prompt: q.prompt, options: q.options as string[], answer: q.answer, explanation: q.explanation, status: q.status })),
    scenarios: scenarios.map((s) => ({ id: s.id, title: s.title, persona: s.persona, situation: s.situation, script: s.script as { who: "customer" | "coach"; text: string }[], goals: s.goals as string[], status: s.status })),
    sessions: sessions.map((s) => ({ start: s.start, end: s.end, title: s.title, kind: s.kind, moduleSlug: s.moduleSlug })),
    batches: batches.map((b) => ({ id: b.id, name: b.name, selfPaced: b.id === selfPacedId, date: isoOf(b.trainingDate), trainerId: b.trainerId, trainer: all.find((s) => s.id === b.trainerId)?.name ?? (b.trainerId ? "" : "HR (no trainer yet)"), status: b.status, note: b.note, count: rows.filter((r) => r.batchId === b.id).length })),
    rows,
    certificates: certs.map((c) => ({ id: c.id, certNo: c.certNo, name: rows.find((r) => r.id === c.assignmentId)?.name ?? "", empNo: rows.find((r) => r.id === c.assignmentId)?.empNo ?? "", score: c.score, issuedAt: c.issuedAt.toISOString(), revoked: !!c.revokedAt, revokedReason: c.revokedReason, verifyCode: c.verifyCode })),
    officialParts: TOUR_VIDEOS.filter((v) => v.kind === "part").map((v) => ({ slug: v.slug, title: v.title, seconds: v.seconds })),
  };
}

/** Employee-wise training report (CSV). */
export async function reportCsv(me: Me) {
  needManager(me);
  const p = await needProgramme();
  const rows = await participantRows({ programmeId: p.id });
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Employee ID", "Name", "Department", "Batch", "Training date", "Trainer", "Attendance", "Lessons done", "Lessons total", "Tour chapters", "Product quiz %", "Final exam %", "Mock call", "Demo", "Product", "Communication", "Cold calling", "Demonstration", "Objections", "CRM", "Professionalism", "Final score", "Status", "Trainer decision", "HR decision", "Certificate"];
  const lines = rows.map((r) => [r.empNo, r.name, r.dept, r.batch, r.date, r.trainer, r.attendance, r.lessonsDone, r.lessonsTotal, `${r.tourDone}/${r.tourTotal}`, r.productPct ?? "", r.finalPct ?? "", r.mock, r.demo, ...Object.values(r.marks).map((m) => m.toFixed(1)), r.score, r.status, r.trainerDecision, r.hrDecision, r.certificate ? `${r.certificate.certNo}${r.certificate.revoked ? " (revoked)" : ""}` : ""].map(q).join(","));
  await audit(me, "Training · Report downloaded", `${rows.length} rows`);
  return [head.join(","), ...lines].join("\n");
}

// ── Files and certificates (route handlers)
export async function resourceFor(me: Me, lessonId: string, index: number) {
  const l = await db.trLesson.findUnique({ where: { id: lessonId } });
  if (!l) return null;
  if (!manager(me) && !(await isTrainer(me.id))) {
    const a = await myAssignment(me);
    if (!a || a.programmeId !== l.programmeId || l.status !== "published") return null;
  }
  const r = ((l.resources as Resource[]) ?? [])[index];
  if (!r?.key) return null;
  const bytes = await getObject(r.key);
  return bytes ? { bytes, name: r.name, type: r.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation" } : null;
}
/** A lesson's slides and notes, for the PDF handout: learners (published), trainers and HR. */
export async function lessonForNotes(me: Me, lessonId: string) {
  const l = await db.trLesson.findUnique({ where: { id: lessonId } });
  if (!l) return null;
  if (!manager(me) && !(await isTrainer(me.id))) {
    const a = await myAssignment(me);
    if (!a || a.programmeId !== l.programmeId || l.status !== "published") return null;
  }
  return { title: l.title, summary: l.summary, slides: (l.slides as Slide[]) ?? [], content: l.content as LessonContent, version: l.version };
}
export async function certificateFor(me: Me, certId: string) {
  const c = await db.trCertificate.findUnique({ where: { id: certId } });
  if (!c) return null;
  try { await canSee(me, c.assignmentId); } catch { return null; }
  return certificateData(c);
}
async function certificateData(c: NonNullable<Awaited<ReturnType<typeof db.trCertificate.findUnique>>>) {
  const [s] = await staffRows([c.staffId]);
  const settings = await trainingSettings();
  return { certNo: c.certNo, verifyCode: c.verifyCode, name: s?.name ?? "", empNo: s?.empNo ?? "", dept: s?.dept || "Sales", programme: c.programmeTitle, completedOn: isoOf(c.completedOn), score: c.score, trainer: c.trainerName, revoked: !!c.revokedAt, revokedReason: c.revokedReason, signatory: settings.signatory };
}
/** Public verification by the code printed on the certificate. Shows only what the certificate itself shows. */
export async function verifyCertificate(code: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) return null;
  const c = await db.trCertificate.findUnique({ where: { verifyCode: code } });
  return c ? certificateData(c) : null;
}
