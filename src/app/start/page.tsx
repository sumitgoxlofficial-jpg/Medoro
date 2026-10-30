import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { db } from "@/server/db";
import { setupGate } from "@/server/setup-gate";
import { Wordmark, WA } from "@/components/site/chrome";
import { StartForm } from "./form";

export const metadata: Metadata = { title: "Start your free trial · Medoro", description: "Tell us about your pharmacy and start a 14-day free trial of Medoro." };
export const dynamic = "force-dynamic";

export default async function Start() {
  const canSetup = setupGate() !== "disabled" && (await db.tenant.count()) === 0;
  return (
    <div className="site-root bg-white text-ink-strong leading-[1.6] min-h-dvh text-[16px]">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-[#EEF0F2]">
        <div className="max-w-[1100px] mx-auto h-[72px] px-6 flex items-center gap-5 max-[640px]:px-4">
          <Link href="/" className="no-underline"><Wordmark size={22} /></Link>
          <Link href="/" className="ml-auto flex gap-1.5 items-center text-[14px] font-semibold text-ink-2 hover:text-ink-strong"><ArrowLeft size={15} />Back to home</Link>
        </div>
      </header>
      <main className="max-w-[1100px] mx-auto px-6 pt-12 pb-24 grid gap-12 items-start grid-cols-1 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[640px]:px-4">
        <div className="flex flex-col gap-4">
          <span className="text-[13px] font-semibold text-teal tracking-[.06em]">14-DAY FREE TRIAL · NO CARD NEEDED</span>
          <h1 className="m-0 font-bold text-[clamp(32px,4.4vw,46px)] leading-[1.1] tracking-[-.03em]">Start your Medoro trial</h1>
          <p className="m-0 text-[16px] text-[#4B535B]">Tell us about your pharmacy. A Medoro specialist contacts you on WhatsApp to help set up your counter, import your stock and answer questions.</p>
          <ol className="m-0 pl-5 flex flex-col gap-2 text-[15px] text-[#3D454D]">
            <li>Fill in the form. It takes a minute.</li>
            <li>Install Medoro on the shop PC (the desktop app for Windows, macOS or Linux) or open it in Chrome. We send you the link on WhatsApp.</li>
            <li>Create your pharmacy and owner account in the setup wizard. Your records stay in a database you control.</li>
            <li>Bill free for 14 days. Then pay by UPI or bank transfer from the Subscription page to continue.</li>
          </ol>
          {canSetup ? (
            <div className="bg-teal-tint border border-teal-line rounded-[10px] px-4 py-3 text-[14.5px] flex flex-col gap-1">
              <strong>This server isn’t set up yet.</strong>
              <span>If this is your own Medoro server, you can create your pharmacy here now.</span>
              <Link href="/setup" className="self-start font-semibold text-teal underline">Run setup on this server →</Link>
            </div>
          ) : null}
          <a href={WA} target="_blank" rel="noreferrer" className="self-start text-[14.5px] font-semibold text-teal">Prefer to talk first? Message us on WhatsApp</a>
        </div>
        <StartForm />
      </main>
    </div>
  );
}
