import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// AI HR Assistant against a real PostgreSQL: detection from attendance records (late, absent, missing check-out) with
// leave, holiday and weekly-off exclusions; idempotency; retries; the employee conversation end to end; stop-call;
// escalation; HR approval; access control; retention and deletion; knowledge approval; the signed webhook.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.7" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));
// Email is captured, not sent: the weekly summary is checked from what would have gone out.
const mail = vi.hoisted(() => ({ on: false, sent: [] as { to: string; subject: string; text: string }[] }));
// Browser push is captured, not sent: a 410 from the push service means the device is gone.
const push = vi.hoisted(() => ({ sent: [] as { endpoint: string; payload: string }[], gone: new Set<string>() }));
vi.mock("web-push", async (orig) => {
  const m = await orig<Record<string, unknown>>(), real = (m.default ?? m) as Record<string, unknown>;
  const sendNotification = async (sub: { endpoint: string }, payload: string) => { if (push.gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 }); push.sent.push({ endpoint: sub.endpoint, payload }); return { statusCode: 201 }; };
  return { ...real, default: { ...real, sendNotification }, sendNotification };
});
vi.mock("@/server/mail", async (orig) => ({ ...(await orig<typeof import("@/server/mail")>()), mailEnabled: () => mail.on, sendMail: async (m: { to: string; subject: string; text: string }) => { mail.sent.push(m); } }));

import { db } from "@/server/db";
import { invalidateSettings, loadPerms, type Me } from "@/staff/hrms/auth";
import { DEFAULT_SETTINGS } from "@/staff/hrms/constants";
import * as svc from "@/staff/hrms/ai-hr/service";
import { sign } from "@/staff/hrms/ai-hr/telephony";
import * as pushSvc from "@/staff/hrms/ai-hr/push";
import { dateOnly } from "@/lib/dates";
import { resetDb } from "./helpers";

let hr: Me, hr2: Me, admin: Me, a: Me, b: Me, c: Me, mgr: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.role === "super_admin" ? "admin" : u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (name: string, role: "hr" | "employee" | "admin", extra: Record<string, unknown> = {}) => (await db.staffUser.create({ data: { empNo: `MS-${700 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}${n}@medoro.in`, kind: "team", phone: "94000000" + String(n).padStart(2, "0"), role: role === "admin" ? "super_admin" : "employee", status: "active", hr: { create: { role: role === "admin" ? "employee" : role, profileDone: true, joinDate: new Date("2025-01-06"), createdAt: new Date("2025-01-06"), ...extra } } } })).id;
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const DAY = "2026-12-02"; // Wednesday
const ist = (hhmm: string, day = DAY) => `${day}T${hhmm}:00+05:30`;
const enable = (over: Partial<svc.AiHrConfig> = {}) => db.hrSetting.upsert({ where: { key: "aiHr" }, update: { value: { ...svc.DEFAULT_CONFIG, enabled: true, llmAssist: false, ...over } }, create: { key: "aiHr", value: { ...svc.DEFAULT_CONFIG, enabled: true, llmAssist: false, ...over } } });
const callsOf = (staffId: string) => db.aiHrCall.findMany({ where: { staffId }, orderBy: { createdAt: "asc" } });

describe("AI HR Assistant (integration)", () => {
  beforeAll(async () => {
    delete process.env.AI_HR_SERVICE_URL; delete process.env.AI_HR_SERVICE_TOKEN;
    await resetDb();
    await db.hrSetting.upsert({ where: { key: "settings" }, update: { value: { ...DEFAULT_SETTINGS, lateAfter: "10:00", weekOff: [0, 6] } }, create: { key: "settings", value: { ...DEFAULT_SETTINGS, lateAfter: "10:00", weekOff: [0, 6] } } }); invalidateSettings();
    hr = await me(await mk("Hema HR", "hr")); hr2 = await me(await mk("Harsh HR", "hr")); admin = await me(await mk("Sara Admin", "admin"));
    mgr = await me(await mk("Manoj Manager", "employee"));
    a = await me(await mk("Anita Late", "employee", { managerId: mgr.id })); b = await me(await mk("Bharat Leave", "employee")); c = await me(await mk("Chetan Early", "employee", { shiftStart: "09:00" }));
    await enable();
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing while switched off", async () => {
    await enable({ enabled: false });
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("10:45"));
    expect(await svc.detect()).toEqual({ created: 0, skipped: 0 });
    await enable();
  });

  it("detects lateness after the shift start + 10 min, once, and excludes approved leave", async () => {
    await db.hrLeave.create({ data: { staffId: b.id, type: "casual", fromDay: dateOnly(DAY), toDay: dateOnly(DAY), days: 1, reason: "family", status: "approved" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(ist("10:05")); expect((await svc.detect()).created).toBe(1); // only Chetan (09:00 start → absent rule after 30 min)
    expect((await callsOf(c.id))[0]).toMatchObject({ reason: "absent" });
    at(ist("10:12"));
    const r = await svc.detect();
    expect(r.created).toBeGreaterThanOrEqual(1);
    const late = await callsOf(a.id);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ reason: "late", eventKey: `late:${a.id}:${DAY}` });
    expect(await callsOf(b.id)).toHaveLength(0); // approved leave
    // duplicate attendance events: running detection again creates nothing new
    at(ist("10:20")); await svc.detect(); await svc.detect();
    expect(await callsOf(a.id)).toHaveLength(1);
    // the late call already exists, so absence at 10:30+ is not a second call for the same day
    at(ist("10:40")); await svc.detect();
    expect(await callsOf(a.id)).toHaveLength(1);
  });

  it("holidays and weekly offs never trigger a conversation", async () => {
    await db.hrHoliday.create({ data: { day: dateOnly("2026-12-03"), name: "Test holiday", kind: "National holiday" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(ist("11:00", "2026-12-03")); expect((await svc.detect()).created).toBe(0);
    at(ist("11:00", "2026-12-05")); expect((await svc.detect()).created).toBe(0); // Saturday
    expect(await db.aiHrCall.count({ where: { day: { in: [dateOnly("2026-12-03"), dateOnly("2026-12-05")] } } })).toBe(0);
  });

  it("notifies, retries at most three times, then hands over to HR; a check-in cancels a pending call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(ist("10:41")); await svc.dispatch();
    const call = (await callsOf(a.id))[0];
    expect((await db.aiHrCall.findUniqueOrThrow({ where: { id: call.id } })).attempts).toBe(1);
    expect(await db.hrNotification.count({ where: { staffId: a.id, screen: "aicall" } })).toBe(1);
    // Chetan checks in before his reminder: his pending absence call is cancelled, not sent again
    await db.hrAttendance.create({ data: { staffId: c.id, day: dateOnly(DAY), inAt: new Date(ist("10:50")), status: "late" } });
    at(ist("11:02")); await svc.dispatch();
    expect((await callsOf(c.id))[0]).toMatchObject({ status: "cancelled", suppressReason: "The employee checked in." });
    at(ist("11:23")); await svc.dispatch();
    expect((await db.aiHrCall.findUniqueOrThrow({ where: { id: call.id } })).attempts).toBe(3);
    at(ist("11:44")); await svc.dispatch();
    expect((await db.aiHrCall.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("no_answer");
    expect(await db.aiHrAction.count({ where: { callId: call.id, kind: "hr_followup" } })).toBe(1);
    expect(await db.hrNotification.count({ where: { staffId: a.id, screen: "aicall" } })).toBe(3); // retry limit
  });

  it("detects a missing check-out 15 minutes after the shift end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Chetan: 09:00 start + 8h + 30 min lunch = 17:30 end
    at(ist("17:40")); await svc.detect();
    expect((await callsOf(c.id)).some((x) => x.reason === "missing_checkout")).toBe(false);
    at(ist("17:46")); await svc.detect();
    expect((await callsOf(c.id)).filter((x) => x.reason === "missing_checkout")).toHaveLength(1);
  });

  it("runs a whole conversation as text without the AI service, stores a sealed transcript and a validated outcome", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(ist("17:50"));
    const call = (await callsOf(c.id)).find((x) => x.reason === "missing_checkout")!;
    const open = await svc.beginCall(c, call.id);
    expect(open.turns[0].text).toMatch(/Naina hoon, Medoro HR ki AI assistant/);
    expect(open.audio).toBeNull(); // no AI service configured: voice is off, text works
    await expect(svc.sendTurn(c, call.id, { audio: new Blob([new Uint8Array(5000)]) })).rejects.toThrow(/type your answer/);
    await svc.sendTurn(c, call.id, { text: "haan" });
    const end = await svc.sendTurn(c, call.id, { text: "checkout bhool gaya, 5:35 pe nikla tha" });
    expect(end.done).toBe(true);
    const row = await db.aiHrCall.findUniqueOrThrow({ where: { id: call.id }, include: { response: true, turns: true } });
    expect(row.status).toBe("completed");
    expect(row.response).toMatchObject({ employeeResponse: "forgot_checkout" });
    expect(Buffer.from(row.turns[2].textSealed).toString("utf8")).not.toMatch(/checkout/); // sealed at rest
    expect(await db.aiHrAction.count({ where: { callId: call.id, kind: "checkout_correction" } })).toBe(1);
    // attendance was not changed by the assistant
    const att = await db.hrAttendance.findUniqueOrThrow({ where: { staffId_day: { staffId: c.id, day: dateOnly(DAY) } } });
    expect(att.outAt).toBeNull();
  });

  it("another employee can't open someone's conversation; employees can't open the HR side", async () => {
    const call = (await callsOf(c.id))[0];
    await expect(svc.beginCall(a, call.id)).rejects.toThrow(/isn't yours/);
    await expect(svc.sendTurn(a, call.id, { text: "haan" })).rejects.toThrow(/isn't yours/);
    await expect(svc.overview(a)).rejects.toThrow(/role can’t/);
    await expect(svc.callDetail(a, call.id)).rejects.toThrow(/role can’t/);
    await expect(svc.saveConfig(hr, svc.DEFAULT_CONFIG)).rejects.toThrow(/super admin/);
  });

  it("overtime: a manager raises it, the employee accepts explicitly, the manager is told and nothing is approved", async () => {
    await expect(svc.requestOvertime(b, { staffId: a.id, date: "2026-12-04", hours: 2, from: "19:00", reason: "stock count" })).rejects.toThrow(/role can’t/);
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("15:00"));
    const id = await svc.requestOvertime(mgr, { staffId: a.id, date: "2026-12-04", hours: 2, from: "19:00", reason: "stock count" });
    await svc.beginCall(a, id);
    await svc.sendTurn(a, id, { text: "haan bolo" });
    await svc.sendTurn(a, id, { text: "haan kar lungi" });
    await svc.sendTurn(a, id, { text: "haan sahi hai" });
    expect((await db.aiHrCallResponse.findUniqueOrThrow({ where: { callId: id } })).overtimeResponse).toBe("accepted");
    expect(await db.hrNotification.count({ where: { staffId: mgr.id, text: { contains: "is available for" } } })).toBe(1);
    expect(await db.aiHrAction.findFirst({ where: { callId: id, kind: "overtime_response" } })).toMatchObject({ status: "open" });
    const id2 = await svc.requestOvertime(hr, { staffId: c.id, date: "2026-12-04", hours: 1, reason: "audit" });
    await svc.beginCall(c, id2);
    await svc.sendTurn(c, id2, { text: "nahi, aaj nahi ruk paunga" });
    expect((await db.aiHrCallResponse.findUniqueOrThrow({ where: { callId: id2 } })).overtimeResponse).toBe("rejected");
  });

  it("a callback request schedules a new conversation at that time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("15:10"));
    const id = await svc.startManualCall(hr, b.id, "pending documents");
    await svc.beginCall(b, id);
    await svc.sendTurn(b, id, { text: "abhi busy hoon, shaam 5 baje call karna" });
    const next = await db.aiHrCall.findUnique({ where: { eventKey: `callback:${id}` } });
    expect(next?.nextAttemptAt?.toISOString()).toBe(new Date(ist("17:00")).toISOString());
  });

  it("asking for a person escalates to HR; HR approves or rejects, never their own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("15:20"));
    const id = await svc.startManualCall(hr, hr2.id, "follow-up");
    await svc.beginCall(hr2, id);
    await svc.sendTurn(hr2, id, { text: "HR se baat karni hai" });
    const act = await db.aiHrAction.findFirstOrThrow({ where: { callId: id, kind: "human_requested" } });
    expect(await db.hrNotification.count({ where: { staffId: hr.id, text: { contains: "asked for HR follow-up" } } })).toBe(1);
    await expect(svc.decideAction(hr2, act.id, true)).rejects.toThrow(/Someone else/);
    await expect(svc.decideAction(hr, act.id, false)).rejects.toThrow(/Say why/);
    await svc.decideAction(hr, act.id, true, "Called back");
    expect(await db.aiHrAction.findUniqueOrThrow({ where: { id: act.id } })).toMatchObject({ status: "approved", decidedBy: hr.id });
    await expect(svc.decideAction(hr, act.id, true)).rejects.toThrow(/already decided/);
    await expect(db.aiHrAction.delete({ where: { id: act.id } })).rejects.toThrow();
  });

  it("a leave draft is proposed; HR's approval files and approves real leave through the leave rules", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("15:30"));
    const mk2 = async () => {
      const id = await svc.startManualCall(hr, mgr.id, "attendance");
      await db.aiHrCall.update({ where: { id }, data: { reason: "absent" } });
      await svc.beginCall(mgr, id);
      await svc.sendTurn(mgr, id, { text: "aaj nahi aa paunga, bukhar hai" });
      await svc.sendTurn(mgr, id, { text: "haan" });
      return db.aiHrAction.findFirstOrThrow({ where: { callId: id, kind: "leave_draft" } });
    };
    const act = await mk2();
    const before = await db.hrLeave.count();
    await svc.decideAction(hr, act.id, false, "Please apply in the HRMS");
    expect(await db.hrLeave.count()).toBe(before); // a rejection writes nothing
    expect(await db.hrNotification.count({ where: { staffId: mgr.id, text: { contains: "Please apply in the HRMS" } } })).toBe(1);
    const act2 = await mk2();
    await expect(svc.decideAction(hr, act2.id, true)).rejects.toThrow(/leave type/);
    await svc.decideAction(hr, act2.id, true, "", "sick");
    const leave = await db.hrLeave.findFirstOrThrow({ where: { staffId: mgr.id, fromDay: dateOnly(DAY) } });
    expect(leave).toMatchObject({ type: "sick", status: "approved", decidedBy: hr.id, days: 1 });
    expect(await db.aiHrAction.findUniqueOrThrow({ where: { id: act2.id } })).toMatchObject({ status: "done" });
    expect(await db.hrNotification.count({ where: { staffId: mgr.id, text: { contains: "Sick Leave" } } })).toBe(1);
    // the leave rules still apply: a second leave on the same day is refused and the proposal stays open
    const act3 = await mk2();
    await expect(svc.decideAction(hr, act3.id, true, "", "casual")).rejects.toThrow(/already have leave/);
    expect((await db.aiHrAction.findUniqueOrThrow({ where: { id: act3.id } })).status).toBe("open");
  });

  it("stop-call: recorded as the employee's preference; no more conversations are created or sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("15:40"));
    const id = await svc.startManualCall(hr, c.id, "check");
    await svc.beginCall(c, id);
    await svc.sendTurn(c, id, { text: "mujhe aage se call mat karo" });
    expect(await db.aiHrConsent.findUniqueOrThrow({ where: { staffId: c.id } })).toMatchObject({ status: "stopped", source: "ai_call" });
    await expect(svc.startManualCall(hr, c.id, "again")).rejects.toThrow(/switched AI conversations off/);
    at(ist("10:20", "2026-12-07")); await svc.detect();
    expect(await db.aiHrCall.count({ where: { staffId: c.id, day: dateOnly("2026-12-07") } })).toBe(0);
    await svc.setConsent(c, true);
    expect((await db.aiHrConsent.findUniqueOrThrow({ where: { staffId: c.id } })).status).toBe("allowed");
  });

  it("harassment reports are escalated urgently to HR", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("15:50"));
    const id = await svc.startManualCall(hr, b.id, "check");
    await svc.beginCall(b, id);
    await svc.sendTurn(b, id, { text: "mere saath office mein harassment ho raha hai" });
    expect(await db.aiHrAction.findFirst({ where: { callId: id, kind: "harassment_report" } })).toMatchObject({ priority: "urgent" });
    expect(await db.hrNotification.count({ where: { staffId: hr.id, text: { startsWith: "URGENT" } } })).toBe(1);
  });

  it("answers from published company policy, and routes unknown questions to HR", async () => {
    await db.hrPolicy.create({ data: { title: "Work from home policy", category: "Attendance", body: "Employees may work from home on Fridays with their manager's approval.\n\nAsk your manager a day before.", mandatory: false, version: 1, publishedBy: hr.id } });
    svc.invalidateKnowledge();
    const t = await svc.testRetrieval(hr, "work from home policy kya hai");
    expect(t.answer?.source).toBe("Work from home policy");
    expect(t.answer?.answer).toMatch(/Fridays/);
    const none = await svc.testRetrieval(hr, "gym membership reimbursement milta hai kya");
    expect(none.answer).toBeNull();
    const pg = await svc.playground(hr, { reason: "manual", lines: ["work from home policy kya hai?"] });
    expect(pg.turns.at(-1)!.text).toMatch(/Fridays.*Work from home policy/);
    const pg2 = await svc.playground(hr, { reason: "late", lines: ["mera data kaun dekhega?"] });
    expect(pg2.turns.at(-1)!.text).toMatch(/authorised HR/);
  });

  it("knowledge versions: drafts need a second person, approval replaces, rollback restores", async () => {
    const id1 = await svc.saveKnowledgeDraft(hr, { title: "Dress code", body: "Business casual from Monday to Thursday.", scope: "organisation", kind: "policy", source: "HR circular 12" });
    await expect(svc.approveKnowledge(hr, id1)).rejects.toThrow(/Someone else/);
    await svc.approveKnowledge(hr2, id1);
    const key = (await db.aiHrKnowledgeDoc.findUniqueOrThrow({ where: { id: id1 } })).docKey;
    const id2 = await svc.saveKnowledgeDraft(hr2, { docKey: key, title: "Dress code", body: "Business casual every working day.", scope: "organisation", kind: "policy", source: "HR circular 13" });
    expect((await svc.testRetrieval(hr, "dress code kya hai")).answer?.answer).toMatch(/Monday to Thursday/);
    await svc.approveKnowledge(hr, id2);
    expect((await svc.testRetrieval(hr, "dress code kya hai")).answer?.answer).toMatch(/every working day/);
    await svc.rollbackKnowledge(hr, key, 1);
    expect((await svc.testRetrieval(hr, "dress code kya hai")).answer?.answer).toMatch(/Monday to Thursday/);
    expect(await db.aiHrKnowledgeDoc.count({ where: { docKey: key } })).toBe(2);
    expect(await db.aiHrKnowledgeDoc.count({ where: { scope: "product", status: "approved" } })).toBeGreaterThan(200);
  });

  it("deletes transcripts after retention, and on request (super admin only)", async () => {
    const done = await db.aiHrCall.findMany({ where: { status: "completed" }, select: { id: true } });
    const [x, y] = done;
    await expect(svc.deleteTranscript(hr, x.id)).rejects.toThrow(/super admin/);
    await svc.deleteTranscript(admin, x.id);
    expect(await db.aiHrTurn.count({ where: { callId: x.id } })).toBe(0);
    expect((await db.aiHrCallResponse.findUniqueOrThrow({ where: { callId: x.id } })).said).toEqual([]);
    await db.aiHrCall.update({ where: { id: y.id }, data: { retainUntil: new Date(Date.now() - 1000) } });
    expect(await svc.retentionSweep()).toBeGreaterThanOrEqual(1);
    expect(await db.aiHrTurn.count({ where: { callId: y.id } })).toBe(0);
    expect(await db.aiHrCallResponse.count({ where: { callId: y.id } })).toBe(1); // the outcome (without quotes) stays
  });

  it("overview counts come from the database", async () => {
    const o = await svc.overview(hr);
    expect(o.total).toBe(await db.aiHrCall.count());
    expect(o.completed).toBe(await db.aiHrCall.count({ where: { status: "completed" } }));
    expect(o.health.configured).toBe(false);
    expect(o.scenarios.total).toBe(1000);
  });

  it("the webhook is off unless configured, verifies signatures and ignores duplicates", async () => {
    const { POST } = await import("@/app/api/webhooks/ai-hr/call-events/route");
    const call = await db.aiHrCall.findFirstOrThrow();
    await db.aiHrCall.update({ where: { id: call.id }, data: { channel: "sip" } });
    const body = JSON.stringify({ id: "evt_000000001", type: "call.no_answer", callId: call.id });
    const req = (sig: string | null) => new Request("http://x/api/webhooks/ai-hr/call-events", { method: "POST", body, headers: sig ? { "x-medoro-signature": sig } : {} });
    expect((await POST(req(null))).status).toBe(404);
    process.env.AI_HR_SIP_ENABLED = "1"; process.env.AI_HR_WEBHOOK_SECRET = "test-webhook-secret-0123456789";
    try {
      expect((await POST(req(null))).status).toBe(401);
      expect((await POST(req(sign(body, "wrong-secret")))).status).toBe(401);
      expect((await POST(req(sign(body, process.env.AI_HR_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 900)))).status).toBe(401); // too old
      const ok = await POST(req(sign(body, process.env.AI_HR_WEBHOOK_SECRET)));
      expect(await ok.json()).toEqual({ ok: true });
      const dup = await POST(req(sign(body, process.env.AI_HR_WEBHOOK_SECRET)));
      expect(await dup.json()).toEqual({ ok: true, duplicate: true });
      expect(await db.aiHrCallAttempt.count({ where: { callId: call.id, outcome: "no_answer", detail: "" } })).toBe(1);
    } finally { delete process.env.AI_HR_SIP_ENABLED; delete process.env.AI_HR_WEBHOOK_SECRET; }
  });

  it("HR teaches a phrase; live conversations understand it; only the Attendance module may change it", async () => {
    await expect(svc.addWord(a, { phrase: "line me lagi hai", intent: "coming" })).rejects.toThrow(/role can’t/);
    await svc.addWord(hr, { phrase: "Line me lagi hai", intent: "coming", reason: "traffic" });
    await expect(svc.addWord(hr, { phrase: "line me lagi hai", intent: "absent" })).rejects.toThrow(/already taught/);
    await expect(svc.addWord(hr, { phrase: "xyz" })).rejects.toThrow(/what it means/);
    expect(await svc.vocabularyAdmin(hr)).toEqual([{ phrase: "line me lagi hai", intent: "coming", reason: "traffic" }]);
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("10:30", "2026-12-08"));
    const id = await svc.startManualCall(hr, b.id, "check");
    await db.aiHrCall.update({ where: { id }, data: { reason: "late" } });
    await svc.beginCall(b, id);
    await svc.sendTurn(b, id, { text: "haan" });
    const r = await svc.sendTurn(b, id, { text: "gaadi line me lagi hai" });
    expect(r.reply).toMatch(/kitne baje/);
    await svc.removeWord(hr, "line me lagi hai");
    expect(await svc.vocabularyAdmin(hr)).toEqual([]);
    expect(await db.staffAudit.count({ where: { action: { startsWith: "HRMS · AI vocabulary" } } })).toBe(2);
  });

  it("page views run the AI job at most once a minute (free scheduling)", async () => {
    const t0 = new Date("2026-12-09T05:00:00Z");
    expect(await svc.maybeTick(t0)).toBe(true);
    expect(await svc.maybeTick(new Date(t0.getTime() + 20_000))).toBe(false);
    expect(await Promise.all([1, 2, 3].map(() => svc.maybeTick(new Date(t0.getTime() + 61_000))))).toEqual(expect.arrayContaining([true, false, false]));
  });

  it("scenario evaluation runs and is stored", async () => {
    const r = await svc.runEvaluation(hr);
    expect(r.total).toBe(1000);
    const run = await db.aiHrEvalRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    expect(run.passed).toBe(r.passed);
    expect(run.finishedAt).not.toBeNull();
  });
  it("answers not understood: HR sees them (audited), teaches a phrase from one, dismisses another; employees can't", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("10:30", "2026-12-10"));
    const id = await svc.startManualCall(hr, b.id, "check");
    await db.aiHrCall.update({ where: { id }, data: { reason: "late" } });
    await svc.beginCall(b, id);
    await svc.sendTurn(b, id, { text: "haan" });
    await svc.sendTurn(b, id, { text: "zorbak plimpo hai" });
    await svc.sendTurn(b, id, { text: "qwixel drumbo" });
    const list = await svc.unclearAnswers(hr);
    const t1 = list.find((r) => r.text === "zorbak plimpo hai")!, t2 = list.find((r) => r.text === "qwixel drumbo")!;
    expect(t1).toMatchObject({ name: "Bharat Leave", reason: "late", now: "" });
    expect(t2).toBeTruthy();
    expect(await db.staffAudit.count({ where: { action: "HRMS · AI unclear answers opened" } })).toBeGreaterThan(0);
    await expect(svc.unclearAnswers(b)).rejects.toThrow();
    await svc.teachFromUnclear(hr, t1.id, { phrase: "zorbak plimpo", intent: "coming" });
    expect((await svc.vocabularyAdmin(hr)).map((w) => w.phrase)).toContain("zorbak plimpo");
    await svc.dismissUnclear(hr, t2.id);
    const after = await svc.unclearAnswers(hr);
    expect(after.some((r) => r.id === t1.id || r.id === t2.id)).toBe(false);
    await expect(svc.dismissUnclear(b, t2.id)).rejects.toThrow();
    await svc.removeWord(hr, "zorbak plimpo");
  });

  it("weekly summary email: once a week to Attendance holders, counts only, and only when switched on", async () => {
    const monday = new Date("2026-12-14T09:00:00+05:30");
    mail.on = true; mail.sent = [];
    await enable({ weeklyDigest: false });
    expect(await svc.weeklyDigest(monday)).toBe(0);
    await enable();
    const sent = await svc.weeklyDigest(monday);
    expect(sent).toBeGreaterThanOrEqual(3); // both HR people and the super admin
    expect(mail.sent.map((m) => m.to)).toEqual(expect.arrayContaining([hr.email, hr2.email, admin.email]));
    expect(mail.sent.map((m) => m.to)).not.toContain(b.email); // not an Attendance holder
    const m = mail.sent[0];
    expect(m.subject).toMatch(/weekly summary \(7 Dec to 13 Dec\)/);
    expect(m.text).toMatch(/Conversations: \d+/);
    expect(m.text).not.toMatch(/Bharat|zorbak/); // no names or conversation text
    // Same week again (another server, a later tick): nothing more is sent.
    expect(await svc.weeklyDigest(new Date("2026-12-16T12:00:00+05:30"))).toBe(0);
    expect(await svc.weeklyDigest(new Date("2026-12-21T08:00:00+05:30"))).toBeGreaterThanOrEqual(3);
    mail.on = false;
  });
  let dv: Me;
  it("Naina in Chats: the employee starts a chat, asks a question, a bare hello just opens it, closing an empty chat leaves nothing for HR", async () => {
    dv = await me(await mk("Divya Chat", "employee"));
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("11:00", "2026-12-15"));
    const incomplete = () => db.aiHrAction.count({ where: { staffId: dv.id, kind: "incomplete" } });
    const before = await incomplete();
    const info = await svc.nainaInfo(dv);
    expect(info).toMatchObject({ open: null });
    // "hi" opens a chat with Naina's offer to help, and isn't treated as an answer.
    const r1 = await svc.nainaSend(dv, "hi");
    let thread = await svc.nainaThread(dv);
    const chat1 = thread.find((t) => t.id === r1.callId)!;
    expect(chat1).toMatchObject({ self: true, status: "in_progress" });
    expect(chat1.turns.map((t) => t.who)).toEqual(["ai"]);
    expect(chat1.turns[0].text).toMatch(/Naina hoon, Medoro HR ki AI assistant/);
    // A question in the same chat is answered from approved knowledge.
    const r2 = await svc.nainaSend(dv, "Leave cancel kaise karte hain HRMS mein?");
    expect(r2.callId).toBe(r1.callId);
    thread = await svc.nainaThread(dv);
    const last = thread.find((t) => t.id === r1.callId)!.turns.at(-1)!;
    expect(last.who).toBe("ai");
    expect(last.text).toMatch(/Source: Cancelling leave/);
    // Another employee never sees it.
    expect((await svc.nainaThread(b)).some((t) => t.id === r1.callId)).toBe(false);
    // An empty chat the employee closes is dropped without a follow-up for HR.
    const r3 = await svc.nainaSend(dv, "hello");
    if (r3.callId !== r1.callId) {
      await svc.nainaEnd(dv);
      expect((await db.aiHrCall.findUniqueOrThrow({ where: { id: r3.callId } })).status).toBe("cancelled");
    }
    await svc.nainaEnd(dv);
    expect(await incomplete()).toBe(before); // closing a chat they started never creates an "incomplete" follow-up
  });

  it("Naina rings for a conversation the scheduler opened, and answering joins that same conversation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("11:30", "2026-12-15"));
    await svc.nainaEnd(dv);
    expect(await svc.nainaRing(dv)).toBeNull();
    const id = await svc.startManualCall(hr, dv.id, "Check documents");
    expect(await svc.nainaRing(dv)).toBeNull(); // scheduled, not yet sent
    await svc.dispatch();
    const ring = await svc.nainaRing(dv);
    expect(ring).toMatchObject({ id, reason: "manual", attempts: 1, cfg: { speech: "browser" } });
    expect((await svc.nainaRing(b))?.id).not.toBe(id); // only the employee it is for
    expect((await svc.nainaInfo(dv))?.open).toMatchObject({ id, status: "notified", self: false });
    // Answering (voice call or a typed reply) joins the waiting conversation instead of starting a new chat.
    const conv = await svc.nainaConversation(dv);
    expect(conv).toEqual({ id, fresh: true });
    expect(await svc.nainaRing(dv)).toBeNull();
    const turns = (await svc.nainaThread(dv)).find((t) => t.id === id)!.turns;
    expect(turns[0].text).toMatch(/Naina/);
    await svc.endCall(dv, id);
  });

  it("Naina is unavailable while the assistant is switched off", async () => {
    await enable({ enabled: false });
    expect(await svc.nainaInfo(dv)).toBeNull();
    await expect(svc.nainaSend(dv, "payslip kahan hai")).rejects.toThrow(/isn't switched on/);
    await enable();
  });
  it("push: only real browser push services are accepted, five devices at most, and Naina's call rings them", async () => {
    const ev = await me(await mk("Esha Push", "employee"));
    const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
    await expect(pushSvc.savePushSub(ev.id, sub("https://evil.example.com/hook"))).rejects.toThrow(/push address/);
    await expect(pushSvc.savePushSub(ev.id, sub("http://fcm.googleapis.com/fcm/send/x"))).rejects.toThrow();
    for (let i = 0; i < 7; i++) await pushSvc.savePushSub(ev.id, sub(`https://fcm.googleapis.com/fcm/send/dev${i}`));
    await pushSvc.savePushSub(ev.id, sub("https://fcm.googleapis.com/fcm/send/dev6")); // the same device again isn't a second one
    expect(await pushSvc.pushDevices(ev.id)).toBe(5);
    const key = await pushSvc.pushPublicKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(await pushSvc.pushPublicKey()).toBe(key); // made once, then kept
    const stored = (await db.hrSetting.findUniqueOrThrow({ where: { key: "aiHrVapid" } })).value as { privateKey: string };
    expect(stored.privateKey).not.toMatch(/^[A-Za-z0-9_-]{43}$/); // the private key is sealed, not stored as is
    // A call the scheduler sends rings every device; a device the push service says is gone is dropped.
    push.sent = []; push.gone = new Set(["https://fcm.googleapis.com/fcm/send/dev2"]);
    vi.useFakeTimers({ toFake: ["Date"] }); at(ist("12:00", "2026-12-16"));
    const id = await svc.startManualCall(hr, ev.id, "Check documents");
    await svc.dispatch();
    const mine = push.sent.filter((x) => x.endpoint.includes("/dev"));
    expect(mine).toHaveLength(4);
    expect(JSON.parse(mine[0].payload)).toMatchObject({ title: "📞 Naina · AI HR is calling", url: "/staff/hrms/chat?c=naina", tag: `naina-${id}` });
    expect(await pushSvc.pushDevices(ev.id)).toBe(4);
    await pushSvc.removePushSub(ev.id, "https://fcm.googleapis.com/fcm/send/dev3");
    expect(await pushSvc.pushDevices(ev.id)).toBe(3);
  });
});
