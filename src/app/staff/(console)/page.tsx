import { redirect } from "next/navigation";
import { requireStaff } from "@/staff/auth";
import { NAV } from "./nav";

export default async function Home() {
  const s = await requireStaff();
  redirect(`/staff/${NAV[s.role][0][0]}`);
}
