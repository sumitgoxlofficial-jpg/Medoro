"use server";
import { ZodError } from "zod";
import { randomBytes } from "node:crypto";
import { createPharmacy } from "@/domain/identity/service";
import { UserError } from "@/server/action";
import { setupUnlocked, signupOpen } from "@/server/setup-gate";
import { rateLimit } from "@/server/rate-limit";
import { clientInfo, createSession } from "@/server/auth";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { mailEnabled } from "@/server/mail";
import { clearPendingSignup, clearVerifiedEmail, readPendingSignup, readVerifiedEmail } from "@/server/google-oidc";
import { log } from "@/server/log";
import { signupDeployment } from "@/domain/identity/deployment";
import { distHostingAllowed } from "@/domain/distribution/hosting";

type R<T = null> = { ok: true; data: T } | { ok: false; error: string };

export type DistSignupInput = {
  business: { name: string; code: string; gstin: string; dl: string; address: string };
  owner: { name: string; email: string; phone: string; password: string };
  godowns: string[];
  backupKey: string;
  kitAck: boolean;
  agree: boolean;
};

/**
 * Creates a MEDORO Distribution tenant (owner, godowns, distribution roles, 7-day trial) the same way pharmacy sign-up
 * does: the owner is the Google account they continued with, or an email confirmed with a code; then they are signed in.
 */
export async function createDistributorAction(input: DistSignupInput): Promise<R<{ code: string; google: boolean }>> {
  const open = signupOpen();
  if (!open && !(await setupUnlocked())) return { ok: false, error: "Sign-up is closed on this server." };
  if (!distHostingAllowed()) return { ok: false, error: "MEDORO Distribution isn’t offered on this hosted server. Run it on your own server or database." };
  if (open && input.agree !== true) return { ok: false, error: "Accept the Terms and Privacy Policy to continue." };
  try {
    const { ip } = await clientInfo();
    if (!(await rateLimit("dist-signup:" + (ip ?? "unknown"), 5, 3600_000))) return { ok: false, error: "Too many sign-ups from this network. Try again in an hour." };
    const email = input.owner.email.trim().toLowerCase();
    const g = await readPendingSignup();
    const viaGoogle = !!g && g.email === email;
    const verified = await readVerifiedEmail();
    if (!viaGoogle && mailEnabled() && verified !== email) return { ok: false, error: "Confirm your email with the code we send first. Go back and choose “Sign up with email”." };
    const godowns = input.godowns.map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const owner = viaGoogle && !input.owner.password ? { ...input.owner, email, password: randomBytes(24).toString("base64url") } : { ...input.owner, email };
    const b = input.business;
    const r = await createPharmacy({
      pharmacy: { name: b.name.trim(), code: b.code.trim().toUpperCase(), gstin: b.gstin.trim().toUpperCase(), dl: b.dl.trim(), pharmacist: "", address: b.address.trim(), lang: "en" },
      owner, deployment: signupDeployment(process.env.DEPLOYMENT_MODE, process.env.DATABASE_URL),
      branches: (godowns.length ? godowns : ["Main godown"]).map((name) => ({ name, counters: 1 })), invites: [],
      backupKey: input.backupKey, kitAck: input.kitAck,
    } as never, { signup: true, product: "distribution" });
    if (viaGoogle) {
      const linked = await db.user.update({ where: { id: r.ownerId }, data: { googleSub: g.sub, googleEmail: g.email } });
      await writeAudit(db, { tenantId: linked.tenantId, userId: linked.id, userName: linked.name, action: "Google sign-in connected", entity: "user", entityId: linked.id, detail: `${g.email} · signed up with Google` });
      await clearPendingSignup();
    }
    if (verified) await clearVerifiedEmail();
    const u = await db.user.findUniqueOrThrow({ where: { id: r.ownerId } });
    await createSession(u.id, u.tokenVersion, viaGoogle ? { mfaPassed: true, device: "Sign-up", firstFactor: "google" } : { mfaPassed: false, device: "Sign-up", firstFactor: "password" });
    return { ok: true, data: { code: r.tenantCode, google: viaGoogle } };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("Distributor sign-up failed.", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}
