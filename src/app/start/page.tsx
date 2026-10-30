import Link from "next/link";
import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { db } from "@/server/db";
import { setupGate } from "@/server/setup-gate";
import { WA_DEMO } from "@/components/site/chrome";
import { PageHeader } from "@/components/site/page-header";
import { StartForm } from "./form";

export const metadata: Metadata = { title: "Start your free trial · Medoro", description: "Tell us about your pharmacy and start a 14-day free trial of Medoro." };
export const dynamic = "force-dynamic";

const STEPS = [
  "Fill in the form. It takes a minute.",
  "Install Medoro on the shop PC (the desktop app for Windows, macOS or Linux) or open it in Chrome. We send you the link on WhatsApp.",
  "Create your pharmacy and owner account in the setup wizard. Your records stay in a database you control.",
  "Bill free for 14 days. Then pay by UPI or bank transfer from the Subscription page to continue.",
];

export default async function Start() {
  const canSetup = setupGate() !== "disabled" && (await db.tenant.count()) === 0;
  return (
    <div className="site-root bg-white min-h-dvh">
      <PageHeader cta={false} />
      <main className="max-w-[1200px] mx-auto px-6 pt-[clamp(40px,6vw,80px)] pb-24 grid grid-cols-12 gap-x-6 gap-y-12 items-start max-[640px]:px-4">
        <div className="col-span-12 min-[960px]:col-span-6 flex flex-col gap-6">
          <span className="text-[14px] font-semibold text-[var(--s-brand)]">14-day free trial · No card needed</span>
          <h1 className="site-display m-0 text-[clamp(40px,5vw,64px)]">Start your Medoro trial.</h1>
          <p className="m-0 text-[18px] leading-[1.6] text-[var(--s-ink-2)] max-w-[540px]">Tell us about your pharmacy. Someone from Medoro messages you on WhatsApp to help set up your counter, import your stock and answer questions.</p>
          <ol className="m-0 p-0 list-none flex flex-col max-w-[560px]">
            {STEPS.map((s, i) => (
              <li key={s} className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 py-4 border-t border-[var(--s-line)] last:border-b text-[16px] text-[var(--s-ink-2)]">
                <span className="site-num text-[14px] text-[var(--s-brand)] pt-0.5">{String(i + 1).padStart(2, "0")}</span><span>{s}</span>
              </li>
            ))}
          </ol>
          {canSetup ? (
            <div className="bg-[var(--s-brand-tint)] border border-[#BFDDD8] rounded-xl px-4 py-3.5 text-[15px] flex flex-col gap-1 max-w-[560px]">
              <strong className="font-semibold">This server isn’t set up yet.</strong>
              <span className="text-[var(--s-ink-2)]">If this is your own Medoro server, you can create your pharmacy here now.</span>
              <Link href="/setup" className="self-start font-semibold text-[var(--s-brand)] underline underline-offset-4">Run setup on this server →</Link>
            </div>
          ) : null}
          <a href={WA_DEMO} target="_blank" rel="noreferrer" className="self-start inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={16} aria-hidden className="text-[#146C43]" />Prefer to talk first? WhatsApp us</a>
        </div>
        <div className="col-span-12 min-[960px]:col-span-5 min-[960px]:col-start-8 min-[960px]:sticky min-[960px]:top-24">
          <StartForm />
        </div>
      </main>
    </div>
  );
}
