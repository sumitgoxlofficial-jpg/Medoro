import type { Metadata } from "next";
import { headers } from "next/headers";
import { UserError } from "@/server/action";
import { clientIp } from "@/server/auth";
import { log } from "@/server/log";
import { signingView, type SigningView } from "@/staff/hrms/offer-sign";
import { SignOffer } from "./sign-offer";
// Handwriting faces for typed signatures, served from this site.
import "@fontsource/great-vibes/400.css";
import "@fontsource/dancing-script/600.css";
import "@fontsource/allura/400.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review and sign your offer", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The page a candidate opens from the offer email: the letter, then email verification and the e-signature. */
export default async function OfferSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: SigningView | null = null, error = "";
  try {
    view = await signingView(token, clientIp(await headers()));
  } catch (e) {
    if (!(e instanceof UserError)) log.error("offer signing page failed", { err: e });
    error = e instanceof UserError ? e.message : "Something went wrong. Please try again, or contact HR.";
  }
  return (
    <main className="min-h-screen bg-[#F1F5F9] text-[#0f172a]" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {view ? <SignOffer token={token} view={view} /> : (
      <div className="max-w-[920px] mx-auto px-4 py-6 max-[560px]:px-2">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center mt-16">
            <h1 className="text-[20px] font-bold m-0">This link can’t be used</h1>
            <p className="text-[14px] text-[#475569] mt-2">{error}</p>
          </div>
      </div>
      )}
    </main>
  );
}
