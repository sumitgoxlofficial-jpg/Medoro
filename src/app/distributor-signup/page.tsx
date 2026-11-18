import { notFound } from "next/navigation";
import Link from "next/link";
import { setupUnlocked, signupOpen } from "@/server/setup-gate";
import { DistributorSignup } from "./form";
import { distHostingAllowed } from "@/domain/distribution/hosting";

export const dynamic = "force-dynamic";
export const metadata = { title: "MEDORO Distribution — create your account", robots: { index: false } };

export default async function Page() {
  if ((!signupOpen() && !(await setupUnlocked())) || !distHostingAllowed()) notFound();
  return (
    <main className="min-h-dvh bg-[#F4F6F9] text-[#0B2545]">
      <div className="max-w-[760px] mx-auto px-4 py-10">
        <div className="text-[12px] font-semibold tracking-[0.14em] text-[#4A5A73]">MEDORO DISTRIBUTION</div>
        <h1 className="text-[26px] font-semibold m-0">Wholesale ERP for pharma distributors, stockists and C&F agents</h1>
        <p className="text-[14px] text-[#5B6B82]">Orders, batch-wise stock, GST billing, schemes, expiry claims, dispatch, collections and a chemist ordering portal. Free trial; your data stays in your own database.</p>
        <DistributorSignup />
        <p className="text-[13px] mt-4">Retail pharmacy? <Link href="/signup">MEDORO Pharmacy</Link> · Already have an account? <Link href="/signin">Sign in</Link></p>
      </div>
    </main>
  );
}
