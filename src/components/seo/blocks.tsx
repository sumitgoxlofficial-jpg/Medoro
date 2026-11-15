import Link from "next/link";
import { ArrowRight, Check, MessageCircle, X } from "lucide-react";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab, WA_DEMO } from "@/components/site/chrome";
import { Aurora, FloatingShapes } from "@/components/site/decor";
import { breadcrumbSchema, faqSchema, type Crumb, type JsonLdObject } from "@/lib/seo";
import type { SiteLink } from "@/data/site-links";
import { JsonLd } from "./json-ld";

/**
 * Building blocks for the public SEO pages (features, comparisons, locations, tools, solutions). Server components
 * in the homepage's visual language (site-* classes in globals.css). Pages are English only, like the landing pages:
 * Google indexes the site in English, since the language is a cookie rather than a separate URL.
 */

export const wrap = "max-w-[1200px] mx-auto px-6 max-[640px]:px-4";
export const h2 = "site-display m-0 text-[clamp(28px,3.4vw,42px)] text-[var(--s-ink)]";
const section = `${wrap} py-[clamp(56px,8vw,104px)]`;

/** Header, footer, breadcrumbs and structured data around a public page. */
export function MarketingShell({ crumbs, jsonLd = [], children }: { crumbs: Crumb[]; jsonLd?: JsonLdObject[]; children: React.ReactNode }) {
  return (
    <div className="site-root bg-white overflow-x-clip">
      <SiteHeader />
      <SiteMotion />
      <JsonLd data={[breadcrumbSchema(crumbs), ...jsonLd]} />
      <main id="main">{children}</main>
      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

/** Visible breadcrumb trail; the last crumb is the current page. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const all: Crumb[] = [["Medoro", "/"], ...crumbs];
  return (
    <nav aria-label="Breadcrumb" className="text-[14px] text-[var(--s-muted)]">
      <ol className="m-0 p-0 list-none flex flex-wrap gap-x-1.5 gap-y-1">
        {all.map(([name, path], i) => (
          <li key={path} className="flex gap-1.5">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {i === all.length - 1 ? <span aria-current="page" className="text-[var(--s-ink-2)]">{name}</span> : <Link href={path} className="hover:text-[var(--s-brand)]">{name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TrialButtons({ secondary = "demo" }: { secondary?: "demo" | "none" }) {
  return (
    <div className="flex gap-3 flex-wrap">
      <a href="/trial" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">Start Free Trial<ArrowRight size={17} aria-hidden /></a>
      {secondary === "demo" ? <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[16px] font-semibold transition-colors hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={17} aria-hidden className="text-[#146C43]" />Get a demo on WhatsApp</a> : null}
    </div>
  );
}

/** Page hero: breadcrumbs, eyebrow, H1, intro, CTA; an optional visual on the right. */
export function Hero({ crumbs, eyebrow, h1, intro, aside, note = "7 days free, no card needed. From ₹999 a month, GST included." }: { crumbs: Crumb[]; eyebrow: string; h1: string; intro: string; aside?: React.ReactNode; note?: string }) {
  return (
    <section className="relative overflow-hidden">
      <Aurora />
      <FloatingShapes />
      <div className={`relative ${wrap} pt-[clamp(28px,5vw,72px)] pb-14 grid grid-cols-1 ${aside ? "min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""} gap-x-12 gap-y-10 items-center`}>
        <div className="flex flex-col gap-5 max-w-[720px]">
          <Breadcrumbs crumbs={crumbs} />
          <span className="site-up text-[14px] font-semibold text-[var(--s-brand)]">{eyebrow}</span>
          <h1 className="site-display site-up [--d:1] m-0 text-[clamp(34px,4.6vw,56px)]">{h1}</h1>
          <p className="site-up [--d:2] m-0 text-[clamp(16px,1.3vw,18px)] leading-[1.6] text-[var(--s-ink-2)]">{intro}</p>
          <div className="site-up [--d:3] pt-1"><TrialButtons /></div>
          {note ? <p className="site-up [--d:4] m-0 text-[14px] text-[var(--s-muted)]">{note}</p> : null}
        </div>
        {aside ? <div className="site-up [--d:3] min-w-0">{aside}</div> : null}
      </div>
    </section>
  );
}

export function Section({ id, title, lead, soft = false, children }: { id: string; title: string; lead?: string; soft?: boolean; children: React.ReactNode }) {
  const inner = (
    <div className={`${section} flex flex-col gap-10`}>
      <div className="flex flex-col gap-3 max-w-[760px]">
        <h2 id={`${id}-title`} className={h2}>{title}</h2>
        {lead ? <p className="m-0 text-[17px] leading-[1.6] text-[var(--s-ink-2)]">{lead}</p> : null}
      </div>
      {children}
    </div>
  );
  return soft
    ? <section aria-labelledby={`${id}-title`} className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">{inner}</section>
    : <section aria-labelledby={`${id}-title`}>{inner}</section>;
}

/** Problem → Medoro's answer, one row per pain point. */
export function ProblemSolution({ items }: { items: { pain: string; fix: string }[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div aria-hidden className="hidden min-[860px]:grid grid-cols-2 gap-4 text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)]">
        <span>The problem today</span><span>How Medoro handles it</span>
      </div>
      {items.map((it, i) => (
        <div key={it.pain} data-reveal style={{ ["--d" as string]: i }} className="grid grid-cols-1 min-[860px]:grid-cols-2 gap-px rounded-xl overflow-hidden border border-[var(--s-line)] bg-[var(--s-line)]">
          <div className="bg-white p-5 flex gap-3">
            <span className="flex-none size-7 rounded-full bg-[#FDECEA] flex items-center justify-center"><X size={15} aria-hidden className="text-[#B3261E]" /></span>
            <p className="m-0 text-[16px] leading-[1.55] text-[var(--s-ink-2)]"><span className="sr-only">Problem: </span>{it.pain}</p>
          </div>
          <div className="bg-[var(--s-brand-tint)] p-5 flex gap-3">
            <span className="flex-none size-7 rounded-full bg-white flex items-center justify-center"><Check size={15} aria-hidden className="text-[var(--s-brand)]" /></span>
            <p className="m-0 text-[16px] leading-[1.55] text-[var(--s-ink)]"><span className="sr-only">With Medoro: </span>{it.fix}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Three-up cards with a heading, paragraph and optional tick list. */
export function CardGrid({ items }: { items: { h: string; p: string; points?: string[] }[] }) {
  return (
    <div className="grid gap-x-8 gap-y-10 grid-cols-1 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
      {items.map((s, i) => (
        <article key={s.h} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-3 border-t border-[var(--s-line)] pt-6">
          <h3 className="m-0 text-[21px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{s.h}</h3>
          <p className="m-0 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{s.p}</p>
          {s.points?.length ? (
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
              {s.points.map((p) => <li key={p} className="flex gap-2 text-[15px] text-[var(--s-ink-2)]"><Check size={16} aria-hidden className="flex-none mt-[3px] text-[var(--s-brand)]" />{p}</li>)}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/** Visible FAQ plus its FAQPage structured data (the two must say the same thing). */
export function FaqSection({ faq, title = "Common questions" }: { faq: readonly (readonly [string, string])[]; title?: string }) {
  return (
    <section aria-labelledby="faq-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
      <JsonLd data={faqSchema(faq)} />
      <div className={`${section} grid grid-cols-12 gap-x-6 gap-y-8`}>
        <h2 id="faq-title" className={`${h2} col-span-12 min-[1000px]:col-span-4`}>{title}</h2>
        <div className="col-span-12 min-[1000px]:col-span-8 flex flex-col">
          {faq.map(([q, a]) => (
            <details key={q} className="group border-t border-[var(--s-line)] last:border-b py-5">
              <summary className="cursor-pointer list-none flex justify-between gap-4 text-[18px] font-semibold text-[var(--s-ink)]">{q}<span aria-hidden className="text-[var(--s-brand)] transition-transform group-open:rotate-45">+</span></summary>
              <p className="m-0 mt-3 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A grid of internal links, each with an optional one-line description. */
export function LinkGrid({ links, cols = 3 }: { links: (SiteLink | [name: string, path: string, blurb: string])[]; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? "min-[1000px]:grid-cols-4" : cols === 3 ? "min-[1000px]:grid-cols-3" : "";
  return (
    <ul className={`m-0 p-0 list-none grid gap-3 grid-cols-1 min-[640px]:grid-cols-2 ${c}`}>
      {links.map(([name, path, blurb]) => (
        <li key={path}>
          <Link href={path} className="site-lift group flex flex-col gap-1.5 h-full rounded-xl border border-[var(--s-line)] bg-white px-5 py-4 transition-colors hover:border-[var(--s-brand)]">
            <span className="flex items-center justify-between gap-3 text-[16px] font-semibold text-[var(--s-ink)] group-hover:text-[var(--s-brand)]">{name}<ArrowRight size={16} aria-hidden className="flex-none" /></span>
            {blurb ? <span className="text-[14.5px] leading-[1.5] text-[var(--s-muted)]">{blurb}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Closing conversion band. */
export function CtaBand({ title = "Try Medoro free for 7 days.", text = "Set up with your own stock, bill a few customers and see your numbers on your phone. No card needed, and your data stays yours if you leave." }: { title?: string; text?: string }) {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden bg-[var(--s-dark)] text-white">
      <Aurora dark />
      <div className={`relative ${wrap} py-[clamp(56px,7vw,96px)] flex flex-col min-[900px]:flex-row min-[900px]:items-center justify-between gap-8`}>
        <div className="flex flex-col gap-3 max-w-[640px]">
          <h2 id="cta-title" className="site-display m-0 text-[clamp(28px,3.4vw,42px)] text-white">{title}</h2>
          <p className="m-0 text-[17px] leading-[1.6] text-[#C3D3D0]">{text}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <a href="/trial" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-white text-[var(--s-brand-ink)] text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-tint)]">Start Free Trial<ArrowRight size={17} aria-hidden /></a>
          <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-white/40 text-white text-[16px] font-semibold transition-colors hover:border-white hover:text-white"><MessageCircle size={17} aria-hidden />WhatsApp us</a>
        </div>
      </div>
    </section>
  );
}
