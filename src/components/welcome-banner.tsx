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

/**
 * Behind the dashboards: soft drifting colour, dotted corners and faint pharmacy icons (capsule, plus, ₹, chart,
 * heart, pill bottle) that float slowly. Sits under the cards; off with reduced motion (.app-motion rule).
 */
export function DashBackdrop() {
  const s = { fill: "none", stroke: "#14B8A6", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const icons: [string, React.ReactNode][] = [
    ["left-[3%] top-[22%] [--dur:13s]", <svg key="cap" viewBox="0 0 48 24" className="w-14" {...s}><rect x="2" y="2" width="44" height="20" rx="10" /><path d="M24 2v20" /></svg>],
    ["right-[4%] top-[14%] [--dur:11s]", <svg key="plus" viewBox="0 0 24 24" className="size-9" {...s} stroke="#F28B82"><path d="M12 4v16M4 12h16" /></svg>],
    ["right-[6%] top-[58%] [--dur:12s]", <svg key="rupee" viewBox="0 0 24 24" className="size-11" {...s} stroke="#E0A82E"><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M13 8c2 0 2 3 0 3h-4l4 5" /></svg>],
    ["left-[5%] bottom-[12%] [--dur:14s]", <svg key="chart" viewBox="0 0 24 24" className="size-11" {...s}><path d="M3 20h18" /><path d="M5 16l4-5 3 3 6-7" /><path d="M15 7h3v3" /></svg>],
    ["left-[46%] bottom-[5%] [--dur:15s] max-[900px]:hidden", <svg key="heart" viewBox="0 0 24 24" className="size-9" {...s} stroke="#F28B82"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></svg>],
    ["right-[30%] top-[4%] [--dur:12.5s] max-[900px]:hidden", <svg key="bottle" viewBox="0 0 24 24" className="size-10" {...s}><rect x="7" y="3" width="10" height="4" rx="1" /><rect x="6" y="7" width="12" height="14" rx="2" /><path d="M10 14h4M12 12v4" /></svg>],
  ];
  return (
    <div aria-hidden className="app-motion pointer-events-none absolute inset-0 overflow-hidden">
      <div className="site-blob site-blob-a bg-[#14B8A6]/[.11]" />
      <div className="site-blob site-blob-b bg-[#F5C451]/[.12]" />
      <div className="site-blob site-blob-c bg-[#8FD3C6]/[.18]" />
      <div className="hr-corner absolute left-0 top-0 size-56 opacity-70" />
      <div className="hr-corner absolute right-0 bottom-0 size-64 rotate-180 opacity-70" />
      {icons.map(([pos, svg], i) => <div key={i} className={`app-drift absolute opacity-[.4] ${pos}`} style={{ animationDelay: `${-i * 1.7}s` }}>{svg}</div>)}
    </div>
  );
}

/** Counts a rupee amount up from zero when it first shows (instantly with reduced motion). */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !value) { setShown(value); return; }
    let raf = 0; const t0 = performance.now(), dur = 900;
    const step = (t: number) => { const p = Math.min(1, (t - t0) / dur); setShown(Math.round(value * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}
