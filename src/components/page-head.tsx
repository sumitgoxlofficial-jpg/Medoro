import type { LucideIcon } from "lucide-react";
import { tx } from "@/lib/tx";

const STAR = "M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z";

/**
 * A page's title and one-line purpose. With `icon` it becomes the teal header strip used on the counter tabs: the
 * icon in a bobbing tile, a large faint copy drifting on the right, a dotted ring and two twinkles (all aria-hidden;
 * motion stops with reduced motion through the .app-motion rule on the shell's main area).
 */
export function PageHead({ title, sub, right, icon: Icon }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; icon?: LucideIcon }) {
  if (Icon) {
    return (
      <div className="app-up app-welcome relative overflow-hidden rounded-xl text-white flex items-center gap-3 flex-wrap mb-5 max-w-[1400px] px-[clamp(16px,2.4vw,22px)] py-4">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="app-glow" />
          <div className="absolute -right-10 -top-12 size-44 rounded-full border border-dashed border-white/15" />
          <Icon size={104} strokeWidth={1.2} className="app-drift absolute right-8 -bottom-7 text-white/10 [--dur:13s]" />
          <svg viewBox="0 0 10 10" className="app-twinkle absolute right-[30%] top-2.5 size-2.5"><path d={STAR} fill="#F5C451" /></svg>
          <svg viewBox="0 0 10 10" className="app-twinkle absolute right-[44%] bottom-2.5 size-2 [animation-delay:-1.4s]"><path d={STAR} fill="#5EEAD4" /></svg>
        </div>
        <span aria-hidden className="app-bob relative flex-none size-12 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center"><Icon size={24} /></span>
        <div className="relative flex flex-col gap-0.5 flex-1 min-w-[200px]">
          <h1 className="m-0 text-[21px] font-semibold tracking-[-.015em] leading-tight">{tx(title)}</h1>
          {sub ? <div className="text-[13px] text-white/80">{tx(sub)}</div> : null}
        </div>
        {right ? <div className="relative">{right}</div> : null}
      </div>
    );
  }
  return (
    <div className="flex items-end gap-4 mb-5 max-w-[1400px] flex-wrap">
      <div className="flex flex-col gap-1 flex-1 min-w-0 basis-full sm:basis-auto sm:min-w-[240px]">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-.015em] leading-tight">{tx(title)}</h1>
        {sub ? <div className="text-[13px] text-faint">{tx(sub)}</div> : null}
      </div>
      {right}
    </div>
  );
}
