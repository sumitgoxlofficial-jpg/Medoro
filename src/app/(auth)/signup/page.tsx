import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/server/auth";
import { signupOpen } from "@/server/setup-gate";
import { googleLoginConfigured, readPendingSignup } from "@/server/google-oidc";
import { Wizard } from "../setup/wizard";

export const metadata = { title: "Create your pharmacy account" };
export const dynamic = "force-dynamic";

/** Self-service sign-up on a hosted multi-pharmacy server. Only when PUBLIC_SIGNUP=1. */
export default async function Page() {
  if (!signupOpen()) notFound();
  if (await readSession()) redirect("/app");
  // Arrived from "Continue with Google" with no account yet: the owner account uses that Google identity.
  const g = await readPendingSignup();
  const google = g ? { name: g.name ?? "", email: g.email } : null;
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="text-center flex flex-col gap-1.5 max-w-[560px]">
        <h1 className="m-0 text-[24px] font-bold">Create your pharmacy account</h1>
        <p className="m-0 text-[14px] text-muted">7-day free trial, no card needed. Already have an account? <Link href="/signin" className="text-teal font-semibold">Sign in</Link></p>
      </div>
      {!google && googleLoginConfigured() ? (
        <a href="/api/auth/google/start" className="flex items-center justify-center gap-2.5 border border-input bg-white rounded-[10px] py-[11px] px-5 text-[14px] font-semibold text-ink no-underline cursor-pointer hover:border-teal hover:text-ink w-[min(420px,100%)]">
          <GoogleMark />Continue with Google
        </a>
      ) : null}
      <Wizard deployment="cloud" signup google={google} />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
