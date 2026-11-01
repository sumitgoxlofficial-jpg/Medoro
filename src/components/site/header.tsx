"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Wordmark } from "./brand";

export const NAV: [string, string][] = [["Product", "/#product"], ["Switching", "/#switching"], ["Security", "/#security"], ["Pricing", "/#pricing"], ["FAQ", "/#faq"]];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f(); window.addEventListener("scroll", f, { passive: true });
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("scroll", f); window.removeEventListener("keydown", k); };
  }, []);
  return (
    <header className={`sticky top-0 z-40 bg-white/95 supports-[backdrop-filter]:bg-white/85 backdrop-blur border-b transition-colors duration-300 ${scrolled || open ? "border-[var(--s-line)]" : "border-transparent"}`}>
      <div className="max-w-[1200px] mx-auto h-16 px-6 flex items-center gap-10 max-[640px]:px-4">
        <Link href="/" aria-label="Medoro home" className="flex-none"><Wordmark size={21} /></Link>
        <nav aria-label="Main" className="hidden min-[960px]:flex gap-1 text-[15px]">
          {NAV.map(([l, h]) => <a key={h} href={h} className="px-3 py-2 rounded-md text-[var(--s-ink-2)] hover:text-[var(--s-ink)] hover:bg-[var(--s-soft)] transition-colors">{l}</a>)}
        </nav>
        <div className="ml-auto flex gap-2 items-center">
          <Link href="/signin" className="flex items-center h-11 px-4 max-[400px]:px-3 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] whitespace-nowrap hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]">Log in</Link>
          <a href="/trial" className="flex items-center h-11 px-4 max-[400px]:px-3 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white"><span className="max-[520px]:hidden">Start 7-day free trial</span><span className="min-[521px]:hidden">Free trial</span></a>
          <button type="button" onClick={() => setOpen((x) => !x)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="site-menu"
            className="min-[960px]:hidden size-11 rounded-lg border border-[var(--s-line)] bg-white flex items-center justify-center cursor-pointer text-[var(--s-ink)]">
            {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>
      </div>
      <div id="site-menu" hidden={!open} className="min-[960px]:hidden border-t border-[var(--s-line)] bg-white px-4 pb-4">
        <nav aria-label="Mobile" className="flex flex-col">
          {NAV.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)} className="text-[var(--s-ink)] text-[16px] font-medium py-3.5 border-b border-[var(--s-line-2)]">{l}</a>)}
          <Link href="/signin" className="text-[var(--s-ink)] text-[16px] font-medium py-3.5 border-b border-[var(--s-line-2)]">Log in</Link>
          <a href="/trial" className="text-[var(--s-brand)] text-[16px] font-semibold py-3.5 border-b border-[var(--s-line-2)]">Start 7-day free trial</a>
          <Link href="/signin?view=employee" className="text-[var(--s-ink)] text-[16px] font-medium py-3.5">Pharmacy staff login</Link>
        </nav>
      </div>
    </header>
  );
}

/** Reveal fallback (browsers without scroll-driven animations), counters and one-shot "play" blocks. */
export function SiteMotion() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const native = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
    const below = (el: Element) => el.getBoundingClientRect().top > window.innerHeight * 0.92;
    const fmt = (el: HTMLElement, n: number) => { el.textContent = (el.dataset.prefix ?? "") + Math.round(n).toLocaleString("en-IN") + (el.dataset.suffix ?? ""); };

    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target as HTMLElement;
      io.unobserve(el);
      el.classList.add("is-in");
      if (el.dataset.count) {
        const to = Number(el.dataset.count), t0 = performance.now(), dur = 1100;
        const step = (t: number) => { const p = Math.min(1, (t - t0) / dur); fmt(el, to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
    }), { rootMargin: "0px 0px -10% 0px" });

    if (!native && !reduce) document.querySelectorAll<HTMLElement>(".site-root [data-reveal]").forEach((el) => { if (below(el)) { el.classList.add("will-reveal"); io.observe(el); } });
    document.querySelectorAll<HTMLElement>(".site-root [data-play]").forEach((el) => { if (reduce) el.classList.add("is-in"); else io.observe(el); });
    if (!reduce) document.querySelectorAll<HTMLElement>(".site-root [data-count]").forEach((el) => { if (below(el)) { fmt(el, 0); io.observe(el); } });
    return () => io.disconnect();
  }, []);
  return null;
}
