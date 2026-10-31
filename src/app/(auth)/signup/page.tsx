import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/server/auth";
import { signupOpen } from "@/server/setup-gate";
import { Wizard } from "../setup/wizard";

export const metadata = { title: "Create your pharmacy account" };
export const dynamic = "force-dynamic";

/** Self-service sign-up on a hosted multi-pharmacy server. Only when PUBLIC_SIGNUP=1. */
export default async function Page() {
  if (!signupOpen()) notFound();
  if (await readSession()) redirect("/app");
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="text-center flex flex-col gap-1.5 max-w-[560px]">
        <h1 className="m-0 text-[24px] font-bold">Create your pharmacy account</h1>
        <p className="m-0 text-[14px] text-muted">14-day free trial, no card needed. Already have an account? <Link href="/signin" className="text-teal font-semibold">Sign in</Link></p>
      </div>
      <Wizard deployment="cloud" signup />
    </div>
  );
}
