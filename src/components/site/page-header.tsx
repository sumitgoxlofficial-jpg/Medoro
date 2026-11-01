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
        <Link href="/signin" className="flex items-center h-11 px-4 max-[400px]:px-3 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] whitespace-nowrap hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]">Log in</Link>
        {cta ? <a href="/trial" className="flex items-center h-11 px-4 max-[400px]:px-3 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold whitespace-nowrap transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white"><span className="max-[520px]:hidden">Start 7-day free trial</span><span className="min-[521px]:hidden">Free trial</span></a> : null}
      </div>
    </header>
  );
}
