import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.6", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, loadSettings, type Me } from "@/staff/hrms/auth";
import { idleEnd, idleStart, idleToday, purgeOld, selfieImage } from "@/staff/hrms/monitor";
import { saveSettings, startBreak } from "@/staff/hrms/people";
import { checkIn, checkOut, teamToday } from "@/staff/hrms/time";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";

let admin: Me, hr: Me, emp: Me, other: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee", hr: "admin" | "hr" | "employee") =>
  db.staffUser.create({ data: { empNo: `MS-00${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98200000${n}0`, role, status: "active", hr: { create: { role: hr, profileDone: true, docsAcceptedAt: new Date() } } } });
const jpeg = (size = 3000) => "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]).toString("base64");
const setting = async (patch: Partial<Awaited<ReturnType<typeof loadSettings>>>) => saveSettings(admin, { ...(await loadSettings()), ...patch });
const wipeToday = async () => { await db.hrAttendance.deleteMany({}); await db.hrSelfie.deleteMany({}); await db.hrIdle.deleteMany({}); };

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk(1, "Asha Admin", "super_admin", "admin")).id);
  hr = await mkMe((await mk(2, "Hari Hr", "employee", "hr")).id);
  emp = await mkMe((await mk(3, "Esha Employee", "employee", "employee")).id);
  other = await mkMe((await mk(4, "Omar Other", "employee", "employee")).id);
  // A check-in is "late" after this time; keep the test independent of the clock.
  await setting({ lateAfter: "23:59" });
});
beforeEach(() => jar.clear());

describe("selfie check-in", () => {
  it("is off by default: checking in needs no photo", async () => {
    expect((await loadSettings()).selfie).toBe(false);
    await checkIn(emp);
    await wipeToday();
  });
  it("when on, no valid selfie means no check-in, and nothing is recorded", async () => {
    await setting({ selfie: true });
    await expect(checkIn(emp)).rejects.toThrow(/selfie/i);
    await expect(checkIn(emp, "data:image/png;base64,AAAA")).rejects.toThrow(/selfie/i);
    await expect(checkIn(emp, "data:image/jpeg;base64," + Buffer.alloc(3000, 1).toString("base64"))).rejects.toThrow(/isn’t a JPEG/);
    await expect(checkIn(emp, jpeg(200_000))).rejects.toThrow(/too large/);
    await expect(checkIn(emp, jpeg(10))).rejects.toThrow(/too large or too small/);
    expect(await db.hrAttendance.count()).toBe(0);
    expect(await db.hrSelfie.count()).toBe(0);
  });
  it("a valid selfie checks in, is stored sealed, and opens only for its owner and HR", async () => {
    await checkIn(emp, jpeg());
    const row = await db.hrSelfie.findFirstOrThrow({ where: { staffId: emp.id, kind: "in" } });
    expect(Buffer.from(row.image).includes(Buffer.alloc(100, 7))).toBe(false); // not the plain picture
    const own = await selfieImage(emp, row.id);
    expect(own && own[0] === 0xff && own[1] === 0xd8 && own.length).toBe(3004);
    expect(await selfieImage(hr, row.id)).not.toBeNull();
    expect(await selfieImage(other, row.id)).toBeNull();
    expect(await selfieImage(emp, "missing")).toBeNull();
  });
  it("checking out needs a selfie too, and HR sees both in the team list", async () => {
    await expect(checkOut(emp)).rejects.toThrow(/selfie/i);
    await checkOut(emp, jpeg(4000));
    const row = (await teamToday(hr)).find((r) => r.id === emp.id)!;
    expect(row.selfieIn).toBeTruthy();
    expect(row.selfieOut).toBeTruthy();
    expect((await teamToday(hr)).find((r) => r.id === other.id)!.selfieIn).toBeNull();
    await expect(teamToday(emp)).rejects.toThrow(/role can’t/);
  });
  it("selfies older than 30 days and idle records older than 90 are deleted; recent ones stay", async () => {
    const old = dateOnly(addDays(todayISO(), -40)), older = dateOnly(addDays(todayISO(), -100)), recent = dateOnly(addDays(todayISO(), -5));
    await db.hrSelfie.createMany({ data: [{ staffId: emp.id, day: old, kind: "in", image: new Uint8Array([1]) }, { staffId: emp.id, day: recent, kind: "in", image: new Uint8Array([1]) }] });
    await db.hrIdle.createMany({ data: [{ staffId: emp.id, day: older, startAt: older, endAt: older, minutes: 5 }, { staffId: emp.id, day: old, startAt: old, endAt: old, minutes: 5 }] });
    await purgeOld();
    expect(await db.hrSelfie.count({ where: { day: old } })).toBe(0);
    expect(await db.hrSelfie.count({ where: { day: recent } })).toBe(1);
    expect(await db.hrIdle.count({ where: { day: older } })).toBe(0);
    expect(await db.hrIdle.count({ where: { day: old } })).toBe(1); // idle is kept 90 days
    await setting({ selfie: false });
    await wipeToday();
  });
});

describe("idle-time monitoring", () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  it("does nothing while it is switched off", async () => {
    await checkIn(emp);
    expect(await idleStart(emp, ago(20))).toEqual({ recorded: false });
    expect(await db.hrIdle.count()).toBe(0);
  });
  it("records an idle stretch only for someone checked in, once at a time", async () => {
    await setting({ idleMonitor: true, idleMinutes: 5 });
    // The employee checked in two hours ago (so earlier inactivity is counted from then, not from the check-in moment).
    await db.hrAttendance.updateMany({ where: { staffId: emp.id }, data: { inAt: new Date(Date.now() - 2 * 3600_000) } });
    expect(await idleStart(other, ago(20))).toEqual({ recorded: false }); // not checked in
    expect(await idleStart(emp, ago(20))).toEqual({ recorded: true });
    expect(await idleStart(emp, ago(10))).toEqual({ recorded: false }); // already idle
    const now = (await idleToday()).get(emp.id)!;
    expect(now.open).toBe(true);
    expect(now.minutes).toBeGreaterThanOrEqual(19);
    expect((await teamToday(hr)).find((r) => r.id === emp.id)).toMatchObject({ idleNow: true });
    expect(await idleEnd(emp)).toEqual({ closed: 1 });
    const done = (await idleToday()).get(emp.id)!;
    expect(done.open).toBe(false);
    expect(done.minutes).toBeGreaterThanOrEqual(19);
    expect(done.minutes).toBeLessThanOrEqual(21);
    expect(await idleEnd(emp)).toEqual({ closed: 0 });
  });
  it("never counts time before the check-in or in the future", async () => {
    await db.hrIdle.deleteMany();
    await db.hrAttendance.updateMany({ where: { staffId: emp.id }, data: { inAt: new Date(Date.now() - 2 * 3600_000) } });
    await idleStart(emp, new Date(Date.now() - 48 * 3600_000).toISOString());
    const a = await db.hrAttendance.findFirstOrThrow({ where: { staffId: emp.id } });
    const i1 = await db.hrIdle.findFirstOrThrow();
    expect(i1.startAt.getTime()).toBe(a.inAt!.getTime());
    await idleEnd(emp);
    await db.hrIdle.deleteMany();
    await idleStart(emp, new Date(Date.now() + 3600_000).toISOString());
    expect((await db.hrIdle.findFirstOrThrow()).startAt.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(idleStart(emp, "not a time")).rejects.toThrow();
    await idleEnd(emp);
  });
  it("a break or a check-out ends an idle stretch (a break isn't idle time)", async () => {
    await db.hrIdle.deleteMany();
    await idleStart(emp, ago(8));
    await startBreak(emp, "Lunch");
    expect((await db.hrIdle.findFirstOrThrow()).endAt).not.toBeNull();
    await db.hrIdle.deleteMany();
    await idleStart(emp, ago(6));
    await checkOut(emp);
    expect((await db.hrIdle.findFirstOrThrow()).endAt).not.toBeNull();
    expect(await idleStart(emp, ago(3))).toEqual({ recorded: false }); // checked out
  });
  it("only the super admin can change the monitoring settings, and idle minutes stay between 1 and 30", async () => {
    await expect(saveSettings(emp, await loadSettings())).rejects.toThrow(/Only the super admin/);
    await expect(setting({ idleMinutes: 0 })).rejects.toThrow(/at least 1/);
    await expect(setting({ idleMinutes: 31 })).rejects.toThrow(/at most 30/);
  });
});
