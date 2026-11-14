"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { Mark, Wordmark } from "@/components/brand";
import { LangSwitch } from "@/components/lang-switch";
import { MotivationArt } from "@/components/site/motivation-art";
import { SideIcons } from "@/app/staff/employee/art";

/**
 * Frame for the pharmacy auth pages. Sign-in gets the split design (teal panel with the pharmacy illustration on the
 * left, the form on a soft animated background on the right); signup, setup and pay keep the plain centred column.
 * Motion stops with reduced motion (.hr-motion rule).
 */
export function AuthShell({ children, lines, points }: { children: React.ReactNode; lines: string[]; points: [string, string][] }) {
  const path = usePathname() ?? "";
  const split = path === "/signin" || path.startsWith("/signin/");
  const brand = (
    <Link href="/" className="relative flex items-center gap-2.5 no-underline hr-up">
      <span className="hr-breathe"><Mark size={36} /></span>
      <Wordmark size={22} />
    </Link>
  );
  if (!split) {
    return (
      <div className="hr-motion relative min-h-dvh bg-bg flex flex-col items-center gap-7 px-4 py-10">
        <LangSwitch className="absolute top-3 right-3" />
        {brand}
        {children}
      </div>
    );
  }
  return (
    <div className="hr-motion min-h-dvh bg-bg grid min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative overflow-hidden bg-[#0B5E5B] text-white px-[clamp(32px,4vw,64px)] py-12 flex-col justify-center gap-7 hidden min-[1100px]:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="hr-dots absolute inset-0" />
          <div className="site-blob site-blob-a bg-[#14B8A6]/30" />
          <div className="site-blob site-blob-b bg-[#F5C451]/15" />
        </div>
        <h2 className="relative hr-up [--d:1] m-0 text-[clamp(30px,2.8vw,42px)] leading-[1.12] font-bold">
          {lines.map((l, i) => <span key={l} className={`block ${i === 1 ? "hr-shine" : ""}`}>{l}</span>)}
        </h2>
        <div className="relative hr-up [--d:2] max-w-[460px] w-full"><MotivationArt className="w-full h-auto drop-shadow-[0_24px_40px_rgba(0,0,0,.28)]" /></div>
        <ul className="relative m-0 p-0 list-none grid grid-cols-2 gap-x-6 gap-y-3 max-w-[520px]">
          {points.map(([name, d], i) => (
            <li key={name} className="hr-up flex items-start gap-2.5 text-[14px]" style={{ ["--d" as string]: 3 + i }}>
              <span className="size-6 mt-0.5 rounded-full bg-white/10 border border-white/15 flex items-center justify-center flex-none"><Check size={13} strokeWidth={3} aria-hidden className="text-[#5EEAD4]" /></span>
              <span className="flex flex-col leading-tight"><strong className="font-semibold">{name}</strong><span className="text-white/65 text-[13px]">{d}</span></span>
            </li>
          ))}
        </ul>
      </aside>
      <div className="relative overflow-hidden flex flex-col items-center justify-center gap-7 px-4 py-10">
        <div aria-hidden className="pointer-events-none absolute inset-0"><div className="site-blob site-blob-b bg-[#14B8A6]/10" /><div className="site-blob site-blob-c bg-[#F5C451]/12" /></div>
        <SideIcons />
        <LangSwitch className="absolute top-3 right-3 z-10" />
        {brand}
        <div className="hr-form relative w-full flex flex-col items-center gap-3.5">{children}</div>
      </div>
    </div>
  );
}
