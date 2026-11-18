import Link from "next/link";
import { redirect } from "next/navigation";
import { readPortalAccount } from "@/domain/distribution/portal";
import { PForm, PF } from "../../_form";
import { signInAction } from "../../actions";

export const metadata = { title: "Sign in" };

export default async function Page() {
  if (await readPortalAccount()) redirect("/portal");
  return (
    <main className="max-w-[420px] mx-auto px-4 py-12">
      <div className="text-center mb-6"><div className="text-[13px] font-semibold tracking-[0.12em] text-muted">MEDORO</div><h1 className="text-[24px] font-semibold m-0">Chemist ordering portal</h1><p className="text-[14px] text-muted">Order from your distributors, track deliveries and see your dues.</p></div>
      <div className="bg-white border border-line rounded-xl p-6">
        <PForm action={signInAction} submit="Sign in">
          <PF label="Email or mobile" name="login" required autoComplete="username" />
          <PF label="Password" name="password" type="password" required autoComplete="current-password" />
        </PForm>
      </div>
      <p className="text-center text-[14px] mt-4">New pharmacy? <Link href="/portal/register" className="font-semibold">Register</Link></p>
      <p className="text-center text-[12px] text-faint">Distributor staff sign in at <Link href="/signin">/signin</Link>.</p>
    </main>
  );
}
