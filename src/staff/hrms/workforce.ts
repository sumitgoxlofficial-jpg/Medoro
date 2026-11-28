import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { rateLimit } from "@/server/rate-limit";
import { audit, can, holders, loadSettings, need, notify, type Me } from "./auth";
import { APP_CATEGORIES, MONITOR_POLICY_VERSION, type AppCategory } from "./workforce-policy";

// The workforce event engine: company PCs enrolled by HR, the agent API (status, events), and what employees and HR see.
// Recording is allowed only when ALL of these hold, checked on the server for every status call and every span:
//   tracking is switched on (Settings), the device is enrolled and not revoked, its employee is active and not the super
//   admin, the employee accepted the current policy, and the span lies inside a check-in (not a break, not after check-out).
// The schema accepts only a process name and active/idle/locked: there is no field for anything else.

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const RETENTION_DAYS = 90;
export const CODE_MINUTES = 15;
const IST = 5.5 * 3600_000;
export type Why = "ok" | "tracking-off" | "policy" | "device-inactive" | "not-checked-in" | "checked-out" | "break" | "not-applicable";
const MESSAGES: Record<Why, string> = {
  ok: "",
  "tracking-off": "Workforce tracking is switched off by the company. Nothing is recorded.",
  policy: "Accept the workforce activity policy in My activity first. Nothing is recorded until you do.",
  "device-inactive": "This PC is not active in Medoro.",
  "not-checked-in": "You are not checked in. Nothing is recorded until you check in.",
  "checked-out": "You are checked out. Nothing is recorded.",
  break: "You are on a break. Nothing is recorded.",
  "not-applicable": "Activity is not recorded for this account.",
};

// ── Enrolment (HR) and the device token
/** HR issues a one-time code for an employee's company PC. The code is shown once and stored only hashed. */
export async function issueDeviceCode(me: Me, staffId: string) {
  need(me, "attendance");
  const u = await db.staffUser.findFirst({ where: { id: staffId, kind: "team", status: "active", deletedAt: null, role: { notIn: ["partner", "super_admin"] } } });
  if (!u) throw new UserError("Choose an active employee.");
  const code = Array.from({ length: 3 }, () => String(randomInt(0, 10_000)).padStart(4, "0")).join("-");
  await db.hrDeviceCode.create({ data: { staffId, codeHash: sha(code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), createdBy: me.id } });
  await audit(me, "Agent enrolment code issued", `${u.empNo} · company PC`);
  return { code, minutes: CODE_MINUTES, employee: u.name };
}

const enrolInput = z.object({ code: z.string().trim().min(4).max(40), name: z.string().trim().min(1).max(80).transform((v) => v.replace(/[^\w.\- ]/g, "").slice(0, 60) || "PC"), platform: z.enum(["windows"]).default("windows"), agentVersion: z.string().trim().max(20).default("") }).strict();

/** The agent exchanges a code for its token (returned once). Codes are single use; attempts are throttled per address. */
export async function enrolDevice(raw: unknown, ip: string | null) {
  if (!(await rateLimit(`agent-enrol:${ip ?? "?"}`, 10, 3600_000))) throw new UserError("Too many enrolment attempts. Try again in an hour.");
  const i = enrolInput.parse(raw);
  const c = await db.hrDeviceCode.findUnique({ where: { codeHash: sha(i.code) } });
  if (!c || c.usedAt || c.expiresAt < new Date()) throw new UserError("That code is wrong or has expired. Ask HR for a new one.");
  const token = randomBytes(32).toString("base64url");
  const device = await db.$transaction(async (tx) => {
    const used = await tx.hrDeviceCode.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new UserError("That code was used already.");
    return tx.hrDevice.create({ data: { staffId: c.staffId, name: i.name, platform: i.platform, agentVersion: i.agentVersion, tokenHash: sha(token), enrolledBy: c.createdBy, lastIp: ip }, include: { staff: { select: { name: true } } } });
  });
  await notify([c.staffId], `A company PC (${device.name}) was enrolled for your account. Its tray icon shows whether anything is recorded; see My activity.`, "myactivity");
  return { deviceId: device.id, token, employee: device.staff.name };
}

/** The device behind a bearer token, or null (unknown or revoked: the agent must stop). */
export async function deviceFor(authHeader: string | null) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(authHeader ?? "");
  if (!m) return null;
  const d = await db.hrDevice.findUnique({ where: { tokenHash: sha(m[1]) }, include: { staff: { select: { id: true, name: true, status: true, role: true, deletedAt: true } } } });
  if (!d || d.revokedAt || d.staff.deletedAt || d.staff.status !== "active") return null;
  return d;
}
type Device = NonNullable<Awaited<ReturnType<typeof deviceFor>>>;

/** Why recording is or isn't allowed for this person right now. */
export async function recordingState(staffId: string, role: string, now = new Date()): Promise<{ why: Why; inAt: Date | null }> {
  const s = await loadSettings(true);
  if (!s.agentTracking) return { why: "tracking-off", inAt: null };
  if (role === "super_admin") return { why: "not-applicable", inAt: null };
  if (!(await db.hrMonitorAck.findUnique({ where: { staffId_version: { staffId, version: MONITOR_POLICY_VERSION } } }))) return { why: "policy", inAt: null };
  const a = await db.hrAttendance.findUnique({ where: { staffId_day: { staffId, day: dateOnly(todayISO(now)) } } });
  if (!a?.inAt) return { why: "not-checked-in", inAt: null };
  if (a.outAt) return { why: "checked-out", inAt: a.inAt };
  if (await db.hrBreak.findFirst({ where: { staffId, endAt: null } })) return { why: "break", inAt: a.inAt };
  return { why: "ok", inAt: a.inAt };
}

export async function agentStatus(d: Device, ip: string | null) {
  await db.hrDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), lastIp: ip } });
  const { why } = await recordingState(d.staffId, d.staff.role);
  const s = await loadSettings();
  const base = (process.env.APP_URL || "").replace(/\/+$/, "");
  return { recording: why === "ok", reason: why, message: MESSAGES[why], employee: d.staff.name, policyVersion: MONITOR_POLICY_VERSION, idleSeconds: s.agentIdleMinutes * 60, sampleSeconds: 10, activityUrl: base ? `${base}/staff/hrms/myactivity` : "" };
}

// ── Ingest
const MAX_SPAN_MS = 60 * 60_000, SKEW_MS = 5 * 60_000, MAX_AGE_MS = 7 * 86400_000;
const eventSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  kind: z.enum(["active", "idle", "locked"]),
  app: z.string().regex(/^[\w.\- ]{1,80}$/).nullish(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
}).strict(); // anything else (a title, a URL…) makes the whole upload invalid
export const uploadSchema = z.object({ events: z.array(eventSchema).max(500) }).strict();

/**
 * Stores spans from a device. Each span must be inside one of the employee's check-ins (between check-in and check-out
 * or now), outside their breaks, at most an hour long, not in the future and not older than 7 days. Spans that aren't
 * are counted as `outside` and dropped. A span already received (same device and clientId) is a duplicate, not an error.
 */
export async function ingest(d: Device, raw: unknown, now = new Date()) {
  if (!(await rateLimit(`agent-events:${d.id}`, 240, 3600_000))) throw new UserError("Too many uploads from this PC. Try again later.");
  const { events } = uploadSchema.parse(raw);
  const state = await recordingState(d.staffId, d.staff.role, now);
  if (state.why === "tracking-off" || state.why === "policy" || state.why === "not-applicable") return { accepted: 0, duplicates: 0, outside: events.length, reason: state.why };
  const spans = events.map((e) => ({ ...e, s: new Date(e.startedAt), e: new Date(e.endedAt) }));
  const days = [...new Set(spans.map((x) => todayISO(x.s)))];
  const [atts, breaks] = await Promise.all([
    db.hrAttendance.findMany({ where: { staffId: d.staffId, day: { in: days.map(dateOnly) } } }),
    db.hrBreak.findMany({ where: { staffId: d.staffId, startAt: { gte: new Date(dateOnly(days.sort()[0] ?? todayISO()).getTime() - IST) } } }),
  ]);
  const att = new Map(atts.map((a) => [isoOf(a.day), a]));
  const ok = spans.filter((x) => {
    const len = x.e.getTime() - x.s.getTime();
    if (len <= 0 || len > MAX_SPAN_MS || x.e.getTime() > now.getTime() + SKEW_MS || now.getTime() - x.s.getTime() > MAX_AGE_MS) return false;
    const a = att.get(todayISO(x.s));
    if (!a?.inAt || x.s < a.inAt || x.e.getTime() > (a.outAt ?? new Date(now.getTime() + SKEW_MS)).getTime()) return false;
    return !breaks.some((b) => x.s < (b.endAt ?? now) && x.e > b.startAt);
  });
  const res = await db.hrWorkEvent.createMany({
    data: ok.map((x) => ({ staffId: d.staffId, deviceId: d.id, clientId: x.clientId, kind: x.kind, app: x.kind === "active" ? x.app ?? null : null, day: dateOnly(todayISO(x.s)), startedAt: x.s, endedAt: x.e, seconds: Math.round((x.e.getTime() - x.s.getTime()) / 1000) })),
    skipDuplicates: true,
  });
  await db.hrDevice.update({ where: { id: d.id }, data: { lastSeenAt: now } });
  return { accepted: res.count, duplicates: ok.length - res.count, outside: spans.length - ok.length, reason: null };
}

// ── What people see
const categories = async () => new Map((await db.hrAppCategory.findMany()).map((c) => [c.app, c.category as AppCategory]));
const minutes = (s: number) => Math.round(s / 60);

/**
 * One person's day: totals, programs (with HR's category) and the spans themselves. For the person; HR (Attendance)
 * opening someone else's is audited. Excluded spans (accepted disputes) are listed but not counted.
 */
export async function activityDay(me: Me, staffId: string, dayRaw: string) {
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dayRaw);
  if (staffId !== me.id) need(me, "attendance");
  const [rows, cats] = await Promise.all([db.hrWorkEvent.findMany({ where: { staffId, day: dateOnly(day) }, orderBy: { startedAt: "asc" }, take: 3000 }), categories()]);
  if (staffId !== me.id) await audit(me, "Workforce activity opened", `${staffId} · ${day}`);
  const counted = rows.filter((r) => !r.excluded);
  const sum = (k: string) => counted.filter((r) => r.kind === k).reduce((a, r) => a + r.seconds, 0);
  const byApp = new Map<string, number>();
  for (const r of counted) if (r.kind === "active" && r.app) byApp.set(r.app, (byApp.get(r.app) ?? 0) + r.seconds);
  const cat = (app: string) => cats.get(app.toLowerCase()) ?? "unknown";
  const apps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).map(([app, s]) => ({ app, minutes: minutes(s), category: cat(app) }));
  const catMin = (c: AppCategory) => apps.filter((a) => a.category === c).reduce((x, a) => x + a.minutes, 0);
  return {
    day, activeMin: minutes(sum("active")), idleMin: minutes(sum("idle")), lockedMin: minutes(sum("locked")),
    byCategory: { work: catMin("work"), neutral: catMin("neutral"), personal: catMin("personal"), unknown: catMin("unknown") },
    first: counted[0]?.startedAt.toISOString() ?? null, last: counted.at(-1)?.endedAt.toISOString() ?? null, apps,
    spans: rows.slice(0, 400).map((r) => ({ id: r.id, kind: r.kind, app: r.app, from: r.startedAt.toISOString(), to: r.endedAt.toISOString(), minutes: Math.max(1, minutes(r.seconds)), excluded: r.excluded })),
    note: "Activity is context only: time in programs never measures performance on its own. KPIs measure output and outcomes.",
  };
}

/** The employee's own page: whether anything can be recorded, the policy, their PCs, today and their disputes. */
export async function myActivity(me: Me, day = todayISO()) {
  const [s, ack, devices, disputes, state] = await Promise.all([
    loadSettings(), db.hrMonitorAck.findUnique({ where: { staffId_version: { staffId: me.id, version: MONITOR_POLICY_VERSION } } }),
    db.hrDevice.findMany({ where: { staffId: me.id }, orderBy: { enrolledAt: "desc" } }),
    db.hrActivityDispute.findMany({ where: { staffId: me.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    recordingState(me.id, me.staffRole),
  ]);
  return {
    tracking: s.agentTracking, acknowledged: ack?.at.toISOString() ?? null, policyVersion: MONITOR_POLICY_VERSION, state: state.why, message: MESSAGES[state.why] || "Your company PC records activity now. The tray icon shows it.",
    devices: devices.map((d) => ({ id: d.id, name: d.name, enrolledAt: d.enrolledAt.toISOString(), lastSeenAt: d.lastSeenAt?.toISOString() ?? null, revoked: !!d.revokedAt, agentVersion: d.agentVersion })),
    disputes: disputes.map((x) => ({ id: x.id, day: isoOf(x.day), from: x.fromTime, to: x.toTime, reason: x.reason, status: x.status, reply: x.reply })),
    activity: await activityDay(me, me.id, day),
  };
}

export async function acknowledgePolicy(me: Me) {
  await db.hrMonitorAck.upsert({ where: { staffId_version: { staffId: me.id, version: MONITOR_POLICY_VERSION } }, update: {}, create: { staffId: me.id, version: MONITOR_POLICY_VERSION } });
  await audit(me, "Workforce activity policy accepted", `version ${MONITOR_POLICY_VERSION}`);
}

/** The employee or HR (Attendance) removes a PC: it stops at its next contact and its token never works again. */
export async function revokeDevice(me: Me, id: string, rawReason = "") {
  const d = await db.hrDevice.findUnique({ where: { id } });
  if (!d || (d.staffId !== me.id && !can(me, "attendance"))) throw new UserError("Device not found.");
  if (d.revokedAt) throw new UserError("This PC was removed already.");
  await db.hrDevice.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: me.id, revokeReason: String(rawReason ?? "").trim().slice(0, 200) } });
  if (d.staffId !== me.id) await notify([d.staffId], `HR removed the company PC ${d.name} from workforce tracking.`, "myactivity");
  await audit(me, "Agent device revoked", `${d.staffId} · ${d.name}`);
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time as HH:MM.");
const disputeInput = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day."), from: hhmm, to: hhmm, reason: z.string().trim().min(10, "Say what is wrong (at least a sentence).").max(500) });

/** The employee disputes a window of recorded activity (last 30 days). HR is told. */
export async function raiseDispute(me: Me, raw: z.input<typeof disputeInput>) {
  const i = disputeInput.parse(raw);
  if (i.to <= i.from) throw new UserError("The end time must be after the start time.");
  if (i.day > todayISO() || i.day < addDays(todayISO(), -30)) throw new UserError("Disputes are for the last 30 days.");
  if ((await db.hrActivityDispute.count({ where: { staffId: me.id, status: "open" } })) >= 10) throw new UserError("You have 10 disputes waiting already.");
  await db.hrActivityDispute.create({ data: { staffId: me.id, day: dateOnly(i.day), fromTime: i.from, toTime: i.to, reason: i.reason } });
  await notify(await holders("attendance"), `${me.name} disputed recorded activity on ${i.day} (${i.from}–${i.to}).`, "workforce");
}

const at = (day: string, t: string) => new Date(`${day}T${t}:00+05:30`);
/** HR decides. Accepting excludes every span overlapping the window from all totals (the rows are kept, marked). */
export async function decideDispute(me: Me, id: string, accept: boolean, rawReply = "") {
  need(me, "attendance");
  const reply = String(rawReply ?? "").trim().slice(0, 500);
  if (!accept && reply.length < 5) throw new UserError("Say why you are rejecting it.");
  const x = await db.hrActivityDispute.findUnique({ where: { id } });
  if (!x || x.status !== "open") throw new UserError("This dispute was already decided.");
  if (x.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to decide your own dispute.");
  const day = isoOf(x.day);
  await db.$transaction(async (tx) => {
    const claimed = await tx.hrActivityDispute.updateMany({ where: { id, status: "open" }, data: { status: accept ? "accepted" : "rejected", reply, decidedBy: me.id, decidedAt: new Date() } });
    if (!claimed.count) throw new UserError("This dispute was already decided.");
    if (accept) await tx.hrWorkEvent.updateMany({ where: { staffId: x.staffId, startedAt: { lt: at(day, x.toTime) }, endedAt: { gt: at(day, x.fromTime) } }, data: { excluded: true } });
  });
  await notify([x.staffId], accept ? `HR accepted your activity dispute for ${day} (${x.fromTime}–${x.toTime}). Those minutes are removed.` : `HR rejected your activity dispute for ${day}: ${reply}`, "myactivity");
  await audit(me, `Activity dispute ${accept ? "accepted" : "rejected"}`, `${x.staffId} · ${day} ${x.fromTime}–${x.toTime}`);
}

/** HR's Workforce screen: devices, open disputes, a team summary for one day, and the programs seen recently. */
export async function workforceAdmin(me: Me, dayRaw = todayISO()) {
  need(me, "attendance");
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dayRaw);
  const [devices, disputes, rows, cats, recent, s] = await Promise.all([
    db.hrDevice.findMany({ include: { staff: { select: { name: true, empNo: true } } }, orderBy: [{ revokedAt: "asc" }, { enrolledAt: "desc" }], take: 500 }),
    db.hrActivityDispute.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 200 }),
    db.hrWorkEvent.groupBy({ by: ["staffId", "kind"], where: { day: dateOnly(day), excluded: false }, _sum: { seconds: true } }),
    categories(),
    db.hrWorkEvent.groupBy({ by: ["app"], where: { day: { gte: dateOnly(addDays(todayISO(), -30)) }, kind: "active", app: { not: null } }, _sum: { seconds: true }, orderBy: { _sum: { seconds: "desc" } }, take: 60 }),
    loadSettings(),
  ]);
  const ids = [...new Set([...rows.map((r) => r.staffId), ...disputes.map((d) => d.staffId)])];
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, empNo: true } })).map((u) => [u.id, u]));
  const team = new Map<string, { active: number; idle: number; locked: number }>();
  for (const r of rows) { const t = team.get(r.staffId) ?? { active: 0, idle: 0, locked: 0 }; t[r.kind as "active" | "idle" | "locked"] = minutes(r._sum.seconds ?? 0); team.set(r.staffId, t); }
  return {
    tracking: s.agentTracking, day,
    devices: devices.map((d) => ({ id: d.id, name: d.name, person: d.staff.name, empNo: d.staff.empNo, enrolledAt: d.enrolledAt.toISOString(), lastSeenAt: d.lastSeenAt?.toISOString() ?? null, revoked: !!d.revokedAt, agentVersion: d.agentVersion })),
    disputes: disputes.map((x) => ({ id: x.id, person: names.get(x.staffId)?.name ?? "", day: isoOf(x.day), from: x.fromTime, to: x.toTime, reason: x.reason, mine: x.staffId === me.id })),
    team: [...team.entries()].map(([id, t]) => ({ id, name: names.get(id)?.name ?? "", empNo: names.get(id)?.empNo ?? "", ...t })).sort((a, b) => a.name.localeCompare(b.name)),
    apps: recent.map((r) => ({ app: r.app!, minutes: minutes(r._sum.seconds ?? 0), category: cats.get(r.app!.toLowerCase()) ?? "unknown" })),
  };
}

export async function setAppCategory(me: Me, rawApp: string, rawCategory: string) {
  need(me, "attendance");
  const app = z.string().regex(/^[\w.\- ]{1,80}$/).parse(rawApp).toLowerCase();
  const category = z.enum(APP_CATEGORIES).parse(rawCategory);
  await db.hrAppCategory.upsert({ where: { app }, update: { category, setBy: me.id }, create: { app, category, setBy: me.id } });
  await audit(me, "Program category set", `${app} → ${category}`);
}

/** Daily: spans older than the retention period and spent enrolment codes are deleted. */
export async function workforceRetention(now = new Date()) {
  const cutoff = dateOnly(addDays(todayISO(now), -RETENTION_DAYS));
  const [a, b] = await Promise.all([
    db.hrWorkEvent.deleteMany({ where: { day: { lt: cutoff } } }),
    db.hrDeviceCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86400_000) } } }),
  ]);
  return a.count + b.count;
}

/** The signed description of a newer agent build, when the server is set up to offer one (see agent/README.md). */
export async function updateManifest() {
  const version = process.env.AGENT_UPDATE_VERSION, url = process.env.AGENT_UPDATE_URL, sha256 = process.env.AGENT_UPDATE_SHA256, key = process.env.AGENT_UPDATE_SIGNING_KEY;
  if (!version || !url || !sha256 || !key) return null;
  const { createPrivateKey, sign } = await import("node:crypto");
  const m = { version, url, sha256: sha256.toLowerCase() };
  const signature = sign("sha256", Buffer.from(`medoro-agent-update\n${m.version}\n${m.url}\n${m.sha256}`), { key: createPrivateKey({ key: Buffer.from(key, "base64"), format: "der", type: "pkcs8" }), dsaEncoding: "ieee-p1363" }).toString("base64");
  return { ...m, signature };
}
