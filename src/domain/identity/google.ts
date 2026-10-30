import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { checkLock, clientInfo } from "@/server/auth";
import { finishSignIn } from "@/server/signin";
import { getCtx } from "@/server/context";
import { clearPendingLink, readPendingLink, setPendingLink, type GoogleClaims } from "@/server/google-oidc";

/**
 * Maps a verified Google identity to a Medoro account and returns where to send the browser.
 * Only an account that already linked this Google subject signs in. A first sign-in whose verified email
 * matches exactly one password account is parked until that account's password is entered: never linked by email alone.
 */
export async function googleSignIn(c: GoogleClaims) {
  const { ip } = await clientInfo();
  const u = await db.user.findUnique({ where: { googleSub: c.sub } });
  if (u) {
    if (!u.active || u.isSupport || !u.passwordHash) {
      await writeAudit(db, { tenantId: u.tenantId, userId: u.id, userName: u.name, action: "Google sign-in refused", entity: "session", detail: "account deactivated", ip });
      return "/signin?google=inactive";
    }
    if (await checkLock(["acct:" + (u.email ?? u.id)])) return "/signin?google=locked";
    return finishSignIn(u, "Google");
  }
  const matches = await db.user.findMany({ where: { email: c.email, active: true, isSupport: false, passwordHash: { not: null }, googleSub: null }, take: 2, select: { id: true } });
  if (matches.length !== 1) return "/signin?google=nouser";
  await setPendingLink({ sub: c.sub, email: c.email, userId: matches[0].id });
  return "/signin?google=link";
}

async function link(userId: string, c: { sub: string; email: string }, how: string) {
  const { ip } = await clientInfo();
  return db.$transaction(async (tx) => {
    const other = await tx.user.findUnique({ where: { googleSub: c.sub } });
    if (other && other.id !== userId) return "taken" as const;
    const u = await tx.user.update({ where: { id: userId }, data: { googleSub: c.sub, googleEmail: c.email } });
    await writeAudit(tx, { tenantId: u.tenantId, userId: u.id, userName: u.name, action: "Google sign-in connected", entity: "user", entityId: u.id, detail: `${c.email} · ${how}`, ip });
    return "linked" as const;
  });
}

/** After a password sign-in: completes a link parked by googleSignIn, if it was for this account. */
export async function confirmPendingLink(userId: string) {
  const p = await readPendingLink();
  if (!p) return null;
  await clearPendingLink();
  return p.userId === userId ? link(userId, p, "confirmed with password") : null;
}

/** Profile → Connect Google, for the signed-in user. */
export async function linkGoogleToSession(c: GoogleClaims) {
  const ctx = await getCtx();
  if (!ctx || ctx.readOnly) return "forbidden";
  const u = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!u?.passwordHash) return "unsupported";
  return link(u.id, c, "from Profile");
}
