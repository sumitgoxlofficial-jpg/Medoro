import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { checkLock, clearFailures, clientInfo, hashPassword, lockKeys, recordFailure, verifyPassword } from "@/server/auth";
import { checkTotp, newTotpSecret, openSecret, totpQr } from "@/server/totp";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { allow, createStaffSession, isStaffEmail, newToken, readStaffSession, staffAudit, staffDomain, tokenHash, type Staff } from "./auth";
import { MOBILE_RE, digits, type StaffRoleId } from "./constants";

const CP = "_cp"; // sequence namespace for the control plane
const INVITE_DAYS = 7;

const email = () => z.string().trim().toLowerCase().refine(isStaffEmail, `Use your @${staffDomain()} work email.`);
const phone = z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile.");
const password = z.string().min(12, "Password must be at least 12 characters.").max(200);

async function newEmployeeNo() {
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "EMP"));
  return { empNo: "MS-" + String(n).padStart(3, "0"), n };
}
const referral = (name: string, n: number) => name.trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10) + n;

// ── Self sign-up: waits for a super admin. The very first super admin comes from STAFF_BOOTSTRAP_EMAIL.
export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(80),
  email: email(), phone, team: z.string().trim().max(60).default(""),
  role: z.enum(["sales", "care"]), password,
});

export async function signup(raw: z.input<typeof signupSchema>) {
  const i = signupSchema.parse(raw);
  if (await db.staffUser.findUnique({ where: { email: i.email } })) throw new UserError("A profile with this email already exists. Sign in, or ask a super admin.");
  const bootstrap = (process.env.STAFF_BOOTSTRAP_EMAIL ?? "").trim().toLowerCase() === i.email && !(await db.staffUser.count({ where: { role: "super_admin", status: "active" } }));
  const { empNo, n } = await newEmployeeNo();
  const role: StaffRoleId = bootstrap ? "super_admin" : i.role;
  const u = await db.staffUser.create({
    data: { empNo, name: i.name, email: i.email, phone: i.phone, team: i.team, role, status: bootstrap ? "active" : "pending", passwordHash: await hashPassword(i.password), referralCode: role === "sales" ? referral(i.name, n) : null },
  });
  await staffAudit({ id: u.id, name: u.name }, bootstrap ? "First super admin created" : "Profile submitted", `${empNo} · ${role}`);
  return { bootstrap, role };
}

// ── Sign-in: password, then an authenticator code (enrolled on first sign-in).
export async function signIn(rawEmail: string, pw: string) {
  const e = String(rawEmail ?? "").trim().toLowerCase();
  if (!isStaffEmail(e)) throw new UserError(`Use your @${staffDomain()} work email.`);
  const { ip } = await clientInfo();
  const keys = lockKeys("staff:" + e, ip);
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  const u = await db.staffUser.findUnique({ where: { email: e } });
  if (!u || !(await verifyPassword(u.passwordHash, String(pw ?? "")))) {
    const left = await recordFailure(keys);
    await staffAudit({ id: u?.id ?? null, name: e }, "Sign-in failed", "wrong email or password");
    throw new UserError(left ? `Email or password is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many attempts. Try again in 15 minutes.");
  }
  if (u.status === "pending") throw new UserError("Your profile is waiting for super admin approval.");
  if (u.status !== "active") throw new UserError("This profile is deactivated. Ask a super admin.");
  await clearFailures(keys);
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
  name: z.string().trim().min(2, "Enter the full name.").max(80), email: email(), phone,
  role: z.enum(["super_admin", "sales", "care"]), team: z.string().trim().max(60).default(""),
});

export async function createEmployee(s: Staff, raw: z.input<typeof employeeSchema>, origin: string) {
  allow(s, "super_admin");
  const i = employeeSchema.parse(raw);
  if (await db.staffUser.findUnique({ where: { email: i.email } })) throw new UserError("Someone already uses this email.");
  const { empNo, n } = await newEmployeeNo();
  const t = newToken();
  await db.staffUser.create({ data: { empNo, ...i, status: "invited", inviteTokenHash: t.hash, inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000), referralCode: i.role === "sales" ? referral(i.name, n) : null, approvedBy: s.name } });
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
