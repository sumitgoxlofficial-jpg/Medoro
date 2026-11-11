import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, can, holders, need, notify, type Me } from "./auth";
import { COL_IDS, JOB_TYPES, PRIORITIES, PROJECT_STATUS, TICKET_TOPICS, type ColId } from "./constants";
import { nameMap } from "./people";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const HR = "_hrms"; // sequence namespace

// ── Tasks and reminders
type TaskRow = { id: string; kind: string; title: string; assigneeId: string; byId: string; due: Date | null; priority: string; status: string; col: string; projectId: string | null; comment: string; doneAt: Date | null; createdAt: Date };
const taskOut = (t: TaskRow, names: Map<string, string>, projects?: Map<string, string>) => ({
  id: t.id, kind: t.kind, title: t.title, assigneeId: t.assigneeId, assignee: names.get(t.assigneeId) ?? "", by: names.get(t.byId) ?? "", due: t.due ? isoOf(t.due) : null, priority: t.priority, done: t.status === "done",
  col: t.col as ColId, projectId: t.projectId, project: t.projectId ? projects?.get(t.projectId) ?? "" : "", comment: t.comment, doneAt: t.doneAt?.toISOString() ?? null,
  overdue: t.status !== "done" && !!t.due && isoOf(t.due) < todayISO(),
});
export type Task = ReturnType<typeof taskOut>;

export async function myTasks(me: Me) {
  const [rows, names, projects] = await Promise.all([
    db.hrTask.findMany({ where: { assigneeId: me.id, OR: [{ status: "open" }, { doneAt: { gte: new Date(Date.now() - 14 * 86400_000) } }] }, orderBy: [{ status: "desc" }, { due: "asc" }, { createdAt: "desc" }] }),
    nameMap(), db.hrProject.findMany({ select: { id: true, name: true } }),
  ]);
  const pm = new Map(projects.map((p) => [p.id, p.name]));
  return rows.map((t) => taskOut(t, names, pm));
}
export async function allTasks(me: Me) {
  need(me, "tasks");
  const [rows, names, projects] = await Promise.all([
    db.hrTask.findMany({ where: { kind: "task" }, orderBy: [{ status: "desc" }, { due: "asc" }, { createdAt: "desc" }], take: 300 }),
    nameMap(), db.hrProject.findMany({ select: { id: true, name: true } }),
  ]);
  const pm = new Map(projects.map((p) => [p.id, p.name]));
  return rows.map((t) => taskOut(t, names, pm));
}
const taskSchema = z.object({
  title: z.string().trim().min(3, "Describe the task.").max(200), assigneeId: z.string().min(1, "Choose who it is for."), due: iso.or(z.literal("")).default(""),
  priority: z.enum(PRIORITIES).default("Medium"), projectId: z.string().nullish(), col: z.enum(COL_IDS).default("todo"),
});
export async function assignTask(me: Me, raw: z.input<typeof taskSchema>) {
  need(me, "tasks");
  const i = taskSchema.parse(raw);
  const who = await db.staffUser.findFirst({ where: { id: i.assigneeId, kind: "team", status: "active" } });
  if (!who) throw new UserError("That employee isn’t active.");
  if (i.projectId && !(await db.hrProject.findUnique({ where: { id: i.projectId } }))) throw new UserError("Project not found.");
  await db.hrTask.create({ data: { title: i.title, assigneeId: i.assigneeId, byId: me.id, due: i.due ? dateOnly(i.due) : null, priority: i.priority, projectId: i.projectId || null, col: i.col, status: i.col === "done" ? "done" : "open", doneAt: i.col === "done" ? new Date() : null } });
  if (who.id !== me.id) await notify([who.id], `${me.name} assigned you a task: ${i.title}`, "mytasks");
  await audit(me, "Task assigned", `${who.name} · ${i.title}`);
}
export async function addReminder(me: Me, raw: { title: string; due?: string }) {
  const i = z.object({ title: z.string().trim().min(2, "Write the reminder.").max(200), due: iso.or(z.literal("")).default("") }).parse(raw);
  await db.hrTask.create({ data: { kind: "reminder", title: i.title, assigneeId: me.id, byId: me.id, due: i.due ? dateOnly(i.due) : dateOnly(todayISO()), priority: "Low" } });
}
/** The assignee ticks their own task; people with Tasks & projects can change any. */
async function editable(me: Me, id: string) {
  const t = await db.hrTask.findUnique({ where: { id } });
  if (!t || (t.assigneeId !== me.id && !can(me, "tasks"))) throw new UserError("Task not found.");
  return t;
}
export async function setTaskDone(me: Me, id: string, done: boolean, comment = "") {
  const t = await editable(me, id);
  await db.hrTask.update({ where: { id }, data: { status: done ? "done" : "open", doneAt: done ? new Date() : null, col: done ? "done" : t.col === "done" ? "todo" : t.col, comment: done ? String(comment).trim().slice(0, 300) : t.comment } });
  if (done && t.kind === "task" && t.byId !== me.id) await notify([t.byId], `${me.name} finished: ${t.title}`, "assigntasks");
}
export async function moveTask(me: Me, id: string, col: string) {
  const c = z.enum(COL_IDS).parse(col);
  await editable(me, id);
  await db.hrTask.update({ where: { id }, data: { col: c, status: c === "done" ? "done" : "open", doneAt: c === "done" ? new Date() : null } });
}
export async function deleteTask(me: Me, id: string) {
  const t = await db.hrTask.findUnique({ where: { id } });
  if (!t || !(can(me, "tasks") || (t.kind === "reminder" && t.assigneeId === me.id))) throw new UserError("Task not found.");
  await db.hrTask.delete({ where: { id } });
}

// ── Projects
const projectSchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(3, "Enter the project name.").max(100), client: z.string().trim().max(100).default("Internal"), leadId: z.string().nullish(),
  members: z.array(z.string()).max(50).default([]), deadline: iso.or(z.literal("")).default(""), status: z.enum(PROJECT_STATUS).default("Planning"),
});
export async function saveProject(me: Me, raw: z.input<typeof projectSchema>) {
  need(me, "tasks");
  const i = projectSchema.parse(raw);
  const members = [...new Set([...(i.leadId ? [i.leadId] : []), ...i.members])];
  const data = { name: i.name, client: i.client || "Internal", leadId: i.leadId || null, members, deadline: i.deadline ? dateOnly(i.deadline) : null, status: i.status };
  if (i.id) {
    const old = await db.hrProject.findUnique({ where: { id: i.id } });
    if (!old) throw new UserError("Project not found.");
    await db.hrProject.update({ where: { id: i.id }, data });
    await notify(members.filter((m) => !old.members.includes(m) && m !== me.id), `You were added to the project ${i.name}.`, "mytasks");
  } else {
    await db.hrProject.create({ data });
    await notify(members.filter((m) => m !== me.id), `You were added to the project ${i.name}.`, "mytasks");
  }
  await audit(me, i.id ? "Project updated" : "Project created", i.name);
}
export async function deleteProject(me: Me, id: string) {
  need(me, "tasks");
  const p = await db.hrProject.findUnique({ where: { id } });
  if (!p) throw new UserError("Project not found.");
  await db.$transaction([db.hrTask.deleteMany({ where: { projectId: id } }), db.hrProject.delete({ where: { id } })]);
  await audit(me, "Project deleted", p.name);
}
export async function projects(me: Me) {
  need(me, "tasks");
  const [rows, names] = await Promise.all([db.hrProject.findMany({ include: { tasks: true }, orderBy: { createdAt: "asc" } }), nameMap()]);
  return rows.map((p) => {
    const tasks = p.tasks.map((t) => taskOut(t, names));
    const done = tasks.filter((t) => t.done).length;
    return {
      id: p.id, name: p.name, client: p.client, leadId: p.leadId, lead: p.leadId ? names.get(p.leadId) ?? "" : "", members: p.members, memberNames: p.members.map((m) => names.get(m) ?? "").filter(Boolean),
      deadline: p.deadline ? isoOf(p.deadline) : "", status: p.status, tasks, progress: tasks.length ? Math.round((done * 100) / tasks.length) : 0,
      late: tasks.filter((t) => t.overdue).length,
    };
  });
}
export async function myProjects(me: Me) {
  const rows = await db.hrProject.findMany({ where: { members: { has: me.id }, status: { not: "Done" } }, include: { tasks: { select: { status: true } } } });
  return rows.map((p) => ({ id: p.id, name: p.name, status: p.status, deadline: p.deadline ? isoOf(p.deadline) : "", progress: p.tasks.length ? Math.round((p.tasks.filter((t) => t.status === "done").length * 100) / p.tasks.length) : 0 }));
}

// ── Announcements
export async function announcements(take = 10) {
  const [rows, names] = await Promise.all([db.hrAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take }), nameMap()]);
  return rows.map((a) => ({ id: a.id, emoji: a.emoji, title: a.title, body: a.body, by: names.get(a.byId) ?? "", at: a.createdAt.toISOString() }));
}
export async function postAnnouncement(me: Me, raw: { emoji?: string; title: string; body: string }) {
  if (!can(me, "employees") && me.role !== "admin") throw new UserError("Only HR and the super admin post announcements.");
  const i = z.object({ emoji: z.string().trim().max(4).default("📢"), title: z.string().trim().min(3, "Enter a title.").max(100), body: z.string().trim().min(3, "Write the announcement.").max(600) }).parse(raw);
  await db.hrAnnouncement.create({ data: { emoji: i.emoji || "📢", title: i.title, body: i.body, byId: me.id } });
  const everyone = await db.staffUser.findMany({ where: { kind: "team", status: "active", role: { not: "partner" }, id: { not: me.id } }, select: { id: true } });
  await notify(everyone.map((u) => u.id), `Announcement: ${i.title}`, "");
  await audit(me, "Announcement posted", i.title);
}
export async function deleteAnnouncement(me: Me, id: string) {
  if (!can(me, "employees") && me.role !== "admin") throw new UserError("Only HR and the super admin remove announcements.");
  await db.hrAnnouncement.deleteMany({ where: { id } });
}

// ── Meetings
const meetingSchema = z.object({
  title: z.string().trim().min(3, "Enter the meeting title.").max(120), day: iso, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time."),
  minutes: z.coerce.number().int().min(5).max(480).default(30), link: z.string().trim().max(300).regex(/^$|^https:\/\/\S+$/, "The meeting link must start with https://").default(""), attendees: z.array(z.string()).max(100).default([]),
});
export async function scheduleMeeting(me: Me, raw: z.input<typeof meetingSchema>) {
  const i = meetingSchema.parse(raw);
  const at = new Date(`${i.day}T${i.time}:00+05:30`);
  if (at.getTime() < Date.now() - 3600_000) throw new UserError("Pick a time in the future.");
  const attendees = [...new Set([me.id, ...i.attendees])];
  await db.hrMeeting.create({ data: { title: i.title, at, minutes: i.minutes, link: i.link, byId: me.id, attendees } });
  await notify(attendees.filter((a) => a !== me.id), `${me.name} invited you to “${i.title}” on ${i.day} at ${i.time}.`, "calendar");
}
export async function saveMeetingNotes(me: Me, id: string, notes: string) {
  const m = await db.hrMeeting.findUnique({ where: { id } });
  if (!m || !m.attendees.includes(me.id)) throw new UserError("Meeting not found.");
  await db.hrMeeting.update({ where: { id }, data: { notes: String(notes).slice(0, 5000) } });
}
export async function cancelMeeting(me: Me, id: string) {
  const m = await db.hrMeeting.findUnique({ where: { id } });
  if (!m || (m.byId !== me.id && me.role !== "admin")) throw new UserError("Only the organiser can cancel this meeting.");
  await db.hrMeeting.delete({ where: { id } });
  await notify(m.attendees.filter((a) => a !== me.id), `“${m.title}” was cancelled.`, "calendar");
}
export async function meetings(me: Me, from: Date, to: Date) {
  const [rows, names] = await Promise.all([db.hrMeeting.findMany({ where: { attendees: { has: me.id }, at: { gte: from, lt: to } }, orderBy: { at: "asc" } }), nameMap()]);
  return rows.map((m) => ({ id: m.id, title: m.title, at: m.at.toISOString(), minutes: m.minutes, link: m.link, by: names.get(m.byId) ?? "", mine: m.byId === me.id, attendees: m.attendees.map((a) => names.get(a) ?? "").filter(Boolean), notes: m.notes }));
}

// ── Recognition and performance
export async function recognise(me: Me, raw: { toId: string; badge?: string; note: string }) {
  const i = z.object({ toId: z.string().min(1), badge: z.string().trim().max(4).default("🌟"), note: z.string().trim().min(3, "Say what they did well.").max(200) }).parse(raw);
  if (i.toId === me.id) throw new UserError("Recognise a teammate, not yourself.");
  if (!(await db.staffUser.findFirst({ where: { id: i.toId, kind: "team", status: "active" } }))) throw new UserError("Employee not found.");
  await db.hrRecognition.create({ data: { fromId: me.id, toId: i.toId, badge: i.badge || "🌟", note: i.note } });
  await notify([i.toId], `${me.name} recognised you: ${i.note}`, "");
}
/**
 * Scores for a period: half task completion, 30% on-time delivery, 20% attendance, plus a point per recognition
 * (up to 5). People with no tasks in the period score on attendance and recognition only.
 */
export async function performance(me: Me, period: "today" | "week" | "month") {
  need(me, "reports");
  const today = todayISO();
  const from = period === "today" ? today : period === "week" ? addDays(today, -6) : today.slice(0, 8) + "01";
  const fromAt = new Date(`${from}T00:00:00+05:30`);
  const [staff, tasks, att, recs] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", status: "active", role: { not: "partner" } }, select: { id: true, name: true, hr: { select: { dept: true, designation: true, presence: true, presenceAt: true } } } }),
    db.hrTask.findMany({ where: { kind: "task", OR: [{ due: { gte: dateOnly(from), lte: dateOnly(today) } }, { doneAt: { gte: fromAt } }, { status: "open", due: { lt: dateOnly(from) } }] } }),
    db.hrAttendance.findMany({ where: { day: { gte: dateOnly(from), lte: dateOnly(today) }, inAt: { not: null } }, select: { staffId: true } }),
    db.hrRecognition.findMany({ where: { createdAt: { gte: fromAt } }, select: { toId: true } }),
  ]);
  let workDays = 0;
  const hol = new Set((await db.hrHoliday.findMany({ where: { day: { gte: dateOnly(from), lte: dateOnly(today) } } })).map((h) => isoOf(h.day)));
  for (let d = from; d <= today; d = addDays(d, 1)) { const w = dateOnly(d).getUTCDay(); if (w !== 0 && w !== 6 && !hol.has(d)) workDays++; }
  const rows = staff.map((u) => {
    const mine = tasks.filter((t) => t.assigneeId === u.id);
    const done = mine.filter((t) => t.status === "done");
    const onTime = done.filter((t) => !t.due || !t.doneAt || todayISO(t.doneAt) <= isoOf(t.due)).length;
    const days = att.filter((a) => a.staffId === u.id).length;
    const kudos = recs.filter((r) => r.toId === u.id).length;
    const completion = mine.length ? Math.round((done.length * 100) / mine.length) : null;
    const onTimePct = done.length ? Math.round((onTime * 100) / done.length) : null;
    const attendance = workDays ? Math.min(100, Math.round((days * 100) / workDays)) : null;
    const parts: [number | null, number][] = [[completion, 0.5], [onTimePct, 0.3], [attendance, 0.2]];
    const weight = parts.reduce((a, [v, w]) => a + (v === null ? 0 : w), 0);
    const base = weight ? parts.reduce((a, [v, w]) => a + (v === null ? 0 : v * w), 0) / weight : 0;
    const live = u.hr?.presenceAt && Date.now() - u.hr.presenceAt.getTime() < 5 * 60_000 ? u.hr.presence : "offline";
    return {
      id: u.id, name: u.name, dept: u.hr?.dept ?? "", designation: u.hr?.designation ?? "", total: mine.length, done: done.length, open: mine.length - done.length, completion, onTimePct, attendance, kudos,
      score: weight ? Math.min(100, Math.round(base) + Math.min(5, kudos)) : null, presence: live,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  return { period, from, rows };
}

// ── Support tickets (HR helpdesk)
export async function raiseTicket(me: Me, raw: { category: string; subject: string; body: string }) {
  const i = z.object({ category: z.enum(TICKET_TOPICS), subject: z.string().trim().min(4, "Enter a subject.").max(120), body: z.string().trim().min(5, "Describe the problem.").max(1500) }).parse(raw);
  const n = await db.$transaction((tx) => nextSeq(tx, HR, "TKT"));
  const code = `HR-${String(n).padStart(4, "0")}`;
  await db.hrTicket.create({ data: { code, staffId: me.id, category: i.category, subject: i.subject, body: i.body } });
  await notify((await holders("employees")).filter((x) => x !== me.id), `${me.name} raised ${code}: ${i.subject}`, "support");
  return code;
}
export async function resolveTicket(me: Me, id: string, reply: string) {
  need(me, "employees");
  const r = z.string().trim().min(3, "Write a reply for the employee.").max(1500).parse(reply);
  const t = await db.hrTicket.findUnique({ where: { id } });
  if (!t || t.status !== "open") throw new UserError("This ticket is already resolved.");
  await db.hrTicket.update({ where: { id }, data: { status: "resolved", reply: r, resolvedBy: me.id, resolvedAt: new Date() } });
  await notify([t.staffId], `${t.code} was resolved: ${r.slice(0, 120)}`, "support");
  await audit(me, "Ticket resolved", t.code);
}
export async function tickets(me: Me) {
  const all = can(me, "employees");
  const [rows, names] = await Promise.all([db.hrTicket.findMany({ where: all ? {} : { staffId: me.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 }), nameMap()]);
  return rows.map((t) => ({ id: t.id, code: t.code, by: names.get(t.staffId) ?? "", mine: t.staffId === me.id, category: t.category, subject: t.subject, body: t.body, status: t.status, reply: t.reply, at: t.createdAt.toISOString() }));
}

// ── Recruitment
const jobSchema = z.object({ title: z.string().trim().min(3, "Enter the job title.").max(100), dept: z.string().trim().min(1, "Choose a department.").max(60), location: z.string().trim().min(2, "Enter the location.").max(60), type: z.enum(JOB_TYPES) });
export async function postJob(me: Me, raw: z.input<typeof jobSchema>) {
  need(me, "recruitment");
  const i = jobSchema.parse(raw);
  await db.hrJob.create({ data: i });
  await audit(me, "Job posted", i.title);
}
export async function setJobOpen(me: Me, id: string, open: boolean) {
  need(me, "recruitment");
  await db.hrJob.update({ where: { id }, data: { status: open ? "active" : "closed" } }).catch(() => { throw new UserError("Job not found."); });
}
export async function jobs(activeOnly = false) {
  const rows = await db.hrJob.findMany({ where: activeOnly ? { status: "active" } : {}, include: { _count: { select: { candidates: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  return rows.map((j) => ({ id: j.id, title: j.title, dept: j.dept, location: j.location, type: j.type, status: j.status, applicants: j._count.candidates }));
}
const candSchema = z.object({
  jobId: z.string().min(1, "Choose the opening."), name: z.string().trim().min(3, "Enter the candidate’s name.").max(80), email: z.string().trim().toLowerCase().regex(/^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email.").default(""),
  phone: z.string().trim().max(20).default(""), note: z.string().trim().max(400).default(""), score: z.coerce.number().int().min(0).max(100).nullish(),
});
/** HR adds a candidate; any employee can refer one for an open role. */
export async function addCandidate(me: Me, raw: z.input<typeof candSchema>, referral = false) {
  if (!referral) need(me, "recruitment");
  const i = candSchema.parse(raw);
  const job = await db.hrJob.findUnique({ where: { id: i.jobId } });
  if (!job || job.status !== "active") throw new UserError("That opening is closed.");
  if (!i.email && !i.phone) throw new UserError("Add an email or a phone number for the candidate.");
  await db.hrCandidate.create({ data: { jobId: job.id, name: i.name, email: i.email, phone: i.phone, role: job.title, note: i.note, score: referral ? null : i.score ?? null, referredBy: referral ? me.id : null } });
  if (referral) await notify((await holders("recruitment")).filter((x) => x !== me.id), `${me.name} referred ${i.name} for ${job.title}.`, "recruit");
}
export async function moveCandidate(me: Me, id: string, stage: string) {
  need(me, "recruitment");
  const st = z.enum(["applied", "interview", "offer", "hired", "rejected"]).parse(stage);
  const c = await db.hrCandidate.findUnique({ where: { id } });
  if (!c) throw new UserError("Candidate not found.");
  await db.hrCandidate.update({ where: { id }, data: { stage: st } });
  await audit(me, "Candidate moved", `${c.name} · ${st}`);
}
export async function scoreCandidate(me: Me, id: string, score: number) {
  need(me, "recruitment");
  await db.hrCandidate.update({ where: { id }, data: { score: z.number().int().min(0).max(100).parse(score) } }).catch(() => { throw new UserError("Candidate not found."); });
}
const offerSchema = z.object({ position: z.string().trim().min(2, "Enter the position.").max(100), empType: z.string().trim().max(40), pay: z.string().trim().min(1, "Enter the pay.").max(60), joinDate: iso, mode: z.string().trim().max(40), terms: z.string().trim().max(2000).default("") });
export async function saveOffer(me: Me, id: string, raw: z.input<typeof offerSchema>) {
  need(me, "recruitment");
  const offer = { ...offerSchema.parse(raw), by: me.name, on: todayISO() };
  const c = await db.hrCandidate.findUnique({ where: { id } });
  if (!c) throw new UserError("Candidate not found.");
  await db.hrCandidate.update({ where: { id }, data: { offer, stage: c.stage === "hired" ? "hired" : "offer" } });
  await audit(me, "Offer letter prepared", `${c.name} · ${offer.position}`);
}
export async function candidates(me: Me) {
  need(me, "recruitment");
  const [rows, names] = await Promise.all([db.hrCandidate.findMany({ where: { stage: { not: "rejected" } }, orderBy: { createdAt: "desc" }, take: 300 }), nameMap()]);
  return rows.map((c) => ({ id: c.id, jobId: c.jobId, name: c.name, email: c.email, phone: c.phone, role: c.role, note: c.note, score: c.score, stage: c.stage, offer: c.offer as (z.infer<typeof offerSchema> & { by: string; on: string }) | null, referredBy: c.referredBy ? names.get(c.referredBy) ?? "" : "" }));
}
