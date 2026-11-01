import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { WA } from "@/components/site/brand";
import { UserError } from "@/server/action";
import { payPage } from "@/staff/online-pay";
import { PayForm } from "./pay-form";

export const metadata = { title: "Pay for Medoro", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Where a self-hosted or desktop installation sends its owner to pay Medoro online (link from Subscription in the app). */
export default async function Page({ searchParams }: { searchParams: Promise<{ l?: string; s?: string }> }) {
  const { l = "", s = "" } = await searchParams;
  let info: Awaited<ReturnType<typeof payPage>> | null = null, error = "";
  try { info = await payPage(l, s); } catch (e) { error = e instanceof UserError ? e.message : "Something went wrong. Open the link again from your Medoro app."; }
  return (
    <div className="bg-white border border-[#E3E6E9] rounded-[14px] p-7 flex flex-col gap-4 w-[min(460px,100%)]">
      <h1 className="m-0 text-[20px] font-bold">Pay for Medoro</h1>
      {info ? <PayForm link={{ l, s }} info={info} /> : (
        <>
          <p role="alert" className="m-0 text-[14px] text-bad">{error}</p>
          <div className="flex gap-2.5 flex-wrap">
            <Link href="/signin" className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-teal text-white text-[15px] font-semibold no-underline hover:bg-teal-hover hover:text-white">Sign in</Link>
            <a href={WA} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[10px] border border-input bg-white text-ink text-[15px] font-semibold no-underline hover:border-teal hover:text-ink"><MessageCircle size={16} aria-hidden className="text-[#146C43]" />WhatsApp us</a>
          </div>
        </>
      )}
    </div>
  );
}
