import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, readStaffSession, staffDomain } from "@/staff/auth";
import { inviteInfo } from "@/staff/people";
import { googleLoginConfigured, readPendingPartner } from "@/server/google-oidc";
import { StaffLogin } from "./form";

export const metadata: Metadata = { title: "Sales & partner sign in" };
export const dynamic = "force-dynamic";

const GOOGLE_MSG: Record<string, string> = {
  error: "Google sign-in didn’t work. Try again.",
  cancelled: "Google sign-in was cancelled.",
  off: "Google sign-in isn’t available right now. Use your email and password.",
  team: "Medoro team profiles sign in with email, password and an authenticator, not Google.",
  mismatch: "This email is linked to a different Google account. Use that account, or your password.",
  deactivated: "This partner profile is deactivated. Contact Medoro.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string; join?: string; google?: string }> }) {
  const { invite, join, google } = await searchParams;
  // After Google the staff cookie (SameSite=Strict) isn't sent on this cross-site redirect; the page hands off in the browser.
  if (google === "ok") return <StaffLogin domain={staffDomain()} invite={null} pending={null} handoff />;
  if (await getStaff()) redirect("/staff");
  const inv = invite ? await inviteInfo(invite) : null;
  const pending = await readStaffSession(true);
  const g = google === "new" ? await readPendingPartner() : null;
  return <StaffLogin domain={staffDomain()} invite={invite ? { token: invite, info: inv } : null} pending={pending ? { email: pending.staff.email, enrolled: pending.staff.totpEnabled } : null}
    joinPartner={join === "partner"} google={googleLoginConfigured()} googleNew={g ? { email: g.email, name: g.name ?? "" } : null}
    notice={google === "new" && !g ? GOOGLE_MSG.error : google ? GOOGLE_MSG[google] ?? "" : ""} />;
}
