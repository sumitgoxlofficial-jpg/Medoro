import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab, WA_DEMO } from "@/components/site/chrome";
import { Aurora, FloatingShapes } from "@/components/site/decor";
import { LANDING_LINKS } from "@/components/site/landing-links";
import { landing } from "@/components/site/landing-data";

/**
 * A search landing page (see landing-data.ts). English only: Google indexes the site in English, since the
 * language is a cookie rather than a separate URL. The header and footer still follow the visitor's language.
 */
const SITE = process.env.APP_URL ?? "https://medoro.in";

export function landingMetadata(slug: string): Metadata {
  const l = landing(slug);
  const url = `/${l.slug}`;
  return {
    title: { absolute: `${l.title} | Medoro` },
    description: l.description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "Medoro", title: l.title, description: l.description, locale: "en_IN", images: [{ url: l.img[0], alt: l.img[1] }] },
    twitter: { card: "summary_large_image", title: l.title, description: l.description },
  };
}

const wrap = "max-w-[1200px] mx-auto px-6 max-[640px]:px-4";
const h2 = "site-display m-0 text-[clamp(30px,3.6vw,44px)] text-[var(--s-ink)]";

export function LandingPage({ slug }: { slug: string }) {
  const l = landing(slug);
  const url = `${SITE}/${l.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: l.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 1, name: "Medoro", item: SITE }, { "@type": "ListItem", position: 2, name: l.name, item: url }],
    },
  ];
  const related = LANDING_LINKS.filter(([, path]) => path !== `/${l.slug}`);
  return (
    <div className="site-root bg-white overflow-x-clip">
      <SiteHeader />
      <SiteMotion />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main id="main">
        <section className="relative overflow-hidden">
          <Aurora />
          <FloatingShapes />
          <div className={`relative ${wrap} pt-[clamp(32px,6vw,80px)] pb-14 grid grid-cols-1 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-x-12 gap-y-10 items-center`}>
            <div className="flex flex-col gap-5">
              <nav aria-label="Breadcrumb" className="text-[14px] text-[var(--s-muted)]"><Link href="/" className="hover:text-[var(--s-brand)]">Medoro</Link> <span aria-hidden>/</span> <span>{l.name}</span></nav>
              <span className="site-up text-[14px] font-semibold text-[var(--s-brand)]">{l.eyebrow}</span>
              <h1 className="site-display site-up [--d:1] m-0 text-[clamp(36px,4.8vw,58px)]">{l.h1}</h1>
              <p className="site-up [--d:2] m-0 text-[clamp(16px,1.3vw,18px)] leading-[1.6] text-[var(--s-ink-2)] max-w-[560px]">{l.intro}</p>
              <div className="site-up [--d:3] flex gap-3 flex-wrap pt-1">
                <a href="/trial" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">Start 7-day free trial<ArrowRight size={17} aria-hidden /></a>
                <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[16px] font-semibold transition-colors hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={17} aria-hidden className="text-[#146C43]" />Get a demo on WhatsApp</a>
              </div>
              <p className="site-up [--d:4] m-0 text-[14px] text-[var(--s-muted)]">No card needed. From ₹999 a month, GST included.</p>
            </div>
            <div className="site-up [--d:3] rounded-xl overflow-hidden border border-[var(--s-line)] shadow-[0_24px_60px_-28px_rgba(14,22,20,.45)] bg-white">
              <Image src={l.img[0]} alt={l.img[1]} width={1600} height={l.img[0].includes("dashboard") ? 1000 : 1144} priority sizes="(min-width: 1248px) 610px, (min-width: 1000px) 50vw, calc(100vw - 32px)" className="block w-full h-auto" />
            </div>
          </div>
        </section>

        <section aria-labelledby="features-title" className={`${wrap} py-[clamp(56px,8vw,104px)] flex flex-col gap-10`}>
          <h2 id="features-title" className={h2}>What you get with Medoro</h2>
          <div className="grid gap-x-8 gap-y-10 grid-cols-1 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {l.sections.map((s, i) => (
              <article key={s.h} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-3 border-t border-[var(--s-line)] pt-6">
                <h3 className="m-0 text-[21px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{s.h}</h3>
                <p className="m-0 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{s.p}</p>
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                  {s.points.map((p) => <li key={p} className="flex gap-2 text-[15px] text-[var(--s-ink-2)]"><Check size={16} aria-hidden className="flex-none mt-[3px] text-[var(--s-brand)]" />{p}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(56px,8vw,104px)] grid grid-cols-12 gap-x-6 gap-y-8`}>
            <h2 id="faq-title" className={`${h2} col-span-12 min-[1000px]:col-span-4`}>Common questions</h2>
            <div className="col-span-12 min-[1000px]:col-span-8 flex flex-col">
              {l.faq.map(([q, a]) => (
                <details key={q} className="group border-t border-[var(--s-line)] last:border-b py-5">
                  <summary className="cursor-pointer list-none flex justify-between gap-4 text-[18px] font-semibold text-[var(--s-ink)]">{q}<span aria-hidden className="text-[var(--s-brand)] transition-transform group-open:rotate-45">+</span></summary>
                  <p className="m-0 mt-3 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="more-title" className={`${wrap} py-[clamp(56px,8vw,96px)] flex flex-col gap-8`}>
          <h2 id="more-title" className={h2}>More about Medoro</h2>
          <ul className="m-0 p-0 list-none grid gap-3 grid-cols-1 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-4">
            {related.map(([name, path]) => (
              <li key={path}><Link href={path} className="flex items-center justify-between gap-3 h-full rounded-lg border border-[var(--s-line)] px-4 py-4 text-[16px] font-semibold text-[var(--s-ink)] transition-colors hover:border-[var(--s-brand)] hover:text-[var(--s-brand)]">{name}<ArrowRight size={16} aria-hidden /></Link></li>
            ))}
          </ul>
          <p className="m-0 text-[16px] text-[var(--s-ink-2)]">See <Link href="/pharmacy#pricing" className="underline underline-offset-4">pricing</Link>, how <Link href="/#switching" className="underline underline-offset-4">switching from your current software</Link> works, or <Link href="/" className="underline underline-offset-4">the full product tour</Link>.</p>
        </section>
      </main>
      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}
