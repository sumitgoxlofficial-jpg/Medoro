import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { checkLock, clearFailures, clientInfo, hashPassword, recordFailure, verifyPassword } from "@/server/auth";
import { UserError } from "@/server/action";
import { googleLoginConfigured } from "@/server/google-oidc";
import type { Ctx } from "@/server/context";
import { passwordSchema, pinSchema } from "./contracts";
import { issueRecoveryCodes, recoveryCodesLeft } from "./recovery";

// Self-service from Profile: the signed-in user's own credentials.

const me = async (ctx: Ctx) => {
  if (ctx.readOnly) throw new UserError("Medoro support access is read-only.");
  return db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
};

export async function profileSecurity(ctx: Ctx) {
  const u = await me(ctx);
  return {
    hasPassword: !!u.passwordHash, hasPin: !!u.pinHash, mfa: u.mfaEnabled,
    recoveryLeft: u.mfaEnabled ? await recoveryCodesLeft(u.id) : 0,
    google: { available: googleLoginConfigured() && !!u.passwordHash, email: u.googleSub ? u.googleEmail ?? "Google account" : null },
  };
}

async function checkCurrent(ctx: Ctx, hash: string | null, given: string, what: string) {
  const keys = ["self:" + ctx.userId];
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  if (!(await verifyPassword(hash, String(given ?? "")))) {
    const left = await recordFailure(keys);
    throw new UserError(left ? `Your current ${what} is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many attempts. Try again in 15 minutes.");
  }
  await clearFailures(keys);
}

/** Saves the new secret and signs out the user's other devices. */
async function saveCredential(ctx: Ctx, data: { passwordHash: string } | { pinHash: string }, action: string) {
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ctx.userId }, data });
    await tx.session.updateMany({ where: { userId: ctx.userId, revokedAt: null, NOT: { id: ctx.sessionId } }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action, entity: "user", entityId: ctx.userId, detail: "other devices signed out", ip });
  });
}

export async function changePassword(ctx: Ctx, current: string, next: string) {
  const u = await me(ctx);
  if (!u.passwordHash) throw new UserError("You sign in with a PIN. Change your PIN instead.");
  const pw = passwordSchema.parse(next ?? "");
  await checkCurrent(ctx, u.passwordHash, current, "password");
  if (await verifyPassword(u.passwordHash, pw)) throw new UserError("Choose a password you haven’t used here.");
  await saveCredential(ctx, { passwordHash: await hashPassword(pw) }, "Password changed");
}

export async function changePin(ctx: Ctx, current: string, next: string) {
  const u = await me(ctx);
  if (!u.pinHash) throw new UserError("You sign in with a password. Change your password instead.");
  const pin = pinSchema.parse(next ?? "");
  await checkCurrent(ctx, u.pinHash, current, "PIN");
  if (await verifyPassword(u.pinHash, pin)) throw new UserError("Choose a different PIN.");
  await saveCredential(ctx, { pinHash: await hashPassword(pin) }, "PIN changed");
}

/** New set of 10 recovery codes; the old ones stop working. */
export async function regenerateRecoveryCodes(ctx: Ctx) {
  const u = await me(ctx);
  if (!u.mfaEnabled) throw new UserError("Set up two-step verification first.");
  return db.$transaction(async (tx) => {
    const codes = await issueRecoveryCodes(tx, u.id);
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: u.id, userName: u.name, action: "Recovery codes regenerated", entity: "user", entityId: u.id });
    return codes;
  });
}

export async function disconnectGoogle(ctx: Ctx) {
  const u = await me(ctx);
  if (!u.googleSub) throw new UserError("Google sign-in isn’t connected.");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { googleSub: null, googleEmail: null } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: u.id, userName: u.name, action: "Google sign-in disconnected", entity: "user", entityId: u.id, detail: u.googleEmail ?? "" });
  });
}
