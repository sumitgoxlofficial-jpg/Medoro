import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { enforce } from "@/server/ratelimit";
import { log } from "@/server/log";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, can, holders, loadSettings, need, needAdmin, notify, type Me } from "../auth";
import { APPLY_IDS, leaveLabel, toMin as hhmmToMin, type Settings } from "../constants";
import { applyLeave, decideLeave, istClock, weekend } from "../time";
import { CALL_REASONS, start, step, type CallReason, type Ctx, type State } from "./engine";
import { understand, clock, normalise, REASONS, TEACHABLE_INTENTS, type CustomWord, type Lang } from "./nlu";
import { buildOutput, type CallOutput } from "./output";
import { Index, kbFrom, productDocs, type KDoc } from "./knowledge";
import { passages } from "../ally-knowledge";
import * as ai from "./ai-client";
import { evaluateAll } from "./evaluate";
import { speechFilesStatus } from "./speech-files";
import { LIBRARY_VERSION, parseExpect, scenarios as libraryScenarios, validateLibrary, type Scenario } from "./scenarios";
import { converse } from "./engine";
import { mailEnabled, sendMail } from "@/server/mail";
import { aiHrDigestMail } from "../mails";
import { digestWeek, type DigestStats } from "./digest";

// The AI HR Assistant's server side. It detects attendance exceptions from the HRMS's own records (the same shift,
// leave, holiday and weekly-off rules the attendance screens use), schedules a conversation per event exactly once,
// notifies the employee in the HRMS (and on WhatsApp if they opted in), runs the conversation turn by turn, stores a
// validated outcome, and proposes follow-ups for HR to approve. It never changes attendance, leave, pay or overtime.

export const ORG_ID = "medoro"; // the HRMS is single-organisation (docs/ai-hr-assistant/AUDIT.md)

// ── Configuration (HrSetting key "aiHr"). Off until the super admin turns it on.
const rule = z.object({ enabled: z.boolean(), afterMin: z.number().int().min(0).max(600) });
export const configSchema = z.object({
  enabled: z.boolean(),
  rules: z.object({ late: rule, absent: rule, missing_checkout: rule, overtime: z.object({ enabled: z.boolean() }) }),
  maxAttempts: z.number().int().min(1).max(3),
  retryGapMin: z.number().int().min(5).max(240),
  callingFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  callingTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  retentionDays: z.number().int().min(7).max(365),
  llmAssist: z.boolean(),
  voice: z.boolean(),
  /** Where speech is recognised: in the employee's browser (free, nothing to host), on the AI host, or nowhere (text only). */
  speech: z.enum(["browser", "server", "off"]),
  /** Browser speech model: base (~80 MB once, faster) or small (~250 MB once, better Hindi). */
  sttModel: z.enum(["whisper-base", "whisper-small"]),
  /** Where browsers download the speech model from: Hugging Face (default) or this server (scripts/office/fetch-speech-model.sh). */
  modelSource: z.enum(["huggingface", "self"]),
  /** A weekly summary email to everyone with Attendance & leave (Monday), when email is set up. */
  weeklyDigest: z.boolean().default(true),
});
export type AiHrConfig = z.infer<typeof configSchema>;
export const DEFAULT_CONFIG: AiHrConfig = {
  enabled: false,
  rules: { late: { enabled: true, afterMin: 10 }, absent: { enabled: true, afterMin: 30 }, missing_checkout: { enabled: true, afterMin: 15 }, overtime: { enabled: true } },
  maxAttempts: 3, retryGapMin: 20, callingFrom: "08:00", callingTo: "21:00", retentionDays: 90, llmAssist: true, voice: true, speech: "browser", sttModel: "whisper-base", modelSource: "huggingface", weeklyDigest: true,
};
export async function loadConfig(): Promise<AiHrConfig> {
  const v = ((await db.hrSetting.findUnique({ where: { key: "aiHr" } }))?.value ?? {}) as Partial<AiHrConfig>;
  return { ...DEFAULT_CONFIG, ...v, rules: { ...DEFAULT_CONFIG.rules, ...(v.rules ?? {}) } };
}
export async function saveConfig(me: Me, raw: unknown) {
  needAdmin(me);
  const c = configSchema.parse(raw);
  if (hhmmToMin(c.callingTo) <= hhmmToMin(c.callingFrom)) throw new UserError("Calling hours must end after they start.");
  await db.hrSetting.upsert({ where: { key: "aiHr" }, update: { value: c }, create: { key: "aiHr", value: c } });
  await audit(me, "AI HR Assistant settings changed", `${c.enabled ? "on" : "off"} · late ${c.rules.late.enabled ? c.rules.late.afterMin + "m" : "off"} · absent ${c.rules.absent.enabled ? c.rules.absent.afterMin + "m" : "off"} · checkout ${c.rules.missing_checkout.enabled ? c.rules.missing_checkout.afterMin + "m" : "off"} · hours ${c.callingFrom}–${c.callingTo}`);
}

const nowMinIST = (now: Date) => hhmmToMin(istClock(now));
const inHours = (c: AiHrConfig, now: Date) => { const m = nowMinIST(now); return m >= hhmmToMin(c.callingFrom) && m <= hhmmToMin(c.callingTo); };
const P2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** A person's expected start and end today: rostered shift, else their own shift start, else Settings. */
export function expectedDay(s: Settings, shift: { start: string; end: string; overnight: boolean } | null, ownStart: string | null | undefined) {
  if (shift) return { start: shift.start, end: shift.end, overnight: shift.overnight, source: "roster" as const };
  const st = ownStart || s.lateAfter, lunch = Math.max(0, hhmmToMin(s.lunchTo) - hhmmToMin(s.lunchFrom));
  return { start: st, end: clock(hhmmToMin(st) + s.workHours * 60 + lunch), overnight: false, source: ownStart ? ("own" as const) : ("settings" as const) };
}

// ── Detection: attendance exceptions for today. Idempotent: each event has a unique key.
export async function detect(now = new Date()) {
  const c = await loadConfig();
  const out = { created: 0, skipped: 0 };
  if (!c.enabled) return out;
  const s = await loadSettings();
  const day = todayISO(now);
  if (!s.checkin || weekend(day, s.weekOff)) return out;
  if (await db.hrHoliday.findUnique({ where: { day: dateOnly(day) } })) return out;
  if (!inHours(c, now)) return out;
  const staff = await db.staffUser.findMany({
    where: { kind: "team", status: "active", deletedAt: null, role: { notIn: ["partner", "super_admin"] } },
    select: { id: true, hr: { select: { role: true, shiftStart: true, joinDate: true, exitDate: true, createdAt: true } } },
  });
  const ids = staff.filter((u) => u.hr && u.hr.role !== "admin").map((u) => u.id);
  if (!ids.length) return out;
  const d = dateOnly(day);
  const [att, leaves, roster, consents, existing] = await Promise.all([
    db.hrAttendance.findMany({ where: { staffId: { in: ids }, day: d } }),
    db.hrLeave.findMany({ where: { staffId: { in: ids }, status: "approved", fromDay: { lte: d }, toDay: { gte: d } } }),
    db.hrShiftAssignment.findMany({ where: { staffId: { in: ids }, fromDay: { lte: d }, OR: [{ toDay: null }, { toDay: { gte: d } }] }, orderBy: [{ fromDay: "desc" }, { createdAt: "desc" }], include: { shift: true } }),
    db.aiHrConsent.findMany({ where: { staffId: { in: ids }, status: "stopped" }, select: { staffId: true } }),
    db.aiHrCall.findMany({ where: { staffId: { in: ids }, day: d }, select: { staffId: true, reason: true } }),
  ]);
  const stopped = new Set(consents.map((x) => x.staffId));
  const nowM = nowMinIST(now);
  for (const u of staff) {
    const p = u.hr; if (!p || p.role === "admin") continue;
    if (stopped.has(u.id)) { out.skipped++; continue; }
    if (p.joinDate && isoOf(p.joinDate) > day) continue;
    if (todayISO(p.createdAt) > day) continue;
    if (p.exitDate && isoOf(p.exitDate) < day) continue;
    if (leaves.some((l) => l.staffId === u.id)) continue; // approved leave (full or half day) covers today
    const a = att.find((x) => x.staffId === u.id);
    const shift = roster.find((r) => r.staffId === u.id)?.shift ?? null;
    const exp = expectedDay(s, shift && !shift.archived ? shift : null, p.shiftStart);
    const startM = hhmmToMin(exp.start), endM = hhmmToMin(exp.end);
    const had = (r: CallReason) => existing.some((x) => x.staffId === u.id && x.reason === r);
    const ctx = { shiftStart: exp.start, shiftEnd: exp.end, source: exp.source };
    let reason: CallReason | null = null;
    if (!a?.inAt && a?.status !== "present") {
      if (c.rules.absent.enabled && nowM >= startM + c.rules.absent.afterMin && !had("late") && !had("absent")) reason = "absent";
      else if (c.rules.late.enabled && nowM >= startM + c.rules.late.afterMin && nowM < startM + (c.rules.absent.enabled ? c.rules.absent.afterMin : 24 * 60) && !had("late")) reason = "late";
    } else if (a?.inAt && !a.outAt && !exp.overnight && c.rules.missing_checkout.enabled && endM > startM && nowM >= endM + c.rules.missing_checkout.afterMin && !had("missing_checkout")) reason = "missing_checkout";
    if (!reason) continue;
    try {
      await db.aiHrCall.create({ data: { staffId: u.id, reason, day: d, eventKey: `${reason}:${u.id}:${day}`, maxAttempts: c.maxAttempts, nextAttemptAt: now, context: ctx } });
      out.created++;
    } catch (e) { if (P2002(e)) out.skipped++; else throw e; }
  }
  return out;
}

// ── Dispatch: notify, retry, expire. Durable: everything is in AiHrCall rows; a failed tick is retried by the next one.
export async function dispatch(now = new Date()) {
  const c = await loadConfig();
  const out = { notified: 0, cancelled: 0, noAnswer: 0 };
  const today = todayISO(now);
  // Calls from earlier days that never started are closed as no answer (attendance is HR's to follow up).
  const stale = await db.aiHrCall.findMany({ where: { status: { in: ["scheduled", "notified"] }, day: { lt: dateOnly(today) }, reason: { not: "overtime" } }, take: 200 });
  for (const call of stale) { await closeNoAnswer(call.id, call.staffId, "The day ended before the employee answered."); out.noAnswer++; }
  if (!c.enabled) return out;
  const due = await db.aiHrCall.findMany({ where: { status: { in: ["scheduled", "notified"] }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: 100 });
  for (const call of due) {
    if ((await db.aiHrConsent.findUnique({ where: { staffId: call.staffId } }))?.status === "stopped") {
      await db.aiHrCall.update({ where: { id: call.id }, data: { status: "suppressed", suppressReason: "Employee switched AI conversations off.", nextAttemptAt: null } });
      out.cancelled++; continue;
    }
    // The situation may have resolved itself: checked in, checked out, leave approved.
    const why = await stillNeeded(call);
    if (why) { await db.aiHrCall.update({ where: { id: call.id }, data: { status: "cancelled", suppressReason: why, nextAttemptAt: null } }); out.cancelled++; continue; }
    if (call.attempts >= call.maxAttempts) { await closeNoAnswer(call.id, call.staffId, `No answer after ${call.attempts} attempt(s).`); out.noAnswer++; continue; }
    if (!inHours(c, now)) continue;
    const n = call.attempts + 1;
    const text = notifyText(call.reason as CallReason, n);
    await notify([call.staffId], text, "aicall");
    await db.$transaction([
      db.aiHrCall.update({ where: { id: call.id }, data: { status: "notified", attempts: n, nextAttemptAt: new Date(now.getTime() + c.retryGapMin * 60_000) } }),
      db.aiHrCallAttempt.create({ data: { callId: call.id, n, outcome: "notified", detail: "HRMS notification" } }),
    ]);
    out.notified++;
  }
  return out;
}
const notifyText = (r: CallReason, n: number) => {
  const what: Record<CallReason, string> = { late: "your check-in today", absent: "today's attendance", missing_checkout: "today's check-out", overtime: "an overtime request from your manager", manual: "a follow-up from HR" };
  return `${n > 1 ? "Reminder: " : ""}Medoro's AI HR Assistant would like a quick word about ${what[r]}. Open it to talk (voice or text), or ask for HR.`;
};
async function stillNeeded(call: { staffId: string; reason: string; day: Date }): Promise<string> {
  if (call.reason === "overtime" || call.reason === "manual") return "";
  const a = await db.hrAttendance.findUnique({ where: { staffId_day: { staffId: call.staffId, day: call.day } } });
  if ((call.reason === "late" || call.reason === "absent") && (a?.inAt || a?.status === "present")) return "The employee checked in.";
  if (call.reason === "missing_checkout" && a?.outAt) return "The employee checked out.";
  if (await db.hrLeave.findFirst({ where: { staffId: call.staffId, status: "approved", fromDay: { lte: call.day }, toDay: { gte: call.day } } })) return "Leave was approved for the day.";
  return "";
}
async function closeNoAnswer(callId: string, staffId: string, detail: string) {
  await db.$transaction([
    db.aiHrCall.update({ where: { id: callId }, data: { status: "no_answer", nextAttemptAt: null, endedAt: new Date() } }),
    db.aiHrCallAttempt.create({ data: { callId, n: 0, outcome: "no_answer", detail } }),
    db.aiHrAction.create({ data: { callId, staffId, kind: "hr_followup", payload: { detail: `No answer to the AI conversation. ${detail}` } } }),
  ]);
}

/** The scheduler job (every minute: /api/cron/minute, or the self-hosted tick). */
export async function aiHrTick(now = new Date(), daily = false) {
  try {
    const d = await detect(now);
    const p = await dispatch(now);
    if (daily) await retentionSweep(now);
    await weeklyDigest(now).catch((e) => log.error("ai-hr weekly digest failed", { err: e }));
    return { ...d, ...p };
  } catch (e) { log.error("ai-hr tick failed", { err: e }); return null; }
}

/**
 * Free scheduling: every HRMS page view may run the AI job, at most once a minute across all servers (an atomic claim
 * on one HrSetting row), after the response is sent. With the free GitHub Actions workflow (every 5 minutes) and
 * Vercel's daily cron, no paid scheduler is needed. Returns whether this call ran it.
 */
export async function maybeTick(now = new Date()): Promise<boolean> {
  const claimed = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "HrSetting" (key, value) VALUES ('aiHrTick', jsonb_build_object('at', ${now.toISOString()}::text))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    WHERE ("HrSetting".value->>'at')::timestamptz < ${new Date(now.getTime() - 55_000).toISOString()}::timestamptz
    RETURNING key`;
  if (!claimed.length) return false;
  await aiHrTick(now);
  return true;
}

// ── Overtime and manual conversations raised by a person
const otInput = z.object({ staffId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."), hours: z.coerce.number().min(0.5, "At least half an hour.").max(8, "At most 8 hours."), from: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).default(""), reason: z.string().trim().min(3, "Say what the overtime is for.").max(120) });
export async function requestOvertime(me: Me, raw: z.input<typeof otInput>) {
  const i = otInput.parse(raw);
  const c = await loadConfig();
  if (!c.enabled || !c.rules.overtime.enabled) throw new UserError("AI overtime conversations are switched off in AI HR Assistant settings.");
  const mgr = (await db.hrProfile.findUnique({ where: { staffId: i.staffId }, select: { managerId: true } }))?.managerId;
  if (mgr !== me.id) need(me, "attendance"); // the person's reporting manager, or Attendance & leave
  if (i.staffId === me.id) throw new UserError("You can't raise overtime for yourself.");
  if (i.date < todayISO()) throw new UserError("Overtime is for today or a later day.");
  const u = await db.staffUser.findUnique({ where: { id: i.staffId }, select: { status: true, kind: true } });
  if (!u || u.status !== "active" || u.kind !== "team") throw new UserError("Choose an active employee.");
  if ((await db.aiHrConsent.findUnique({ where: { staffId: i.staffId } }))?.status === "stopped") throw new UserError("This employee switched AI conversations off. Ask them directly.");
  const call = await db.aiHrCall.create({ data: { staffId: i.staffId, reason: "overtime", day: dateOnly(i.date), eventKey: `overtime:${i.staffId}:${i.date}:${randomUUID()}`, maxAttempts: c.maxAttempts, nextAttemptAt: new Date(), createdBy: me.id, context: { overtime: { date: i.date, hours: i.hours, from: i.from || undefined, why: i.reason }, requestedBy: me.id } } });
  await audit(me, "AI overtime request raised", `${i.staffId} · ${i.date} · ${i.hours}h · ${i.reason}`);
  return call.id;
}
export async function startManualCall(me: Me, staffId: string, topic: string) {
  need(me, "attendance");
  const t = z.string().trim().min(3, "Say what the follow-up is about.").max(120).parse(topic);
  if ((await db.aiHrConsent.findUnique({ where: { staffId } }))?.status === "stopped") throw new UserError("This employee switched AI conversations off.");
  const c = await loadConfig();
  const call = await db.aiHrCall.create({ data: { staffId, reason: "manual", day: dateOnly(todayISO()), eventKey: `manual:${staffId}:${randomUUID()}`, maxAttempts: c.maxAttempts, nextAttemptAt: new Date(), createdBy: me.id, context: { topic: t } } });
  await audit(me, "AI follow-up conversation raised", `${staffId} · ${t}`);
  return call.id;
}

// ── Knowledge: approved records in the database, plus live organisation facts. Never invented.
export async function ensureKnowledge() {
  if (await db.aiHrKnowledgeDoc.count({ where: { scope: "product" } })) return;
  const docs = productDocs();
  await db.aiHrKnowledgeDoc.createMany({ data: docs.map((d) => ({ docKey: d.key, version: 1, scope: "product", kind: d.key.startsWith("screen.") ? "module" : d.key.startsWith("faq.") ? "faq" : "rule", title: d.title, body: d.body, source: d.source, status: "approved", createdBy: "system", approvedBy: "system", approvedAt: new Date() })), skipDuplicates: true });
}
let indexCache: { at: number; index: Index } | null = null;
export const invalidateKnowledge = () => { indexCache = null; };
/** Organisation facts from live records: Settings, holidays and published policies. */
export async function organisationDocs(): Promise<KDoc[]> {
  const s = await loadSettings(), today = todayISO();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hols = await db.hrHoliday.findMany({ where: { day: { gte: dateOnly(today), lte: dateOnly(addDays(today, 365)) } }, orderBy: { day: "asc" }, take: 20 });
  const policies = await db.hrPolicy.findMany({ where: { archivedAt: null }, select: { title: true, category: true, body: true } });
  const org: KDoc[] = [
    { key: "org.hours", title: "Working hours and late time", scope: "organisation", source: "Settings (live)", body: `Check-in is ${s.checkin ? "on" : "off"}. A check-in after ${s.lateAfter} counts as late unless you are rostered on a shift. The working day expects ${s.workHours} hours plus lunch from ${s.lunchFrom} to ${s.lunchTo}.` },
    { key: "org.weekoff", title: "Weekly off days", scope: "organisation", source: "Settings (live)", body: `The weekly days off are ${s.weekOff.map((d) => days[d]).join(" and ") || "none"}.` },
    { key: "org.leave", title: "Leave policy per year", scope: "organisation", source: "Settings (live)", body: `Leave each year: ${Object.entries(s.leave).map(([k, v]) => `${v} days of ${k} leave`).join(", ")}. Unused privilege leave carries forward up to ${s.carryForward} days.` },
    { key: "org.holidays", title: "Upcoming holidays", scope: "organisation", source: "Calendar (live)", body: hols.length ? `Next holidays: ${hols.map((h) => `${h.name} on ${isoOf(h.day)}`).join(", ")}.` : "No upcoming holidays are listed in the calendar yet." },
    ...policies.flatMap(passages).map((p, i) => ({ key: `org.policy.${i}`, title: p.policy, body: p.text, source: `Company policy: ${p.policy}`, scope: "organisation" as const })),
  ];
  return org;
}
export async function knowledgeIndex(): Promise<Index> {
  if (indexCache && Date.now() - indexCache.at < 60_000) return indexCache.index;
  await ensureKnowledge();
  const rows = await db.aiHrKnowledgeDoc.findMany({ where: { status: "approved", OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] } });
  const docs: KDoc[] = rows.map((r) => ({ key: r.docKey, title: r.title, body: r.body, source: r.source, scope: r.scope as KDoc["scope"], version: r.version }));
  const index = new Index([...docs, ...(await organisationDocs())]);
  indexCache = { at: Date.now(), index };
  return index;
}

const kInput = z.object({ docKey: z.string().trim().max(80).default(""), title: z.string().trim().min(3, "Give the record a title.").max(120), body: z.string().trim().min(20, "Write at least a sentence.").max(4000), scope: z.enum(["product", "organisation"]), kind: z.enum(["module", "policy", "faq", "procedure", "rule"]), source: z.string().trim().min(2, "Say where this comes from.").max(160), effectiveFrom: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).default("") });
/** A new version of a record, as a draft. Nothing is used in conversations until it is approved. */
export async function saveKnowledgeDraft(me: Me, raw: z.input<typeof kInput>) {
  need(me, "employees");
  const i = kInput.parse(raw);
  const docKey = i.docKey || `hr.${i.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}-${Date.now().toString(36)}`;
  const last = await db.aiHrKnowledgeDoc.findFirst({ where: { docKey }, orderBy: { version: "desc" } });
  const row = await db.aiHrKnowledgeDoc.create({ data: { docKey, version: (last?.version ?? 0) + 1, scope: i.scope, kind: i.kind, title: i.title, body: i.body, source: i.source, effectiveFrom: i.effectiveFrom ? dateOnly(i.effectiveFrom) : null, status: "draft", createdBy: me.id } });
  await audit(me, "AI knowledge draft saved", `${docKey} v${row.version}`);
  return row.id;
}
/** Approves a version: it replaces the record's current approved version (kept as archived for rollback). */
export async function approveKnowledge(me: Me, id: string) {
  need(me, "employees");
  const row = await db.aiHrKnowledgeDoc.findUnique({ where: { id } });
  if (!row) throw new UserError("Record not found.");
  if (row.createdBy === me.id && me.role !== "admin") throw new UserError("Someone else has to approve a record you wrote.");
  await db.$transaction([
    db.aiHrKnowledgeDoc.updateMany({ where: { docKey: row.docKey, status: "approved", id: { not: id } }, data: { status: "archived" } }),
    db.aiHrKnowledgeDoc.update({ where: { id }, data: { status: "approved", approvedBy: me.id, approvedAt: new Date() } }),
  ]);
  invalidateKnowledge();
  await audit(me, "AI knowledge approved", `${row.docKey} v${row.version}`);
}
/** Rolls a record back to an earlier version, or archives it entirely (version 0). */
export async function rollbackKnowledge(me: Me, docKey: string, version: number) {
  need(me, "employees");
  if (version === 0) {
    await db.aiHrKnowledgeDoc.updateMany({ where: { docKey, status: "approved" }, data: { status: "archived" } });
  } else {
    const row = await db.aiHrKnowledgeDoc.findUnique({ where: { docKey_version: { docKey, version } } });
    if (!row) throw new UserError("That version doesn't exist.");
    await db.$transaction([
      db.aiHrKnowledgeDoc.updateMany({ where: { docKey, status: "approved" }, data: { status: "archived" } }),
      db.aiHrKnowledgeDoc.update({ where: { id: row.id }, data: { status: "approved", approvedBy: me.id, approvedAt: new Date() } }),
    ]);
  }
  invalidateKnowledge();
  await audit(me, "AI knowledge rolled back", `${docKey} → ${version ? "v" + version : "withdrawn"}`);
}
export async function knowledgeAdmin(me: Me, q = "") {
  need(me, "employees");
  await ensureKnowledge();
  const where: Prisma.AiHrKnowledgeDocWhereInput = q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {};
  const [rows, counts] = await Promise.all([
    db.aiHrKnowledgeDoc.findMany({ where, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 150 }),
    db.aiHrKnowledgeDoc.groupBy({ by: ["status", "scope"], _count: { _all: true } }),
  ]);
  const org = await organisationDocs();
  return {
    rows: rows.map((r) => ({ id: r.id, docKey: r.docKey, version: r.version, scope: r.scope, kind: r.kind, title: r.title, body: r.body, source: r.source, status: r.status, effectiveFrom: r.effectiveFrom ? isoOf(r.effectiveFrom) : "", createdBy: r.createdBy, approvedAt: r.approvedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString() })),
    counts: counts.map((c) => ({ status: c.status, scope: c.scope, n: c._count._all })),
    live: org.map((d) => ({ title: d.title, body: d.body, source: d.source })),
  };
}
export async function testRetrieval(me: Me, question: string) {
  need(me, "employees");
  const q = z.string().trim().min(3).max(300).parse(question);
  const idx = await knowledgeIndex();
  const hits = idx.search(q, 5);
  const answer = kbFrom(idx)(q, "hinglish");
  return { hits: hits.map((h) => ({ title: h.doc.title, source: h.doc.source, scope: h.doc.scope, score: Math.round(h.score * 100) / 100, coverage: Math.round(h.coverage * 100), passage: h.passage })), answer };
}

// ── Vocabulary HR teaches the assistant (HrSetting key "aiHrVocabulary")
const wordInput = z.object({
  phrase: z.string().trim().min(2, "Write the word or phrase.").max(60, "Keep it under 60 characters."),
  intent: z.enum(TEACHABLE_INTENTS as [string, ...string[]]).optional(),
  reason: z.enum(REASONS).optional(),
}).refine((w) => !!w.intent || !!w.reason, { message: "Choose what it means." });
let vocabCache: { at: number; words: CustomWord[] } | null = null;
export async function loadVocabulary(): Promise<CustomWord[]> {
  if (vocabCache && Date.now() - vocabCache.at < 60_000) return vocabCache.words;
  const v = (await db.hrSetting.findUnique({ where: { key: "aiHrVocabulary" } }))?.value;
  const words = (Array.isArray(v) ? v : []).flatMap((x) => { const r = wordInput.safeParse(x); return r.success ? [r.data as CustomWord] : []; });
  vocabCache = { at: Date.now(), words };
  return words;
}
export async function vocabularyAdmin(me: Me) { need(me, "attendance"); return loadVocabulary(); }
export async function addWord(me: Me, raw: z.input<typeof wordInput>) {
  need(me, "attendance");
  const w = wordInput.parse(raw) as CustomWord;
  w.phrase = normalise(w.phrase);
  const words = await loadVocabulary();
  if (words.length >= 300) throw new UserError("That's 300 words already. Remove some first.");
  if (words.some((x) => x.phrase === w.phrase)) throw new UserError("That phrase is already taught. Remove it first to change its meaning.");
  const next = [...words, w];
  await db.hrSetting.upsert({ where: { key: "aiHrVocabulary" }, update: { value: next }, create: { key: "aiHrVocabulary", value: next } });
  vocabCache = null;
  await audit(me, "AI vocabulary added", `"${w.phrase}" → ${[w.intent, w.reason].filter(Boolean).join(" / ")}`);
}
export async function removeWord(me: Me, phrase: string) {
  need(me, "attendance");
  const next = (await loadVocabulary()).filter((x) => x.phrase !== phrase);
  await db.hrSetting.upsert({ where: { key: "aiHrVocabulary" }, update: { value: next }, create: { key: "aiHrVocabulary", value: next } });
  vocabCache = null;
  await audit(me, "AI vocabulary removed", `"${phrase}"`);
}

// ── Answers the assistant didn't understand: HR reviews them and teaches a meaning, or dismisses them.
const DISMISSED = "aiHrUnclearDismissed";
async function dismissedTurns(): Promise<string[]> {
  const v = (await db.hrSetting.findUnique({ where: { key: DISMISSED } }))?.value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
/** Employee answers whose meaning wasn't recognised (within the transcript retention period), newest first. Opening them is audited. */
export async function unclearAnswers(me: Me) {
  need(me, "attendance");
  const [hidden, vocabulary] = await Promise.all([dismissedTurns(), loadVocabulary()]);
  const rows = await db.aiHrTurn.findMany({
    where: { who: "employee", intent: "unknown", ...(hidden.length ? { id: { notIn: hidden } } : {}) },
    orderBy: { at: "desc" }, take: 100,
    include: { call: { select: { id: true, reason: true, day: true, staff: { select: { name: true, empNo: true } } } } },
  });
  if (rows.length) await audit(me, "AI unclear answers opened", `${rows.length} answers`);
  return rows.map((t) => {
    const text = openText(t.textSealed);
    // With the words HR has taught since, would the assistant understand it now?
    const now = understand(text, 600, { reason: t.call.reason, custom: vocabulary }).primary;
    return { id: t.id, callId: t.call.id, at: t.at.toISOString(), text, reason: t.call.reason, day: isoOf(t.call.day), name: t.call.staff.name, empNo: t.call.staff.empNo, now: now === "unknown" ? "" : now };
  });
}
export async function dismissUnclear(me: Me, turnId: string) {
  need(me, "attendance");
  const t = await db.aiHrTurn.findUnique({ where: { id: turnId }, select: { id: true, who: true } });
  if (!t || t.who !== "employee") throw new UserError("That answer is no longer kept.");
  const known = new Set(await db.aiHrTurn.findMany({ where: { id: { in: [...(await dismissedTurns()), turnId] } }, select: { id: true } }).then((r) => r.map((x) => x.id)));
  const next = [...known].slice(-2000); // turns deleted by retention drop out of the list
  await db.hrSetting.upsert({ where: { key: DISMISSED }, update: { value: next }, create: { key: DISMISSED, value: next } });
}
/** Teaches a phrase from an unclear answer and takes the answer off the list. */
export async function teachFromUnclear(me: Me, turnId: string, raw: z.input<typeof wordInput>) {
  await addWord(me, raw);
  await dismissUnclear(me, turnId);
}

// ── Weekly summary email to HR (Attendance & leave holders), once a week from Monday, counted from database rows.
let digestSentFor = "";
/** Counts for the seven days before `now` (the summary passes Monday 00:00 India time, so it covers last Monday to Sunday). */
export async function digestStats(now = new Date()): Promise<DigestStats> {
  const since = new Date(now.getTime() - 7 * 86400_000);
  const [calls, resp, opened, open, urgent, unclear] = await Promise.all([
    db.aiHrCall.groupBy({ by: ["reason", "status"], where: { createdAt: { gte: since, lt: now } }, _count: { _all: true } }),
    db.aiHrCallResponse.findMany({ where: { createdAt: { gte: since, lt: now } }, select: { employeeResponse: true, overtimeResponse: true, humanEscalationRequired: true, employeeRequestedStop: true } }),
    db.aiHrAction.count({ where: { createdAt: { gte: since, lt: now } } }),
    db.aiHrAction.count({ where: { status: "open" } }),
    db.aiHrAction.count({ where: { status: "open", priority: "urgent" } }),
    db.aiHrTurn.count({ where: { who: "employee", intent: "unknown", at: { gte: since, lt: now } } }),
  ]);
  const sum = (f: (c: (typeof calls)[number]) => boolean) => calls.filter(f).reduce((a, c) => a + c._count._all, 0);
  return {
    conversations: sum(() => true), completed: sum((c) => c.status === "completed"), noAnswer: sum((c) => c.status === "no_answer"),
    byReason: { late: sum((c) => c.reason === "late"), absent: sum((c) => c.reason === "absent"), missing_checkout: sum((c) => c.reason === "missing_checkout"), overtime: sum((c) => c.reason === "overtime"), manual: sum((c) => c.reason === "manual") },
    coming: resp.filter((r) => r.employeeResponse === "coming").length, absent: resp.filter((r) => r.employeeResponse === "absent").length,
    otAccepted: resp.filter((r) => r.overtimeResponse === "accepted").length, otRejected: resp.filter((r) => r.overtimeResponse === "rejected").length,
    escalations: resp.filter((r) => r.humanEscalationRequired).length, stops: resp.filter((r) => r.employeeRequestedStop).length,
    actionsRaised: opened, openActions: open, urgentOpen: urgent, unclear,
  };
}
/** Sends the weekly summary once per week (an atomic claim on one HrSetting row, so several servers send it once). */
export async function weeklyDigest(now = new Date()): Promise<number> {
  const week = digestWeek(now);
  if (digestSentFor === week) return 0;
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.weeklyDigest || !mailEnabled()) return 0;
  const claimed = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "HrSetting" (key, value) VALUES ('aiHrDigest', jsonb_build_object('week', ${week}::text))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE "HrSetting".value->>'week' IS DISTINCT FROM ${week}::text
    RETURNING key`;
  digestSentFor = week;
  if (!claimed.length) return 0;
  const ids = await holders("attendance");
  const people = await db.staffUser.findMany({ where: { id: { in: ids } }, select: { name: true, email: true } });
  const stats = await digestStats(new Date(`${week}T00:00:00+05:30`));
  const org = (await loadSettings()).company.name || "Medoro";
  let sent = 0;
  for (const p of people) {
    if (!p.email) continue;
    const ok = await sendMail({ to: p.email, ...aiHrDigestMail({ name: p.name, org, week, stats }) }).then(() => true).catch((e) => { log.warn("ai-hr digest mail failed", { err: e instanceof Error ? e.message : String(e) }); return false; });
    if (ok) sent++;
  }
  log.info("ai-hr weekly digest", { week, recipients: sent });
  return sent;
}

// ── The conversation, for the employee it belongs to
async function ownCall(me: Me, id: string) {
  const call = await db.aiHrCall.findUnique({ where: { id }, include: { staff: { select: { name: true } } } });
  if (!call || call.staffId !== me.id) throw new UserError("This conversation isn't yours or no longer exists.");
  return call;
}
async function ctxFor(call: { reason: string; context: Prisma.JsonValue; staff: { name: string } }, cfg: AiHrConfig): Promise<Ctx> {
  const cx = (call.context ?? {}) as { shiftStart?: string; shiftEnd?: string; overtime?: Ctx["overtime"]; topic?: string };
  const idx = await knowledgeIndex();
  return { name: call.staff.name.trim().split(/\s+/)[0], nowMin: nowMinIST(new Date()), shiftStart: cx.shiftStart, shiftEnd: cx.shiftEnd, overtime: cx.overtime, topic: cx.topic, retentionDays: cfg.retentionDays, kb: kbFrom(idx), vocabulary: await loadVocabulary() };
}
const sealText = (t: string) => new Uint8Array(seal(t));
const openText = (b: Uint8Array) => unseal(b).toString("utf8");

export async function myCalls(me: Me) {
  const [calls, consent, cfg, h] = await Promise.all([
    db.aiHrCall.findMany({ where: { staffId: me.id }, orderBy: { createdAt: "desc" }, take: 15, include: { response: { select: { summary: true } } } }),
    db.aiHrConsent.findUnique({ where: { staffId: me.id } }), loadConfig(), ai.serviceConfig() ? ai.health() : Promise.resolve(null),
  ]);
  return {
    open: calls.filter((c) => ["scheduled", "notified", "in_progress"].includes(c.status)).map((c) => ({ id: c.id, reason: c.reason, day: isoOf(c.day), status: c.status })),
    past: calls.filter((c) => !["scheduled", "notified", "in_progress"].includes(c.status)).map((c) => ({ id: c.id, reason: c.reason, day: isoOf(c.day), status: c.status, summary: c.response?.summary ?? "" })),
    allowed: consent?.status !== "stopped", enabled: cfg.enabled,
    speech: cfg.speech, sttModel: cfg.sttModel, modelSource: cfg.modelSource,
    // Server speech only when the AI host answers; browser speech needs nothing from the server.
    voice: cfg.speech === "browser" || (cfg.speech === "server" && !!h?.reachable && h.stt?.ok !== false),
    tts: cfg.speech === "server" ? !!h?.reachable && h.tts?.ok !== false : cfg.speech === "browser",
    retentionDays: cfg.retentionDays,
  };
}

async function maybeSpeak(text: string, cfg: AiHrConfig) {
  if (cfg.speech !== "server" || !ai.serviceConfig() || !text) return null;
  try { return await ai.speak(text); } catch (e) { log.warn("ai-hr tts failed", { err: e instanceof Error ? e.message : String(e) }); return null; }
}

/** Starts (or resumes) a conversation: the assistant's opening line. */
export async function beginCall(me: Me, id: string, opts: { speak?: boolean } = {}) {
  const call = await ownCall(me, id);
  const cfg = await loadConfig();
  if (!["scheduled", "notified", "in_progress"].includes(call.status)) throw new UserError("This conversation has ended.");
  if (call.status === "in_progress") {
    const turns = await db.aiHrTurn.findMany({ where: { callId: id }, orderBy: { seq: "asc" } });
    return { turns: turns.map((t) => ({ who: t.who as "ai" | "employee", text: openText(t.textSealed) })), done: false, audio: null, speech: "" };
  }
  const t = start(call.reason as CallReason, await ctxFor(call, cfg));
  const audio = opts.speak ? await maybeSpeak(t.speech || t.reply, cfg) : null;
  await db.$transaction([
    db.aiHrCall.update({ where: { id }, data: { status: "in_progress", startedAt: new Date(), state: t.state as unknown as Prisma.InputJsonValue, nextAttemptAt: null } }),
    db.aiHrTurn.create({ data: { callId: id, seq: 0, who: "ai", textSealed: sealText(t.reply), lang: t.state.lang, ttsMs: audio?.ms ?? null } }),
    db.aiHrCallAttempt.create({ data: { callId: id, n: call.attempts, outcome: "answered", detail: "opened in the HRMS" } }),
  ]);
  return { turns: [{ who: "ai" as const, text: t.reply }], done: false, audio, speech: t.speech ?? t.reply };
}

/** Canonical phrasing for an intent a local model suggested, so the engine's own rules decide what happens next. */
const CANON: Partial<Record<string, string>> = { coming: "haan aa raha hoon", absent: "aaj nahi aa paunga", leave_applied: "leave apply kar di hai", want_leave: "leave chahiye", wfh: "work from home", already_checked_in: "main office mein hoon", attendance_issue: "check in nahi ho raha, app problem", still_working: "abhi bhi kaam kar raha hoon", forgot_checkout: "checkout bhool gaya", overtime_accept: "haan kar lunga", overtime_reject: "nahi kar paunga", overtime_clarify: "kitne ghante ka hai", busy: "abhi busy hoon", yes: "haan", no: "nahi" };

/** One employee turn, typed or spoken. Audio goes to the self-hosted speech service and is not stored. */
export async function sendTurn(me: Me, id: string, input: { text?: string; audio?: Blob | null; speak?: boolean; sttMs?: number }) {
  await enforce("aiHrTurn", `hrms:${me.id}`);
  const call = await ownCall(me, id);
  if (call.status !== "in_progress") throw new UserError("This conversation isn't active. Open it again.");
  const cfg = await loadConfig();
  let text = String(input.text ?? "").slice(0, 1000).trim(), sttMs: number | null = Number.isFinite(input.sttMs) && input.sttMs! > 0 ? Math.min(600_000, Math.round(input.sttMs!)) : null;
  if (!text && input.audio && input.audio.size > 0) {
    if (input.audio.size > 3_000_000) throw new UserError("That recording is too long. Keep each answer short.");
    if (!ai.serviceConfig()) throw new UserError("Voice isn't available right now. Please type your answer.");
    try { const r = await ai.transcribe(input.audio); text = r.text; sttMs = r.ms; }
    catch (e) { log.warn("ai-hr stt failed", { err: e instanceof Error ? e.message : String(e) }); throw new UserError("I couldn't hear that clearly. Please try again or type your answer."); }
  }
  const prev = call.state as unknown as State;
  const ctx = await ctxFor(call, cfg);
  let used = text, llmMs: number | null = null, intentNote = "";
  // A local model may place an utterance the rules can't, but only by choosing one of the engine's own intents.
  if (text && cfg.llmAssist && understand(text, ctx.nowMin, { reason: call.reason, custom: ctx.vocabulary }).primary === "unknown") {
    const t0 = Date.now();
    const m = await ai.classify(text, call.reason, prev.lastQ ?? "");
    if (m && m.intent !== "unknown" && CANON[m.intent]) { used = `${CANON[m.intent]}${m.eta ? " " + m.eta : ""}`; intentNote = `llm:${m.intent}`; llmMs = Date.now() - t0; }
  }
  const r = step(prev, ctx, used);
  const seq = await db.aiHrTurn.count({ where: { callId: id } });
  const audio = input.speak && r.reply ? await maybeSpeak(r.speech || r.reply, cfg) : null;
  const writes: Prisma.PrismaPromise<unknown>[] = [
    db.aiHrTurn.create({ data: { callId: id, seq, who: "employee", textSealed: sealText(text), lang: r.nlu?.lang ?? r.state.lang, intent: intentNote || (r.nlu?.primary ?? (text ? "" : "silence")), sttMs, llmMs } }),
    db.aiHrCall.update({ where: { id }, data: { state: r.state as unknown as Prisma.InputJsonValue } }),
  ];
  if (r.reply) writes.push(db.aiHrTurn.create({ data: { callId: id, seq: seq + 1, who: "ai", textSealed: sealText(r.reply), lang: r.state.lang, ttsMs: audio?.ms ?? null } }));
  await db.$transaction(writes);
  if (r.done) await finish(id);
  return { reply: r.reply, speech: r.speech ?? r.reply, done: r.done, heard: text, audio };
}

/** The employee hangs up. What was said so far is kept and summarised. */
export async function endCall(me: Me, id: string) {
  const call = await ownCall(me, id);
  if (call.status !== "in_progress") return;
  const st = call.state as unknown as State;
  if (!st.ended) { st.ended = true; st.endReason = "incomplete"; if (!st.flags.followup.includes("incomplete")) st.flags.followup.push("incomplete"); }
  await db.aiHrCall.update({ where: { id }, data: { state: st as unknown as Prisma.InputJsonValue } });
  await finish(id);
}

/** Stores the validated outcome, records follow-ups for HR, applies a stop request, and tells HR what needs a person. */
async function finish(id: string) {
  const call = await db.aiHrCall.findUniqueOrThrow({ where: { id }, include: { turns: { orderBy: { seq: "asc" } }, staff: { select: { name: true } } } });
  if (call.status === "completed") return;
  const cfg = await loadConfig();
  const st = call.state as unknown as State;
  const now = new Date();
  let o: CallOutput;
  try {
    o = buildOutput(st, { organisationId: ORG_ID, employeeId: call.staffId, reason: call.reason as CallReason, transcript: call.turns.map((t) => ({ who: t.who as "ai" | "employee", text: openText(t.textSealed) })), startedAt: call.startedAt, endedAt: now, status: "completed" });
  } catch (e) {
    log.error("ai-hr output failed validation", { err: e });
    await db.$transaction([
      db.aiHrCall.update({ where: { id }, data: { status: "failed", endedAt: now } }),
      db.aiHrAction.create({ data: { callId: id, staffId: call.staffId, kind: "hr_followup", payload: { detail: "The conversation's outcome could not be validated. Please check the transcript." } } }),
    ]);
    return;
  }
  const actions = o.recommended.map((r) => ({ callId: id, staffId: call.staffId, kind: r.kind, priority: r.priority, payload: { detail: r.detail, eta: o.expectedArrivalTime, callbackTime: o.callbackTime, overtime: o.overtimeResponse, reason: o.reasonCategory }, status: ["expected_arrival", "stop_calls"].includes(r.kind) ? "done" : "open" }));
  await db.$transaction([
    db.aiHrCallResponse.create({ data: { callId: id, reasonCategory: o.reasonCategory, employeeResponse: o.employeeResponse, expectedArrival: o.expectedArrivalTime ?? "", leaveRequestIntent: o.leaveRequestIntent, overtimeResponse: o.overtimeResponse ?? "", callbackRequested: o.callbackRequested, callbackTime: o.callbackTime ?? "", humanEscalationRequired: o.humanEscalationRequired, employeeRequestedStop: o.employeeRequestedStop, summary: o.conversationSummary, confidence: o.confidenceScore, said: o.said, inferred: o.inferred, recommended: o.recommended } }),
    db.aiHrCall.update({ where: { id }, data: { status: "completed", endedAt: now, retainUntil: new Date(now.getTime() + cfg.retentionDays * 86400_000) } }),
    ...actions.map((a) => db.aiHrAction.create({ data: a })),
    ...(o.employeeRequestedStop ? [db.aiHrConsent.upsert({ where: { staffId: call.staffId }, update: { status: "stopped", source: "ai_call", reason: "Asked during an AI conversation", changedAt: now }, create: { staffId: call.staffId, status: "stopped", source: "ai_call", reason: "Asked during an AI conversation" } })] : []),
  ]);
  // A callback becomes a new conversation at the time asked (today), as a fresh event.
  if (o.callbackRequested && o.callbackTime && /^\d{2}:\d{2}$/.test(o.callbackTime)) {
    const when = new Date(`${todayISO(now)}T${o.callbackTime}:00+05:30`);
    if (when > now) await db.aiHrCall.create({ data: { staffId: call.staffId, reason: call.reason, day: call.day, eventKey: `callback:${id}`, maxAttempts: 1, nextAttemptAt: when, context: call.context ?? {}, createdBy: "callback" } }).catch((e) => { if (!P2002(e)) throw e; });
  }
  const hr = (await holders("attendance")).filter((x) => x !== call.staffId);
  if (o.escalationPriority === "urgent") await notify(hr, `URGENT · AI HR Assistant: ${call.staff.name} needs HR now (${o.conversationSummary}). Open AI HR Assistant → Escalations.`.slice(0, 240), "aihr");
  else if (o.humanEscalationRequired) await notify(hr, `AI HR Assistant: ${call.staff.name} asked for HR follow-up. Open AI HR Assistant → Escalations.`, "aihr");
  if (call.reason === "overtime" && o.overtimeResponse && o.overtimeResponse !== "none") {
    const by = ((call.context ?? {}) as { requestedBy?: string }).requestedBy;
    if (by) await notify([by], `AI HR Assistant: ${call.staff.name} ${o.overtimeResponse === "accepted" ? "is available for" : o.overtimeResponse === "rejected" ? "is not available for" : "has questions about"} the overtime you requested. You decide; nothing was approved automatically.`, "aihr");
  }
}

export async function setConsent(me: Me, allowed: boolean) {
  await db.aiHrConsent.upsert({ where: { staffId: me.id }, update: { status: allowed ? "allowed" : "stopped", source: "employee", reason: "", changedAt: new Date() }, create: { staffId: me.id, status: allowed ? "allowed" : "stopped", source: "employee" } });
  if (!allowed) await db.aiHrCall.updateMany({ where: { staffId: me.id, status: { in: ["scheduled", "notified"] } }, data: { status: "suppressed", suppressReason: "Employee switched AI conversations off.", nextAttemptAt: null } });
  await audit(me, allowed ? "AI conversations turned on" : "AI conversations turned off");
}

// ── HR side
export async function overview(me: Me) {
  need(me, "attendance");
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byStatus, byReason, resp, actions, consentsOff, cfg, health] = await Promise.all([
    db.aiHrCall.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.aiHrCall.groupBy({ by: ["reason"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.aiHrCallResponse.findMany({ where: { createdAt: { gte: since } }, select: { employeeResponse: true, overtimeResponse: true, callbackRequested: true, humanEscalationRequired: true, employeeRequestedStop: true, confidence: true } }),
    db.aiHrAction.groupBy({ by: ["status", "priority"], _count: { _all: true } }),
    db.aiHrConsent.count({ where: { status: "stopped" } }), loadConfig(), ai.health(),
  ]);
  const st = Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])) as Record<string, number>;
  const kn = await db.aiHrKnowledgeDoc.groupBy({ by: ["status"], _count: { _all: true } });
  const lastEval = await db.aiHrEvalRun.findFirst({ orderBy: { startedAt: "desc" } });
  return {
    enabled: cfg.enabled, total: byStatus.reduce((a, x) => a + x._count._all, 0),
    completed: st.completed ?? 0, failed: st.failed ?? 0, pending: (st.scheduled ?? 0) + (st.notified ?? 0), live: st.in_progress ?? 0, noAnswer: st.no_answer ?? 0, suppressed: (st.suppressed ?? 0) + (st.cancelled ?? 0),
    byReason: Object.fromEntries(byReason.map((x) => [x.reason, x._count._all])) as Record<string, number>,
    late: resp.filter((r) => r.employeeResponse === "coming").length, absent: resp.filter((r) => r.employeeResponse === "absent").length,
    otAccepted: resp.filter((r) => r.overtimeResponse === "accepted").length, otRejected: resp.filter((r) => r.overtimeResponse === "rejected").length,
    callbacks: resp.filter((r) => r.callbackRequested).length, escalations: resp.filter((r) => r.humanEscalationRequired).length, stops: resp.filter((r) => r.employeeRequestedStop).length,
    avgConfidence: resp.length ? Math.round((resp.reduce((a, r) => a + r.confidence, 0) / resp.length) * 100) : null,
    openActions: actions.filter((a) => a.status === "open").reduce((a, x) => a + x._count._all, 0), urgentOpen: actions.filter((a) => a.status === "open" && a.priority === "urgent").reduce((a, x) => a + x._count._all, 0),
    consentsOff, health, knowledge: Object.fromEntries(kn.map((x) => [x.status, x._count._all])) as Record<string, number>,
    scenarios: { library: LIBRARY_VERSION, total: libraryScenarios().length, custom: await db.aiHrScenario.count({ where: { disabled: false } }) },
    lastEval: lastEval ? { at: lastEval.startedAt.toISOString(), total: lastEval.total, passed: lastEval.passed } : null,
  };
}

const callFilter = z.object({ reason: z.enum([...CALL_REASONS, ""]).default(""), status: z.string().max(20).default(""), days: z.coerce.number().int().min(1).max(365).default(30) });
export async function listCalls(me: Me, raw: z.input<typeof callFilter> = {}) {
  need(me, "attendance");
  const f = callFilter.parse(raw);
  const rows = await db.aiHrCall.findMany({
    where: { createdAt: { gte: new Date(Date.now() - f.days * 86400_000) }, ...(f.reason ? { reason: f.reason } : {}), ...(f.status ? { status: f.status } : {}) },
    orderBy: { createdAt: "desc" }, take: 200, include: { staff: { select: { name: true, empNo: true } }, response: true },
  });
  return rows.map((c) => ({ id: c.id, name: c.staff.name, empNo: c.staff.empNo, reason: c.reason, day: isoOf(c.day), status: c.status, attempts: c.attempts, createdAt: c.createdAt.toISOString(), startedAt: c.startedAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null, suppressReason: c.suppressReason, response: c.response ? { employeeResponse: c.response.employeeResponse, reason: c.response.reasonCategory, eta: c.response.expectedArrival, overtime: c.response.overtimeResponse, callback: c.response.callbackTime, escalate: c.response.humanEscalationRequired, stop: c.response.employeeRequestedStop, summary: c.response.summary, confidence: c.response.confidence } : null }));
}
/** Opens a transcript (HR with Attendance). Each opening is written to the audit log. */
export async function callDetail(me: Me, id: string) {
  need(me, "attendance");
  const c = await db.aiHrCall.findUnique({ where: { id }, include: { staff: { select: { name: true, empNo: true } }, turns: { orderBy: { seq: "asc" } }, response: true, attemptRows: { orderBy: { at: "asc" } }, actions: true } });
  if (!c) throw new UserError("Conversation not found.");
  await audit(me, "AI conversation transcript opened", `${c.staff.empNo} · ${c.reason} · ${isoOf(c.day)}`);
  return {
    id: c.id, name: c.staff.name, empNo: c.staff.empNo, reason: c.reason, day: isoOf(c.day), status: c.status, context: c.context,
    turns: c.turns.map((t) => ({ who: t.who, text: openText(t.textSealed), lang: t.lang, intent: t.intent, at: t.at.toISOString(), sttMs: t.sttMs, llmMs: t.llmMs, ttsMs: t.ttsMs })),
    response: c.response, attempts: c.attemptRows.map((a) => ({ n: a.n, outcome: a.outcome, detail: a.detail, at: a.at.toISOString() })),
    actions: c.actions.map((a) => ({ id: a.id, kind: a.kind, status: a.status, priority: a.priority })), retainUntil: c.retainUntil?.toISOString() ?? null,
  };
}
export async function actionsBoard(me: Me, status: "open" | "all" = "open") {
  need(me, "attendance");
  const rows = await db.aiHrAction.findMany({ where: status === "open" ? { status: "open" } : {}, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 200 });
  const staff = await db.staffUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.staffId))] } }, select: { id: true, name: true, empNo: true } });
  return rows.map((a) => ({ id: a.id, callId: a.callId, staffId: a.staffId, name: staff.find((s) => s.id === a.staffId)?.name ?? "", empNo: staff.find((s) => s.id === a.staffId)?.empNo ?? "", kind: a.kind, priority: a.priority, status: a.status, detail: String((a.payload as { detail?: string })?.detail ?? ""), reason: String((a.payload as { reason?: string })?.reason ?? ""), note: a.note, createdAt: a.createdAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null }));
}
/**
 * HR's decision on a proposal. Approving records the decision and tells the employee; the AI never writes leave,
 * attendance, pay or overtime rows. HR applies an approved change in the screen that owns it (Leave Management,
 * Attendance corrections, Payroll), so every existing rule and approval there still applies.
 */
export async function decideAction(me: Me, id: string, approve: boolean, note = "", leaveType = "") {
  need(me, "attendance");
  const a = await db.aiHrAction.findUnique({ where: { id } });
  if (!a) throw new UserError("Action not found.");
  if (a.status !== "open") throw new UserError("This was already decided.");
  if (a.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to decide something about you.");
  const n = z.string().trim().max(300).parse(note);
  if (!approve && n.length < 3) throw new UserError("Say why, in a few words.");
  // An approved leave draft becomes a real leave through the HRMS's own rules (balance, overlap, weekends, holidays),
  // filed for the employee and approved by this HR person. Any rule that refuses it leaves the proposal open.
  if (approve && (a.kind === "leave_draft" || a.kind === "half_day_request")) {
    const type = z.enum(APPLY_IDS, { error: "Choose the leave type." }).parse(leaveType);
    const call = a.callId ? await db.aiHrCall.findUnique({ where: { id: a.callId }, select: { day: true } }) : null;
    const day = isoOf(call?.day ?? new Date());
    const u = await db.staffUser.findUniqueOrThrow({ where: { id: a.staffId }, include: { hr: true } });
    const employee = { ...me, id: u.id, name: u.name, first: u.name.split(" ")[0], role: u.hr?.role ?? "employee", staffRole: u.role } as Me;
    await applyLeave(employee, { type, from: day, to: day, half: a.kind === "half_day_request", reason: `From an AI HR conversation (approved by ${me.name})` });
    const leave = await db.hrLeave.findFirstOrThrow({ where: { staffId: a.staffId, status: "pending", fromDay: dateOnly(day) }, orderBy: { createdAt: "desc" } });
    await decideLeave(me, leave.id, true);
    await db.aiHrAction.update({ where: { id }, data: { status: "done", note: [n, `${leaveLabel(type)} recorded`].filter(Boolean).join(" · "), decidedBy: me.id, decidedAt: new Date(), payload: { ...(a.payload as object), leaveId: leave.id } } });
    await audit(me, "AI leave draft approved", `${a.staffId} · ${type} · ${day}`);
    return;
  }
  await db.aiHrAction.update({ where: { id }, data: { status: approve ? "approved" : "rejected", note: n, decidedBy: me.id, decidedAt: new Date() } });
  const tell: Record<string, string> = { leave_draft: "HR reviewed the leave you mentioned in your AI conversation and couldn't approve it", wfh_request: approve ? "Your work-from-home request from the AI conversation was approved by HR." : "Your work-from-home request from the AI conversation wasn't approved", half_day_request: "Your half-day request from the AI conversation wasn't approved" };
  if (tell[a.kind]) await notify([a.staffId], `${tell[a.kind]}${!approve && n ? `: ${n}` : approve ? "" : "."}`, approve && a.kind !== "wfh_request" ? "leave" : "aicall");
  await audit(me, `AI action ${approve ? "approved" : "rejected"}`, `${a.kind} · ${a.staffId}${n ? " · " + n : ""}`);
}

// ── Retention and deletion
export async function retentionSweep(now = new Date()) {
  const due = await db.aiHrCall.findMany({ where: { retainUntil: { lte: now } }, select: { id: true }, take: 500 });
  for (const c of due) await purgeTranscript(c.id);
  return due.length;
}
async function purgeTranscript(callId: string) {
  await db.$transaction([
    db.aiHrTurn.deleteMany({ where: { callId } }),
    db.aiHrCall.update({ where: { id: callId }, data: { state: {}, retainUntil: null } }),
    db.aiHrCallResponse.updateMany({ where: { callId }, data: { said: [] } }),
  ]);
}
/** Deletes a transcript now (on an employee's request or for a correction). The structured outcome stays, without quotes. */
export async function deleteTranscript(me: Me, callId: string) {
  needAdmin(me);
  const c = await db.aiHrCall.findUnique({ where: { id: callId }, select: { staffId: true, reason: true } });
  if (!c) throw new UserError("Conversation not found.");
  await purgeTranscript(callId);
  await audit(me, "AI conversation transcript deleted", `${c.staffId} · ${c.reason}`);
}

// ── Scenarios, evaluation and the playground
export async function scenarioAdmin(me: Me) {
  need(me, "attendance");
  const v = validateLibrary();
  const custom = await db.aiHrScenario.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const runs = await db.aiHrEvalRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  const sample = libraryScenarios().filter((_, i) => i % 10 === 0).map((s) => ({ id: s.id, category: s.categoryName, reason: s.callReason, opening: s.opening, english: s.english, hindi: s.hindi, expect: s.expect, split: s.split }));
  return { version: LIBRARY_VERSION, validation: { total: v.total, categories: v.categories, valid: v.valid, duplicates: v.duplicates.length, problems: v.problems.length, perCategory: v.perCategory }, sample, custom: custom.map((c) => ({ id: c.id, category: c.category, utterance: c.utterance, callReason: c.callReason, expect: c.expect, disabled: c.disabled, createdAt: c.createdAt.toISOString() })), runs: runs.map((r) => ({ id: r.id, at: r.startedAt.toISOString(), split: r.split, total: r.total, passed: r.passed, metrics: r.metrics, failures: r.failures })) };
}
const scInput = z.object({ category: z.string().trim().min(2).max(60), utterance: z.string().trim().min(2).max(400), callReason: z.enum(CALL_REASONS), expect: z.string().trim().min(3, "Say what should happen, e.g. s=coming eta=11:00").max(200) });
export async function addScenario(me: Me, raw: z.input<typeof scInput>) {
  need(me, "attendance");
  const i = scInput.parse(raw);
  const ex = parseExpect(i.expect);
  if (!Object.keys(ex).length) throw new UserError("Write the expectation as key=value, e.g. s=coming eta=11:00.");
  await db.aiHrScenario.create({ data: { category: i.category, utterance: i.utterance, callReason: i.callReason, expect: ex, createdBy: me.id } });
  await audit(me, "AI scenario added", `${i.category} · ${i.callReason}`);
}
export async function toggleScenario(me: Me, id: string, disabled: boolean) {
  need(me, "attendance");
  await db.aiHrScenario.update({ where: { id }, data: { disabled } });
}
/** Runs the whole library (plus HR's own scenarios) through the engine and stores the result. */
export async function runEvaluation(me: Me) {
  need(me, "attendance");
  const run = await db.aiHrEvalRun.create({ data: { by: me.id } });
  const custom = await db.aiHrScenario.findMany({ where: { disabled: false } });
  const list: Scenario[] = [...libraryScenarios(), ...custom.map((c, i) => ({ id: `custom-${i + 1}`, category: `custom:${c.category}`, categoryName: c.category, callReason: c.callReason as CallReason, situation: c.utterance, opening: c.utterance.split("||")[0].trim(), turns: c.utterance.split("||").map((t) => t.trim()), english: c.utterance, hindi: c.utterance, hindiSource: "category" as const, objective: "", escalation: "", expect: c.expect as Record<string, string>, split: "tuning" as const }))];
  const r = evaluateAll(list, LIBRARY_VERSION, { vocabulary: await loadVocabulary() });
  await db.aiHrEvalRun.update({ where: { id: run.id }, data: { total: r.total, passed: r.passed, metrics: { ...r.metrics, bySplit: r.bySplit } as unknown as Prisma.InputJsonValue, failures: r.failures.slice(0, 100).map((f) => ({ id: f.id, failed: f.failed })), finishedAt: new Date() } });
  await audit(me, "AI scenario evaluation run", `${r.passed}/${r.total}`);
  return { total: r.total, passed: r.passed };
}
const pgInput = z.object({ reason: z.enum(CALL_REASONS), lines: z.array(z.string().max(500)).max(12), lang: z.enum(["hinglish", "hi", "en"]).default("hinglish") });
/** Plays a conversation without contacting anyone or saving anything (HR's test bench). */
export async function playground(me: Me, raw: z.input<typeof pgInput>) {
  need(me, "attendance");
  const i = pgInput.parse(raw);
  const idx = await knowledgeIndex();
  const ctx: Ctx = { name: me.first, nowMin: nowMinIST(new Date()), shiftStart: "10:00", shiftEnd: "19:00", retentionDays: (await loadConfig()).retentionDays, kb: kbFrom(idx), vocabulary: await loadVocabulary(), overtime: i.reason === "overtime" ? { date: addDays(todayISO(), 1), hours: 2, from: "19:00", why: "testing" } : undefined };
  const r = converse(i.reason, ctx, i.lines);
  const o = buildOutput(r.state, { organisationId: ORG_ID, employeeId: me.id, reason: i.reason, transcript: r.turns, status: r.state.ended ? "completed" : "in_progress" });
  return { turns: r.turns, output: o, lang: r.state.lang as Lang };
}
export async function modelStatus(me: Me) {
  need(me, "attendance");
  const config = await loadConfig();
  return { health: await ai.health(), sip: process.env.AI_HR_SIP_ENABLED === "1", mail: mailEnabled(), config, speechFiles: await speechFilesStatus(config.sttModel) };
}
export { can };
