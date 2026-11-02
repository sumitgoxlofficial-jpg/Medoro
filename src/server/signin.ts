import "server-only";
import { db } from "./db";
import { writeAudit } from "./audit";
import { clientInfo, createSession, isTrustedDevice } from "./auth";

type FirstFactor = "password" | "google" | "otp" | "pin";
type SignInUser = { id: string; tenantId: string; name: string; tokenVersion: number; mfaEnabled: boolean; mfaRequired: boolean };

/** Opens a session after the first factor. Returns where to go next: the MFA step or the app. */
export async function finishSignIn(user: SignInUser, factor: FirstFactor, how: string, opts: { counterId?: string; device?: string } = {}) {
  // An enrolled authenticator is asked for after every first factor, Google included. Google sign-in only skips the
  // "enrol an authenticator" step that mfaRequired otherwise forces, since Google runs its own 2-step verification.
  const wantsMfa = user.mfaEnabled || (factor !== "google" && user.mfaRequired);
  const needMfa = wantsMfa && !(user.mfaEnabled && (await isTrustedDevice(user.id, user.tokenVersion)));
  await createSession(user.id, user.tokenVersion, { mfaPassed: !needMfa, firstFactor: factor, ...opts });
  const { ip } = await clientInfo();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, { tenantId: user.tenantId, userId: user.id, userName: user.name, action: needMfa ? "Password accepted, MFA pending" : "Signed in", entity: "session", detail: how, ip });
  });
  return needMfa ? "/signin/mfa" : "/app";
}
