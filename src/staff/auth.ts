import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { db } from "@/server/db";
import { clientInfo } from "@/server/auth";
import { UserError, type ActionResult } from "@/server/action";
import type { StaffRoleId } from "./constants";

// Staff sessions are completely separate from pharmacy sessions: own cookie, own table,
// and the staff code never imports pharmacy services or reads pharmacy tables.
export const STAFF_COOKIE = "medoro_staff";
const SESSION_HOURS = 10;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const staffDomain = () => (process.env.STAFF_EMAIL_DOMAIN || "medoro.in").toLowerCase();
/**
 * Medoro's own team signs in with work email (STAFF_EMAIL_DOMAIN, default medoro.in; "*" allows any email, every new
 * profile still waits for a super admin). The first super admin (STAFF_BOOTSTRAP_EMAIL) may use any address.
 */
const bootstrapEmail = () => (process.env.STAFF_BOOTSTRAP_EMAIL ?? "").trim().toLowerCase();
export const isStaffEmail = (e: string) => {
  const v = String(e ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return false;
  if (staffDomain() === "*" || (bootstrapEmail() && v === bootstrapEmail())) return true;
  return v.endsWith("@" + staffDomain());
};
/** Reference partners are outside the company: any valid email. */
export const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e ?? "").trim());

export type Staff = { id: string; empNo: string; name: string; email: string; role: StaffRoleId; referralCode: string | null; sessionId: string };

export async function createStaffSession(staffId: string, tokenVersion: number, opts: { mfaPassed?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.staffSession.create({ data: { id: sha(token), staffId, tokenVersion, expiresAt, ip, userAgent, mfaPassed: opts.mfaPassed ?? false } });
  (await cookies()).set(STAFF_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/staff", expires: expiresAt });
}

/** The signed-in staff member. Sessions waiting for the authenticator code only come back with `allowPendingMfa`. */
export async function readStaffSession(allowPendingMfa = false) {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const s = await db.staffSession.findUnique({ where: { id: sha(token) }, include: { staff: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.tokenVersion !== s.staff.tokenVersion || s.staff.status !== "active") return null;
  if (!s.mfaPassed && !allowPendingMfa) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) await db.staffSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return s;
}

export async function destroyStaffSession() {
  const c = await cookies();
  const token = c.get(STAFF_COOKIE)?.value;
  if (token) await db.staffSession.updateMany({ where: { id: sha(token) }, data: { revokedAt: new Date() } });
  c.delete({ name: STAFF_COOKIE, path: "/staff" });
}

export async function getStaff(): Promise<Staff | null> {
  const s = await readStaffSession();
  if (!s) return null;
  const u = s.staff;
  return { id: u.id, empNo: u.empNo, name: u.name, email: u.email, role: u.role, referralCode: u.referralCode, sessionId: s.id };
}

export async function requireStaff(roles?: StaffRoleId[]): Promise<Staff> {
  const s = await getStaff();
  if (!s) redirect("/staff/login");
  if (roles && !roles.includes(s.role)) redirect("/staff");
  return s;
}

export function allow(s: Staff, ...roles: StaffRoleId[]) {
  if (!roles.includes(s.role)) throw new UserError("Your staff role can’t do that.");
}

export async function staffAudit(s: { id: string | null; name: string }, action: string, detail?: string) {
  const { ip } = await clientInfo().catch(() => ({ ip: null }));
  await db.staffAudit.create({ data: { staffId: s.id, staffName: s.name, action, detail: detail ?? null, ip } });
}

/** Server-action wrapper for the staff console. */
export async function staffRun<T>(fn: (s: Staff) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const s = await getStaff();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again." };
  try {
    return { ok: true, data: await fn(s), message };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}

export const newToken = () => { const t = randomBytes(24).toString("base64url"); return { token: t, hash: sha(t) }; };
export const tokenHash = sha;
