import Link from "next/link";
import { GST_STATES } from "@/domain/accounting/gst";
import { PForm, PF } from "../../_form";
import { registerAction } from "../../actions";
import { CONSENT_VERSION } from "@/domain/distribution/portal";

export const metadata = { title: "Register your pharmacy" };

export default function Page() {
  return (
    <main className="max-w-[640px] mx-auto px-4 py-10">
      <h1 className="text-[24px] font-semibold m-0">Register your pharmacy</h1>
      <p className="text-[14px] text-muted">Your drug licence and GST details are shared only with distributors you ask to connect to. Each distributor checks your licence before you can order.</p>
      <div className="bg-white border border-line rounded-xl p-6 mt-4">
        <PForm action={registerAction} submit="Create account">
          <div className="grid gap-3 sm:grid-cols-2">
            <PF label="Pharmacy name" name="firmName" required />
            <PF label="Owner / pharmacist" name="ownerName" required />
            <PF label="Email" name="email" type="email" required />
            <PF label="Mobile" name="phone" inputMode="tel" required pattern="[6-9][0-9]{9}" />
            <PF label="Drug licence (Form 20B)" name="dl20b" required />
            <PF label="Drug licence (Form 21B)" name="dl21b" required />
            <PF label="Licence valid until" name="dlExpiry" type="date" required />
            <PF label="GSTIN (if registered)" name="gstin" />
            <PF label="Shop address" name="address" required />
            <PF label="PIN code" name="pincode" inputMode="numeric" required />
            <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">State<select aria-label="State" name="stateCode" required className="h-11 rounded-lg border border-input px-2 text-[15px] bg-white">{GST_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            <PF label="Password (10+ characters)" name="password" type="password" required minLength={10} autoComplete="new-password" />
          </div>
          <label className="flex gap-2 text-[13px] items-start"><input type="checkbox" name="consent" required className="mt-1" /><span>I agree to the <Link href="/legal#terms">terms</Link> and <Link href="/legal#privacy">privacy notice</Link> (version {CONSENT_VERSION}). My licence and GST details are shared only with distributors I choose.</span></label>
        </PForm>
      </div>
      <p className="text-[14px] mt-4">Already registered? <Link href="/portal/signin" className="font-semibold">Sign in</Link></p>
    </main>
  );
}
