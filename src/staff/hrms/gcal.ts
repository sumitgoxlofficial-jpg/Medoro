import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { seal, unseal, unsealClient } from "@/server/vault";
import { audit, type Me } from "./auth";

// Google Calendar for the HRMS. Each employee connects their own Google account (scope calendar.events only: Medoro can
// read and create events, nothing else). The refresh token is sealed with HOST_KEY. It uses the same OAuth client as
// Google sign-in and Drive backups; add the redirect URI below to that client and enable the Google Calendar API.
type Env = Record<string, string | undefined>;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth", TOKEN_URL = "https://oauth2.googleapis.com/token", REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** Drive's hidden per-app folder: Medoro can read and write only the files it made there, and the employee sees nothing in their Drive. */
export const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export type Purpose = "calendar" | "backup";
const FLOW_COOKIE = "medoro_hrgcal", FLOW_PATH = "/staff/hrms/google";

export function gcalConfig(env: Env = process.env) {
  const id = env.GOOGLE_OAUTH_CLIENT_ID, secret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect = env.GOOGLE_CALENDAR_REDIRECT_URI || (env.APP_URL ? env.APP_URL.replace(/\/+$/, "") + "/staff/hrms/google/callback" : "");
  return id && secret && redirect ? { id, secret, redirect } : null;
}
export const gcalConfigured = () => !!gcalConfig();

const b64u = (b: Buffer) => b.toString("base64url");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Lax so the cookie comes back on Google's redirect; it is sealed, bound to this browser, single use, and names the employee.
const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: FLOW_PATH, maxAge });

/** Starts the connection: returns Google's consent URL. The flow cookie carries state, the PKCE verifier and who is connecting. */
export async function beginConnect(me: Me, purpose: Purpose = "calendar") {
  const g = gcalConfig();
  if (!g) throw new UserError("Google Calendar isn’t set up on this server yet. Ask the super admin.");
  const state = b64u(randomBytes(32)), verifier = b64u(randomBytes(48));
  const sealed = b64u(seal(JSON.stringify({ state, verifier, staffId: me.id, purpose, exp: Date.now() + 600_000 })));
  (await cookies()).set(FLOW_COOKIE, sealed, cookieOpts(600));
  const q = new URLSearchParams({
    client_id: g.id, redirect_uri: g.redirect, response_type: "code", scope: `${purpose === "backup" ? APPDATA_SCOPE : SCOPE} openid email`, access_type: "offline", prompt: "consent",
    state, code_challenge: b64u(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", login_hint: me.email,
  });
  return `${AUTH_URL}?${q}`;
}

async function takeFlow() {
  const c = await cookies();
  const raw = c.get(FLOW_COOKIE)?.value;
  c.set(FLOW_COOKIE, "", cookieOpts(0));
  if (!raw) return null;
  try {
    const f = JSON.parse(unsealClient(Buffer.from(raw, "base64url")).toString()) as { state: string; verifier: string; staffId: string; purpose?: Purpose; exp: number };
    return f.exp > Date.now() ? f : null;
  } catch { return null; }
}
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o), signal: AbortSignal.timeout(15_000) });

/** Google's redirect lands here: checks state, swaps the code for a refresh token and stores it for the employee who started it. */
export async function finishConnect(code: string, state: string): Promise<Purpose> {
  const flow = await takeFlow();
  try { return await complete(code, state, flow); }
  catch (e) { if (e instanceof UserError) (e as UserError & { purpose?: Purpose }).purpose = flow?.purpose === "backup" ? "backup" : "calendar"; throw e; } // so the error lands on the page the person came from
}
async function complete(code: string, state: string, flow: Awaited<ReturnType<typeof takeFlow>>): Promise<Purpose> {
  const g = gcalConfig();
  if (!g || !flow || !equal(flow.state, state)) throw new UserError("That Google sign-in expired. Try connecting again.");
  const staff = await db.staffUser.findFirst({ where: { id: flow.staffId, kind: "team", status: "active" }, select: { id: true, name: true } });
  if (!staff) throw new UserError("This profile isn’t active.");
  const r = await fetch(TOKEN_URL, form({ code, client_id: g.id, client_secret: g.secret, redirect_uri: g.redirect, grant_type: "authorization_code", code_verifier: flow.verifier }));
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string; error?: string };
  if (!r.ok) { log.error("google calendar code exchange failed", { error: j.error }); throw new UserError("Google didn’t accept the connection. Try again."); }
  const purpose: Purpose = flow.purpose === "backup" ? "backup" : "calendar";
  if (!(j.scope ?? "").split(" ").includes(purpose === "backup" ? APPDATA_SCOPE : SCOPE)) throw new UserError(purpose === "backup" ? "Google Drive access wasn’t allowed. Connect again and allow Medoro to store its backup file." : "Calendar access wasn’t allowed. Connect again and tick the calendar permission.");
  if (!j.refresh_token) throw new UserError("Google didn’t return a long-lived token. Remove Medoro in your Google account’s connected apps, then connect again.");
  const email = j.id_token ? (JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email ?? "" : "";
  if (purpose === "backup") {
    const b = { email, tokenSealed: new Uint8Array(seal(j.refresh_token)), fileId: "", lastError: "" };
    await db.hrChatBackup.upsert({ where: { staffId: staff.id }, update: b, create: { staffId: staff.id, ...b } });
    await audit({ id: staff.id, name: staff.name }, "Chat backup connected", email);
    return "backup";
  }
  const data = { email, tokenSealed: new Uint8Array(seal(j.refresh_token)), scope: "calendar.events" };
  await db.hrGoogle.upsert({ where: { staffId: staff.id }, update: data, create: { staffId: staff.id, ...data } });
  tokens.delete(staff.id);
  await audit({ id: staff.id, name: staff.name }, "Google Calendar connected", email);
  return "calendar";
}

export async function status(staffId: string) {
  const row = await db.hrGoogle.findUnique({ where: { staffId }, select: { email: true } });
  return { configured: gcalConfigured(), connected: !!row, email: row?.email ?? "" };
}

const tokens = new Map<string, { token: string; exp: number }>();
const lost = async (staffId: string) => {
  tokens.delete(staffId);
  await db.hrGoogle.deleteMany({ where: { staffId } });
  throw new UserError("Google Calendar was disconnected (access was removed or expired). Connect it again.");
};
async function accessToken(staffId: string, force = false) {
  const c = tokens.get(staffId);
  if (!force && c && c.exp - 60_000 > Date.now()) return c.token;
  const g = gcalConfig(), row = await db.hrGoogle.findUnique({ where: { staffId } });
  if (!g || !row) throw new UserError("Connect Google Calendar first.");
  const r = await fetch(TOKEN_URL, form({ refresh_token: unseal(row.tokenSealed).toString(), client_id: g.id, client_secret: g.secret, grant_type: "refresh_token" }));
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (j.access_token) { tokens.set(staffId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }); return j.access_token; }
  if (j.error === "invalid_grant") return lost(staffId);
  throw new UserError("Couldn’t reach Google Calendar. Try again in a moment.");
}
/** One Calendar API call, refreshing the access token once if Google says it expired. */
async function api(staffId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(API + path, {
      method: init.method ?? "GET", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${await accessToken(staffId, attempt > 0)}`, ...(init.body ? { "content-type": "application/json" } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined,
    }).catch(() => null);
    if (!r) throw new UserError("Couldn’t reach Google Calendar. Try again in a moment.");
    if (r.status === 401 && attempt === 0) continue;
    if (r.status === 401) return lost(staffId);
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 403) throw new UserError("Google refused the request. Check that the Google Calendar API is enabled for this server’s Google project.");
    return { status: r.status, json };
  }
  return lost(staffId);
}

export type GEvent = { id: string; title: string; start: string; end: string; allDay: boolean; link: string; meet: string };
/** The employee's own primary calendar between two instants (ISO). Cancelled events are left out. */
export async function listEvents(me: Me, fromIso: string, toIso: string): Promise<GEvent[]> {
  const q = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const { status: st, json } = await api(me.id, `/calendars/primary/events?${q}`);
  if (st >= 400) throw new UserError("Couldn’t read your Google Calendar.");
  type Raw = { id?: string; summary?: string; status?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; htmlLink?: string; hangoutLink?: string };
  return ((json.items ?? []) as Raw[]).filter((e) => e.id && e.status !== "cancelled" && (e.start?.dateTime || e.start?.date)).map((e) => ({
    id: e.id!, title: e.summary || "(no title)", start: (e.start!.dateTime ?? e.start!.date)!, end: (e.end?.dateTime ?? e.end?.date ?? e.start!.dateTime ?? e.start!.date)!,
    allDay: !e.start!.dateTime, link: e.htmlLink ?? "", meet: e.hangoutLink ?? "",
  }));
}

/** Adds an HRMS meeting to the organiser's Google Calendar with a Meet link; Google emails the invitations. */
export async function pushMeeting(me: Me, meetingId: string) {
  const m = await db.hrMeeting.findUnique({ where: { id: meetingId } });
  if (!m || m.byId !== me.id) throw new UserError("Only the organiser can add this meeting to Google Calendar.");
  if (m.googleEventId) return { meet: m.link };
  const people = await db.staffUser.findMany({ where: { id: { in: m.attendees.filter((a) => a !== me.id) } }, select: { email: true } });
  const { status: st, json } = await api(me.id, "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
    method: "POST",
    body: {
      summary: m.title, description: "Scheduled from Medoro HRMS." + (m.link ? `\n${m.link}` : ""),
      start: { dateTime: m.at.toISOString() }, end: { dateTime: new Date(m.at.getTime() + m.minutes * 60_000).toISOString() },
      attendees: people.map((p) => ({ email: p.email })),
      ...(m.link ? {} : { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
    },
  });
  if (st >= 400 || typeof json.id !== "string") throw new UserError("Google Calendar didn’t accept the event.");
  const meet = typeof json.hangoutLink === "string" ? json.hangoutLink : "";
  await db.hrMeeting.update({ where: { id: m.id }, data: { googleEventId: json.id, ...(meet && !m.link ? { link: meet } : {}) } });
  return { meet: meet || m.link };
}

/** A Google Meet call that starts now, made in the caller's own calendar. Guests are added so they can join without knocking. */
export async function instantMeet(me: Me, title: string, guestEmails: string[]) {
  if (!(await db.hrGoogle.findUnique({ where: { staffId: me.id }, select: { staffId: true } }))) throw new UserError("Connect Google Calendar first (Calendar page) to start a Meet call.");
  const now = Date.now();
  const { status: st, json } = await api(me.id, "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none", {
    method: "POST",
    body: {
      summary: title, description: "Started from Medoro Team Chat.",
      start: { dateTime: new Date(now).toISOString() }, end: { dateTime: new Date(now + 60 * 60_000).toISOString() },
      attendees: guestEmails.slice(0, 100).map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  });
  const link = typeof json.hangoutLink === "string" ? json.hangoutLink : "";
  if (st >= 400 || !/^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(link)) throw new UserError("Google couldn’t create the Meet call. Try again in a moment.");
  return link;
}

/** Removes a meeting's Google event (and tells guests). A missing event is fine. */
export async function removeEvent(staffId: string, eventId: string) {
  if (!(await db.hrGoogle.findUnique({ where: { staffId }, select: { staffId: true } }))) return;
  const { status: st } = await api(staffId, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  if (st >= 400 && st !== 404 && st !== 410) throw new UserError("Couldn’t remove the event from Google Calendar.");
}

export async function disconnect(me: Me) {
  const row = await db.hrGoogle.findUnique({ where: { staffId: me.id } });
  if (!row) return;
  const refresh = unseal(row.tokenSealed).toString();
  await db.hrGoogle.delete({ where: { staffId: me.id } });
  tokens.delete(me.id);
  await fetch(REVOKE_URL, form({ token: refresh })).catch(() => {}); // best effort: the token is already forgotten here
  await audit(me, "Google Calendar disconnected", row.email);
}
