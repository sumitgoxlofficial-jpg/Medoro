"use client";
import { useEffect, useState } from "react";

/** Sticky table of contents that highlights the section in view. */
export function Toc({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const h = location.hash.slice(1); if (h) setActive(h);
    const io = new IntersectionObserver((es) => { const v = es.find((e) => e.isIntersecting); if (v) setActive(v.target.id); }, { rootMargin: "-20% 0px -70% 0px" });
    items.forEach((i) => { const el = document.getElementById(i.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page" className="min-[900px]:sticky top-24 flex flex-row flex-wrap min-[900px]:flex-col gap-0.5">
      <span className="text-[13px] font-semibold tracking-[.08em] uppercase text-[var(--s-muted)] px-3 pb-2 w-full">On this page</span>
      {items.map((t) => (
        <a key={t.id} href={`#${t.id}`} onClick={() => setActive(t.id)} aria-current={active === t.id ? "true" : undefined}
          className={`text-[15px] px-3 py-2 rounded-md transition-colors hover:bg-[var(--s-soft)] hover:text-[var(--s-ink)] ${active === t.id ? "text-[var(--s-brand-ink)] bg-[var(--s-brand-tint)] font-semibold" : "text-[var(--s-ink-2)]"}`}>{t.title}</a>
      ))}
    </nav>
  );
}
