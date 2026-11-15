import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CtaBand, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { POSTS_BY_DATE, fmtDate, readingMinutes } from "@/data/blog";
import { HUBS, TOOL_LINKS } from "@/data/site-links";
import { absoluteUrl, itemListSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const metadata = {
  ...pageMetadata({
    title: "Pharmacy Blog: Guides for Indian Chemists & Medical Stores | Medoro",
    description: "Practical guides for Indian pharmacy owners: PTR and PTS, GST on medicines, the Schedule H1 register, expiry loss, starting a medical store and choosing software.",
    path: HUBS.blog,
  }),
  alternates: { canonical: absoluteUrl(HUBS.blog), types: { "application/rss+xml": absoluteUrl(`${HUBS.blog}/rss.xml`) } },
};

const crumbs: Crumb[] = [["Blog", HUBS.blog]];

export default function BlogIndex() {
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[itemListSchema("Medoro blog", POSTS_BY_DATE.map((p) => [p.title, `/blog/${p.slug}`]))]}>
      <Hero crumbs={crumbs} eyebrow="Medoro blog" h1="Guides for pharmacy owners." intro="Practical, plain-language guides on margins, GST, compliance, stock and software for Indian chemists and medical stores, written by the team that builds Medoro." note="" />
      <Section id="articles" title="Latest articles">
        <ul className="m-0 p-0 list-none grid gap-5 grid-cols-1 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
          {POSTS_BY_DATE.map((p, i) => (
            <li key={p.slug} data-reveal style={{ ["--d" as string]: i % 3 }}>
              <article className="site-lift group relative h-full flex flex-col gap-3 rounded-xl border border-[var(--s-line)] bg-white p-6 transition-colors hover:border-[var(--s-brand)]">
                <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-brand)]">{p.category}</span>
                <h3 className="m-0 text-[20px] font-semibold leading-[1.3] text-[var(--s-ink)] group-hover:text-[var(--s-brand)]">
                  <Link href={`/blog/${p.slug}`} className="after:absolute after:inset-0">{p.h1}</Link>
                </h3>
                <p className="m-0 text-[15px] leading-[1.6] text-[var(--s-ink-2)] flex-1">{p.description}</p>
                <span className="flex items-center justify-between gap-3 text-[13.5px] text-[var(--s-muted)]">
                  <span><time dateTime={p.updated ?? p.published}>{fmtDate(p.updated ?? p.published)}</time> · {readingMinutes(p)} min read</span>
                  <ArrowRight size={16} aria-hidden className="text-[var(--s-brand)]" />
                </span>
              </article>
            </li>
          ))}
        </ul>
        <p className="m-0 text-[14px] text-[var(--s-muted)]">Follow new articles with the <a href={`${HUBS.blog}/rss.xml`} className="underline underline-offset-4">RSS feed</a>.</p>
      </Section>
      <Section id="tools" title="Free pharmacy tools" soft>
        <LinkGrid links={TOOL_LINKS} />
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}
