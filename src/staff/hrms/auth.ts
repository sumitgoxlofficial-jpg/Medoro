import "server-only";
import { randomInt } from "node:crypto";
import { redirect } from "next/navigation";
import { z, ZodError } from "zod";
import { db } from "@/server/db";
import { checkLock, clearFailures, clientInfo, hashPassword, lockKeys, rateLimit, recordFailure, verifyPassword } from "@/server/auth";
import { checkTotp, openSecret } from "@/server/totp";
import { UserError, type ActionResult } from "@/server/action";
import { log } from "@/server/log";
import { mailEnabled, sendMail } from "@/server/mail";
import { otpMail } from "./mails";
import { defer } from "@/server/defer";
import { createStaffSession, readStaffSession, staffAudit } from "../auth";
import type { StaffRoleId } from "../constants";
import { DEFAULT_PERMS, DEFAULT_SETTINGS, HR_ROLES, MODULES, hasModule, type HrRoleId, type ModuleId, type Perms, type Settings } from "./constants";

// The HRMS signs Medoro's own employees in with their employee ID or work email and a password. It uses the staff
// session cookie with kind "hrms": such a session opens the HRMS, never the staff console (sales employees excepted,
// see readStaffSession). Reference partners have no HRMS.

export type Me = {
  id: string; empNo: string; name: string; first: string; email: string; staffRole: StaffRoleId; role: HrRoleId; perms: Perms; sessionId: string;
  phone: string; personalEmail: string; dept: string; designation: string; photo: string | null; mustChangePassword: boolean; profileDone: boolean; docsAccepted: boolean;
  /** Aadhaar and PAN given with proof / both verified (see kyc.ts). */
  kycSubmitted: boolean; kycVerified: boolean;
};

export const password = z.string().min(12, "Password must be at least 12 characters.").max(200);

// ── Settings and permissions (HrSetting rows)
// Settings and permissions change rarely but every page reads them: keep them for a few seconds per server instance
// (saving clears the copy at once). Actions always read them fresh. Tests read fresh every time.
const TTL = process.env.NODE_ENV === "test" ? 0 : 10_000;
const memo = new Map<string, { at: number; value: unknown }>();
export const invalidateSettings = () => memo.clear();
async function setting(key: "perms" | "settings", fresh: boolean): Promise<unknown> {
  const hit = memo.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  const value = (await db.hrSetting.findUnique({ where: { key } }))?.value ?? {};
  memo.set(key, { at: Date.now(), value });
  return value;
}
export async function loadPerms(fresh = false): Promise<Perms> {
  const saved = (await setting("perms", fresh)) as Partial<Perms>;
  const ids = MODULES.map((m) => m.id) as string[];
  const out = { ...DEFAULT_PERMS };
  for (const r of HR_ROLES) if (r !== "admin" && Array.isArray(saved[r])) out[r] = saved[r]!.filter((m) => ids.includes(m));
  return out;
}
export async function loadSettings(fresh = false): Promise<Settings> {
  const v = (await setting("settings", fresh)) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...v, company: { ...DEFAULT_SETTINGS.company, ...(v.company ?? {}) }, leave: { ...DEFAULT_SETTINGS.leave, ...(v.leave ?? {}) } };
}

/** The HRMS role: super admins of the staff console are the HRMS super admin; everyone else has the role HR gave. */
export const roleOf = (staffRole: StaffRoleId, profileRole: HrRoleId | undefined): HrRoleId =>
  staffRole === "super_admin" ? "admin" : profileRole && profileRole !== "admin" ? profileRole : staffRole === "sales" ? "sales" : "employee";

/** Every team member gets an HR profile the first time the HRMS sees them. */
export async function ensureProfile(staffId: string, staffRole: StaffRoleId) {
  return db.hrProfile.upsert({ where: { staffId }, update: {}, create: { staffId, role: roleOf(staffRole, undefined), profileDone: staffRole === "super_admin" } });
}

export async function getMe(): Promise<Me | null> {
  const s = await readStaffSession(false, true); // one joined query: session, staff and HR profile
  if (!s || s.staff.kind !== "team" || s.staff.role === "partner") return null;
  const u = s.staff;
  const [p, perms] = await Promise.all([u.hr ?? ensureProfile(u.id, u.role), loadPerms()]);
  if (!p.presenceAt || Date.now() - p.presenceAt.getTime() > 60_000) {
    await defer(() => db.hrProfile.update({ where: { staffId: u.id }, data: { presenceAt: new Date(), ...(p.presence === "offline" ? { presence: "active" } : {}) } }));
  }
  return {
    id: u.id, empNo: u.empNo, name: u.name, first: u.name.trim().split(/\s+/)[0], email: u.email, staffRole: u.role, role: roleOf(u.role, p.role), perms, sessionId: s.id,
    phone: u.phone, personalEmail: p.personalEmail, dept: p.dept, designation: p.designation, photo: p.photo, mustChangePassword: p.mustChangePassword, profileDone: p.profileDone, docsAccepted: !!p.docsAcceptedAt, kycSubmitted: !!p.kycSubmittedAt, kycVerified: !!p.kycVerifiedAt,
  };
}

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/staff/login");
  return me;
}

export const can = (me: Me, m: ModuleId) => hasModule(me.role, me.perms, m);
export function need(me: Me, m: ModuleId) {
  if (!can(me, m)) throw new UserError("Your role can’t do that. Ask the super admin for access in Roles & Permissions.");
}
export function needAdmin(me: Me) {
  if (me.role !== "admin") throw new UserError("Only the super admin can do that.");
}
export const audit = (me: { id: string | null; name: string }, action: string, detail?: string) => staffAudit(me, "HRMS · " + action, detail);

export async function notify(staffIds: string[], text: string, screen = "") {
  const ids = [...new Set(staffIds)].filter(Boolean);
  if (ids.length) await db.hrNotification.createMany({ data: ids.map((staffId) => ({ staffId, text: text.slice(0, 240), screen })) });
}
/** Active people who hold a module (to tell them something needs a decision). */
export async function holders(m: ModuleId): Promise<string[]> {
  const perms = await loadPerms();
  const staff = await db.staffUser.findMany({ where: { kind: "team", status: "active", role: { not: "partner" } }, select: { id: true, role: true, hr: { select: { role: true } } } });
  return staff.filter((u) => hasModule(roleOf(u.role, u.hr?.role), perms, m)).map((u) => u.id);
}

/** Server-action wrapper for the HRMS. */
export async function hrRun<T>(fn: (me: Me) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const me = await getMe();
  if (!me) return { ok: false, error: "Your session has ended. Sign in again." };
  me.perms = await loadPerms(true); // an action never trusts a cached permission
  try {
    return { ok: true, data: await fn(me), message };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("hrms action failed", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}

// ── Sign-in
const findLogin = (raw: string) => {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  return v.includes("@")
    ? db.staffUser.findUnique({ where: { email_kind: { email: v.toLowerCase(), kind: "team" } }, include: { hr: true } })
    : db.staffUser.findFirst({ where: { empNo: { equals: v, mode: "insensitive" }, kind: "team" }, include: { hr: true } });
};

/**
 * Employee ID or work email, then the password or a one-time password. Profiles with an authenticator app (the
 * super admins) also enter its code. Locks for 15 minutes after 5 wrong tries.
 */
export async function signIn(rawId: string, pw: string, code = "") {
  const id = String(rawId ?? "").trim();
  if (!id) throw new UserError("Enter your employee ID or official email.");
  const { ip } = await clientInfo();
  const keys = lockKeys(`hrms:${id.toLowerCase()}`, ip);
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  const u = await findLogin(id);
  const fail = async (why: string) => {
    const left = await recordFailure(keys);
    await staffAudit({ id: u?.id ?? null, name: u?.name ?? id }, "HRMS · Sign-in failed", why);
    throw new UserError(left ? `Employee ID or password is incorrect. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many attempts. Try again in 15 minutes.");
  };
  if (!u || u.role === "partner") return fail("unknown employee");
  const typed = String(pw ?? "");
  const byPassword = await verifyPassword(u.passwordHash, typed);
  const otpLive = !!u.hr?.otpHash && !!u.hr.otpExpiresAt && u.hr.otpExpiresAt > new Date();
  const byOtp = !byPassword && otpLive && (await verifyPassword(u.hr!.otpHash, typed));
  if (!byPassword && !byOtp) return fail("wrong password");
  if (u.status === "pending") throw new UserError("Your profile is waiting for approval. You can sign in once Medoro approves it.");
  if (u.status === "deactivated") throw new UserError("This profile is deactivated. Contact HR.");
  if (u.totpEnabled && u.totpSecret) {
    const c = String(code ?? "").replace(/\D/g, "");
    if (!c) return { next: "totp" as const };
    if (!checkTotp(openSecret(u.totpSecret), c)) return fail("wrong authenticator code");
  }
  await clearFailures(keys);
  const profile = await ensureProfile(u.id, u.role);
  if (byOtp) await db.hrProfile.update({ where: { staffId: u.id }, data: { otpHash: null, otpExpiresAt: null, mustChangePassword: true } });
  // A profile HR created signs in for the first time here: it becomes active.
  if (u.status === "invited") await db.staffUser.update({ where: { id: u.id }, data: { status: "active", inviteTokenHash: null, inviteExpiresAt: null } });
  await createStaffSession(u.id, u.tokenVersion, { mfaPassed: true, kind: "hrms" });
  await db.hrProfile.update({ where: { staffId: u.id }, data: { presence: "active", presenceAt: new Date() } });
  await staffAudit({ id: u.id, name: u.name }, "HRMS · Signed in", byOtp ? "one-time password" : u.totpEnabled ? "password + authenticator" : "password");
  return { next: "done" as const, mustChange: profile.mustChangePassword || byOtp };
}

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Emails a 6-digit one-time password (10 minutes). Says the same thing whether or not the ID exists. */
export async function sendCode(rawId: string) {
  if (!mailEnabled()) throw new UserError("This server can’t send email. Ask HR for a one-time password (HR → Credentials).");
  const id = String(rawId ?? "").trim();
  if (!id) throw new UserError("Enter your employee ID or official email.");
  const { ip } = await clientInfo();
  const wait = await rateLimit([{ key: `hrmscode:${id.toLowerCase()}`, max: 3 }, { key: `hrmscode:ip:${ip ?? "?"}`, max: 20 }]);
  if (wait) throw new UserError(`Too many codes requested. Try again in ${wait} minute${wait > 1 ? "s" : ""}.`);
  const u = await findLogin(id);
  if (u && u.role !== "partner" && u.status !== "deactivated" && u.status !== "pending") {
    const code = newCode();
    await ensureProfile(u.id, u.role);
    await db.hrProfile.update({ where: { staffId: u.id }, data: { otpHash: await hashPassword(code), otpExpiresAt: new Date(Date.now() + 10 * 60_000) } });
    const to = u.hr?.personalEmail || u.email;
    await sendMail({ to, ...otpMail({ name: u.name, code, org: (await loadSettings()).company.name || "Medoro" }) }).catch((e) => log.error("hrms code mail failed", { err: e }));
  }
  return { sent: true };
}

/** Set a new password. Forced after a temporary or one-time password; otherwise the current password is needed. */
export async function changePassword(me: Me, next: string, current = "") {
  const pass = password.parse(next);
  const u = await db.staffUser.findUniqueOrThrow({ where: { id: me.id } });
  if (!me.mustChangePassword && !(await verifyPassword(u.passwordHash, String(current)))) throw new UserError("Your current password is incorrect.");
  if (await verifyPassword(u.passwordHash, pass)) throw new UserError("Choose a password you haven’t used here before.");
  await db.$transaction([
    db.staffUser.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(pass) } }),
    db.hrProfile.update({ where: { staffId: me.id }, data: { mustChangePassword: false, otpHash: null, otpExpiresAt: null } }),
    // Other devices are signed out; this session stays.
    db.staffSession.updateMany({ where: { staffId: me.id, id: { not: me.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(me, "Password changed");
}
