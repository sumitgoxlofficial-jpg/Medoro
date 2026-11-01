import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { checkLock, clearFailures, clientInfo, hashPassword, lockKeys, recordFailure, verifyPassword } from "@/server/auth";
import { checkTotp, newTotpSecret, openSecret, totpQr } from "@/server/totp";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { allow, createStaffSession, isEmail, isStaffEmail, newToken, readStaffSession, staffAudit, staffDomain, tokenHash, type Staff } from "./auth";
import { MOBILE_RE, digits, type StaffRoleId } from "./constants";
import { clearPendingPartner, clearVerifiedEmail, readPendingPartner, readVerifiedEmail, setPendingPartner, type GoogleClaims } from "@/server/google-oidc";
import { mailEnabled } from "@/server/mail";

const CP = "_cp"; // sequence namespace for the control plane
const INVITE_DAYS = 7;

const anyEmail = () => z.string().trim().toLowerCase().refine(isEmail, "Enter a valid email.");
/** Who earns commission and gets a referral code. */
const earns = (role: StaffRoleId) => role === "sales" || role === "partner";
/** Medoro's own team and reference partners are separate profiles: one email can have one of each, each opening its own panel. */
export type StaffKind = "team" | "partner";
export const kindOf = (role: StaffRoleId): StaffKind => (role === "partner" ? "partner" : "team");
const byEmail = (email: string, kind: StaffKind) => db.staffUser.findUnique({ where: { email_kind: { email, kind } } });
const phone = z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile.");
const password = z.string().min(12, "Password must be at least 12 characters.").max(200);

async function newEmployeeNo() {
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "EMP"));
  return { empNo: "MS-" + String(n).padStart(3, "0"), n };
}
const referral = (name: string, n: number) => name.trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10) + n;

// ── Self sign-up. Reference partners are active straight away; sales and care wait for a super admin.
// The very first super admin comes from STAFF_BOOTSTRAP_EMAIL.
export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(80),
  email: anyEmail(), phone, team: z.string().trim().max(60).default(""),
  role: z.enum(["sales", "care", "partner"]), password,
}).refine((i) => i.role === "partner" || isStaffEmail(i.email), { message: `Medoro team profiles use an @${staffDomain()} work email. Joining as an MR or consultant? Choose Reference partner.`, path: ["email"] });

export async function signup(raw: z.input<typeof signupSchema>) {
  const i = signupSchema.parse(raw);
  const kind = kindOf(i.role);
  if (await byEmail(i.email, kind)) throw new UserError(kind === "partner" ? "You already have a partner profile with this email. Sign in on the Reference partner tab." : "A team profile with this email already exists. Sign in, or ask a super admin.");
  // The first super admin comes from the Medoro team set-up, never from the partner form.
  // A partner who joins with email proves the address with a code first (when this server can send email).
  if (kind === "partner" && mailEnabled() && (await readVerifiedEmail()) !== i.email) throw new UserError("Confirm your email with the code we send first.");
  const bootstrap = kind === "team" && (process.env.STAFF_BOOTSTRAP_EMAIL ?? "").trim().toLowerCase() === i.email && !(await db.staffUser.count({ where: { role: "super_admin", status: "active" } }));
  const { empNo, n } = await newEmployeeNo();
  const role: StaffRoleId = bootstrap ? "super_admin" : i.role;
  const active = bootstrap || role === "partner";
  const u = await db.staffUser.create({
    data: { empNo, name: i.name, email: i.email, kind, phone: i.phone, team: i.team, role, status: active ? "active" : "pending", passwordHash: await hashPassword(i.password), referralCode: earns(role) ? referral(i.name, n) : null },
  });
  if (kind === "partner") await clearVerifiedEmail();
  await staffAudit({ id: u.id, name: u.name }, bootstrap ? "First super admin created" : role === "partner" ? "Reference partner joined" : "Profile submitted", `${empNo} · ${role}`);
  return { bootstrap, role, active };
}

// ── Reference partners with Google: no password, no approval. Google has verified the email.

/** After Google: signs an existing partner in, or holds the identity while a new partner adds their details. Returns where to go. */
export async function partnerFromGoogle(c: GoogleClaims): Promise<string> {
  // Only the partner profile: a Medoro team profile with the same email is separate and never opened by Google.
  const bySub = await db.staffUser.findUnique({ where: { googleSub: c.sub } });
  const u = bySub?.kind === "partner" ? bySub : await byEmail(c.email, "partner");
  if (!u) {
    await setPendingPartner({ sub: c.sub, email: c.email, name: c.name });
    return "/staff/login?join=partner&google=new";
  }
  if (u.googleSub && u.googleSub !== c.sub) return "/staff/login?google=mismatch";
  if (u.status === "deactivated") return "/staff/login?google=deactivated";
  await db.staffUser.update({ where: { id: u.id }, data: { googleSub: c.sub, ...(u.status !== "active" ? { status: "active" } : {}) } });
  await createStaffSession(u.id, u.tokenVersion, { mfaPassed: true });
  await staffAudit({ id: u.id, name: u.name }, "Signed in", "Google (reference partner)");
  return "/staff/login?google=ok";
}

export const googlePartnerSchema = z.object({ name: z.string().trim().min(2, "Enter your full name.").max(80), phone, team: z.string().trim().max(60).default("") });

/** Creates the partner profile for the Google identity held after `partnerFromGoogle`, and signs them in. */
export async function completeGooglePartner(raw: z.input<typeof googlePartnerSchema>) {
  const g = await readPendingPartner();
  if (!g) throw new UserError("Your Google sign-in expired. Tap “Continue with Google” again.");
  const i = googlePartnerSchema.parse(raw);
  if (await db.staffUser.findFirst({ where: { OR: [{ email: g.email, kind: "partner" }, { googleSub: g.sub }] } })) {
    await clearPendingPartner();
    throw new UserError("A profile with this Google account already exists. Tap “Continue with Google” to sign in.");
  }
  const { empNo, n } = await newEmployeeNo();
  const u = await db.staffUser.create({
    data: { empNo, name: i.name, email: g.email, kind: "partner", phone: i.phone, team: i.team, role: "partner", status: "active", googleSub: g.sub, passwordHash: null, referralCode: referral(i.name, n) },
  });
  await clearPendingPartner();
  await staffAudit({ id: u.id, name: u.name }, "Reference partner joined", `${empNo} · Google`);
  await createStaffSession(u.id, u.tokenVersion, { mfaPassed: true });
  return { next: "done" as const, code: u.referralCode };
}

// ── Sign-in: password, then an authenticator code (enrolled on first sign-in). `as` picks which profile opens.
export async function signIn(rawEmail: string, pw: string, as: StaffKind = "team") {
  const e = String(rawEmail ?? "").trim().toLowerCase();
  if (!isEmail(e)) throw new UserError("Enter your email.");
  const { ip } = await clientInfo();
  const keys = lockKeys(`staff:${as}:${e}`, ip);
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  const u = await byEmail(e, as);
  if (!u && (await byEmail(e, as === "team" ? "partner" : "team"))) {
    throw new UserError(as === "team" ? "This email has a reference partner profile, not a Medoro team profile. Use the Reference partner tab." : "This email has no partner profile yet. Join free below, or use the Medoro team tab.");
  }
  if (u && u.kind === "partner" && u.googleSub && !u.passwordHash) throw new UserError("This profile signs in with Google. Tap “Continue with Google”.");
  if (!u || !(await verifyPassword(u.passwordHash, String(pw ?? "")))) {
    const left = await recordFailure(keys);
    await staffAudit({ id: u?.id ?? null, name: e }, "Sign-in failed", "wrong email or password");
    throw new UserError(left ? `Email or password is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many attempts. Try again in 15 minutes.");
  }
  if (u.role !== "partner" && !isStaffEmail(e)) throw new UserError(`Use your @${staffDomain()} work email.`);
  if (u.status === "pending") throw new UserError("Your profile is waiting for approval. You’ll be able to sign in once Medoro approves it.");
  if (u.status !== "active") throw new UserError("This profile is deactivated. Contact Medoro.");
  await clearFailures(keys);
  // Reference partners see only their own referrals and earnings, so a password is enough; payouts go to a bank
  // account Medoro verifies. Medoro's own team also sets up an authenticator app.
  if (u.role === "partner") {
    await createStaffSession(u.id, u.tokenVersion, { mfaPassed: true });
    await staffAudit({ id: u.id, name: u.name }, "Signed in", "password (reference partner)");
    return { next: "done" as const, who: u.email };
  }
  await createStaffSession(u.id, u.tokenVersion);
  return { next: u.totpEnabled ? ("totp" as const) : ("enroll" as const), who: u.email };
}

/** QR for first-time authenticator setup. The secret is stored sealed but not enabled until a code checks out. */
export async function enrollTotp() {
  const s = await readStaffSession(true);
  if (!s) throw new UserError("Sign in again.");
  if (s.staff.totpEnabled) throw new UserError("Your authenticator is already set up.");
  const sec = newTotpSecret();
  await db.staffUser.update({ where: { id: s.staffId }, data: { totpSecret: sec.sealed } });
  return { qr: await totpQr(sec.b32, `Medoro staff (${s.staff.email})`), secret: sec.b32 };
}

export async function verifyTotp(code: string) {
  const s = await readStaffSession(true);
  if (!s || !s.staff.totpSecret) throw new UserError("Sign in again.");
  const keys = ["stafftotp:" + s.staffId];
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many wrong codes. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  if (!checkTotp(openSecret(s.staff.totpSecret), String(code ?? "").replace(/\D/g, ""))) {
    await recordFailure(keys);
    await staffAudit({ id: s.staffId, name: s.staff.name }, "Sign-in failed", "wrong authenticator code");
    throw new UserError("Code didn’t match. Codes refresh every 30 seconds.");
  }
  await clearFailures(keys);
  await db.$transaction([
    db.staffSession.update({ where: { id: s.id }, data: { mfaPassed: true } }),
    db.staffUser.update({ where: { id: s.staffId }, data: { totpEnabled: true } }),
  ]);
  await staffAudit({ id: s.staffId, name: s.staff.name }, "Signed in", s.staff.totpEnabled ? "password + authenticator" : "password + authenticator (enrolled)");
}

// ── Invites (created by a super admin) and sign-in resets.
export async function inviteInfo(token: string) {
  const u = await db.staffUser.findUnique({ where: { inviteTokenHash: tokenHash(String(token ?? "")) } });
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt < new Date() || u.status === "deactivated") return null;
  return { name: u.name, email: u.email };
}

export async function acceptInvite(token: string, pw: string) {
  const pass = password.parse(pw);
  const u = await db.staffUser.findUnique({ where: { inviteTokenHash: tokenHash(String(token ?? "")) } });
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt < new Date() || u.status === "deactivated") throw new UserError("This invite link has expired. Ask a super admin for a new one.");
  await db.staffUser.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(pass), inviteTokenHash: null, inviteExpiresAt: null, status: u.status === "invited" ? "active" : u.status, totpEnabled: false, totpSecret: null } });
  await staffAudit({ id: u.id, name: u.name }, "Invite accepted", u.empNo);
  return { email: u.email };
}

export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name.").max(80), email: anyEmail(), phone,
  role: z.enum(["super_admin", "sales", "care", "partner"]), team: z.string().trim().max(60).default(""),
}).refine((i) => i.role === "partner" || isStaffEmail(i.email), { message: `Medoro team members use an @${staffDomain()} work email.`, path: ["email"] });

export async function createEmployee(s: Staff, raw: z.input<typeof employeeSchema>, origin: string) {
  allow(s, "super_admin");
  const i = employeeSchema.parse(raw);
  if (await byEmail(i.email, kindOf(i.role))) throw new UserError("Someone already uses this email.");
  const { empNo, n } = await newEmployeeNo();
  const t = newToken();
  await db.staffUser.create({ data: { empNo, ...i, kind: kindOf(i.role), status: "invited", inviteTokenHash: t.hash, inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000), referralCode: earns(i.role) ? referral(i.name, n) : null, approvedBy: s.name } });
  await staffAudit(s, "Employee created", `${empNo} · ${i.email} · ${i.role}`);
  return { empNo, link: `${origin}/staff/login?invite=${t.token}` };
}

export async function setEmployeeStatus(s: Staff, id: string, action: "approve" | "deactivate" | "reactivate") {
  allow(s, "super_admin");
  if (id === s.id) throw new UserError("You can’t change your own access.");
  const u = await db.staffUser.findUnique({ where: { id } });
  if (!u) throw new UserError("Employee not found.");
  if (action === "approve" && u.status !== "pending") throw new UserError("Only pending profiles can be approved.");
  if (action === "deactivate" && u.role === "super_admin" && (await db.staffUser.count({ where: { role: "super_admin", status: "active" } })) <= 1) throw new UserError("Keep at least one active super admin.");
  const status = action === "deactivate" ? "deactivated" : u.passwordHash ? "active" : "invited";
  await db.staffUser.update({ where: { id }, data: { status, tokenVersion: action === "deactivate" ? { increment: 1 } : undefined, approvedBy: action === "approve" ? s.name : undefined } });
  await staffAudit(s, action === "approve" ? "Employee approved" : action === "deactivate" ? "Employee deactivated" : "Employee reactivated", `${u.empNo} · ${u.email}`);
}

/** Clears the password and authenticator and signs the person out everywhere; returns a new invite link. */
export async function resetSignIn(s: Staff, id: string, origin: string) {
  allow(s, "super_admin");
  const u = await db.staffUser.findUnique({ where: { id } });
  if (!u || u.status === "deactivated") throw new UserError("Employee not found or deactivated.");
  const t = newToken();
  await db.staffUser.update({ where: { id }, data: { passwordHash: null, totpEnabled: false, totpSecret: null, tokenVersion: { increment: 1 }, inviteTokenHash: t.hash, inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } });
  await staffAudit(s, "Sign-in reset", `${u.empNo} · ${u.email}`);
  return { link: `${origin}/staff/login?invite=${t.token}` };
}

export async function listEmployees() {
  return db.staffUser.findMany({ orderBy: { empNo: "asc" }, select: { id: true, empNo: true, name: true, email: true, phone: true, role: true, team: true, status: true, referralCode: true, bonusPct: true, totpEnabled: true } });
}
