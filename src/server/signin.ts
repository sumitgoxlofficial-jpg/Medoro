import "server-only";
import { db } from "./db";
import { writeAudit } from "./audit";
import { clientInfo, createSession, isTrustedDevice } from "./auth";

type SignInUser = { id: string; tenantId: string; name: string; tokenVersion: number; mfaEnabled: boolean; mfaRequired: boolean };

/** Opens a session after the first factor. Returns where to go next: the MFA step or the app. */
export async function finishSignIn(user: SignInUser, how: string, opts: { counterId?: string; device?: string } = {}) {
  const needMfa = (user.mfaEnabled || user.mfaRequired) && !(user.mfaEnabled && (await isTrustedDevice(user.id, user.tokenVersion)));
  await createSession(user.id, user.tokenVersion, { mfaPassed: !needMfa, ...opts });
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, { tenantId: user.tenantId, userId: user.id, userName: user.name, action: needMfa ? (how === "Google" ? "Google sign-in accepted, MFA pending" : "Password accepted, MFA pending") : "Signed in", entity: "session", detail: how, ip });
  });
  return needMfa ? "/signin/mfa" : "/app";
}
