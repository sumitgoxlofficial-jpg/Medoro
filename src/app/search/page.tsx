import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { Breadcrumbs, CtaBand, LinkGrid, MarketingShell, wrap } from "@/components/seo/blocks";
import { LANDING_LINKS } from "@/components/site/landing-links";
import { searchSite } from "@/data/site-search";
import { pageMetadata, type Crumb } from "@/lib/seo";

/**
 * Site search (/search?q=…): the address the site-wide WebSite structured data gives search engines as Medoro's
 * own search (SearchAction in src/lib/seo.ts). Result pages are kept out of the index; their links are followed.
 */
export const metadata = pageMetadata({
  title: "Search Medoro | Medoro",
  description: "Search the Medoro website: medical billing SaaS, pharmacy billing and stock software, features, comparisons, free tools and guides.",
  path: "/search",
  noindex: true,
});

const crumbs: Crumb[] = [["Search", "/search"]];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, 120);
  const hits = searchSite(q);
  return (
    <MarketingShell crumbs={crumbs}>
      <section className={`${wrap} pt-[clamp(28px,5vw,72px)] pb-[clamp(56px,8vw,104px)] flex flex-col gap-8`}>
        <Breadcrumbs crumbs={crumbs} />
        <h1 className="site-display m-0 text-[clamp(34px,4.6vw,56px)]">{q ? `Results for “${q}”` : "Search Medoro"}</h1>
        <form action="/search" method="get" role="search" className="flex gap-3 max-w-[720px] max-[520px]:flex-col">
          <label htmlFor="site-q" className="sr-only">Search the Medoro website</label>
          <div className="relative flex-1 min-w-0">
            <Search size={18} aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--s-muted)]" />
            <input id="site-q" name="q" type="search" defaultValue={q} required maxLength={120} placeholder="GST billing, expiry, Marg alternative…" className="w-full h-12 pl-11 pr-4 rounded-lg border border-[#C9D1CF] bg-white text-[16px] text-[var(--s-ink)] placeholder:text-[var(--s-muted)]" />
          </div>
          <button type="submit" className="h-12 px-6 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold cursor-pointer transition-colors hover:bg-[var(--s-brand-ink)]">Search</button>
        </form>

        {q ? (
          hits.length ? (
            <>
              <p className="m-0 text-[15px] text-[var(--s-muted)]" role="status">{hits.length} {hits.length === 1 ? "page" : "pages"} found</p>
              <ol className="m-0 p-0 list-none flex flex-col max-w-[820px] border-t border-[var(--s-line)]">
                {hits.map((h) => (
                  <li key={h.path} className="border-b border-[var(--s-line)]">
                    <Link href={h.path} className="group flex flex-col gap-1.5 py-5">
                      <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)]">{h.kind}</span>
                      <span className="flex items-center gap-2 text-[19px] font-semibold text-[var(--s-ink)] group-hover:text-[var(--s-brand)]">{h.name}<ArrowRight size={16} aria-hidden className="flex-none" /></span>
                      <span className="text-[16px] leading-[1.55] text-[var(--s-ink-2)]">{h.description}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="m-0 text-[17px] text-[var(--s-ink-2)]" role="status">No pages match “{q}”. Try a shorter phrase, or start from one of these.</p>
          )
        ) : null}

        {!hits.length ? <LinkGrid links={LANDING_LINKS} cols={4} /> : null}
      </section>
      <CtaBand />
    </MarketingShell>
  );
}
