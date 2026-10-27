"use server";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import {
  checkLock, clearFailures, clientInfo, createSession, destroySession, hashPassword, isTrustedDevice,
  markMfaPassed, readSession, recordFailure, setTrustedDevice, verifyPassword,
} from "@/server/auth";
import { otpEnabled, sendOtp, verifyOtp } from "@/server/otp";
import { checkTotp, newTotpSecret, openSecret } from "@/server/totp";
import { UserError } from "@/server/action";
import { createPharmacy, isSetupDone, nextEmployeeNo } from "@/domain/identity/service";
import { MOBILE_RE, inviteContact, normPhone, passwordSchema, pinSchema, type SetupInput } from "@/domain/identity/contracts";
import { ZodError } from "zod";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (error: string): R<never> => ({ ok: false, error });
const errMsg = (e: unknown) =>
  e instanceof ZodError ? e.issues[0]?.message ?? "Invalid input." : e instanceof UserError ? e.message : (console.error(e), "Something went wrong. Nothing was saved.");

async function finishSignIn(user: { id: string; tenantId: string; name: string; tokenVersion: number; mfaEnabled: boolean; mfaRequired: boolean }, how: string, opts: { counterId?: string; device?: string } = {}) {
  const needMfa = (user.mfaEnabled || user.mfaRequired) && !(user.mfaEnabled && (await isTrustedDevice(user.id, user.tokenVersion)));
  await createSession(user.id, user.tokenVersion, { mfaPassed: !needMfa, ...opts });
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, { tenantId: user.tenantId, userId: user.id, userName: user.name, action: needMfa ? "Password accepted, MFA pending" : "Signed in", entity: "session", detail: how, ip });
  });
  return needMfa ? "/signin/mfa" : "/app";
}

// ───────────── First-run setup ─────────────

export async function setupAction(input: SetupInput): Promise<R<{ invites: { contact: string; role: string; code: string }[]; tenantCode: string }>> {
  try {
    if (await isSetupDone()) return fail("This installation is already set up. Sign in instead.");
    const r = await createPharmacy(input);
    const owner = await db.user.findUniqueOrThrow({ where: { id: r.ownerId } });
    await createSession(owner.id, owner.tokenVersion, { mfaPassed: false, device: "Setup" });
    return { ok: true, data: { invites: r.invites, tenantCode: r.tenantCode } };
  } catch (e) { return fail(errMsg(e)); }
}

/** Checks the live database this server is configured with. */
export async function testDatabase(): Promise<R<string>> {
  if (await isSetupDone()) return fail("Already set up.");
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
  const keys = ["acct:" + e, "ip:" + (ip ?? "?")];
  const mins = await checkLock(keys);
  if (mins) return fail(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  const user = await db.user.findFirst({ where: { email: e, active: true } });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    const left = await recordFailure(keys);
    return fail(left ? `Email or password is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many attempts. Sign-in is locked for 15 minutes.");
  }
  await clearFailures(keys);
  return { ok: true, data: await finishSignIn(user, "Email and password") };
}

export async function requestSignInOtp(phone: string): Promise<R> {
  if (!otpEnabled()) return fail("Mobile OTP is not set up on this server. Use email and password.");
  const p = normPhone(phone);
  if (!MOBILE_RE.test(p)) return fail("Enter a valid 10-digit Indian mobile number.");
  const mins = await checkLock(["acct:" + p]);
  if (mins) return fail(`Too many attempts. Try again in ${mins} minutes.`);
  const user = await db.user.findFirst({ where: { phone: p, active: true } });
  // Same response whether or not the number exists, so the form can't be used to find accounts.
  if (user) { try { await sendOtp(p, "signin"); } catch (e) { return fail(errMsg(e)); } }
  return { ok: true };
}

export async function otpSignIn(phone: string, code: string): Promise<R<string>> {
  const p = normPhone(phone);
  const r = await verifyOtp(p, code, "signin");
  if (!r.ok) {
    await recordFailure(["acct:" + p]);
    return fail(r.left ? `Incorrect OTP. ${r.left} attempts left.` : "That code has expired. Send a new OTP.");
  }
  const user = await db.user.findFirst({ where: { phone: p, active: true } });
  if (!user) return fail("No account uses this number.");
  await clearFailures(["acct:" + p]);
  return { ok: true, data: await finishSignIn(user, "Mobile OTP") };
}

// ───────────── MFA ─────────────

export async function verifyMfa(code: string, trust: boolean): Promise<R<string>> {
  const s = await readSession(true);
  if (!s) return fail("Your sign-in has expired. Start again.");
  if (!/^\d{6}$/.test(code)) return fail("Enter the 6-digit code from your authenticator app.");
  const u = s.user;
  if (!u.mfaSecret) return fail("Set up your authenticator first.");
  const keys = ["mfa:" + u.id];
  const mins = await checkLock(keys);
  if (mins) return fail(`Too many attempts. Try again in ${mins} minutes.`);
  if (!checkTotp(openSecret(u.mfaSecret), code)) {
    const left = await recordFailure(keys);
    return fail(left ? "Code did not match. Codes refresh every 30 seconds." : "Too many attempts. Locked for 15 minutes.");
  }
  await clearFailures(keys);
  await markMfaPassed(s.id);
  await db.$transaction(async (tx) => {
    if (!u.mfaEnabled) await tx.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
    await writeAudit(tx, { tenantId: u.tenantId, userId: u.id, userName: u.name, action: u.mfaEnabled ? "Signed in with MFA" : "Authenticator set up", entity: "session" });
  });
  if (trust) await setTrustedDevice(u.id, u.tokenVersion);
  return { ok: true, data: "/app" };
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

export async function countersFor(code: string): Promise<{ id: string; name: string; branch: string }[]> {
  const t = await db.tenant.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!t) return [];
  const [cs, bs] = await Promise.all([
    db.counter.findMany({ where: { tenantId: t.id, active: true }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { tenantId: t.id, active: true } }),
  ]);
  return cs.map((c) => ({ id: c.id, name: c.name, branch: bs.find((b) => b.id === c.branchId)?.name ?? "" })).sort((a, b) => a.branch.localeCompare(b.branch));
}

export async function employeeSignIn(input: { code: string; employeeNo: string; pin: string; counterId: string }): Promise<R<string>> {
  const code = input.code.trim().toUpperCase(), no = input.employeeNo.trim().toUpperCase();
  if (code.length < 4) return fail("Enter your pharmacy code. Your manager can find it in Users.");
  if (!/^\d{4}$/.test(input.pin)) return fail("Enter your 4-digit PIN.");
  const { ip } = await clientInfo();
  const keys = ["emp:" + code + ":" + no, "ip:" + (ip ?? "?")];
  const mins = await checkLock(keys);
  if (mins) return fail(`This ID is locked for ${mins} more minute${mins > 1 ? "s" : ""}.`);
  const t = await db.tenant.findUnique({ where: { code } });
  const user = t ? await db.user.findFirst({ where: { tenantId: t.id, employeeNo: no, active: true }, include: { role: true } }) : null;
  if (!user || !(await verifyPassword(user.pinHash, input.pin))) {
    const left = await recordFailure(keys);
    return fail(!user && t ? "Employee ID not found for this pharmacy." : left ? `Wrong PIN. ${left} attempt${left > 1 ? "s" : ""} left.` : "5 wrong PINs. This ID is locked for 15 minutes.");
  }
  const counter = await db.counter.findFirst({ where: { id: input.counterId, tenantId: user.tenantId, active: true } });
  if (!counter) return fail("Choose your counter.");
  if (user.branchIds.length && !user.branchIds.includes(counter.branchId)) return fail("You are not assigned to that branch.");
  if (user.mfaRequired) return fail("Owners and managers sign in with email and password.");
  await clearFailures(keys);
  const next = await finishSignIn(user, `Employee PIN · ${counter.name}`, { counterId: counter.id, device: counter.name });
  return { ok: true, data: next === "/app" ? (user.role.name === "Accountant" ? "/app/acc" : "/app") : next };
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
    try { await sendOtp(c.phone, "invite"); } catch (e) { return fail(errMsg(e)); }
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

export async function otpAvailable() { return otpEnabled(); }
