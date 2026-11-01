import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)),
    delete: (k: string) => jar.delete(k),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { createHash } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { db } from "@/server/db";
import { createSession, hashPassword, isTrustedDevice, readSession, SESSION_COOKIE, setTrustedDevice } from "@/server/auth";
import { getCtx, type Ctx } from "@/server/context";
import { openSecret } from "@/server/totp";
import { resetJwksCache } from "@/server/google-oidc";
import {
  checkInviteContact, completeInvite, ensureMfaSecret, forgotPassword, otpSignIn, passwordSignIn, requestSignInOtp, resetMfaWithCode,
  resetPassword, sendMfaResetCode, signupAction, verifyMfa,
} from "@/app/(auth)/actions";
import { changePassword, changePin, disconnectGoogle, profileSecurity, regenerateRecoveryCodes } from "@/domain/identity/account";
import { issueReset, resetTwoStep } from "@/domain/identity/admin";
import { GET as googleStart } from "@/app/api/auth/google/start/route";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { fakeGoogle } from "../stubs/google";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const EMAIL = "owner@test.in", PW = "long-enough-pw", PHONE = "9822000001";
const CLIENT = "client-123.apps.googleusercontent.com", APP = "https://p.example.in";

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];
let fail = false;
const google = fakeGoogle();
let idClaims: Record<string, unknown> = {};

function codeFrom(s: Sent) {
  if (s.url.includes("resend.com")) return /\n {4}(\d{6})\n/.exec(JSON.parse(s.body).text)![1];
  if (s.url.includes("msg91.com")) return JSON.parse(s.body).recipients[0].otp as string;
  if (s.url.includes("twilio.com")) return new URLSearchParams(s.body).get("Body")!.slice(0, 6);
  return JSON.parse(s.body).code as string;
}
const lastCode = () => codeFrom(sent.at(-1)!);
const other = (c: string) => (c === "000000" ? "000001" : "000000");

const totpFor = async (email: string) => {
  const u = await db.user.findFirstOrThrow({ where: { email } });
  return new TOTP({ secret: Secret.fromBase32(openSecret(u.mfaSecret!)), digits: 6, period: 30, algorithm: "SHA1" }).generate();
};

/** Password, then authenticator (enrolling if needed): a full session in the cookie jar. */
async function signIn(email = EMAIL, pw = PW): Promise<Ctx> {
  jar.clear();
  const r = await passwordSignIn(email, pw);
  expect(r).toEqual({ ok: true, data: "/signin/mfa" });
  await ensureMfaSecret();
  const m = await verifyMfa(await totpFor(email), false);
  expect(m.ok).toBe(true);
  return (await getCtx())!;
}

const restoreOwner = async () => db.user.updateMany({ where: { email: EMAIL }, data: { passwordHash: await hashPassword(PW), passwordResetAt: null, active: true } });
const audits = (action: string) => db.auditEvent.count({ where: { action } });

describe("account recovery, providers and Google sign-in", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });
  beforeEach(async () => {
    sent = []; fail = false; jar.clear(); resetJwksCache();
    await db.loginAttempt.deleteMany();
    vi.stubEnv("MAIL_PROVIDER", "resend"); vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("MAIL_FROM", "Medoro <no-reply@p.example.in>");
    vi.stubEnv("OTP_PROVIDER", "msg91"); vi.stubEnv("OTP_API_KEY", "msg-key"); vi.stubEnv("OTP_TEMPLATE_ID", "tpl-otp");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", CLIENT); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "g-secret"); vi.stubEnv("APP_URL", APP);
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return google.certs();
      const s = { url, headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? "") };
      sent.push(s);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: google.idToken(idClaims), access_token: "at" });
      if (fail) return new Response("down", { status: 503 });
      return url.includes("msg91") ? Response.json({ type: "success" }) : Response.json({ id: "ok" });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("enrolment issues 10 hashed recovery codes; each signs in once instead of the authenticator", async () => {
    jar.clear();
    expect(await passwordSignIn(EMAIL, PW)).toEqual({ ok: true, data: "/signin/mfa" });
    await ensureMfaSecret();
    const r = await verifyMfa(await totpFor(EMAIL), false);
    if (!r.ok) throw new Error(r.error);
    const codes = r.data!.recoveryCodes!;
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[0-9a-z]{4}(-[0-9a-z]{4}){3}$/);
    const rows = await db.recoveryCode.findMany();
    expect(rows).toHaveLength(10);
    expect(rows.some((x) => codes.includes(x.codeHash) || x.codeHash.includes(codes[0].replace(/-/g, "")))).toBe(false);

    jar.clear();
    await passwordSignIn(EMAIL, PW);
    expect(await verifyMfa(codes[0].toUpperCase(), false)).toEqual({ ok: true, data: { next: "/app", recoveryCodes: undefined, remaining: 9 } });
    expect((await getCtx())?.userName).toBe("Owner Person");
    expect(await audits("Signed in with a recovery code")).toBe(1);

    jar.clear();
    await passwordSignIn(EMAIL, PW);
    expect(await verifyMfa(codes[0], false)).toEqual({ ok: false, error: "That recovery code doesn’t match or was already used." });
    expect(await getCtx()).toBeNull();
  });

  it("Profile: regenerate recovery codes, change password (current required) and change PIN", async () => {
    const ctx = await signIn();
    const elsewhere = (await db.session.findMany({ where: { userId: ctx.userId, revokedAt: null, NOT: { id: ctx.sessionId } } })).length;
    expect(elsewhere).toBeGreaterThan(0);
    const codes = await regenerateRecoveryCodes(ctx);
    expect(codes).toHaveLength(10);
    expect((await profileSecurity(ctx)).recoveryLeft).toBe(10);

    await expect(changePassword(ctx, "not-my-password", "brand-new-password")).rejects.toThrow("Your current password is incorrect. 4 attempts left.");
    await expect(changePassword(ctx, PW, "short")).rejects.toThrow(/10 characters/);
    await setTrustedDevice(ctx.userId, (await db.user.findUniqueOrThrow({ where: { id: ctx.userId } })).tokenVersion);
    const tv = (await db.user.findUniqueOrThrow({ where: { id: ctx.userId } })).tokenVersion;
    expect(await isTrustedDevice(ctx.userId, tv)).toBe(true);
    await changePassword(ctx, PW, "brand-new-password");
    const after = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    expect(after.tokenVersion).toBe(tv + 1);
    expect(await isTrustedDevice(ctx.userId, after.tokenVersion)).toBe(false);
    expect(await db.session.count({ where: { userId: ctx.userId, revokedAt: null } })).toBe(1);
    expect((await getCtx())?.sessionId).toBe(ctx.sessionId);
    // The trusted-PC cookie is still in the jar but no longer skips the authenticator.
    jar.delete(SESSION_COOKIE);
    expect((await passwordSignIn(EMAIL, PW)).ok).toBe(false);
    expect(await passwordSignIn(EMAIL, "brand-new-password")).toEqual({ ok: true, data: "/signin/mfa" });
    await restoreOwner();

    const t = await db.tenant.findFirstOrThrow();
    const role = await db.role.findFirstOrThrow({ where: { tenantId: t.id, name: "Cashier" } });
    const cashier = await db.user.create({ data: { tenantId: t.id, name: "Cash Person", phone: "9850000099", employeeNo: "E-150", pinHash: await hashPassword("3971"), roleId: role.id, branchIds: [] } });
    const counter = await db.counter.findFirstOrThrow({ where: { tenantId: t.id } });
    jar.clear();
    await createSession(cashier.id, 0, { mfaPassed: true, counterId: counter.id, firstFactor: "pin" });
    const otherShift = (await readSession())!.id;
    jar.clear();
    await createSession(cashier.id, 0, { mfaPassed: true, counterId: counter.id, firstFactor: "pin" });
    const cctx = (await getCtx())!;
    await expect(changePassword(cctx, "x", "brand-new-password")).rejects.toThrow(/PIN instead/);
    await expect(changePin(cctx, "1111", "4826")).rejects.toThrow(/current PIN is incorrect/);
    await expect(changePin(cctx, "3971", "1234")).rejects.toThrow(/too easy/);
    await changePin(cctx, "3971", "4826");
    expect((await db.user.findUniqueOrThrow({ where: { id: cashier.id } })).tokenVersion).toBe(1);
    expect((await getCtx())?.sessionId).toBe(cctx.sessionId);
    expect((await db.session.findUniqueOrThrow({ where: { id: otherShift } })).revokedAt).not.toBeNull();
    expect(await audits("PIN changed")).toBe(1);
    expect(await audits("Password changed")).toBe(1);
  });

  it("forgot password by email: generic response, hashed single-use code, new password signs out everywhere", async () => {
    const ctx = await signIn();
    jar.clear();
    expect(await forgotPassword("nobody@test.in")).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(await forgotPassword("  OWNER@test.in ")).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    expect(sent[0].headers.Authorization).toBe("Bearer re_test");
    const mail = JSON.parse(sent[0].body);
    expect(mail).toMatchObject({ from: "Medoro <no-reply@p.example.in>", to: [EMAIL] });
    const code = lastCode();
    const row = await db.authCode.findFirstOrThrow({ where: { purpose: "reset" } });
    expect(row.codeHash).not.toContain(code);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);

    expect(await resetPassword({ contact: EMAIL, code: other(code), password: "a-fresh-password" })).toEqual({ ok: false, error: "That code is wrong or has expired. Request a new one." });
    expect(await resetPassword({ contact: EMAIL, code, password: "short" })).toMatchObject({ ok: false, error: expect.stringMatching(/10 characters/) });
    expect(await resetPassword({ contact: "nobody@test.in", code, password: "a-fresh-password" })).toMatchObject({ ok: false });
    expect(await resetPassword({ contact: EMAIL, code, password: "a-fresh-password" })).toEqual({ ok: true });
    expect(await resetPassword({ contact: EMAIL, code, password: "another-password" })).toMatchObject({ ok: false });

    expect((await db.session.findUniqueOrThrow({ where: { id: ctx.sessionId } })).revokedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: ctx.userId, revokedAt: null } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: ctx.userId } })).passwordResetAt).not.toBeNull();
    expect(await audits("Password reset")).toBe(1);
    expect((await passwordSignIn(EMAIL, PW)).ok).toBe(false);
    expect(await passwordSignIn(EMAIL, "a-fresh-password")).toEqual({ ok: true, data: "/signin/mfa" });
    await restoreOwner();
  });

  it("forgot password by SMS (MSG91), with sends rate-limited per number", async () => {
    expect(await forgotPassword("+91 98220 00001")).toEqual({ ok: true });
    expect(sent[0].url).toBe("https://control.msg91.com/api/v5/flow");
    expect(sent[0].headers.authkey).toBe("msg-key");
    expect(JSON.parse(sent[0].body).recipients[0].mobiles).toBe("91" + PHONE);
    expect(await resetPassword({ contact: PHONE, code: lastCode(), password: "sms-reset-password" })).toEqual({ ok: true });
    expect((await passwordSignIn(EMAIL, "sms-reset-password")).ok).toBe(true);
    await restoreOwner();

    for (let i = 0; i < 4; i++) expect(await forgotPassword(PHONE)).toEqual({ ok: true });
    expect(await forgotPassword(PHONE)).toEqual({ ok: false, error: "Too many codes requested. Try again in 15 minutes." });
    expect(await forgotPassword("9822999999")).toEqual({ ok: true }); // the limit is per number
    vi.stubEnv("OTP_PROVIDER", "");
    expect(await forgotPassword("9822999999")).toEqual({ ok: false, error: "SMS isn’t set up on this server. Use your email." });
  });

  it("lost authenticator: a code to the verified email resets two-step at the MFA step, except right after a password reset", async () => {
    jar.clear();
    await passwordSignIn(EMAIL, PW);
    expect(await sendMfaResetCode()).toEqual({ ok: true, data: "o***@test.in" });
    expect(JSON.parse(sent[0].body).subject).toMatch(/verification code/);
    expect(await resetMfaWithCode(other(lastCode()))).toMatchObject({ ok: false });
    expect(await resetMfaWithCode(lastCode())).toEqual({ ok: true, data: null });
    const u = await db.user.findFirstOrThrow({ where: { email: EMAIL } });
    expect(u).toMatchObject({ mfaEnabled: false, mfaSecret: null });
    expect(await db.recoveryCode.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(1);
    expect((await readSession(true))?.mfaPassed).toBe(false);
    await ensureMfaSecret();
    const r = await verifyMfa(await totpFor(EMAIL), false);
    expect(r.ok && r.data!.recoveryCodes).toHaveLength(10);
    expect(await audits("Two-step verification reset")).toBe(1);

    await db.user.update({ where: { id: u.id }, data: { passwordResetAt: new Date() } });
    jar.clear();
    await passwordSignIn(EMAIL, PW);
    expect(await sendMfaResetCode()).toMatchObject({ ok: false, error: expect.stringMatching(/password was reset recently/) });
    await restoreOwner();
    vi.stubEnv("MAIL_PROVIDER", "");
    expect(await sendMfaResetCode()).toEqual({ ok: true, data: "******0001" });
    expect(sent.at(-1)!.url).toContain("msg91.com");
  });

  it("the owner resets a manager's two-step; nobody resets their own or the owner's here; manager password reset still works", async () => {
    const t = await db.tenant.findFirstOrThrow();
    const role = await db.role.findFirstOrThrow({ where: { tenantId: t.id, name: "Manager" } });
    const mgr = await db.user.create({ data: { tenantId: t.id, name: "Mgr Person", email: "mgr@test.in", passwordHash: await hashPassword("manager-password"), roleId: role.id, branchIds: [], mfaRequired: true } });
    await signIn("mgr@test.in", "manager-password");
    const o = await db.user.findFirstOrThrow({ where: { email: EMAIL } });
    const owner = { ...(await ctxFor()), userId: o.id, userName: o.name };
    expect(await resetTwoStep(owner, mgr.id)).toBe("Mgr Person");
    expect(await db.user.findUniqueOrThrow({ where: { id: mgr.id } })).toMatchObject({ mfaEnabled: false, mfaSecret: null, tokenVersion: 1 });
    expect(await getCtx()).toBeNull();
    await expect(resetTwoStep(owner, mgr.id)).rejects.toThrow(/hasn’t set up/);
    await expect(resetTwoStep(owner, owner.userId)).rejects.toThrow(/your own/);
    await expect(resetTwoStep({ ...owner, userId: mgr.id }, owner.userId)).rejects.toThrow(/Only the owner/);
    await expect(resetTwoStep(await ctxFor("Manager"), mgr.id)).rejects.toThrow(/role/);

    const inv = await issueReset(owner, mgr.id);
    expect(await completeInvite({ code: inv.tenantCode, inviteCode: inv.code, contact: "MGR@test.in", name: "Mgr Person", password: "manager-new-password", agree: true })).toMatchObject({ ok: true, data: { manager: true } });
    await signIn("mgr@test.in", "manager-new-password");
  });

  it("Google: PKCE + state + nonce; a verified email links to its account and signs straight in", async () => {
    const start = await googleStart(new Request(`${APP}/api/auth/google/start`));
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(loc.searchParams);
    expect(q).toMatchObject({ client_id: CLIENT, redirect_uri: `${APP}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", code_challenge_method: "S256" });
    expect(q.state.length).toBeGreaterThanOrEqual(43);
    expect(jar.get("medoro_goidc")).not.toContain(q.state);

    idClaims = google.claims({ aud: CLIENT, nonce: q.nonce, sub: "g-owner", email: EMAIL });
    const cb = await googleCallback(new Request(`${APP}/api/auth/google/callback?state=${q.state}&code=code-1`));
    // Google verified the email, which matches exactly one owner account: linked and signed in, no password or code.
    expect(cb.headers.get("location")).toBe(`${APP}/app`);
    const tok = new URLSearchParams(sent.find((s) => s.url.includes("oauth2.googleapis.com/token"))!.body);
    expect(createHash("sha256").update(tok.get("code_verifier")!).digest("base64url")).toBe(q.code_challenge);
    expect(tok.get("redirect_uri")).toBe(`${APP}/api/auth/google/callback`);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await db.user.findFirstOrThrow({ where: { email: EMAIL } })).toMatchObject({ googleSub: "g-owner", googleEmail: EMAIL });
    expect(await audits("Google sign-in connected")).toBe(1);

    // The callback is single use: replaying it fails on state.
    const replay = await googleCallback(new Request(`${APP}/api/auth/google/callback?state=${q.state}&code=code-1`));
    expect(replay.headers.get("location")).toBe(`${APP}/signin?google=state`);

    // Password sign-in still asks for the authenticator code.
    jar.clear();
    expect(await passwordSignIn(EMAIL, PW)).toEqual({ ok: true, data: "/signin/mfa" });

    const google2 = async (claims: Record<string, unknown>, state?: string) => {
      jar.clear();
      const s = new URL((await googleStart(new Request(`${APP}/api/auth/google/start`))).headers.get("location")!).searchParams;
      idClaims = google.claims({ aud: CLIENT, nonce: s.get("nonce"), ...claims });
      return (await googleCallback(new Request(`${APP}/api/auth/google/callback?state=${state ?? s.get("state")}&code=c`))).headers.get("location");
    };
    // Google already verified the person, so there's no second code: straight into the app.
    expect(await google2({ sub: "g-owner", email: EMAIL })).toBe(`${APP}/app`);
    expect((await readSession(true))?.mfaPassed).toBe(true);
    expect((await getCtx())?.userName).toBe("Owner Person");
    expect(await audits("Signed in")).toBeGreaterThan(0);

    expect(await google2({ sub: "g-owner", email: EMAIL }, "forged-state")).toBe(`${APP}/signin?google=state`);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await google2({ sub: "g-owner", email: EMAIL, nonce: "stale" })).toBe(`${APP}/signin?google=error`);
    expect(await google2({ sub: "g-owner", email: EMAIL, email_verified: false })).toBe(`${APP}/signin?google=error`);
    expect(await google2({ sub: "g-stranger", email: "stranger@gmail.com" })).toBe(`${APP}/signin?google=nouser`);
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    // With self sign-up open, a new person goes on to create their pharmacy with that Google account: no password,
    // linked to Google, and signed straight in.
    vi.stubEnv("PUBLIC_SIGNUP", "1");
    expect(await google2({ sub: "g-new", email: "new.owner@gmail.com", name: "New Owner" })).toBe(`${APP}/signup?google=1`);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const created = await signupAction({
      pharmacy: { name: "New Owner Medicals", code: "NEW-OWNER", gstin: "", dl: "MH-9999", pharmacist: "", address: "Pune", lang: "en" },
      owner: { name: "New Owner", email: "new.owner@gmail.com", phone: "9822000077", password: "" },
      branches: [{ name: "Main branch", counters: 1 }], invites: [], backupKey: "B".repeat(43), kitAck: true, agree: true,
    });
    expect(created).toMatchObject({ ok: true, data: { tenantCode: "NEW-OWNER" } });
    expect(await db.user.findFirstOrThrow({ where: { email: "new.owner@gmail.com" } })).toMatchObject({ googleSub: "g-new", googleEmail: "new.owner@gmail.com" });
    expect(await readSession(true)).toMatchObject({ firstFactor: "google", mfaPassed: true });
    expect((await getCtx())?.userName).toBe("New Owner");
    // Next time, Google signs them straight in.
    expect(await google2({ sub: "g-new", email: "new.owner@gmail.com" })).toBe(`${APP}/app`);
    vi.stubEnv("PUBLIC_SIGNUP", "");

    await db.loginAttempt.create({ data: { key: "acct:" + EMAIL, lockedUntil: new Date(Date.now() + 600_000) } });
    expect(await google2({ sub: "g-owner", email: EMAIL })).toBe(`${APP}/signin?google=locked`);
    await db.loginAttempt.deleteMany();
    await db.user.updateMany({ where: { email: EMAIL }, data: { active: false } });
    expect(await google2({ sub: "g-owner", email: EMAIL })).toBe(`${APP}/signin?google=inactive`);
    await restoreOwner();
  });

  it("Google: Profile connects any Google account while signed in, refuses one linked elsewhere, and disconnects", async () => {
    const ctx = await signIn("mgr@test.in", "manager-new-password");
    const connect = async (claims: Record<string, unknown>) => {
      const s = new URL((await googleStart(new Request(`${APP}/api/auth/google/start?intent=link`))).headers.get("location")!).searchParams;
      idClaims = google.claims({ aud: CLIENT, nonce: s.get("nonce"), ...claims });
      return (await googleCallback(new Request(`${APP}/api/auth/google/callback?state=${s.get("state")}&code=c`))).headers.get("location");
    };
    expect(await connect({ sub: "g-owner", email: EMAIL })).toBe(`${APP}/app?google=taken`);
    expect(await connect({ sub: "g-mgr", email: "mgr.personal@gmail.com" })).toBe(`${APP}/app?google=linked`);
    expect((await profileSecurity(ctx)).google).toEqual({ available: true, email: "mgr.personal@gmail.com" });
    await disconnectGoogle(ctx);
    expect((await db.user.findUniqueOrThrow({ where: { id: ctx.userId } })).googleSub).toBeNull();
    expect(await audits("Google sign-in disconnected")).toBe(1);

    jar.clear();
    const signedOut = await googleStart(new Request(`${APP}/api/auth/google/start?intent=link`));
    expect(signedOut.headers.get("location")).toBe(`${APP}/signin`);
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    expect((await googleStart(new Request(`${APP}/api/auth/google/start`))).headers.get("location")).toBe(`${APP}/signin?google=off`);
  });

  it("mobile OTP sign-in via Twilio and invite OTP via the http webhook; a failed send is a clear error", async () => {
    vi.stubEnv("OTP_PROVIDER", "twilio"); vi.stubEnv("TWILIO_ACCOUNT_SID", "AC1"); vi.stubEnv("TWILIO_AUTH_TOKEN", "tt"); vi.stubEnv("TWILIO_FROM", "+15005550006");
    expect(await requestSignInOtp("9822999999")).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(await requestSignInOtp("098220 00001")).toEqual({ ok: true });
    expect(sent[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(new URLSearchParams(sent[0].body).get("To")).toBe("+91" + PHONE);
    expect((await otpSignIn(PHONE, other(lastCode()))).ok).toBe(false);
    expect(await otpSignIn(PHONE, lastCode())).toEqual({ ok: true, data: "/signin/mfa" });

    fail = true;
    expect(await requestSignInOtp(PHONE)).toEqual({ ok: false, error: "Couldn’t send the code, try again." });
    expect(await db.otpCode.count({ where: { phone: PHONE } })).toBe(0);
    fail = false;

    vi.stubEnv("OTP_PROVIDER", "http"); vi.stubEnv("OTP_HTTP_URL", "https://sms.example/hook"); vi.stubEnv("OTP_HTTP_TOKEN", "hook-token");
    const t = await db.tenant.findFirstOrThrow();
    const inv = await db.invite.findFirstOrThrow({ where: { contact: "9850000002", usedAt: null } });
    expect(await checkInviteContact(t.code, inv.code, "98500 00002")).toEqual({ ok: true, data: { otpSent: true } });
    expect(sent.at(-1)!.headers.Authorization).toBe("Bearer hook-token");
    expect(JSON.parse(sent.at(-1)!.body)).toMatchObject({ phone: "+919850000002", purpose: "invite" });
    expect(await completeInvite({ code: t.code, inviteCode: inv.code, contact: "9850000002", otp: lastCode(), name: "New Cashier", pin: "3971", agree: true })).toMatchObject({ ok: true });
  });

  it("owner and manager sessions end after 2 idle hours; counter sessions last the shift", async () => {
    const ctx = await signIn();
    await db.session.update({ where: { id: ctx.sessionId }, data: { lastSeenAt: new Date(Date.now() - 119 * 60_000) } });
    expect(await readSession()).not.toBeNull();
    await db.session.update({ where: { id: ctx.sessionId }, data: { lastSeenAt: new Date(Date.now() - 121 * 60_000) } });
    expect(await readSession()).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: ctx.sessionId } })).revokedAt).not.toBeNull();

    jar.clear();
    const cashier = await db.user.findFirstOrThrow({ where: { name: "New Cashier" } });
    const counter = await db.counter.findFirstOrThrow({ where: { tenantId: cashier.tenantId } });
    await createSession(cashier.id, cashier.tokenVersion, { mfaPassed: true, counterId: counter.id });
    const s = (await readSession())!;
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(Date.now() - 5 * 3600_000) } });
    expect((await readSession())?.id).toBe(s.id);
  });
  it("the email/SMS two-step reset needs a password first factor; Google or mobile-OTP sign-ins can't use it and hold it for 24 h", async () => {
    const owner = await db.user.findFirstOrThrow({ where: { email: EMAIL } });
    expect(owner).toMatchObject({ googleSub: "g-owner", mfaEnabled: true });
    const viaGoogle = async () => {
      jar.clear();
      const s = new URL((await googleStart(new Request(`${APP}/api/auth/google/start`))).headers.get("location")!).searchParams;
      idClaims = google.claims({ aud: CLIENT, nonce: s.get("nonce"), sub: "g-owner", email: EMAIL });
      expect((await googleCallback(new Request(`${APP}/api/auth/google/callback?state=${s.get("state")}&code=c`))).headers.get("location")).toBe(`${APP}/app`); // Google needs no second code
    };
    const mailsAndSms = () => sent.filter((s) => !s.url.includes("oauth2.googleapis.com")).length;
    const refused = { ok: false, error: expect.stringMatching(/needs a sign-in with your password/) };

    // A password session asks for a code; a Google session can't spend it.
    await db.session.updateMany({ where: { userId: owner.id, firstFactor: { in: ["google", "otp"] } }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    jar.clear();
    await passwordSignIn(EMAIL, PW);
    expect((await readSession(true))?.firstFactor).toBe("password");
    expect(await sendMfaResetCode()).toEqual({ ok: true, data: "o***@test.in" });
    const code = lastCode();

    await viaGoogle();
    expect((await readSession(true))).toMatchObject({ firstFactor: "google", mfaPassed: true });
    const before = mailsAndSms();
    // A Google session is already fully signed in, so it has no pending code to reset.
    expect((await sendMfaResetCode()).ok).toBe(false);
    expect((await resetMfaWithCode(code)).ok).toBe(false);
    expect(mailsAndSms()).toBe(before);

    // Mobile-OTP sign-in, with SMS the only channel left: still refused, nothing sent.
    vi.stubEnv("MAIL_PROVIDER", "");
    jar.clear();
    expect(await requestSignInOtp(PHONE)).toEqual({ ok: true });
    expect(await otpSignIn(PHONE, lastCode())).toEqual({ ok: true, data: "/signin/mfa" });
    expect((await readSession(true))?.firstFactor).toBe("otp");
    const sms = mailsAndSms();
    expect(await sendMfaResetCode()).toEqual(refused);
    expect(await resetMfaWithCode(code)).toEqual(refused);
    expect(mailsAndSms()).toBe(sms);
    expect(await db.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ mfaEnabled: true });
    expect(await db.recoveryCode.count({ where: { userId: owner.id, usedAt: null } })).toBe(10);

    // Those sign-ins hold the reset back for 24 h even for a password session…
    vi.stubEnv("MAIL_PROVIDER", "resend");
    jar.clear();
    await passwordSignIn(EMAIL, PW);
    expect(await sendMfaResetCode()).toMatchObject({ ok: false, error: expect.stringMatching(/signed in to this account with Google or a mobile code recently/) });
    expect(await resetMfaWithCode(code)).toMatchObject({ ok: false, error: expect.stringMatching(/paused/) });
    // …and once they are older, the password session's reset works.
    await db.session.updateMany({ where: { userId: owner.id, firstFactor: { in: ["google", "otp"] } }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    expect(await sendMfaResetCode()).toEqual({ ok: true, data: "o***@test.in" });
    expect(await resetMfaWithCode(lastCode())).toEqual({ ok: true, data: null });
    expect(await db.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ mfaEnabled: false, mfaSecret: null });
  });
});
