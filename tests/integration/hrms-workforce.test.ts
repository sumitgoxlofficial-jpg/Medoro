import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 4: device enrolment and revocation, the agent API (status, events, update), the rules that limit
// recording (tracking switch, policy acceptance, check-in, breaks, strict schema), disputes, access and retention.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.7", "user-agent": "MedoroAgent/1.0.0" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { generateKeyPairSync, verify } from "node:crypto";
import { db } from "@/server/db";
import { invalidateSettings, loadPerms, type Me } from "@/staff/hrms/auth";
import { DEFAULT_SETTINGS } from "@/staff/hrms/constants";
import { acknowledgePolicy, activityDay, decideDispute, issueDeviceCode, raiseDispute, revokeDevice, workforceRetention } from "@/staff/hrms/workforce";
import { MONITOR_POLICY_VERSION } from "@/staff/hrms/workforce-policy";
import { dateOnly, todayISO } from "@/lib/dates";
import { POST as enrolRoute } from "@/app/api/agent/enrol/route";
import { GET as statusRoute } from "@/app/api/agent/status/route";
import { POST as eventsRoute } from "@/app/api/agent/events/route";
import { GET as updateRoute } from "@/app/api/agent/update/route";
import { resetDb } from "./helpers";

let hr: Me, emp: Me, other: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (name: string, hrRole: "hr" | "employee") => (await db.staffUser.create({ data: { empNo: `MS-${300 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: "95000000" + String(n).padStart(2, "0"), role: "employee", status: "active", hr: { create: { role: hrRole, profileDone: true } } } })).id;
const setSettings = async (v: Partial<typeof DEFAULT_SETTINGS>) => { await db.hrSetting.upsert({ where: { key: "settings" }, update: { value: { ...DEFAULT_SETTINGS, ...v } }, create: { key: "settings", value: { ...DEFAULT_SETTINGS, ...v } } }); invalidateSettings(); };
const req = (path: string, token: string | null, body?: unknown) => new Request(`https://hr.test${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const span = (id: string, fromMin: number, toMin: number, extra: Record<string, unknown> = {}) => ({ clientId: id.padEnd(12, "0"), kind: "active", app: "EXCEL", startedAt: ago(fromMin).toISOString(), endedAt: ago(toMin).toISOString(), ...extra });

describe("HRMS workforce agent (Phase 4)", () => {
  let token = "";
  afterAll(() => { vi.useRealTimers(); });
  beforeAll(async () => {
    // The spans and check-in are "N minutes ago" while the HRMS day is India's date: run at midday IST so they never
    // straddle midnight (this test failed whenever CI ran between 00:00 and ~02:00 IST).
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${todayISO()}T13:00:00+05:30`) });
    await resetDb();
    hr = await me(await mk("Hari HR", "hr"));
    emp = await me(await mk("Esha Employee", "employee"));
    other = await me(await mk("Omar Other", "employee"));
  });

  it("only HR issues enrolment codes; a code works once and only until it expires", async () => {
    await expect(issueDeviceCode(emp, emp.id)).rejects.toThrow(/role can’t/);
    const c = await issueDeviceCode(hr, emp.id);
    expect(c.code).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    expect(await db.hrDeviceCode.count({ where: { codeHash: c.code } })).toBe(0); // stored hashed only
    const bad = await enrolRoute(req("/api/agent/enrol", null, { code: "0000-0000-0000", name: "PC" }));
    expect(bad.status).toBe(400);
    const ok = await enrolRoute(req("/api/agent/enrol", null, { code: c.code, name: "ESHA-LAPTOP<script>", agentVersion: "1.0.0" }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ employee: "Esha Employee" });
    token = body.token;
    expect((await db.hrDevice.findUniqueOrThrow({ where: { id: body.deviceId } })).name).toBe("ESHA-LAPTOPscript");
    expect((await enrolRoute(req("/api/agent/enrol", null, { code: c.code, name: "PC2" }))).status).toBe(400); // used
    const late = await issueDeviceCode(hr, emp.id);
    await db.hrDeviceCode.updateMany({ where: { usedAt: null }, data: { expiresAt: ago(1) } });
    expect((await enrolRoute(req("/api/agent/enrol", null, { code: late.code, name: "PC3" }))).status).toBe(400);
    expect((await statusRoute(req("/api/agent/status", "not-a-real-token-xxxxxxxxxxxx"))).status).toBe(401);
  });

  it("records only with tracking on, the policy accepted, checked in and not on a break", async () => {
    const st = async () => (await (await statusRoute(req("/api/agent/status", token))).json()) as { recording: boolean; reason: string; message: string };
    expect(await st()).toMatchObject({ recording: false, reason: "tracking-off" });
    await setSettings({ agentTracking: true });
    expect(await st()).toMatchObject({ recording: false, reason: "policy" });
    expect((await eventsRoute(req("/api/agent/events", token, { events: [span("pol", 5, 4)] }))).status).toBe(403);
    await acknowledgePolicy(emp);
    expect(await st()).toMatchObject({ recording: false, reason: "not-checked-in" });
    await db.hrAttendance.create({ data: { staffId: emp.id, day: dateOnly(todayISO()), inAt: ago(120), status: "present" } });
    expect(await st()).toMatchObject({ recording: true, reason: "ok" });
    const brk = await db.hrBreak.create({ data: { staffId: emp.id, kind: "tea", startAt: ago(60) } });
    expect(await st()).toMatchObject({ recording: false, reason: "break", message: expect.stringMatching(/break/) });
    await db.hrBreak.update({ where: { id: brk.id }, data: { endAt: ago(50) } });
    expect(await st()).toMatchObject({ recording: true });
  });

  it("accepts only spans inside working time, refuses any extra field, and de-duplicates", async () => {
    const send = async (events: unknown[]) => { const r = await eventsRoute(req("/api/agent/events", token, { events })); return { status: r.status, body: await r.json() }; };
    expect((await send([span("t1", 10, 9, { title: "Salary sheet.xlsx" })])).status).toBe(400); // no titles, ever
    expect((await send([span("u1", 10, 9, { url: "https://x" })])).status).toBe(400);
    const r = await send([
      span("in1", 40, 30), span("in2", 30, 20, { kind: "idle", app: "EXCEL" }),
      span("pre", 150, 140), // before check-in
      span("brk", 58, 55), // during the break
      span("fut", -30, -40), // in the future
      span("long", 110, 30), // longer than an hour
    ]);
    expect(r).toMatchObject({ status: 200, body: { accepted: 2, duplicates: 0, outside: 4 } });
    expect((await send([span("in1", 40, 30)])).body).toMatchObject({ accepted: 0, duplicates: 1 });
    const rows = await db.hrWorkEvent.findMany({ where: { staffId: emp.id }, orderBy: { startedAt: "asc" } });
    expect(rows.map((x) => [x.kind, x.app])).toEqual([["active", "EXCEL"], ["idle", null]]); // idle spans carry no program
  });

  it("shows activity to the person and to HR (audited), not to colleagues", async () => {
    const mine = await activityDay(emp, emp.id, todayISO());
    expect(mine).toMatchObject({ activeMin: 10, idleMin: 10, apps: [{ app: "EXCEL", minutes: 10, category: "unknown" }] });
    await expect(activityDay(other, emp.id, todayISO())).rejects.toThrow(/role can’t/);
    await activityDay(hr, emp.id, todayISO());
    expect(await db.staffAudit.count({ where: { staffId: hr.id, action: "HRMS · Workforce activity opened" } })).toBe(1);
  });

  it("a dispute HR accepts removes the window from every total; rejection needs a reason", async () => {
    const t = (min: number) => new Date(Date.now() - min * 60_000 + 5.5 * 3600_000).toISOString().slice(11, 16);
    await raiseDispute(emp, { day: todayISO(), from: t(41), to: t(29), reason: "I was in the client meeting room" });
    const x = await db.hrActivityDispute.findFirstOrThrow({ where: { staffId: emp.id } });
    await expect(decideDispute(emp, x.id, true)).rejects.toThrow(/role can’t/);
    await expect(decideDispute(hr, x.id, false, "")).rejects.toThrow(/why/);
    await decideDispute(hr, x.id, true);
    const after = await activityDay(emp, emp.id, todayISO());
    expect(after.activeMin).toBe(0);
    expect(after.spans.find((s) => s.kind === "active")?.excluded).toBe(true);
    await expect(decideDispute(hr, x.id, true)).rejects.toThrow(/already decided/);
  });

  it("a revoked PC is refused everywhere; policy acceptances can't be changed", async () => {
    const d = await db.hrDevice.findFirstOrThrow({ where: { staffId: emp.id } });
    await expect(revokeDevice(other, d.id)).rejects.toThrow(/not found/);
    await revokeDevice(emp, d.id, "laptop returned");
    expect((await statusRoute(req("/api/agent/status", token))).status).toBe(401);
    expect((await eventsRoute(req("/api/agent/events", token, { events: [span("after", 5, 4)] }))).status).toBe(401);
    const ack = await db.hrMonitorAck.findFirstOrThrow({ where: { staffId: emp.id, version: MONITOR_POLICY_VERSION } });
    await expect(db.hrMonitorAck.delete({ where: { id: ack.id } })).rejects.toThrow(/append-only/);
  });

  it("offers a signed update only when configured, in the format the agent verifies", async () => {
    const c = await issueDeviceCode(hr, other.id);
    const t2 = (await (await enrolRoute(req("/api/agent/enrol", null, { code: c.code, name: "PC" }))).json()).token;
    expect((await updateRoute(req("/api/agent/update", t2))).status).toBe(204);
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    Object.assign(process.env, { AGENT_UPDATE_VERSION: "1.1.0", AGENT_UPDATE_URL: "https://hr.test/agent/MedoroAgent-1.1.0.msi", AGENT_UPDATE_SHA256: "AB".repeat(32), AGENT_UPDATE_SIGNING_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") });
    try {
      const m = await (await updateRoute(req("/api/agent/update", t2))).json();
      expect(m).toMatchObject({ version: "1.1.0", sha256: "ab".repeat(32) });
      const ok = verify("sha256", Buffer.from(`medoro-agent-update\n${m.version}\n${m.url}\n${m.sha256}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(m.signature, "base64"));
      expect(ok).toBe(true);
    } finally { for (const k of ["AGENT_UPDATE_VERSION", "AGENT_UPDATE_URL", "AGENT_UPDATE_SHA256", "AGENT_UPDATE_SIGNING_KEY"]) delete process.env[k]; }
  });

  it("deletes activity after the retention period", async () => {
    const d = await db.hrDevice.findFirstOrThrow({ where: { staffId: other.id } });
    const old = new Date(Date.now() - 100 * 86400_000);
    await db.hrWorkEvent.create({ data: { staffId: other.id, deviceId: d.id, clientId: "old-span-0001", kind: "active", app: "x", day: dateOnly(todayISO(old)), startedAt: old, endedAt: new Date(old.getTime() + 60_000), seconds: 60 } });
    expect(await workforceRetention()).toBeGreaterThanOrEqual(1);
    expect(await db.hrWorkEvent.count({ where: { clientId: "old-span-0001" } })).toBe(0);
    expect(await db.hrWorkEvent.count({ where: { staffId: emp.id } })).toBe(2); // recent spans stay
    await setSettings({});
  });
});
