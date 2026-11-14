"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ScanBarcode } from "lucide-react";
import { useT } from "@/lib/i18n-client";

/**
 * Greeting banner at the top of both pharmacy dashboards (server mode /app and counter mode): "Good morning, Asha 👋",
 * a small animated illustration and a New bill button. Motion comes from the .app-motion rules in globals.css.
 */
export function WelcomeBanner({ name, branch, newBill }: { name: string; branch: string; newBill: { href: string } | { onClick: () => void } | null }) {
  const t = useT();
  // The greeting follows the viewer's own clock, so it is set after the page loads (no server/browser mismatch).
  const [part, setPart] = useState<"morning" | "afternoon" | "evening" | null>(null);
  useEffect(() => { const h = new Date().getHours(); setPart(h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"); }, []);
  const first = name.trim().split(/\s+/)[0] ?? "";
  const hello = part === "morning" ? t("Good morning, {name}", { name: first }) : part === "afternoon" ? t("Good afternoon, {name}", { name: first }) : part === "evening" ? t("Good evening, {name}", { name: first }) : t("Welcome, {name}", { name: first });
  const btn = "app-sweep relative overflow-hidden flex-none inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-white text-[#0B5E5B] text-[14px] font-semibold no-underline transition-transform duration-300 hover:-translate-y-0.5 hover:text-[#0B5E5B] max-[420px]:px-3";
  const label = <><ScanBarcode size={16} aria-hidden />{t("New bill")}<ArrowRight size={15} aria-hidden className="max-[420px]:hidden" /></>;
  return (
    <div className="app-up app-welcome relative overflow-hidden rounded-xl text-white px-[clamp(16px,2.4vw,24px)] py-[clamp(14px,2vw,18px)] flex items-center gap-4">
      <div aria-hidden className="pointer-events-none absolute inset-0"><div className="app-glow" /></div>
      <svg viewBox="0 0 120 90" className="relative flex-none w-[84px] h-auto max-[520px]:hidden" aria-hidden>
        <rect x="8" y="58" width="104" height="24" rx="6" fill="#14B8A6" />
        <rect x="8" y="58" width="104" height="6" rx="3" fill="#5EEAD4" />
        <g className="app-bob"><rect x="18" y="16" width="44" height="34" rx="6" fill="#fff" /><path d="M24 42l9-9 7 5 12-12" stroke="#0B5E5B" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M48 26h5v5" stroke="#F5C451" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
        <g className="app-bob [animation-delay:-1.5s]"><circle cx="88" cy="34" r="16" fill="#F5C451" /><text x="88" y="40" textAnchor="middle" fontSize="16" fontWeight="700" fill="#94570A">₹</text></g>
      </svg>
      <div className="relative flex flex-col gap-0.5 min-w-0 flex-1">
        <strong className="text-[clamp(17px,1.6vw,20px)] font-semibold truncate">{hello} <span className="app-wave inline-block" aria-hidden>👋</span></strong>
        <span className="text-[13.5px] text-white/75 truncate">{t("Here’s how {branch} is doing.", { branch })}</span>
      </div>
      {newBill ? ("href" in newBill
        ? <Link href={newBill.href} className={btn}>{label}</Link>
        : <button type="button" onClick={newBill.onClick} className={btn + " cursor-pointer border-0"}>{label}</button>) : null}
    </div>
  );
}
