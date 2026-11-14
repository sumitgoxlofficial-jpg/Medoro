import { redirect } from "next/navigation";

/** The old HRMS sign-in address. Everyone at Medoro now signs in on one page. */
export default function Page() {
  redirect("/staff/login");
}
