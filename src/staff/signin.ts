import "server-only";
import { db } from "@/server/db";
import { checkLock, clientInfo, lockKeys, verifyPassword } from "@/server/auth";
import { UserError } from "@/server/action";
import * as people from "./people";
import * as hrms from "./hrms/auth";
import type { StaffRoleId } from "./constants";

const CONSOLE_ROLES = new Set<StaffRoleId>(["super_admin", "care"]);

export type SignInNext =
  | { next: "done"; to: string }
  | { next: "totp" | "enroll" } // console: authenticator on the next step (session is pending)
  | { next: "code" }; // HRMS: send the authenticator code with the same email/ID and password

/**
 * The one staff sign-in. Takes an email or employee ID and works out which profile it opens:
 * - the Medoro team console (super admins and care, with authenticator) when the password matches it,
 * - a reference partner profile when the password matches that,
 * - otherwise the HRMS (employees, sales, employee IDs, one-time passwords from HR).
 * Each path still goes through its own sign-in, so lockouts, audits and messages stay as they were.
 */
export async function signIn(rawId: string, rawPw: string, code = ""): Promise<SignInNext> {
  const id = String(rawId ?? "").trim();
  if (!id) throw new UserError("Enter your email or employee ID.");
  const pw = String(rawPw ?? "");
  if (!id.includes("@")) return viaHrms(id, pw, code);

  const email = id.toLowerCase();
  const { ip } = await clientInfo();
  // Don't test passwords while any sign-in for this email is locked.
  for (const account of [`staff:team:${email}`, `staff:partner:${email}`, `hrms:${email}`]) {
    const mins = await checkLock(lockKeys(account, ip));
    if (mins) throw new UserError(`Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.`);
  }
  const [team, partner] = await Promise.all([
    db.staffUser.findUnique({ where: { email_kind: { email, kind: "team" } } }),
    db.staffUser.findUnique({ where: { email_kind: { email, kind: "partner" } } }),
  ]);
  // Super admins and customer care open the console (with their authenticator). Sales and employees use the HRMS
  // sign-in as before; a sales HRMS session still opens their leads in the console.
  if (team && CONSOLE_ROLES.has(team.role) && (await verifyPassword(team.passwordHash, pw))) return viaConsole(email, pw, "team");
  if (partner && (await verifyPassword(partner.passwordHash, pw))) return viaConsole(email, pw, "partner");
  if (team) return viaHrms(id, pw, code);
  return viaConsole(email, pw, "partner"); // unknown email or wrong password: counts the failure, says so
}

async function viaConsole(email: string, pw: string, as: people.StaffKind): Promise<SignInNext> {
  const r = await people.signIn(email, pw, as);
  return r.next === "done" ? { next: "done", to: "/staff" } : { next: r.next };
}

async function viaHrms(id: string, pw: string, code: string): Promise<SignInNext> {
  const r = await hrms.signIn(id, pw, code);
  return r.next === "totp" ? { next: "code" } : { next: "done", to: "/staff/hrms" };
}
