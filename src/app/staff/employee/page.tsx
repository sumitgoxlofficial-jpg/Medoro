import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/staff/auth";
import { googleLoginConfigured, readPendingEmployee } from "@/server/google-oidc";
import { EmployeeLogin } from "./form";

export const metadata: Metadata = { title: "Employee sign in" };
export const dynamic = "force-dynamic";

const MSG: Record<string, string> = {
  error: "Google sign-in didn’t work. Try again.",
  cancelled: "Google sign-in was cancelled.",
  off: "Google sign-in isn’t set up on this server yet. Ask your admin.",
  state: "That sign-in link expired. Try again.",
  mismatch: "This email is linked to a different Google account. Use that Google account.",
  notsales: "This page is for sales employees. Admins, managers and customer care sign in on the Medoro team sign-in page.",
  partner: "This Google account belongs to a reference partner profile. Use another Google account for your employee profile.",
  deactivated: "This employee profile is deactivated or was not approved. Contact your Medoro admin.",
  pending: "Your profile is waiting for approval. You can sign in once a Medoro admin approves it.",
};

/** Sales employees sign in (and sign up) with Google here. New profiles wait for a super admin's approval. */
export default async function Page({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  // After Google the staff cookie (SameSite=Strict) isn't sent on the cross-site redirect; hand off in the browser.
  if (google === "ok") return <EmployeeLogin google handoff />;
  if (await getStaff()) redirect("/staff/growth");
  const g = google === "new" ? await readPendingEmployee() : null;
  return <EmployeeLogin google={googleLoginConfigured()} newProfile={g ? { email: g.email, name: g.name ?? "" } : null}
    notice={google === "new" && !g ? MSG.error : google ? MSG[google] ?? "" : ""} waiting={google === "pending"} />;
}
