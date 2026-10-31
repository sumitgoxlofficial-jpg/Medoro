import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, readStaffSession, staffDomain } from "@/staff/auth";
import { inviteInfo } from "@/staff/people";
import { StaffLogin } from "./form";

export const metadata: Metadata = { title: "Medoro team sign in" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await getStaff()) redirect("/staff");
  const { invite } = await searchParams;
  const inv = invite ? await inviteInfo(invite) : null;
  const pending = await readStaffSession(true);
  return <StaffLogin domain={staffDomain()} invite={invite ? { token: invite, info: inv } : null} pending={pending ? { email: pending.staff.email, enrolled: pending.staff.totpEnabled } : null} />;
}
