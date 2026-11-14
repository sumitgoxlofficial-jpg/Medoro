import type { ReactNode } from "react";

/**
 * A slim motivational band between homepage sections: a small drawn graphic, one encouraging line and a
 * short follow-up. Graphics are inline SVG in the site's teal palette (decorative, aria-hidden), and float
 * gently with the .mo-float animation from globals.css (off with reduced motion).
 */
export type MotivationArt = "sunrise" | "plant" | "rocket" | "steps" | "trophy";

const T = "#0B5E5B", T2 = "#14B8A6", T3 = "#8FD3C6", GOLD = "#F5C451", ROSE = "#F28B82";

const ART: Record<MotivationArt, ReactNode> = {
  // A sun rising over a pharmacy shutter: a fresh start every morning.
  sunrise: (
    <>
      <circle cx="60" cy="60" r="56" fill="#fff" stroke="#CFE6E3" strokeWidth="1.5" />
      <g className="mo-float"><circle cx="60" cy="58" r="20" fill={GOLD} />
        {[0, 45, 90, 135, 180].map((a) => <rect key={a} x="58" y="22" width="4" height="10" rx="2" fill={GOLD} transform={`rotate(${a - 90} 60 58)`} />)}
      </g>
      <rect x="22" y="64" width="76" height="34" rx="4" fill={T} />
      <path d="M26 72h68M26 79h68M26 86h68M26 93h68" stroke={T2} strokeWidth="2" />
      <rect x="50" y="56" width="20" height="10" rx="2" fill="#fff" /><path d="M60 58v6M57 61h6" stroke={T} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  // A seedling sprouting from a coin: small savings grow.
  plant: (
    <>
      <circle cx="60" cy="60" r="56" fill="#fff" stroke="#CFE6E3" strokeWidth="1.5" />
      <ellipse cx="60" cy="92" rx="26" ry="8" fill={GOLD} /><ellipse cx="60" cy="88" rx="26" ry="8" fill="#F8D57E" />
      <text x="60" y="92" textAnchor="middle" fontSize="11" fontWeight="700" fill="#94570A">₹</text>
      <path d="M60 84V50" stroke={T} strokeWidth="4" strokeLinecap="round" />
      <g className="mo-float"><path d="M60 58c-18 0-26-10-26-24 16 0 26 8 26 24z" fill={T2} /><path d="M60 50c0-16 10-26 28-26 0 16-10 26-28 26z" fill={T} /></g>
    </>
  ),
  // A rocket lifting off: the fastest counter in town.
  rocket: (
    <>
      <circle cx="60" cy="60" r="56" fill="#fff" stroke="#CFE6E3" strokeWidth="1.5" />
      <g className="mo-float" transform="rotate(35 60 60)">
        <path d="M60 18c14 12 18 30 14 52H46c-4-22 0-40 14-52z" fill="#fff" stroke={T} strokeWidth="3" />
        <circle cx="60" cy="44" r="7" fill={T2} stroke={T} strokeWidth="3" />
        <path d="M46 60l-10 14h12M74 60l10 14H72" fill={T} />
        <path d="M52 72c2 12 6 18 8 22 2-4 6-10 8-22z" fill={GOLD} /><path d="M56 72c1 7 3 11 4 14 1-3 3-7 4-14z" fill={ROSE} />
      </g>
      <circle cx="26" cy="34" r="2.5" fill={T3} /><circle cx="94" cy="88" r="3" fill={T3} /><circle cx="90" cy="26" r="2" fill={GOLD} />
    </>
  ),
  // Steps up to a flag: one afternoon at a time.
  steps: (
    <>
      <circle cx="60" cy="60" r="56" fill="#fff" stroke="#CFE6E3" strokeWidth="1.5" />
      <path d="M20 96h24V80h20V64h20V48h16v48z" fill={T} />
      <path d="M20 96h24V80h20V64h20V48h16" stroke={T2} strokeWidth="3" fill="none" strokeLinejoin="round" />
      <g className="mo-float"><path d="M92 48V18" stroke={T} strokeWidth="3" strokeLinecap="round" /><path d="M93 19h20l-6 7 6 7H93z" fill={GOLD} /></g>
      <circle cx="34" cy="70" r="6" fill={ROSE} /><path d="M34 76v12M28 82h12" stroke={ROSE} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  // A trophy with a plus: winning by caring.
  trophy: (
    <>
      <circle cx="60" cy="60" r="56" fill="#fff" stroke="#CFE6E3" strokeWidth="1.5" />
      <g className="mo-float">
        <path d="M40 28h40v18c0 14-9 24-20 24S40 60 40 46z" fill={GOLD} />
        <path d="M40 34H28c0 12 6 18 14 18M80 34h12c0 12-6 18-14 18" stroke={GOLD} strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M60 38v18M51 47h18" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      </g>
      <rect x="54" y="70" width="12" height="12" fill="#D9A93A" />
      <rect x="40" y="82" width="40" height="12" rx="3" fill={T} />
      <path d="M22 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM98 70l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill={T2} />
    </>
  ),
};

export function MotivationStrip({ art, line, sub, flip = false }: { art: MotivationArt; line: string; sub: string; flip?: boolean }) {
  return (
    <aside aria-label={line} className="max-w-[1200px] mx-auto px-6 max-[640px]:px-4 py-[clamp(28px,4vw,48px)]">
      <div data-reveal className={`flex items-center gap-[clamp(16px,3vw,36px)] rounded-2xl bg-gradient-to-r from-[#F2F9F8] to-[#E7F2F0] border border-[#CFE6E3] px-[clamp(18px,4vw,48px)] py-[clamp(18px,3vw,32px)] max-[560px]:flex-col max-[560px]:text-center ${flip ? "flex-row-reverse" : ""}`}>
        <svg viewBox="0 0 120 120" className="flex-none size-[clamp(84px,10vw,120px)]" aria-hidden focusable="false">{ART[art]}</svg>
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <p className="site-display m-0 text-[clamp(22px,2.6vw,32px)] text-[var(--s-ink)]">{line}</p>
          <p className="m-0 text-[clamp(15px,1.3vw,17px)] text-[var(--s-ink-2)]">{sub}</p>
        </div>
      </div>
    </aside>
  );
}
