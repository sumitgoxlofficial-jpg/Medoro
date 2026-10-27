import type { Metadata } from "next";
import { Headset, Lock } from "lucide-react";
import { Wordmark } from "@/components/site/chrome";
import { grantInfo } from "@/domain/identity/support";
import { StartButton } from "./start";

export const metadata: Metadata = { title: "Medoro support access", robots: { index: false } };
export const dynamic = "force-dynamic";

// Opening the link only shows this page (chat apps preview links); the session starts on the button.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await grantInfo(token);
  const until = g ? new Date(g.expiresAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="min-h-dvh bg-[#F5F6F7] flex flex-col items-center justify-center gap-5 p-4">
      <Wordmark size={22} />
      <div className="w-[min(460px,100%)] bg-white border border-line rounded-[14px] p-6 flex flex-col gap-3.5">
        <div className="flex gap-3 items-center"><span className="size-10 rounded-[10px] bg-[#0E1A1F] text-[#5FD3BC] flex items-center justify-center flex-none"><Headset size={20} /></span>
          <h1 className="m-0 text-[19px] font-semibold">Medoro support access</h1></div>
        {g ? (
          <>
            <p className="m-0 text-[14px] text-ink-2"><strong>{g.pharmacy}</strong> gave Medoro support read-only access until <strong>{until}</strong>.</p>
            <div className="text-[13px] text-muted bg-[#F7F8F9] rounded-lg px-3 py-2">Reason: {g.reason} · granted by {g.grantedBy}</div>
            <div className="flex gap-2 items-start text-[13px] text-ink-2"><Lock size={15} className="text-teal mt-0.5 flex-none" /><span>You can look but not change or download anything. Everything you open is recorded in the pharmacy’s audit trail. The link works once.</span></div>
            <StartButton token={token} />
          </>
        ) : <p className="m-0 text-[14px] text-ink-2">This link has expired, was revoked or was already used. Ask the pharmacy owner for a new one from Privacy &amp; data → Medoro support access.</p>}
      </div>
    </div>
  );
}
