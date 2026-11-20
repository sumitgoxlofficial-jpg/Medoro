import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/server/auth";
import { setupUnlocked, signupOpen } from "@/server/setup-gate";
import { googleLoginConfigured, readPendingSignup, readVerifiedEmail } from "@/server/google-oidc";
import { mailEnabled } from "@/server/mail";
import { distHostingAllowed } from "@/domain/distribution/hosting";
import { getT } from "@/server/lang";
import { EmailStep } from "../signup/email-step";
import { GoogleMark } from "../signup/google-mark";
import { DistributorSignup } from "./form";

export async function generateMetadata() { return { title: (await getT())("Create your distributor account") }; }
export const dynamic = "force-dynamic";

/** MEDORO Distribution sign-up: the same steps as pharmacy sign-up (Google or a confirmed email, then the details). */
export default async function Page({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const open = signupOpen();
  if ((!open && !(await setupUnlocked())) || !distHostingAllowed()) notFound();
  if (await readSession()) redirect("/app");
  const g = await readPendingSignup();
  const google = g ? { name: g.name ?? "", email: g.email } : null;
  const sp = await searchParams;
  const choose = open && !google && googleLoginConfigured() && sp.with !== "email";
  const verifiedEmail = google ? null : await readVerifiedEmail();
  const needCode = !choose && !google && !verifiedEmail && mailEnabled();
  const t = await getT();
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="text-center flex flex-col gap-1.5 max-w-[560px]">
        <div className="text-[12px] font-semibold tracking-[0.14em] text-muted">MEDORO DISTRIBUTION</div>
        <h1 className="m-0 text-[24px] font-bold">{t("Create your distributor account")}</h1>
        <p className="m-0 text-[14px] text-muted">{t("7-day free trial, no card needed. Already have an account?")} <Link href="/signin" className="text-teal font-semibold">{t("Sign in")}</Link></p>
      </div>
      {choose ? (
        <div className="bg-white border border-[#E3E6E9] rounded-[14px] p-7 flex flex-col gap-3.5 w-[min(420px,100%)]">
          <a href="/api/auth/google/start?next=dist" className="flex items-center justify-center gap-2.5 border border-input bg-white rounded-[10px] py-3 px-5 text-[15px] font-semibold text-ink no-underline cursor-pointer hover:border-teal hover:text-ink">
            <GoogleMark />{t("Continue with Google")}
          </a>
          <div className="text-[13px] text-muted text-center">{t("Your name and email come from Google, so there’s no password to remember. Next you add your business details.")}</div>
          <div className="flex items-center gap-3 text-[12px] text-faint"><span className="flex-1 h-px bg-line" />{t("or")}<span className="flex-1 h-px bg-line" /></div>
          <Link href="/distributor-signup?with=email" className="text-center text-[14px] font-semibold text-teal min-h-10 inline-flex items-center justify-center">{t("Sign up with email instead")}</Link>
        </div>
      ) : needCode ? (
        <EmailStep back={open && googleLoginConfigured() ? "/distributor-signup" : null} then="Then you add your business details." />
      ) : (
        <>
          {verifiedEmail ? <div className="text-[13.5px] text-ink-2 bg-white border border-line rounded-lg px-4 py-2.5">{t("Email confirmed:")} <strong>{verifiedEmail}</strong>. {t("Now add your business details.")}</div> : null}
          {google ? <div className="text-[13.5px] text-ink-2 bg-white border border-line rounded-lg px-4 py-2.5">{t("Signed in with Google as")} <strong>{google.email}</strong>. {t("Now add your business details.")}</div> : null}
          <DistributorSignup signup={open} google={google} verifiedEmail={verifiedEmail ?? ""} />
        </>
      )}
      <p className="m-0 text-[13px] text-muted">{t("Retail pharmacy?")} <a href="/trial" className="text-teal font-semibold">{t("Medoro Pharmacy sign-up")}</a></p>
    </div>
  );
}
