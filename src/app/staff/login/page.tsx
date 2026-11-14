import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getStaff, readStaffSession, staffDomain } from "@/staff/auth";
import { inviteInfo } from "@/staff/people";
import { googleLoginConfigured, readPendingPartner } from "@/server/google-oidc";
import { mailEnabled } from "@/server/mail";
import { StaffLogin } from "./form";

export const metadata: Metadata = { title: "Reference partner sign in" };
export const dynamic = "force-dynamic";

const GOOGLE_MSG: Record<string, string> = {
  error: "Google sign-in didn’t work. Try again.",
  cancelled: "Google sign-in was cancelled.",
  off: "Google sign-in isn’t available right now. Use your email and password.",
  mismatch: "This email is linked to a different Google account. Use that account, or your password.",
  deactivated: "This partner profile is deactivated. Contact Medoro.",
};

/**
 * Reference partners sign in here. The Medoro team signs in on the HRMS (/staff/employee); super admins and care land
 * here from the HRMS "Staff console" link only to confirm their authenticator. Team invite links also open here.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string; join?: string; google?: string; setup?: string }> }) {
  const { invite, join, google, setup } = await searchParams;
  // After Google the staff cookie (SameSite=Strict) isn't sent on this cross-site redirect; the page hands off in the browser.
  if (google === "ok") return <StaffLogin domain={staffDomain()} invite={null} pending={null} handoff />;
  if (!invite && (await getStaff())) redirect("/staff");
  const inv = invite ? await inviteInfo(invite) : null;
  const pending = await readStaffSession(true);
  const g = google === "new" ? await readPendingPartner() : null;
  return <StaffLogin domain={staffDomain()} invite={invite ? { token: invite, info: inv } : null} pending={pending && !pending.mfaPassed ? { email: pending.staff.email, enrolled: pending.staff.totpEnabled } : null}
    joinPartner={join === "partner"} google={googleLoginConfigured()} googleNew={g ? { email: g.email, name: g.name ?? "" } : null}
    notice={google === "new" && !g ? GOOGLE_MSG.error : google ? GOOGLE_MSG[google] ?? "" : ""}
    emailCodes={mailEnabled()} setupOpen={setup === "1" && !(await db.staffUser.count({ where: { role: "super_admin", status: "active" } }))} />;
}
