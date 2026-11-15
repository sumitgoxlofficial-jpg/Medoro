import { ArrowRight, Sparkles } from "lucide-react";

/** Shared styles for the free tools (site palette, 44px+ touch targets). */
export const label = "text-[14px] font-semibold text-[var(--s-ink)]";
export const input = "h-11 w-full min-w-0 rounded-lg border border-[#C9D1CF] bg-white px-3 text-[16px] text-[var(--s-ink)] outline-none transition-colors focus:border-[var(--s-brand)] focus:ring-2 focus:ring-[var(--s-brand)]/20 placeholder:text-[#8A9593]";
export const card = "rounded-xl border border-[var(--s-line)] bg-white p-5 max-[640px]:p-4";
export const btn = "inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-[15px] font-semibold transition-colors";
export const btnPrimary = `${btn} bg-[var(--s-brand)] text-white hover:bg-[var(--s-brand-ink)]`;
export const btnGhost = `${btn} border border-[#C9D1CF] bg-white text-[var(--s-ink)] hover:border-[var(--s-ink)]`;

export function Field({ id, name, hint, children }: { id: string; name: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className={label}>{name}</label>
      {children}
      {hint ? <span id={`${id}-hint`} className="text-[13px] text-[var(--s-muted)]">{hint}</span> : null}
    </div>
  );
}

/**
 * The call to action every free tool carries. From tablet width up it sticks to the bottom of the screen while the
 * tool is in view (clear of the WhatsApp button) and stops at the end of the tool's section; on phones it sits after
 * the tool, so it never covers the inputs. Hidden when printing.
 */
export function ToolCta() {
  return (
    <div className="min-[640px]:sticky bottom-3 z-20 print:hidden min-[640px]:max-[1519px]:pr-[150px]">
      <a href="/trial" className="group flex items-center gap-3 rounded-xl bg-[var(--s-dark)] text-white px-4 py-3 shadow-[0_16px_40px_-16px_rgba(14,22,20,.6)] transition-colors hover:bg-[#0F2A28] hover:text-white">
        <span className="flex-none size-9 rounded-lg bg-white/10 flex items-center justify-center"><Sparkles size={18} aria-hidden className="text-[#8FD3C6]" /></span>
        <span className="flex-1 min-w-0 text-[15px] leading-[1.4]">
          <span className="font-semibold">Want to automate this for 50,000+ medicines?</span>{" "}
          <span className="text-[#C3D3D0]">Try Medoro Cloud Pharmacy ERP for Free.</span>
        </span>
        <span className="flex-none max-[520px]:hidden inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-white text-[var(--s-brand-ink)] text-[14.5px] font-semibold">Start free trial<ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" /></span>
      </a>
    </div>
  );
}
