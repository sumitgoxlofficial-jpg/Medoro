import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { POSTS } from "@/components/site/blog-data";
import { BlogShell, SITE, fmtDate } from "@/components/site/blog";

const TITLE = "Pharmacy Guides: GST, Expiry, Billing and Compliance";
const DESC = "Practical guides for Indian medical store owners: GST on medicines, GST returns, Schedule H1 rules, reducing expiry loss and choosing pharmacy software.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | Medoro Blog` },
  description: DESC,
  alternates: { canonical: "/blog" },
  openGraph: { type: "website", url: "/blog", siteName: "Medoro", title: TITLE, description: DESC, locale: "en_IN" },
};

export default function BlogIndex() {
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Blog", name: "Medoro Blog", url: `${SITE}/blog`, description: DESC,
    blogPost: POSTS.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: p.published, dateModified: p.updated })),
  };
  return (
    <BlogShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="max-w-[1000px] mx-auto px-6 max-[640px]:px-4 pt-[clamp(32px,6vw,72px)] pb-[clamp(56px,8vw,96px)] flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <span className="text-[14px] font-semibold text-[var(--s-brand)]">Medoro Blog</span>
          <h1 className="site-display m-0 text-[clamp(34px,4.6vw,54px)] text-[var(--s-ink)]">Guides for medical store owners</h1>
          <p className="m-0 text-[18px] leading-[1.6] text-[var(--s-ink-2)] max-w-[640px]">GST, expiry, prescriptions and the day-to-day running of an Indian pharmacy, explained plainly.</p>
        </header>
        <ul className="m-0 p-0 list-none flex flex-col">
          {POSTS.map((p) => (
            <li key={p.slug} className="border-t border-[var(--s-line)] last:border-b">
              <Link href={`/blog/${p.slug}`} className="group flex flex-col gap-2 py-7 px-3 -mx-3 no-underline transition-colors hover:bg-[var(--s-soft)]">
                <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-[var(--s-ink)] group-hover:text-[var(--s-brand)]">{p.title}</h2>
                <p className="m-0 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{p.description}</p>
                <span className="flex items-center gap-2 text-[14px] text-[var(--s-muted)]">{fmtDate(p.updated)} · {p.minutes} min read<ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-1" /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </BlogShell>
  );
}
