"use server";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import {
  checkLock, clearFailures, clientInfo, clientIp, createSession, destroySession, hashPassword, lockKeys,
  markMfaPassed, readSession, recordFailure, setTrustedDevice, verifyPassword,
} from "@/server/auth";
import { otpEnabled, sendOtp, throttleSend, verifyOtp } from "@/server/otp";
import { checkTotp, newTotpSecret, openSecret } from "@/server/totp";
import { finishSignIn } from "@/server/signin";
import { UserError } from "@/server/action";
import { createPharmacy, isSetupDone, nextEmployeeNo } from "@/domain/identity/service";
import { confirmMfaReset, completePasswordReset, issueRecoveryCodes, looksLikeRecoveryCode, redeemRecoveryCode, requestMfaReset, requestPasswordReset } from "@/domain/identity/recovery";
import { confirmPendingLink } from "@/domain/identity/google";
import { setupUnlocked, signupOpen, unlockSetup } from "@/server/setup-gate";
import { enforce } from "@/server/ratelimit";
import { signupDeployment } from "@/domain/identity/deployment";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { clearPendingSignup, clearVerifiedEmail, readPendingSignup, readVerifiedEmail } from "@/server/google-oidc";
import { sendSignupCode, verifySignupCode } from "@/domain/identity/signup-email";
import { mailEnabled } from "@/server/mail";
import { adoptSetupDrive } from "@/server/setup-drive";
import { MOBILE_RE, inviteContact, passwordSchema, pinSchema, type SetupInput } from "@/domain/identity/contracts";
import { ZodError } from "zod";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (error: string): R<never> => ({ ok: false, error });
const errMsg = (e: unknown) =>
  e instanceof ZodError ? e.issues[0]?.message ?? "Invalid input." : e instanceof UserError ? e.message : (console.error(e), "Something went wrong. Nothing was saved.");

// ───────────── First-run setup ─────────────

export async function unlockSetupAction(token: string): Promise<R<null>> {
  if (await isSetupDone()) return fail("This installation is already set up. Sign in instead.");
  await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  return (await unlockSetup(token)) ? { ok: true, data: null } : fail("That setup token is not right.");
}

export async function setupAction(input: SetupInput): Promise<R<{ invites: { contact: string; role: string; code: string }[]; tenantCode: string }>> {
  try {
    if (await isSetupDone()) return fail("This installation is already set up. Sign in instead.");
    if (!(await setupUnlocked())) return fail("Enter the setup token first.");
    const r = await createPharmacy(input);
    const owner = await db.user.findUniqueOrThrow({ where: { id: r.ownerId } });
    await adoptSetupDrive(owner.tenantId).catch((e) => console.error("[setup] Google Drive not kept:", e));
    await createSession(owner.id, owner.tokenVersion, { mfaPassed: false, device: "Setup", firstFactor: "password" });
    return { ok: true, data: { invites: r.invites, tenantCode: r.tenantCode } };
  } catch (e) { return fail(errMsg(e)); }
}

// ───────────── Self-service sign-up (hosted, multi-pharmacy) ─────────────

export async function signupAction(input: Omit<SetupInput, "deployment"> & { agree: boolean; referral?: string; driveStorage?: boolean }): Promise<R<{ invites: { contact: string; role: string; code: string }[]; tenantCode: string }>> {
  try {
    if (!signupOpen()) return fail("Sign-up is not open on this server.");
    if (input.agree !== true) return fail("Accept the Terms and Privacy Policy to continue.");
    await enforce("signup", clientIp(await headers()) ?? "unknown");
    // Referred by a Medoro sales person or reference partner: they earn commission on what this pharmacy pays.
    const { referrer } = await import("@/staff/sales");
    const ref = input.referral?.trim() ? await referrer(input.referral) : null;
    if (input.referral?.trim() && !ref) return fail("That referral code isn’t valid. Check it with the person who referred you, or leave it empty.");
    const { pharmacy, owner: o, branches, invites, backupKey, kitAck } = input;
    // Signing up after "Continue with Google": the owner is that verified Google account and needs no password to get in.
    // A random one is set so the account still has a password (it can be changed from Profile or Forgot password).
    const g = await readPendingSignup();
    const viaGoogle = !!g && g.email === o.email.trim().toLowerCase();
    // Signing up with email: the address must have been confirmed with a code (when this server can send email).
    const verified = await readVerifiedEmail();
    if (!viaGoogle && mailEnabled() && verified !== o.email.trim().toLowerCase()) return fail("Confirm your email with the code we send first. Go back and choose “Sign up with email”.");
    const ownerIn = viaGoogle && !o.password ? { ...o, password: randomBytes(24).toString("base64url") } : o;
    const r = await createPharmacy({ pharmacy, owner: ownerIn, branches, invites, backupKey, kitAck, deployment: signupDeployment(process.env.DEPLOYMENT_MODE, process.env.DATABASE_URL) }, { signup: true });
    if (input.driveStorage) {
      // Records live on the pharmacy's devices and in its own Google Drive; Medoro keeps only the account.
      const t = await db.tenant.findUniqueOrThrow({ where: { code: r.tenantCode } });
      await db.tenant.update({ where: { id: t.id }, data: { settings: { ...((t.settings as object) ?? {}), driveMode: true, driveOnly: true } as object } });
      await writeAudit(db, { tenantId: t.id, userName: "Sign-up", action: "Data kept in the pharmacy’s Google Drive", entity: "tenant", entityId: t.id, detail: "Chosen at sign-up: bills and stock live on the counters and in the owner’s Google Drive" });
    }
    if (ref) {
      const t = await db.tenant.findUniqueOrThrow({ where: { code: r.tenantCode } });
      await db.tenant.update({ where: { id: t.id }, data: { settings: { ...((t.settings as object) ?? {}), referral: { code: ref.referralCode, staffId: ref.id, at: new Date().toISOString() } } as object } });
      await writeAudit(db, { tenantId: t.id, userName: "Sign-up", action: "Referred by a Medoro partner", entity: "tenant", entityId: t.id, detail: `code ${ref.referralCode} · ${ref.name}` });
    }
    if (viaGoogle) {
      const linked = await db.user.update({ where: { id: r.ownerId }, data: { googleSub: g.sub, googleEmail: g.email } });
      await writeAudit(db, { tenantId: linked.tenantId, userId: linked.id, userName: linked.name, action: "Google sign-in connected", entity: "user", entityId: linked.id, detail: `${g.email} · signed up with Google` });
      await clearPendingSignup();
    }
    if (verified) await clearVerifiedEmail();
    const owner = await db.user.findUniqueOrThrow({ where: { id: r.ownerId } });
    await createSession(owner.id, owner.tokenVersion, viaGoogle ? { mfaPassed: true, device: "Sign-up", firstFactor: "google" } : { mfaPassed: false, device: "Sign-up", firstFactor: "password" });
    return { ok: true, data: { invites: r.invites, tenantCode: r.tenantCode } };
  } catch (e) { return fail(errMsg(e)); }
}

/** Sign-up with email, step 1: send a 6-digit code to the address. */
export async function sendSignupEmailCode(email: string): Promise<R> {
  try { if (!signupOpen()) return fail("Sign-up is not open on this server."); await sendSignupCode(email); return { ok: true }; } catch (e) { return fail(errMsg(e)); }
}
/** Step 2: the code matches; the pharmacy form opens with this email. */
export async function verifySignupEmailCode(email: string, code: string): Promise<R> {
  try { await verifySignupCode(email, code); return { ok: true }; } catch (e) { return fail(errMsg(e)); }
}

/** Checks the live database this server is configured with. */
export async function testDatabase(): Promise<R<string>> {
  if (await isSetupDone()) return fail("Already set up.");
  if (!(await setupUnlocked())) return fail("Enter the setup token first.");
  try {
    const [v] = await db.$queryRaw<{ v: string }[]>`SELECT current_setting('server_version') AS v`;
    const [ssl] = await db.$queryRaw<{ ssl: boolean | null }[]>`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
    const [m] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    return { ok: true, data: `Connected · PostgreSQL ${v.v.split(" ")[0]} · ${ssl?.ssl ? "TLS on" : "TLS off (local socket)"} · migrations applied (${Number(m.n)})` };
  } catch {
    return fail("Could not reach the database in DATABASE_URL. Check the server configuration.");
  }
}

// ───────────── Owner / manager sign-in ─────────────

export async function passwordSignIn(email: string, password: string): Promise<R<string>> {
  const e = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) return fail("Enter a valid email.");
  if (password.length < 10) return fail("Password must be at least 10 characters.");
  const { ip } = await clientInfo();
  const keys = lockKeys("acct:" + e, ip);
  const mins = await checkLock(keys);
  if (mins) return fail(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  // One email can belong to more than one pharmacy account (an owner here, a manager there). Open the one whose
  // password this is; if several share it, the owner account.
  const users = await db.user.findMany({ where: { email: e, active: true, isSupport: false, passwordHash: { not: null } }, include: { role: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 5 });
  const ok: typeof users = [];
  for (const u of users) if (await verifyPassword(u.passwordHash, password)) ok.push(u);
  const user = ok.find((u) => u.role.name === "Owner") ?? ok[0];
  if (!user) {
    const left = await recordFailure(keys);
    return fail(left ? `Email or password is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many attempts. Sign-in is locked for 15 minutes.");
  }
  await clearFailures(keys);
  await confirmPendingLink(user.id);
  return { ok: true, data: await finishSignIn(user, "password", "Email and password") };
}

// ───────────── MFA ─────────────

type MfaDone = { next: string; recoveryCodes?: string[]; remaining?: number };

/** Accepts an authenticator code, or (once enrolled) one of the user's recovery codes. */
export async function verifyMfa(code: string, trust: boolean): Promise<R<MfaDone>> {
  const s = await readSession(true);
  if (!s) return fail("Your sign-in has expired. Start again.");
  const u = s.user;
  if (!u.mfaSecret) return fail("Set up your authenticator first.");
  code = String(code ?? "").trim();
  const totp = /^\d{6}$/.test(code), recovery = !totp && u.mfaEnabled && looksLikeRecoveryCode(code);
  if (!totp && !recovery) return fail(u.mfaEnabled ? "Enter the 6-digit code from your authenticator app, or a recovery code." : "Enter the 6-digit code from your authenticator app.");
  const keys = ["mfa:" + u.id];
  const mins = await checkLock(keys);
  if (mins) return fail(`Too many attempts. Try again in ${mins} minutes.`);
  const remaining = recovery ? await redeemRecoveryCode(u.id, code) : null;
  if (recovery ? remaining === null : !checkTotp(openSecret(u.mfaSecret), code)) {
    const left = await recordFailure(keys);
    if (!left) return fail("Too many attempts. Locked for 15 minutes.");
    return fail(recovery ? "That recovery code doesn’t match or was already used." : "Code did not match. Codes refresh every 30 seconds.");
  }
  await clearFailures(keys);
  await markMfaPassed(s.id);
  const recoveryCodes = await db.$transaction(async (tx) => {
    const codes = u.mfaEnabled ? undefined : await issueRecoveryCodes(tx, u.id);
    if (!u.mfaEnabled) await tx.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
    await writeAudit(tx, {
      tenantId: u.tenantId, userId: u.id, userName: u.name, entity: "session",
      action: !u.mfaEnabled ? "Authenticator set up" : recovery ? "Signed in with a recovery code" : "Signed in with MFA",
      detail: !u.mfaEnabled ? "10 recovery codes issued" : recovery ? `${remaining} recovery code${remaining === 1 ? "" : "s"} left` : null,
    });
    return codes;
  });
  if (trust) await setTrustedDevice(u.id, u.tokenVersion);
  return { ok: true, data: { next: "/app", recoveryCodes, remaining: recovery ? remaining! : undefined } };
}

/** Lost authenticator: sends a code to the email or mobile on the account. Returns the masked destination. */
export async function sendMfaResetCode(): Promise<R<string>> {
  const s = await readSession(true);
  if (!s || s.mfaPassed) return fail("Your sign-in has expired. Start again.");
  try { return { ok: true, data: await requestMfaReset(s) }; } catch (e) { return fail(errMsg(e)); }
}

export async function resetMfaWithCode(code: string): Promise<R<null>> {
  const s = await readSession(true);
  if (!s || s.mfaPassed) return fail("Your sign-in has expired. Start again.");
  try { await confirmMfaReset(s, code); return { ok: true, data: null }; } catch (e) { return fail(errMsg(e)); }
}

// ───────────── Forgot password ─────────────

export async function forgotPassword(contact: string): Promise<R> {
  try { await requestPasswordReset(contact); return { ok: true }; } catch (e) { return fail(errMsg(e)); }
}

export async function resetPassword(input: { contact: string; code: string; password: string }): Promise<R> {
  try { await completePasswordReset(input); return { ok: true }; } catch (e) { return fail(errMsg(e)); }
}

/** Creates an unconfirmed TOTP secret for a user who hasn't enrolled yet. */
export async function ensureMfaSecret(): Promise<void> {
  const s = await readSession(true);
  if (!s || s.user.mfaEnabled || s.user.mfaSecret) return;
  await db.user.update({ where: { id: s.user.id }, data: { mfaSecret: newTotpSecret().sealed } });
}

export async function signOut() {
  const s = await readSession(true);
  if (s) await writeAudit(db, { tenantId: s.user.tenantId, userId: s.user.id, userName: s.user.name, action: "Signed out", entity: "session" });
  await destroySession();
  redirect("/signin");
}

// ───────────── Employee (counter staff) ─────────────

/** Counters to offer at employee login. Once a known employee ID is typed, only that person's branches are listed. */
export async function countersFor(code: string, employeeNo = ""): Promise<{ id: string; name: string; branch: string }[]> {
  const t = await db.tenant.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!t) return [];
  const [cs, bs, u] = await Promise.all([
    db.counter.findMany({ where: { tenantId: t.id, active: true }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { tenantId: t.id, active: true }, orderBy: { createdAt: "asc" } }),
    employeeNo.trim() ? db.user.findFirst({ where: { tenantId: t.id, employeeNo: employeeNo.trim().toUpperCase(), active: true }, select: { branchIds: true } }) : null,
  ]);
  const allowed = u?.branchIds.length ? bs.filter((b) => u.branchIds.includes(b.id)) : bs;
  return allowed.flatMap((b) => cs.filter((c) => c.branchId === b.id).map((c) => ({ id: c.id, name: c.name, branch: b.name })));
}

export async function employeeSignIn(input: { code: string; employeeNo: string; pin: string; counterId: string }): Promise<R<string>> {
  const code = input.code.trim().toUpperCase(), no = input.employeeNo.trim().toUpperCase();
  if (code.length < 4) return fail("Enter your pharmacy code. Your manager can find it in Users.");
  if (!/^\d{4}$/.test(input.pin)) return fail("Enter your 4-digit PIN.");
  const { ip } = await clientInfo();
  const keys = lockKeys("emp:" + code + ":" + no, ip);
  const mins = await checkLock(keys);
  if (mins) return fail(`This ID is locked for ${mins} more minute${mins > 1 ? "s" : ""}.`);
  const t = await db.tenant.findUnique({ where: { code } });
  const user = t ? await db.user.findFirst({ where: { tenantId: t.id, employeeNo: no, active: true }, include: { role: true } }) : null;
  if (!user || !(await verifyPassword(user.pinHash, input.pin))) {
    const left = await recordFailure(keys);
    return fail(left ? `Employee ID or PIN is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many wrong attempts. This ID is locked for 15 minutes.");
  }
  const counter = await db.counter.findFirst({ where: { id: input.counterId, tenantId: user.tenantId, active: true } });
  if (!counter) return fail("Choose your counter.");
  if (user.branchIds.length && !user.branchIds.includes(counter.branchId)) return fail("You are not assigned to that branch.");
  if (user.mfaRequired) return fail("Owners and managers sign in with email and password.");
  await clearFailures(keys);
  const next = await finishSignIn(user, "pin", `Employee PIN · ${counter.name}`, { counterId: counter.id, device: counter.name });
  return { ok: true, data: next === "/app" ? (user.role.name === "Accountant" ? "/app/accounts" : "/app") : next };
}

export async function findInvite(code: string, inviteCode: string): Promise<R<{ role: string; branch: string; pharmacy: string; name: string | null; kind: "phone" | "email" }>> {
  const t = await db.tenant.findUnique({ where: { code: code.trim().toUpperCase() } });
  const inv = t ? await db.invite.findFirst({ where: { tenantId: t.id, code: inviteCode.trim().toUpperCase(), usedAt: null, expiresAt: { gt: new Date() } } }) : null;
  if (!t || !inv) return fail("Invite code not found or expired. Codes are valid for 48 hours.");
  const br = inv.branchId ? await db.branch.findUnique({ where: { id: inv.branchId } }) : null;
  return { ok: true, data: { role: inv.roleName, branch: br?.name ?? "All branches", pharmacy: t.name, name: inv.name, kind: MOBILE_RE.test(inv.contact) ? "phone" : "email" } };
}

/** Confirms the contact on the invite. Sends an OTP when SMS is configured. */
export async function checkInviteContact(code: string, inviteCode: string, contact: string): Promise<R<{ otpSent: boolean }>> {
  const t = await db.tenant.findUnique({ where: { code: code.trim().toUpperCase() } });
  const inv = t ? await db.invite.findFirst({ where: { tenantId: t.id, code: inviteCode.trim().toUpperCase(), usedAt: null, expiresAt: { gt: new Date() } } }) : null;
  if (!inv) return fail("Invite code not found or expired.");
  const c = inviteContact(contact);
  if (!c || (c.phone ?? c.email) !== inv.contact) return fail("That doesn’t match the mobile number or email on the invite.");
  if (c.phone && otpEnabled()) {
    try { await throttleSend(c.phone); await sendOtp(c.phone, "invite"); } catch (e) { return fail(errMsg(e)); }
    return { ok: true, data: { otpSent: true } };
  }
  return { ok: true, data: { otpSent: false } };
}

export async function completeInvite(input: { code: string; inviteCode: string; contact: string; otp?: string; name: string; pin?: string; password?: string; agree: boolean }): Promise<R<{ employeeNo: string; tenantCode: string; manager: boolean }>> {
  try {
    if (input.name.trim().length < 2) return fail("Enter your full name.");
    if (!input.agree) return fail("Please accept the staff terms.");
    const t = await db.tenant.findUnique({ where: { code: input.code.trim().toUpperCase() } });
    const inv = t ? await db.invite.findFirst({ where: { tenantId: t.id, code: input.inviteCode.trim().toUpperCase(), usedAt: null, expiresAt: { gt: new Date() } } }) : null;
    if (!t || !inv) return fail("Invite code not found or expired.");
    const c = inviteContact(input.contact);
    if (!c || (c.phone ?? c.email) !== inv.contact) return fail("That doesn’t match the invite.");
    // Managers sign in with email, password and an authenticator; everyone else uses a PIN at the counter.
    const manager = inv.roleName === "Manager";
    if (manager) { if (!c.email) return fail("Manager invites must be sent to an email address."); passwordSchema.parse(input.password ?? ""); }
    else pinSchema.parse(input.pin ?? "");
    if (c.phone && otpEnabled()) {
      const r = await verifyOtp(c.phone, input.otp ?? "", "invite");
      if (!r.ok) return fail(r.left ? `Incorrect OTP. ${r.left} attempts left.` : "That code has expired. Go back and send a new one.");
    }
    const secretHash = await hashPassword(manager ? input.password! : input.pin!);
    const out = await db.$transaction(async (tx) => {
      if (inv.userId) {
        // A reset: set a new PIN/password on the existing account.
        const u = await tx.user.update({ where: { id: inv.userId }, data: { ...(manager ? { passwordHash: secretHash } : { pinHash: secretHash }), tokenVersion: { increment: 1 }, failedLogins: 0 } });
        const used = await tx.invite.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date() } });
        if (!used.count) throw new UserError("This code was just used.");
        await writeAudit(tx, { tenantId: t.id, userId: u.id, userName: u.name, action: manager ? "Password reset completed" : "PIN reset completed", entity: "user", entityId: u.id });
        return { employeeNo: u.employeeNo ?? "", tenantCode: t.code, manager };
      }
      const role = await tx.role.findFirstOrThrow({ where: { tenantId: t.id, name: inv.roleName } });
      const employeeNo = await nextEmployeeNo(tx, t.id);
      const taken = await tx.user.findFirst({ where: { tenantId: t.id, OR: [c.phone ? { phone: c.phone } : { email: c.email }] } });
      if (taken) throw new UserError("An account already uses this contact. Ask your manager.");
      const u = await tx.user.create({
        data: { tenantId: t.id, name: input.name.trim(), phone: c.phone, email: c.email, ...(manager ? { passwordHash: secretHash } : { pinHash: secretHash }), roleId: role.id, branchIds: inv.branchId ? [inv.branchId] : [], employeeNo, mfaRequired: manager },
      });
      const used = await tx.invite.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date(), userId: u.id } });
      if (!used.count) throw new UserError("This invite was just used.");
      await writeAudit(tx, { tenantId: t.id, userId: u.id, userName: u.name, action: "Employee account created", entity: "user", entityId: u.id, detail: `${employeeNo} · ${inv.roleName} · invite ${inv.code}` });
      return { employeeNo, tenantCode: t.code, manager };
    });
    return { ok: true, data: out };
  } catch (e) { return fail(errMsg(e)); }
}

