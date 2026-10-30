import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { checkLock, clearFailures, clientInfo, hashPassword, lockKeys, recordFailure } from "@/server/auth";
import { deliverSms, hashCode, newCode, otpEnabled, sameHash, throttleSend } from "@/server/otp";
import { mailEnabled, sendMail } from "@/server/mail";
import { UserError } from "@/server/action";
import { inviteContact, passwordSchema } from "./contracts";

const CODE_MIN = 15;
const MFA_RESET_HOLD_H = 24;
type CodeUser = { id: string; tenantId: string; name: string; email: string | null; phone: string | null };
type Channel = "email" | "sms";
type Purpose = "reset" | "mfa-reset";

export const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1***$2");
export const maskPhone = (p: string) => "******" + p.slice(-4);

// ───────────── Recovery codes ─────────────
// 16 characters from a 32-letter alphabet = 80 bits each, so a plain SHA-256 at rest is enough.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz0";
const normRecovery = (s: string) => s.toLowerCase().replace(/[^0-9a-z]/g, "");
export const looksLikeRecoveryCode = (s: string) => normRecovery(s).length === 16;
const recoveryHash = (userId: string, code: string) => createHash("sha256").update(`recovery:${userId}:${normRecovery(code)}`).digest("hex");

export function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const s = [...randomBytes(16)].map((b) => ALPHABET[b & 31]).join("");
    return s.match(/.{4}/g)!.join("-");
  });
}

/** Replaces the user's recovery codes. Returns the plain codes, which are shown once. */
export async function issueRecoveryCodes(tx: Tx, userId: string) {
  const codes = newRecoveryCodes();
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: recoveryHash(userId, c) })) });
  return codes;
}

/** Marks a matching unused code as used. Returns how many remain, or null when it doesn't match. */
export async function redeemRecoveryCode(userId: string, code: string) {
  const want = recoveryHash(userId, code);
  const rows = await db.recoveryCode.findMany({ where: { userId, usedAt: null } });
  const hit = rows.find((r) => sameHash(r.codeHash, want));
  if (!hit) return null;
  const used = await db.recoveryCode.updateMany({ where: { id: hit.id, usedAt: null }, data: { usedAt: new Date() } });
  return used.count ? rows.length - 1 : null;
}

export const recoveryCodesLeft = (userId: string) => db.recoveryCode.count({ where: { userId, usedAt: null } });

// ───────────── Emailed / SMS codes ─────────────

const scope = (purpose: Purpose, userId: string) => `${purpose}:${userId}`;

async function issueCode(u: CodeUser, purpose: Purpose, channel: Channel) {
  const code = newCode();
  await db.$transaction([
    db.authCode.deleteMany({ where: { userId: u.id, purpose, usedAt: null } }),
    db.authCode.create({ data: { userId: u.id, purpose, channel, codeHash: hashCode(scope(purpose, u.id), code), expiresAt: new Date(Date.now() + CODE_MIN * 60_000) } }),
  ]);
  try {
    if (channel === "sms") await deliverSms(u.phone!, code, purpose, CODE_MIN);
    else {
      const what = purpose === "reset" ? "reset your Medoro password" : "reset two-step verification on your Medoro account";
      await sendMail({
        to: u.email!,
        subject: purpose === "reset" ? `Your Medoro password reset code: ${code}` : `Your Medoro verification code: ${code}`,
        text: `Hi ${u.name.split(" ")[0]},\n\nUse this code to ${what}:\n\n    ${code}\n\nIt expires in ${CODE_MIN} minutes and works once. If you didn't ask for it, ignore this email and tell your pharmacy owner: someone may know your password or email.\n\nMedoro`,
      });
    }
  } catch (e) {
    await db.authCode.deleteMany({ where: { userId: u.id, purpose, usedAt: null } });
    throw e;
  }
  const { ip } = await clientInfo();
  await writeAudit(db, { tenantId: u.tenantId, userId: u.id, userName: u.name, action: purpose === "reset" ? "Password reset code sent" : "Two-step reset code sent", entity: "user", entityId: u.id, detail: channel === "sms" ? "by SMS" : "by email", ip });
}

/** Single use, 15-minute expiry, 5 attempts per code. */
async function consumeCode(userId: string, purpose: Purpose, code: string) {
  const r = await db.authCode.findFirst({ where: { userId, purpose, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!r || r.expiresAt < new Date() || r.attempts >= 5) return null;
  if (!/^\d{6}$/.test(code) || !sameHash(r.codeHash, hashCode(scope(purpose, userId), code))) {
    await db.authCode.update({ where: { id: r.id }, data: { attempts: { increment: 1 } } });
    return null;
  }
  const used = await db.authCode.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: new Date() } });
  return used.count ? r : null;
}

// ───────────── Forgot password ─────────────

export const recoveryChannels = () => ({ email: mailEnabled(), sms: otpEnabled() });

function parseContact(contact: string) {
  const c = inviteContact(String(contact ?? "").trim());
  if (!c) throw new UserError("Enter your email or 10-digit mobile number.");
  const channel: Channel = c.email ? "email" : "sms";
  if (channel === "email" ? !mailEnabled() : !otpEnabled()) {
    throw new UserError(channel === "email" ? "Email isn’t set up on this server. Use your mobile number." : "SMS isn’t set up on this server. Use your email.");
  }
  return { ...c, channel, target: (c.email ?? c.phone)! };
}

// The account a password sign-in with this contact would reach (same order as passwordSignIn).
const passwordUser = (c: { email: string | null; phone: string | null }) =>
  db.user.findFirst({ where: { active: true, isSupport: false, passwordHash: { not: null }, ...(c.email ? { email: c.email } : { phone: c.phone }) }, orderBy: { createdAt: "asc" } });

/** Sends a reset code when an owner/manager account uses this email or mobile. Says nothing about whether one does. */
export async function requestPasswordReset(contact: string) {
  const c = parseContact(contact);
  await throttleSend(c.target);
  const u = await passwordUser(c);
  if (u) await issueCode(u, "reset", c.channel);
}

export async function completePasswordReset(input: { contact: string; code: string; password: string }) {
  const c = parseContact(input.contact);
  const password = passwordSchema.parse(input.password ?? "");
  const { ip } = await clientInfo();
  const keys = lockKeys("reset:" + c.target, ip);
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  const u = await passwordUser(c);
  const ok = u ? await consumeCode(u.id, "reset", String(input.code ?? "").trim()) : null;
  if (!u || !ok) {
    await recordFailure(keys);
    throw new UserError("That code is wrong or has expired. Request a new one.");
  }
  const hash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { passwordHash: hash, tokenVersion: { increment: 1 }, passwordResetAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await tx.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { tenantId: u.tenantId, userId: u.id, userName: u.name, action: "Password reset", entity: "user", entityId: u.id, detail: `with a code sent by ${ok.channel === "sms" ? "SMS" : "email"} · signed out everywhere`, ip });
  });
  await clearFailures([...keys, ...(u.email ? ["acct:" + u.email] : [])]);
}

// ───────────── Lost authenticator (at the MFA step, after the password) ─────────────

export function mfaResetChannel(u: { email: string | null; phone: string | null }) {
  if (u.email && mailEnabled()) return { channel: "email" as const, to: maskEmail(u.email) };
  if (u.phone && otpEnabled()) return { channel: "sms" as const, to: maskPhone(u.phone) };
  return null;
}

// A forgot-password reset proves only the email or phone. Holding back an OTP-only MFA reset for a day means
// someone who takes over that inbox can't also remove the authenticator straight away; recovery codes still work.
function holdUntil(u: { passwordResetAt: Date | null }) {
  const until = u.passwordResetAt ? u.passwordResetAt.getTime() + MFA_RESET_HOLD_H * 3600_000 : 0;
  return until > Date.now() ? new Date(until) : null;
}

type PendingSession = { id: string; user: CodeUser & { mfaEnabled: boolean; passwordResetAt: Date | null; tokenVersion: number } };

export async function requestMfaReset(s: PendingSession) {
  const u = s.user;
  if (!u.mfaEnabled) throw new UserError("Two-step verification isn’t set up yet. Scan the QR code to set it up.");
  const hold = holdUntil(u);
  if (hold) throw new UserError(`Your password was reset recently, so this option opens at ${hold.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}. Use a recovery code, or ask the owner to reset it.`);
  const ch = mfaResetChannel(u);
  if (!ch) throw new UserError("Email and SMS aren’t set up on this server. Use a recovery code, or ask the owner to reset it.");
  await throttleSend("mfa:" + u.id);
  await issueCode(u, "mfa-reset", ch.channel);
  return ch.to;
}

/** Clears the authenticator so the user enrols a new one now. Ends every other session. */
export async function confirmMfaReset(s: PendingSession, code: string) {
  const u = s.user;
  if (holdUntil(u)) throw new UserError("Use a recovery code instead.");
  const keys = ["mfa:" + u.id];
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minutes.`);
  const r = await consumeCode(u.id, "mfa-reset", String(code ?? "").trim());
  if (!r) {
    await recordFailure(keys);
    throw new UserError("That code is wrong or has expired. Request a new one.");
  }
  await clearFailures(keys);
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    const nu = await tx.user.update({ where: { id: u.id }, data: { mfaSecret: null, mfaEnabled: false, tokenVersion: { increment: 1 } } });
    await tx.recoveryCode.deleteMany({ where: { userId: u.id } });
    await tx.session.update({ where: { id: s.id }, data: { tokenVersion: nu.tokenVersion } });
    await tx.session.updateMany({ where: { userId: u.id, revokedAt: null, NOT: { id: s.id } }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { tenantId: u.tenantId, userId: u.id, userName: u.name, action: "Two-step verification reset", entity: "user", entityId: u.id, detail: `lost authenticator · verified by ${r.channel === "sms" ? "SMS" : "email"} code · other sessions signed out`, ip });
  });
}
