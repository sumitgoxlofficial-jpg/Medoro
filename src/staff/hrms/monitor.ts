import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { dateOnly, todayISO } from "@/lib/dates";
import { can, loadSettings, type Me } from "./auth";

// Selfie check-in and idle-time monitoring. Both are OFF until the super admin switches them on in Settings, and both are
// deliberately narrow:
//  * A selfie is a photo HR can look at. Nothing is matched or analysed. It is sealed with HOST_KEY, only the employee and
//    people with the Attendance module can open it, and it is deleted after SELFIE_DAYS days.
//  * Idle time is measured only inside the HRMS browser tab (no keystrokes, screenshots or other apps) and only while the
//    employee is checked in and not on a break. Records are deleted after IDLE_DAYS days.
export const SELFIE_DAYS = 30, IDLE_DAYS = 90, MAX_SELFIE_BYTES = 150_000;
const OPEN_IDLE_CAP_MIN = 240; // an idle stretch nobody closed counts for at most 4 hours

/** Checks a camera picture sent as a data URL and returns its bytes: a small JPEG, nothing else. */
export function parseSelfie(dataUrl: unknown): Buffer {
  const m = typeof dataUrl === "string" ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) throw new UserError("Take a selfie with the camera to continue.");
  const b = Buffer.from(m[1], "base64");
  if (b.length < 1000 || b.length > MAX_SELFIE_BYTES) throw new UserError("The selfie is too large or too small. Take it again.");
  if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) throw new UserError("That isn’t a JPEG picture. Take the selfie again.");
  return b;
}
export async function saveSelfie(staffId: string, day: string, kind: "in" | "out", image: Buffer) {
  const data = { image: new Uint8Array(seal(image)), at: new Date() };
  await db.hrSelfie.upsert({ where: { staffId_day_kind: { staffId, day: dateOnly(day), kind } }, update: data, create: { staffId, day: dateOnly(day), kind, ...data } });
}
/** Opens one selfie for its owner or for HR (Attendance module). */
export async function selfieImage(me: Me, id: string) {
  const s = await db.hrSelfie.findUnique({ where: { id } });
  if (!s || (s.staffId !== me.id && !can(me, "attendance"))) return null;
  return Buffer.from(unseal(s.image));
}
/** Selfie ids by day for one person: { "2026-11-11": { in, out } }. */
export async function selfieIds(staffId: string, from: string, to: string) {
  const rows = await db.hrSelfie.findMany({ where: { staffId, day: { gte: dateOnly(from), lte: dateOnly(to) } }, select: { id: true, day: true, kind: true } });
  const out: Record<string, { in?: string; out?: string }> = {};
  for (const r of rows) (out[r.day.toISOString().slice(0, 10)] ??= {})[r.kind as "in" | "out"] = r.id;
  return out;
}
export async function purgeOld() {
  const day = (n: number) => dateOnly(todayISO(new Date(Date.now() - n * 86400_000)));
  await Promise.all([db.hrSelfie.deleteMany({ where: { day: { lt: day(SELFIE_DAYS) } } }), db.hrIdle.deleteMany({ where: { day: { lt: day(IDLE_DAYS) } } })]);
}

// ── Idle time
const checkedInNow = async (staffId: string) => {
  const a = await db.hrAttendance.findUnique({ where: { staffId_day: { staffId, day: dateOnly(todayISO()) } } });
  return a?.inAt && !a.outAt ? a : null;
};
/** The browser reports that the person was inactive since `sinceIso` and didn't answer "still working?". */
export async function idleStart(me: Me, sinceIso: string) {
  const s = await loadSettings();
  if (!s.idleMonitor || me.role === "admin") return { recorded: false };
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) throw new UserError("Bad time.");
  const a = await checkedInNow(me.id);
  if (!a) return { recorded: false };
  if (await db.hrIdle.findFirst({ where: { staffId: me.id, endAt: null } })) return { recorded: false };
  // Never before the check-in, never in the future, and an honest idle stretch is at least the configured minutes.
  const startAt = new Date(Math.min(Date.now(), Math.max(since.getTime(), a.inAt!.getTime())));
  await db.hrIdle.create({ data: { staffId: me.id, day: dateOnly(todayISO()), startAt } });
  await db.hrProfile.update({ where: { staffId: me.id }, data: { presenceNote: "Idle" } }).catch(() => {});
  return { recorded: true };
}
/** Closes the person's open idle stretch at `at` (activity resumed, a break started, or they checked out). */
export async function closeIdle(staffId: string, at = new Date()) {
  const open = await db.hrIdle.findMany({ where: { staffId, endAt: null } });
  for (const i of open) await db.hrIdle.update({ where: { id: i.id }, data: { endAt: at, minutes: Math.min(OPEN_IDLE_CAP_MIN, Math.max(0, Math.round((at.getTime() - i.startAt.getTime()) / 60_000))) } });
  if (open.length) await db.hrProfile.updateMany({ where: { staffId, presenceNote: "Idle" }, data: { presenceNote: "" } });
  return open.length;
}
export async function idleEnd(me: Me) { return { closed: await closeIdle(me.id) }; }

/** Idle minutes today per person, for HR. An idle stretch still open counts up to now (capped). */
export async function idleToday(): Promise<Map<string, { minutes: number; open: boolean }>> {
  const rows = await db.hrIdle.findMany({ where: { day: dateOnly(todayISO()) } });
  const out = new Map<string, { minutes: number; open: boolean }>();
  for (const r of rows) {
    const cur = out.get(r.staffId) ?? { minutes: 0, open: false };
    cur.minutes += r.endAt ? r.minutes : Math.min(OPEN_IDLE_CAP_MIN, Math.max(0, Math.round((Date.now() - r.startAt.getTime()) / 60_000)));
    cur.open ||= !r.endAt;
    out.set(r.staffId, cur);
  }
  return out;
}
