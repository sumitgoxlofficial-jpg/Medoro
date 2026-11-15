import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, CtaBand, FaqSection, LinkGrid, MarketingShell, Section, wrap } from "@/components/seo/blocks";
import { ArticleBody, headingId } from "@/components/seo/article-body";
import { Aurora } from "@/components/site/decor";
import { POSTS, POSTS_BY_DATE, fmtDate, postBySlug, readingMinutes, wordCount } from "@/data/blog";
import { featureBySlug } from "@/data/features";
import { HUBS } from "@/data/site-links";
import { toolBySlug } from "@/data/tools";
import { articleSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => POSTS.map((p) => ({ slug: p.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = postBySlug((await params).slug);
  if (!p) return {};
  return pageMetadata({ title: `${p.title} | Medoro`, description: p.description, path: `/blog/${p.slug}`, keywords: p.keywords, type: "article", published: p.published, modified: p.updated });
}

export default async function BlogPost({ params }: Props) {
  const p = postBySlug((await params).slug);
  if (!p) notFound();
  const path = `/blog/${p.slug}`;
  const crumbs: Crumb[] = [["Blog", HUBS.blog], [p.title, path]];
  const toc = p.body.flatMap((b) => ("h2" in b ? [b.h2] : []));
  const next = [
    ...p.tools.map((s) => toolBySlug(s)!).map((t) => [t.name, `/tools/${t.slug}`, "Free tool"] as [string, string, string]),
    ...p.features.map((s) => featureBySlug(s)!).map((f) => [f.name, `/features/${f.slug}`, "Medoro feature"] as [string, string, string]),
  ];
  const more = POSTS_BY_DATE.filter((x) => x.slug !== p.slug).slice(0, 3).map((x) => [x.title, `/blog/${x.slug}`, x.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[articleSchema({ headline: p.title, description: p.description, path, published: p.published, modified: p.updated, keywords: p.keywords, section: p.category, wordCount: wordCount(p) })]}>
      <article>
        <header className="relative overflow-hidden border-b border-[var(--s-line)]">
          <Aurora />
          <div className={`relative ${wrap} pt-[clamp(28px,5vw,64px)] pb-10 flex flex-col gap-5 max-w-[880px] min-[1248px]:max-w-[1200px]`}>
            <Breadcrumbs crumbs={crumbs} />
            <span className="text-[14px] font-semibold text-[var(--s-brand)]">{p.category}</span>
            <h1 className="site-display m-0 text-[clamp(32px,4.2vw,52px)] max-w-[860px]">{p.h1}</h1>
            <p className="m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.65] text-[var(--s-ink-2)] max-w-[760px]">{p.lede}</p>
            <p className="m-0 text-[14px] text-[var(--s-muted)]">
              By the Medoro team · <time dateTime={p.published}>{fmtDate(p.published)}</time>
              {p.updated ? <> · Updated <time dateTime={p.updated}>{fmtDate(p.updated)}</time></> : null} · {readingMinutes(p)} min read
            </p>
          </div>
        </header>
        <div className={`${wrap} py-[clamp(40px,6vw,72px)] grid gap-10 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_260px] items-start`}>
          <div className="min-w-0 max-w-[760px]"><ArticleBody blocks={p.body} /></div>
          {toc.length > 2 ? (
            <nav aria-label="On this page" className="max-[1099px]:order-first max-[1099px]:max-w-[760px] min-[1100px]:sticky min-[1100px]:top-24 rounded-xl border border-[var(--s-line)] bg-[var(--s-soft)] p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)]">On this page</span>
              <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
                {toc.map((h) => <li key={h}><a href={`#${headingId(h)}`} className="text-[14.5px] leading-[1.4] text-[var(--s-ink-2)] hover:text-[var(--s-brand)]">{h}</a></li>)}
              </ol>
            </nav>
          ) : null}
        </div>
      </article>

      <FaqSection faq={p.faq} title="Frequently asked questions" />

      <Section id="next" title="Put it into practice">
        <LinkGrid links={next} />
      </Section>

      <Section id="more" title="More from the blog" soft>
        <LinkGrid links={more} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]"><Link href={HUBS.blog} className="underline underline-offset-4">All articles</Link></p>
      </Section>

      <CtaBand />
    </MarketingShell>
  );
}
