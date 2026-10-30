"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, MessageCircle, Mail } from "lucide-react";

export const WA = "https://wa.me/916207774673";

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/medoro-mark.png" alt="" style={{ width: size * 1.4 }} className="h-auto block" />
      <span className="font-cond font-bold uppercase tracking-[.02em]" style={{ fontSize: size }}><span className="text-[#0B3A78]">Med</span><span className="text-[#0A9A80]">oro</span></span>
    </span>
  );
}

const NAV: [string, string][] = [["Product", "/#product"], ["AI", "/#ai"], ["Data & security", "/#data"], ["Pricing", "/#pricing"], ["FAQ", "/#faq"]];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [shadow, setShadow] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const f = () => {
      setShadow(window.scrollY > 8);
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? window.scrollY / h : 0);
    };
    f(); window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  const link = "text-[#4B535B] px-2.5 py-2 rounded-md whitespace-nowrap hover:text-teal";
  return (
    <>
      <div aria-hidden className="fixed left-0 top-0 right-0 h-[3px] z-[60] pointer-events-none origin-left bg-[linear-gradient(90deg,#0B3A78,#0A9A80)]" style={{ transform: `scaleX(${progress})` }} />
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-[#EEF0F2] transition-shadow" style={{ boxShadow: shadow ? "0 8px 24px -12px rgba(16,24,40,.18)" : "none" }}>
        <div className="max-w-[1320px] mx-auto h-[76px] px-6 flex items-center gap-8 max-[640px]:px-4">
          <Link href="/" className="no-underline flex-none"><Wordmark /></Link>
          <nav className="hidden min-[1280px]:flex gap-1 text-[13px] font-semibold tracking-[.1em] uppercase">
            {NAV.map(([l, h]) => <a key={h} href={h} className={link}>{l}</a>)}
          </nav>
          <div className="ml-auto flex gap-2.5 items-center">
            <div className="hidden min-[1280px]:flex">
              <Link href="/signin" className="text-ink-strong text-[13px] font-semibold tracking-[.1em] uppercase px-3 py-2 whitespace-nowrap hover:text-teal">Sign in</Link>
              <Link href="/signin?view=employee" className="text-ink-strong text-[13px] font-semibold tracking-[.1em] uppercase px-3 py-2 whitespace-nowrap hover:text-teal">Employee login</Link>
            </div>
            <Link href="/start" className="flex items-center bg-teal text-white h-11 px-[22px] rounded-full text-[15px] font-semibold whitespace-nowrap shadow-[0_8px_20px_-8px_rgba(11,94,91,.55)] hover:bg-teal-hover hover:text-white max-[400px]:px-4">Get started</Link>
            <button onClick={() => setOpen((x) => !x)} aria-label="Menu" aria-expanded={open} className="min-[1280px]:hidden size-[42px] border border-[#E6E8EB] bg-white rounded-full flex items-center justify-center cursor-pointer text-ink-strong">
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        {open ? (
          <div className="min-[1280px]:hidden border-t border-[#EEF0F2] bg-white px-4 pt-2 pb-4 flex flex-col">
            {NAV.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)} className="text-ink-strong text-[14px] font-semibold tracking-[.08em] uppercase px-2 py-3.5 border-b border-[#F2F4F5]">{l}</a>)}
            <Link href="/signin" className="text-teal text-[14px] font-semibold tracking-[.08em] uppercase px-2 py-3.5 border-b border-[#F2F4F5]">Sign in</Link>
            <Link href="/signin?view=employee" className="text-teal text-[14px] font-semibold tracking-[.08em] uppercase px-2 py-3.5">Employee login</Link>
          </div>
        ) : null}
      </header>
    </>
  );
}

const FOOT: { t: string; links: [string, string][] }[] = [
  { t: "Product", links: [["Billing & POS", "/#product"], ["Expiry prevention", "/#product"], ["Invoice scanner", "/#product"], ["Accounts & GST", "/#product"], ["WhatsApp invoices", "/#product"], ["AI Manager", "/#ai"], ["Pricing", "/#pricing"]] },
  { t: "Company", links: [["About Medoro", "/legal#about"], ["Data ownership", "/#data"], ["Security", "/#security"], ["FAQ", "/#faq"], ["Contact", "/legal#contact"]] },
  { t: "Resources", links: [["Help & setup", "/legal#help"], ["Backup & recovery", "/legal#backup"], ["Sign in", "/signin"], ["Pharmacy staff login", "/signin?view=employee"], ["Medoro employee login", "/staff/login"], ["Start free trial", "/start"], ["WhatsApp support", WA]] },
  { t: "Legal", links: [["Privacy policy", "/legal#privacy"], ["Terms of service", "/legal#terms"], ["Refund policy", "/legal#refund"], ["Cookie policy", "/legal#cookies"], ["DPDP rights", "/legal#dpdp"], ["Grievance officer", "/legal#grievance"]] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[#EEF0F2] bg-[#FBFBFC]">
      <div className="max-w-[1200px] mx-auto px-6 pt-14 pb-7 flex flex-col gap-10 max-[640px]:px-4">
        <div className="grid gap-x-8 gap-y-10 grid-cols-2 min-[640px]:grid-cols-3 min-[1000px]:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
          <div className="flex flex-col gap-3 col-span-full min-[1000px]:col-span-1 min-w-0">
            <Link href="/" className="no-underline"><Wordmark size={18} /></Link>
            <span className="text-[14px] text-[#4B535B] max-w-[300px]">Smarter Pharmacy. Simpler Business. Pharmacy software built in Pune for India.</span>
            <div className="flex flex-col gap-1 text-[14px]">
              <a href={WA} className="text-ink-strong flex gap-1.5 items-center"><MessageCircle size={14} className="text-ok" />WhatsApp +91 62077 74673</a>
              <a href="mailto:hello@medoro.in" className="text-ink-strong flex gap-1.5 items-center"><Mail size={14} className="text-faint" />hello@medoro.in</a>
              <span className="text-faint text-[13px]">Mon–Sat, 9 am to 9 pm IST</span>
            </div>
          </div>
          {FOOT.map((c) => (
            <div key={c.t} className="flex flex-col gap-2.5">
              <span className="text-[13px] font-semibold text-ink-strong">{c.t}</span>
              {c.links.map(([l, h]) => <a key={l} href={h} className="text-[14px] text-[#4B535B] hover:text-ink-strong">{l}</a>)}
            </div>
          ))}
        </div>
        <div className="border-t border-[#EEF0F2] pt-5 flex justify-between gap-3 flex-wrap text-[13px] text-faint">
          <span className="flex gap-x-4 gap-y-1.5 flex-wrap items-center"><span>© 2026 Medoro. All rights reserved.</span><a href="/legal#privacy" className="text-[#4B535B] hover:text-ink-strong">Privacy</a><a href="/legal#terms" className="text-[#4B535B] hover:text-ink-strong">Terms</a><a href="/legal#grievance" className="text-[#4B535B] hover:text-ink-strong">Grievance officer</a></span>
          <span>Medoro is business software and does not give clinical advice. Compliance responsibilities stay with the licensed pharmacist.</span>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFab() {
  return (
    <a href={WA} aria-label="WhatsApp us" className="fixed right-5 bottom-5 z-30 flex items-center gap-2 h-12 min-w-12 justify-center px-0 min-[640px]:pl-3.5 min-[640px]:pr-[18px] rounded-full bg-ok text-white text-[14.5px] font-semibold whitespace-nowrap shadow-[0_10px_30px_-8px_rgba(16,24,40,.35)] hover:bg-[#13633F] hover:text-white">
      <MessageCircle size={19} /><span className="hidden min-[640px]:inline">WhatsApp us</span>
    </a>
  );
}

/** Fades sections in as they scroll into view; respects reduced motion. */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target as HTMLElement;
      el.style.transitionDelay = `${Math.min(+(el.dataset.reveal || 0), 6) * 70}ms`;
      el.classList.add("revealed"); io.unobserve(el);
    }), { rootMargin: "0px 0px -12% 0px" });
    els.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
    return () => io.disconnect();
  }, []);
  return null;
}
