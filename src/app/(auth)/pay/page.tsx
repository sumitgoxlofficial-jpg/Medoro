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
      {info ? <PayForm link={{ l, s }} info={info} /> : <p role="alert" className="m-0 text-[14px] text-bad">{error}</p>}
    </div>
  );
}
