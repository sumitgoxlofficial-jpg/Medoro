import Link from "next/link";
import { Info } from "lucide-react";
import type { Block } from "@/data/blog";

/** Heading id from its text ("1. Sell the earliest expiry first" → "sell-the-earliest-expiry-first"). */
export const headingId = (s: string) => s.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Inline text: [label](/path) links and **bold**. Internal links use <Link>; anything else opens normally. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
          const cls = "font-medium text-[var(--s-brand)] underline underline-offset-4 decoration-[var(--s-brand)]/40 hover:decoration-[var(--s-brand)]";
          return link[2].startsWith("/") ? <Link key={i} href={link[2]} className={cls}>{link[1]}</Link> : <a key={i} href={link[2]} className={cls} rel="noopener noreferrer">{link[1]}</a>;
        }
        const bold = /^\*\*([^*]+)\*\*$/.exec(part);
        if (bold) return <strong key={i} className="font-semibold text-[var(--s-ink)]">{bold[1]}</strong>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const p = "m-0 text-[17.5px] leading-[1.75] text-[var(--s-ink-2)]";

/** An article's body. Server component; plain HTML so search engines read it all. */
export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((b, i) => {
        if ("h2" in b) return <h2 key={i} id={headingId(b.h2)} className="scroll-mt-24 m-0 mt-6 text-[clamp(24px,2.6vw,30px)] font-semibold tracking-[-.015em] leading-[1.25] text-[var(--s-ink)]">{b.h2}</h2>;
        if ("h3" in b) return <h3 key={i} className="m-0 mt-2 text-[20px] font-semibold text-[var(--s-ink)]">{b.h3}</h3>;
        if ("p" in b) return <p key={i} className={p}><Inline text={b.p} /></p>;
        if ("ul" in b) return <ul key={i} className="m-0 pl-6 flex flex-col gap-2.5 list-disc marker:text-[var(--s-brand)]">{b.ul.map((li, j) => <li key={j} className={`${p} pl-1`}><Inline text={li} /></li>)}</ul>;
        if ("ol" in b) return <ol key={i} className="m-0 pl-6 flex flex-col gap-3 list-decimal marker:font-semibold marker:text-[var(--s-brand)]">{b.ol.map((li, j) => <li key={j} className={`${p} pl-1`}><Inline text={li} /></li>)}</ol>;
        if ("note" in b) return (
          <aside key={i} className="flex gap-3 rounded-xl border border-[var(--s-brand)]/25 bg-[var(--s-brand-tint)] p-5">
            <Info size={20} aria-hidden className="flex-none mt-[3px] text-[var(--s-brand)]" />
            <p className="m-0 text-[16px] leading-[1.65] text-[var(--s-ink)]"><Inline text={b.note} /></p>
          </aside>
        );
        return (
          <div key={i} className="overflow-x-auto rounded-xl border border-[var(--s-line)]">
            <table className="w-full border-collapse text-left text-[15px]">
              <caption className="caption-top text-left px-4 pt-3 pb-2 text-[13.5px] font-semibold text-[var(--s-muted)]">{b.table.caption}</caption>
              <thead className="bg-[var(--s-soft)]"><tr>{b.table.head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-semibold text-[var(--s-ink)] whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{b.table.rows.map((r, j) => <tr key={j} className="border-t border-[var(--s-line)]">{r.map((c, k) => k === 0 ? <th key={k} scope="row" className="px-4 py-2.5 font-medium text-[var(--s-ink)] align-top">{c}</th> : <td key={k} className="px-4 py-2.5 text-[var(--s-ink-2)] align-top">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
