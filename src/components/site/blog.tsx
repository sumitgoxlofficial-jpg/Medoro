import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab } from "@/components/site/chrome";
import type { Block, Post } from "@/components/site/blog-data";

/** Blog layout pieces. English only, like the landing pages: Google indexes the site in English. */
export const SITE = process.env.APP_URL ?? "https://medoro.in";
export const wrap = "max-w-[760px] mx-auto px-6 max-[640px]:px-4";
const linkCls = "text-[var(--s-brand)] underline underline-offset-4 hover:text-[var(--s-brand-ink)]";

export const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Text with [label](/path) internal links. */
function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\((\/[^)\s]*)\)/g)) {
    out.push(text.slice(last, m.index));
    out.push(<Link key={m.index} href={m[2]} className={linkCls}>{m[1]}</Link>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}

function BlockView({ b }: { b: Block }) {
  if ("h2" in b) return <h2 className="m-0 mt-6 text-[26px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{b.h2}</h2>;
  if ("p" in b) return <p className="m-0"><Rich text={b.p} /></p>;
  if ("note" in b) return <p className="m-0 flex gap-3 rounded-lg bg-[var(--s-soft)] border border-[var(--s-line)] p-4 text-[16px]"><Info size={18} aria-hidden className="flex-none mt-[3px] text-[var(--s-brand)]" /><span>{b.note}</span></p>;
  const List = "ol" in b ? "ol" : "ul";
  const items = "ol" in b ? b.ol : b.ul;
  return <List className={`m-0 pl-6 flex flex-col gap-2 ${List === "ol" ? "list-decimal" : "list-disc"} marker:text-[var(--s-brand)]`}>{items.map((x) => <li key={x}><Rich text={x} /></li>)}</List>;
}

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-root bg-white overflow-x-clip">
      <SiteHeader />
      <SiteMotion />
      <main id="main">{children}</main>
      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

export function Article({ post }: { post: Post }) {
  return (
    <article className={`${wrap} pt-[clamp(32px,6vw,72px)] pb-[clamp(56px,8vw,96px)] flex flex-col gap-5 text-[17.5px] leading-[1.7] text-[var(--s-ink-2)]`}>
      <nav aria-label="Breadcrumb" className="text-[14px] text-[var(--s-muted)]"><Link href="/" className="hover:text-[var(--s-brand)]">Medoro</Link> <span aria-hidden>/</span> <Link href="/blog" className="hover:text-[var(--s-brand)]">Blog</Link></nav>
      <h1 className="site-display m-0 text-[clamp(32px,4.4vw,48px)] leading-[1.1] text-[var(--s-ink)]">{post.title}</h1>
      <p className="m-0 text-[14px] text-[var(--s-muted)]">Updated <time dateTime={post.updated}>{fmtDate(post.updated)}</time> · {post.minutes} min read · Medoro team</p>
      {post.body.map((b, i) => <BlockView key={i} b={b} />)}
      <div className="mt-8 rounded-xl border border-[var(--s-line)] bg-[var(--s-soft)] p-6 flex flex-col gap-4">
        <p className="m-0 text-[20px] font-semibold text-[var(--s-ink)]">Medoro: billing, stock, GST and accounts for Indian medical stores</p>
        <p className="m-0 text-[16px]">7-day free trial, no card needed. From ₹999 a month, GST included.</p>
        <div className="flex gap-3 flex-wrap">
          <a href="/trial" className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold no-underline hover:bg-[var(--s-brand-ink)] hover:text-white">Start free trial<ArrowRight size={16} aria-hidden /></a>
          <Link href={post.cta.href} className="inline-flex items-center h-11 px-5 rounded-lg border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[15px] font-semibold no-underline hover:border-[var(--s-ink)]">{post.cta.text}</Link>
        </div>
      </div>
    </article>
  );
}
