import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.8", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { beginConnect, disconnect, finishConnect, listEvents, pushMeeting, status } from "@/staff/hrms/gcal";
import { cancelMeeting, scheduleMeeting } from "@/staff/hrms/work";
import { resetDb } from "./helpers";

let org: Me, guest: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycVerified: true }; };

type Call = { url: string; method: string; body: string; auth: string };
let calls: Call[] = [];
let refreshFails = false, insertFails = false;
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const fakeIdToken = (email: string) => "x." + Buffer.from(JSON.stringify({ email })).toString("base64url") + ".y";

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", APP_URL: "https://hr.test" });
  const mk = (empNo: string, name: string, email: string, n: number) => db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + n, role: "employee", status: "active", hr: { create: { role: "employee", profileDone: true, docsAcceptedAt: new Date() } } } });
  org = await mkMe((await mk("MS-001", "Olga Organiser", "olga@medoro.in", 1)).id);
  guest = await mkMe((await mk("MS-002", "Gus Guest", "gus@medoro.in", 2)).id);
});
beforeEach(() => {
  jar.clear(); calls = []; refreshFails = false; insertFails = false;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? String(init.body) : "";
    calls.push({ url, method, body, auth: String((init?.headers as Record<string, string> | undefined)?.authorization ?? "") });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (body.includes("grant_type=authorization_code")) return j({ refresh_token: "REFRESH-SECRET-1", access_token: "AT1", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events openid email", id_token: fakeIdToken("olga@gmail.com") });
      return refreshFails ? j({ error: "invalid_grant" }, 400) : j({ access_token: "AT" + calls.length, expires_in: 3600 });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return j({});
    if (url.includes("/calendar/v3/calendars/primary/events?") && method === "GET") return j({ items: [
      { id: "e1", summary: "Dentist", start: { dateTime: "2026-12-03T10:00:00+05:30" }, end: { dateTime: "2026-12-03T11:00:00+05:30" }, htmlLink: "https://cal/e1" },
      { id: "e2", summary: "Holiday", start: { date: "2026-12-10" }, end: { date: "2026-12-12" } },
      { id: "e3", summary: "Gone", status: "cancelled", start: { dateTime: "2026-12-04T10:00:00+05:30" }, end: { dateTime: "2026-12-04T11:00:00+05:30" } },
    ] });
    if (url.includes("/calendar/v3/calendars/primary/events?") && method === "POST") return insertFails ? j({ error: { message: "bad" } }, 400) : j({ id: "gev1", hangoutLink: "https://meet.google.com/abc-defg-hij" });
    if (url.includes("/calendar/v3/calendars/primary/events/") && method === "DELETE") return new Response(null, { status: 204 });
    return j({}, 404);
  });
});
afterEach(() => vi.unstubAllGlobals());

const connect = async (m: Me) => {
  const url = new URL(await beginConnect(m));
  await finishConnect("code123", url.searchParams.get("state")!);
};

describe("HRMS Google Calendar", () => {
  it("starts with the calendar.events scope only, PKCE, offline access and a sealed single-use flow cookie", async () => {
    const u = new URL(await beginConnect(org));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events openid email");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe("https://hr.test/staff/hrms/google/callback");
    expect(jar.get("medoro_hrgcal")).toBeTruthy();
    await expect(finishConnect("c", "wrong-state")).rejects.toThrow(/expired/); // wrong state, and the cookie is now used up
    await expect(finishConnect("c", u.searchParams.get("state")!)).rejects.toThrow(/expired/);
  });

  it("stores the refresh token sealed, for the employee who started the flow", async () => {
    await connect(org);
    const row = await db.hrGoogle.findUniqueOrThrow({ where: { staffId: org.id } });
    expect(row.email).toBe("olga@gmail.com");
    expect(Buffer.from(row.tokenSealed).toString("utf8")).not.toContain("REFRESH-SECRET-1");
    expect(await status(org.id)).toMatchObject({ configured: true, connected: true, email: "olga@gmail.com" });
    expect((await status(guest.id)).connected).toBe(false);
  });

  it("refuses a connection that didn't grant calendar access", async () => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => String(input).startsWith("https://oauth2.googleapis.com/token") ? j({ refresh_token: "R", scope: "openid email" }) : real(input, init));
    const url = new URL(await beginConnect(guest));
    await expect(finishConnect("c", url.searchParams.get("state")!)).rejects.toThrow(/Calendar access/);
    expect((await status(guest.id)).connected).toBe(false);
  });

  it("lists events, keeps all-day events, skips cancelled ones", async () => {
    const ev = await listEvents(org, "2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(ev.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(ev[1]).toMatchObject({ allDay: true, start: "2026-12-10", end: "2026-12-12" });
    const q = calls.find((c) => c.url.includes("/events?") && c.method === "GET")!;
    expect(q.url).toContain("singleEvents=true");
    expect(q.auth).toMatch(/^Bearer AT/);
  });

  it("adds a meeting to Google with a Meet link and the guests' emails; only the organiser can", async () => {
    await scheduleMeeting(org, { title: "Sprint review", day: "2030-01-15", time: "10:00", minutes: 45, link: "", attendees: [guest.id], google: false });
    const m = await db.hrMeeting.findFirstOrThrow({ where: { title: "Sprint review" } });
    expect(m.googleEventId).toBeNull();
    await expect(pushMeeting(guest, m.id)).rejects.toThrow(/organiser/);
    expect((await pushMeeting(org, m.id)).meet).toBe("https://meet.google.com/abc-defg-hij");
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/events?"))!;
    const body = JSON.parse(post.body);
    expect(post.url).toContain("conferenceDataVersion=1");
    expect(post.url).toContain("sendUpdates=all");
    expect(body.attendees).toEqual([{ email: "gus@medoro.in" }]);
    expect(body.end.dateTime).toBe(new Date(new Date(body.start.dateTime).getTime() + 45 * 60_000).toISOString());
    const after = await db.hrMeeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ googleEventId: "gev1", link: "https://meet.google.com/abc-defg-hij" });
    const before = calls.length;
    await pushMeeting(org, m.id); // already added: nothing is sent twice
    expect(calls.length).toBe(before);
  });

  it("cancelling a meeting removes its Google event", async () => {
    const m = await db.hrMeeting.findFirstOrThrow({ where: { title: "Sprint review" } });
    calls = [];
    await cancelMeeting(org, m.id);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/events/gev1"))).toBe(true);
    expect(await db.hrMeeting.count({ where: { id: m.id } })).toBe(0);
  });

  it("scheduling still works when Google can't create the event", async () => {
    insertFails = true;
    const r = await scheduleMeeting(org, { title: "Offsite", day: "2030-02-01", time: "11:00", minutes: 30, link: "", attendees: [guest.id], google: true });
    expect(r.google).toBe("failed");
    expect(await db.hrMeeting.count({ where: { title: "Offsite" } })).toBe(1);
    expect(await db.hrNotification.count({ where: { staffId: guest.id, text: { contains: "Offsite" } } })).toBe(1);
  });

  it("a revoked grant disconnects cleanly and asks to reconnect", async () => {
    refreshFails = true;
    // A fresh module has no cached access token, so Google is asked for a new one and refuses it.
    vi.resetModules();
    const fresh = await import("@/staff/hrms/gcal");
    await expect(fresh.listEvents(org, "2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z")).rejects.toThrow(/Connect it again/);
    expect(await db.hrGoogle.count({ where: { staffId: org.id } })).toBe(0);
  });

  it("disconnect revokes the token at Google and forgets it", async () => {
    await connect(guest);
    await disconnect(guest);
    expect(calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke") && c.body.includes("REFRESH-SECRET-1"))).toBe(true);
    expect((await status(guest.id)).connected).toBe(false);
  });
});
