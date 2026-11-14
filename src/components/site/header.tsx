"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Boxes, Handshake, HelpCircle, IndianRupee, LogIn, Menu, ShieldCheck, Sparkles, UserRound, X, type LucideIcon } from "lucide-react";
import { useLang, useT } from "@/lib/i18n-client";
import type { Lang } from "@/lib/tr";
import { setLang } from "@/app/app/actions";
import { Wordmark } from "./brand";

/** Icons shown beside the header links (same order as NAV). */
const NAV_ICONS: LucideIcon[] = [Boxes, ArrowLeftRight, ShieldCheck, IndianRupee, HelpCircle, Handshake];

export const NAV: [string, string][] = [["Product", "/#product"], ["Switching", "/#switching"], ["Security", "/#security"], ["Pricing", "/#pricing"], ["FAQ", "/#faq"], ["Become a partner", "/partners"]];

/**
 * EN / हिंदी for the public site. Sets the same `medoro_lang` cookie as the app's switch (works without signing in),
 * then re-renders the page from the server in the new language.
 */
export function SiteLangSwitch({ className = "" }: { className?: string }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (l: Lang) => {
    try { localStorage.removeItem("medoro-site-lang"); } catch {}
    if (l !== lang) start(async () => { await setLang(l); router.refresh(); });
  };
  const b = (l: Lang, label: string) => (
    <button key={l} type="button" lang={l} aria-pressed={lang === l} disabled={pending} onClick={() => pick(l)}
      className={`h-9 px-2 rounded-md text-[14px] font-medium cursor-pointer transition-colors disabled:cursor-wait ${lang === l ? "bg-white text-[var(--s-ink)] shadow-[0_1px_2px_rgba(14,22,20,.12)]" : "text-[var(--s-muted)] hover:text-[var(--s-ink)]"}`}>{label}</button>
  );
  return <div role="group" aria-label="Language / भाषा" className={`inline-flex flex-none gap-0.5 p-[3px] rounded-lg bg-[var(--s-soft)] border border-[var(--s-line)] ${className}`}>{b("en", "EN")}{b("hi", "हिंदी")}</div>;
}

/**
 * The homepage hero used to keep its own language in localStorage. A visitor who picked हिंदी there and has no
 * language cookie yet gets the cookie once, so the whole site (and the app) opens in Hindi.
 */
export function SiteLangCarryOver() {
  const router = useRouter();
  useEffect(() => {
    let old: string | null = null;
    try { old = localStorage.getItem("medoro-site-lang"); localStorage.removeItem("medoro-site-lang"); } catch {}
    if (old === "hi") void setLang("hi").then(() => router.refresh());
  }, [router]);
  return null;
}

export function SiteHeader() {
  const t = useT();
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
      <div className="max-w-[1200px] mx-auto h-16 px-6 flex items-center gap-10 max-[1099px]:gap-4 max-[959px]:gap-3 max-[640px]:px-4">
        <Link href="/" aria-label={t("Medoro home")} className="site-logo flex-none"><Wordmark size={21} /></Link>
        <nav aria-label={t("Main")} className="hidden min-[1180px]:flex gap-1 text-[15px]">
          {NAV.map(([l, h], i) => {
            const Icon = NAV_ICONS[i];
            return (
              <a key={h} href={h} className="site-nav group relative flex items-center gap-1.5 px-3 py-2 rounded-md text-[var(--s-ink-2)] hover:text-[var(--s-ink)] hover:bg-[var(--s-soft)] transition-colors whitespace-nowrap">
                <Icon size={16} aria-hidden className="site-nav-ico max-[1799px]:hidden text-[var(--s-brand)]" />{t(l, { ctx: "site" })}
              </a>
            );
          })}
        </nav>
        <div className="ml-auto flex gap-2 items-center">
          <SiteLangSwitch className="max-[559px]:hidden" />
          <Link href="/staff/employee" title={t("Medoro employee login")} className="group max-[1179px]:hidden flex items-center gap-1.5 h-11 px-3 rounded-lg text-[15px] font-medium text-[var(--s-ink-2)] whitespace-nowrap hover:text-[var(--s-ink)] hover:bg-[var(--s-soft)] transition-colors">
            <UserRound size={17} aria-hidden className="site-nav-ico text-[var(--s-brand)]" /><span className="max-[1799px]:sr-only">{t("Medoro employee login")}</span>
          </Link>
          <Link href="/signin" className="group max-[419px]:hidden flex items-center gap-1.5 h-11 px-4 max-[400px]:px-3 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] whitespace-nowrap transition-colors hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><LogIn size={16} aria-hidden className="site-nav-ico max-[640px]:hidden" />{t("Log in")}</Link>
          <a href="/trial" className="site-cta group relative overflow-hidden flex items-center gap-1.5 h-11 px-4 max-[400px]:px-3 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white"><Sparkles size={16} aria-hidden className="site-sparkle max-[400px]:hidden" /><span className="max-[520px]:hidden">{t("Start 7-day free trial")}</span><span className="min-[521px]:hidden">{t("Free trial")}</span></a>
          <button type="button" onClick={() => setOpen((x) => !x)} aria-label={open ? t("Close menu") : t("Open menu")} aria-expanded={open} aria-controls="site-menu"
            className="min-[1180px]:hidden size-11 rounded-lg border border-[var(--s-line)] bg-white flex items-center justify-center cursor-pointer text-[var(--s-ink)]">
            {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>
      </div>
      <div id="site-menu" hidden={!open} className="min-[1180px]:hidden border-t border-[var(--s-line)] bg-white px-4 pb-4">
        <nav aria-label={t("Mobile")} className="flex flex-col">
          {NAV.map(([l, h], i) => {
            const Icon = NAV_ICONS[i];
            return <a key={h} href={h} onClick={() => setOpen(false)} className="flex items-center gap-3 text-[var(--s-ink)] text-[16px] font-medium py-3.5 border-b border-[var(--s-line-2)]"><span className="size-8 rounded-lg bg-[var(--s-brand-tint)] flex items-center justify-center"><Icon size={17} aria-hidden className="text-[var(--s-brand)]" /></span>{t(l, { ctx: "site" })}</a>;
          })}
          <Link href="/signin" className="text-[var(--s-ink)] text-[16px] font-medium py-3.5 border-b border-[var(--s-line-2)]">{t("Log in")}</Link>
          <a href="/trial" className="text-[var(--s-brand)] text-[16px] font-semibold py-3.5 border-b border-[var(--s-line-2)]">{t("Start 7-day free trial")}</a>
          <Link href="/staff/employee" className="text-[var(--s-ink)] text-[16px] font-medium py-3.5 border-b border-[var(--s-line-2)]">{t("Medoro employee login")}</Link>
          <Link href="/signin?view=employee" className="text-[var(--s-ink)] text-[16px] font-medium py-3.5 border-b border-[var(--s-line-2)]">{t("Pharmacy staff login")}</Link>
        </nav>
        <SiteLangSwitch className="min-[560px]:hidden mt-4" />
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
