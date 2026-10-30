import { redirect } from "next/navigation";
import { isSetupDone } from "@/domain/identity/service";
import { readSession } from "@/server/auth";
import { otpEnabled } from "@/server/otp";
import { googleLoginConfigured, readPendingLink } from "@/server/google-oidc";
import { recoveryChannels } from "@/domain/identity/recovery";
import { SignIn } from "./sign-in";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; restored?: string; google?: string }> }) {
  if (!(await isSetupDone())) redirect("/setup");
  if (await readSession()) redirect("/app");
  const { view, restored, google } = await searchParams;
  const link = google === "link" ? await readPendingLink() : null;
  return (
    <>
      {restored ? <div role="status" className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-ok text-white rounded-lg px-4 py-2.5 text-[14px] font-medium shadow-pop max-w-[90vw]">Backup restored. Everyone has been signed out; sign in again.</div> : null}
      <SignIn otp={otpEnabled()} google={googleLoginConfigured()} recovery={recoveryChannels()} notice={google ?? null} linkEmail={link?.email ?? null} initialView={view === "employee" ? "employee" : view === "join" ? "join" : "signin"} />
    </>
  );
}
