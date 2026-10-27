import { redirect } from "next/navigation";
import { isSetupDone } from "@/domain/identity/service";
import { readSession } from "@/server/auth";
import { otpEnabled } from "@/server/otp";
import { SignIn } from "./sign-in";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await isSetupDone())) redirect("/setup");
  if (await readSession()) redirect("/app");
  const { view } = await searchParams;
  return <SignIn otp={otpEnabled()} initialView={view === "employee" ? "employee" : view === "join" ? "join" : "signin"} />;
}
