import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "./brand";

/** Slim header for secondary site pages (/start, /legal). */
export function PageHeader({ cta = true }: { cta?: boolean }) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 supports-[backdrop-filter]:bg-white/85 backdrop-blur border-b border-[var(--s-line)]">
      <div className="max-w-[1200px] mx-auto h-16 px-6 flex items-center gap-4 max-[640px]:px-4">
        <Link href="/" aria-label="Medoro home" className="flex-none"><Wordmark size={21} /></Link>
        <Link href="/" className="ml-auto flex gap-1.5 items-center h-11 px-3 rounded-md text-[15px] font-medium text-[var(--s-ink-2)] hover:text-[var(--s-ink)] hover:bg-[var(--s-soft)]"><ArrowLeft size={16} aria-hidden /><span className="max-[420px]:sr-only">Back to home</span></Link>
        {cta ? <Link href="/start" className="flex items-center h-11 px-4 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">Start free trial</Link> : null}
      </div>
    </header>
  );
}
