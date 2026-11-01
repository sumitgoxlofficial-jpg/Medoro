import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { checkLock, clientInfo } from "@/server/auth";
import { finishSignIn } from "@/server/signin";
import { getCtx } from "@/server/context";
import { clearPendingLink, readPendingLink, setPendingSignup, type GoogleClaims } from "@/server/google-oidc";
import { signupOpen } from "@/server/setup-gate";

/**
 * Maps a verified Google identity to a Medoro account and returns where to send the browser.
 * - An account that already linked this Google subject signs in.
 * - A first Google sign-in whose verified email matches exactly one owner or manager account links to it and signs in
 *   (Google has verified that the person owns that email).
 * - No account with that email: on a server with self sign-up, the person goes on to create their pharmacy with
 *   this Google identity; otherwise they're told no account is connected.
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
    return finishSignIn(u, "google", "Google");
  }
  // One email can have accounts in more than one pharmacy: Google opens the owner account when there is exactly one.
  const all = await db.user.findMany({ where: { email: c.email, active: true, isSupport: false, passwordHash: { not: null }, googleSub: null }, take: 10, select: { id: true, role: { select: { name: true } } } });
  const owners = all.filter((m) => m.role.name === "Owner");
  const matches = all.length === 1 ? all : owners.length === 1 ? owners : all.slice(0, 2);
  if (matches.length === 1) {
    if ((await link(matches[0].id, c, "verified Google email")) === "taken") return "/signin?google=taken";
    const user = await db.user.findUniqueOrThrow({ where: { id: matches[0].id } });
    if (await checkLock(["acct:" + (user.email ?? user.id)])) return "/signin?google=locked";
    return finishSignIn(user, "google", "Google");
  }
  if (matches.length === 0 && signupOpen() && !(await db.user.findFirst({ where: { email: c.email }, select: { id: true } }))) {
    await setPendingSignup({ sub: c.sub, email: c.email, name: c.name });
    return "/signup?google=1";
  }
  return "/signin?google=nouser";
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
