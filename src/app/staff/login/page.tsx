import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getStaff, readStaffSession, staffDomain } from "@/staff/auth";
import { inviteInfo } from "@/staff/people";
import { googleLoginConfigured, readPendingPartner } from "@/server/google-oidc";
import { StaffLogin } from "./form";

export const metadata: Metadata = { title: "Partner & team sign in" };
export const dynamic = "force-dynamic";

const GOOGLE_MSG: Record<string, string> = {
  error: "Google sign-in didn’t work. Try again.",
  cancelled: "Google sign-in was cancelled.",
  off: "Google sign-in isn’t available right now. Use your email and password.",
  mismatch: "This email is linked to a different Google account. Use that account, or your password.",
  deactivated: "This partner profile is deactivated. Contact Medoro.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string; join?: string; google?: string; as?: string }> }) {
  const { invite, join, google, as: asked } = await searchParams;
  const as = asked === "team" || invite ? "team" : "partner";
  // After Google the staff cookie (SameSite=Strict) isn't sent on this cross-site redirect; the page hands off in the browser.
  if (google === "ok") return <StaffLogin domain={staffDomain()} invite={null} pending={null} handoff />;
  // Already signed in to the profile this page is for: go to it. Signed in to the other one: let them switch.
  const me = await getStaff();
  if (me && (me.role === "partner") === (as === "partner")) redirect("/staff");
  const inv = invite ? await inviteInfo(invite) : null;
  const pending = await readStaffSession(true);
  const g = google === "new" ? await readPendingPartner() : null;
  return <StaffLogin domain={staffDomain()} invite={invite ? { token: invite, info: inv } : null} pending={pending ? { email: pending.staff.email, enrolled: pending.staff.totpEnabled } : null}
    joinPartner={join === "partner"} google={googleLoginConfigured()} googleNew={g ? { email: g.email, name: g.name ?? "" } : null}
    notice={google === "new" && !g ? GOOGLE_MSG.error : google ? GOOGLE_MSG[google] ?? "" : ""}
    as={as} setupOpen={!(await db.staffUser.count({ where: { role: "super_admin", status: "active" } }))} />;
}
