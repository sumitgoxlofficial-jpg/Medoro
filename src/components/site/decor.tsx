/**
 * Decorative, animated graphics for the public homepage. All are aria-hidden and drawn inline in the
 * site's palette (no downloads). Motion lives in globals.css under "Homepage motion"; the .site-root
 * reduced-motion rule switches every animation off.
 */

const T = "#0B5E5B", T2 = "#14B8A6", T3 = "#8FD3C6", GOLD = "#F5C451", ROSE = "#F28B82";

/** Soft drifting colour blobs and a dot grid behind a section. `dark` for the dark sections. */
export function Aurora({ dark = false }: { dark?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className={`site-dots absolute inset-0 ${dark ? "opacity-[.18]" : "opacity-60"}`} />
      <div className={`site-blob site-blob-a ${dark ? "bg-[#14B8A6]/25" : "bg-[#14B8A6]/15"}`} />
      <div className={`site-blob site-blob-b ${dark ? "bg-[#0EA5E9]/15" : "bg-[#F5C451]/20"}`} />
      <div className={`site-blob site-blob-c ${dark ? "bg-[#4ADE80]/12" : "bg-[#8FD3C6]/25"}`} />
    </div>
  );
}

/** Small pharmacy shapes floating around the hero. */
export function FloatingShapes() {
  const shapes: [string, React.ReactNode][] = [
    // capsule
    ["left-[3%] top-[14%] [--r:-28deg] [--dur:9s] max-[999px]:hidden", <svg key="c" viewBox="0 0 64 28" className="w-14"><rect x="1" y="1" width="62" height="26" rx="13" fill="#fff" stroke={T3} strokeWidth="2" /><path d="M32 1h18a13 13 0 0 1 0 26H32z" fill={T2} /></svg>],
    // plus
    ["left-[46%] top-[6%] [--r:12deg] [--dur:7s] max-[999px]:hidden", <svg key="p" viewBox="0 0 32 32" className="w-8"><path d="M12 2h8v10h10v8H20v10h-8V20H2v-8h10z" fill={T2} opacity=".85" /></svg>],
    // tablet
    ["left-[40%] bottom-[10%] [--r:0deg] [--dur:8s] max-[999px]:hidden", <svg key="t" viewBox="0 0 36 36" className="w-9"><circle cx="18" cy="18" r="16" fill="#fff" stroke={GOLD} strokeWidth="3" /><path d="M8 18h20" stroke={GOLD} strokeWidth="3" strokeLinecap="round" /></svg>],
    // heart pulse
    ["right-[4%] top-[8%] [--r:8deg] [--dur:10s] max-[640px]:hidden", <svg key="h" viewBox="0 0 48 44" className="w-11"><path d="M24 42C8 31 2 23 2 14 2 7 7 2 14 2c4 0 8 2 10 6 2-4 6-6 10-6 7 0 12 5 12 12 0 9-6 17-22 28z" fill={ROSE} /><path d="M8 22h8l3-6 5 12 3-6h12" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>],
    // leaf
    ["left-[8%] bottom-[8%] [--r:-14deg] [--dur:11s] max-[999px]:hidden", <svg key="l" viewBox="0 0 40 40" className="w-9"><path d="M6 34C6 14 18 4 36 4c0 20-12 30-30 30z" fill={T} /><path d="M8 32L30 10" stroke={T3} strokeWidth="2" strokeLinecap="round" /></svg>],
    // rupee coin
    ["right-[44%] bottom-[4%] [--r:0deg] [--dur:9.5s] max-[999px]:hidden", <svg key="r" viewBox="0 0 36 36" className="w-8"><circle cx="18" cy="18" r="16" fill={GOLD} /><circle cx="18" cy="18" r="12" fill="#F8D57E" /><text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="700" fill="#94570A">₹</text></svg>],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {shapes.map(([pos, svg], i) => <div key={i} className={`site-float absolute ${pos}`} style={{ animationDelay: `${-i * 1.3}s` }}>{svg}</div>)}
    </div>
  );
}

/** Coins dripping into a jar that a shield protects: "stop the leaks". For the leaks section. */
export function SavingsArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 260" className={className} aria-hidden focusable="false">
      <rect x="0" y="0" width="360" height="260" rx="28" fill="#F2F9F8" />
      <circle cx="292" cy="62" r="46" fill="#E7F2F0" />
      {/* falling coins */}
      {[[118, 0], [150, 1.1], [182, 2.2]].map(([x, d]) => (
        <g key={x} className="site-coin" style={{ animationDelay: `${d}s` }}>
          <circle cx={x} cy="40" r="11" fill={GOLD} /><circle cx={x} cy="40" r="7.5" fill="#F8D57E" />
          <text x={x} y="44.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#94570A">₹</text>
        </g>
      ))}
      {/* jar */}
      <path d="M96 118h112v96a20 20 0 0 1-20 20h-72a20 20 0 0 1-20-20z" fill="#fff" stroke={T3} strokeWidth="3" />
      <rect x="90" y="106" width="124" height="16" rx="6" fill={T} />
      <g className="site-fill">
        <path d="M99 190h106v24a17 17 0 0 1-17 17h-72a17 17 0 0 1-17-17z" fill={T2} opacity=".9" />
        {[[120, 200], [150, 196], [178, 204], [136, 216], [166, 218]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="8" fill={GOLD} stroke="#D9A93A" strokeWidth="1.5" />)}
      </g>
      {/* shield */}
      <g className="site-bob">
        <path d="M278 120c18 0 30-8 30-8s12 8 30 8v34c0 22-14 36-30 44-16-8-30-22-30-44z" transform="translate(-24 0)" fill={T} />
        <path d="M268 158l10 10 20-22" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* rising arrow */}
      <path className="site-draw" d="M36 210l26-22 20 10 26-30" stroke={T2} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <path d="M100 168l10-2-2 10" stroke={T2} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path className="site-twinkle" d="M310 196l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={GOLD} />
      <path className="site-twinkle [animation-delay:-1.4s]" d="M42 54l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={T2} />
    </svg>
  );
}

/** Partners page: a partner in the middle, linked to pharmacies; ₹ coins travel back along the links. */
export function ReferralArt({ className }: { className?: string }) {
  const stores: [number, number][] = [[60, 52], [300, 52], [40, 190], [320, 190], [180, 236]];
  return (
    <svg viewBox="0 0 360 270" className={className} aria-hidden focusable="false">
      <rect x="0" y="0" width="360" height="270" rx="24" fill="#F2F9F8" />
      <circle cx="180" cy="128" r="70" fill="none" stroke="#CFE6E3" strokeWidth="1.5" strokeDasharray="3 7" className="site-spin" />
      {stores.map(([x, y], i) => (
        <g key={i}>
          <path d={`M180 128L${x} ${y}`} stroke="#8FD3C6" strokeWidth="2" strokeDasharray="5 6" className="site-dash" />
          <circle r="7" fill={GOLD} stroke="#D9A93A" strokeWidth="1.5">
            <animateMotion dur="3.2s" begin={`${i * 0.6}s`} repeatCount="indefinite" path={`M${x} ${y}L180 128`} />
          </circle>
          <g className="site-bob" style={{ animationDelay: `${-i * 0.8}s` }}>
            <rect x={x - 22} y={y - 18} width="44" height="36" rx="7" fill="#fff" stroke="#CFE6E3" strokeWidth="2" />
            <path d={`M${x - 22} ${y - 8}h44`} stroke={T2} strokeWidth="8" />
            <rect x={x - 6} y={y + 2} width="12" height="16" rx="2" fill={T} />
            <path d={`M${x} ${y - 16}v-6M${x - 3} ${y - 19}h6`} stroke={ROSE} strokeWidth="2.4" strokeLinecap="round" />
          </g>
        </g>
      ))}
      <circle cx="180" cy="128" r="34" fill="rgba(20,184,166,.15)" className="site-breathe" />
      <circle cx="180" cy="128" r="26" fill={T} />
      <circle cx="180" cy="120" r="8" fill="#fff" />
      <path d="M166 142c3-9 8-12 14-12s11 3 14 12" fill="#fff" />
      <g className="site-float [--dur:7s]" style={{ transformOrigin: "180px 128px" }}>
        <circle cx="214" cy="96" r="13" fill={GOLD} /><text x="214" y="101" textAnchor="middle" fontSize="13" fontWeight="700" fill="#94570A">₹</text>
      </g>
    </svg>
  );
}
