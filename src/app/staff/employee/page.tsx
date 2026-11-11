import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/staff/hrms/auth";
import { mailEnabled } from "@/server/mail";
import { readStaffSession } from "@/staff/auth";
import { EmployeeLogin } from "./form";

export const metadata: Metadata = { title: "Medoro HRMS sign in" };
export const dynamic = "force-dynamic";

/** Medoro employees sign in to the HRMS here with their employee ID or work email and a password. */
export default async function Page() {
  if (await getMe()) redirect("/staff/hrms");
  // A console session of a partner is not an employee session: let them sign in here regardless.
  void (await readStaffSession(true, true));
  return <EmployeeLogin emailCodes={mailEnabled()} />;
}
