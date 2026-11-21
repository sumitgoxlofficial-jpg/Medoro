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

/**
 * Homepage "About": the medicine supply chain Medoro serves. Factory → distributor's godown → medical store, joined by a
 * road that trucks drive along, with ₹ coming back the other way.
 */
export function SupplyChainArt({ className }: { className?: string }) {
  const road = "M70 250C150 250 160 172 240 172S330 250 410 250";
  const back = "M410 250C330 250 320 172 240 172S150 250 70 250";
  return (
    <svg viewBox="0 0 480 300" className={className} aria-hidden focusable="false">
      <rect x="0" y="0" width="480" height="300" rx="28" fill="#F2F9F8" />
      {/* sky */}
      <circle cx="404" cy="62" r="22" fill={GOLD} opacity=".9" className="site-breathe" style={{ transformBox: "fill-box" }} />
      <g className="site-float [--dur:12s]"><ellipse cx="90" cy="64" rx="34" ry="12" fill="#fff" /><ellipse cx="108" cy="56" rx="18" ry="12" fill="#fff" /></g>
      <g className="site-float [--dur:14s]" style={{ animationDelay: "-5s" }}><ellipse cx="300" cy="44" rx="26" ry="9" fill="#fff" /><ellipse cx="314" cy="38" rx="14" ry="9" fill="#fff" /></g>
      {/* road */}
      <path d={road} stroke="#DCEDEA" strokeWidth="16" fill="none" strokeLinecap="round" />
      <path d={road} stroke="#fff" strokeWidth="2" fill="none" strokeDasharray="6 8" className="site-dash" />
      {/* factory */}
      <g>
        <rect x="88" y="176" width="13" height="34" fill={T} />
        <circle cx="96" cy="164" r="6" fill="#DCEDEA" className="site-twinkle" />
        <circle cx="106" cy="150" r="8" fill="#E7F2F0" className="site-twinkle [animation-delay:-1.2s]" />
        <path d="M30 250V204l20-14v14l20-14v14l20-14v14l20-14v60z" fill="#fff" stroke={T3} strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="40" y="216" width="14" height="12" rx="2" fill={T3} /><rect x="62" y="216" width="14" height="12" rx="2" fill={T3} />
        <rect x="84" y="226" width="16" height="24" rx="2" fill={T} />
        <g transform="translate(46 236) rotate(-20)"><rect x="-10" y="-4" width="20" height="8" rx="4" fill="#fff" stroke={T2} strokeWidth="1.5" /><path d="M0 -4h6a4 4 0 0 1 0 8H0z" fill={T2} /></g>
      </g>
      {/* distributor's godown */}
      <g>
        <path d="M186 124L240 92l54 32z" fill={T} />
        <rect x="194" y="122" width="92" height="50" fill="#fff" stroke={T3} strokeWidth="2.5" />
        <rect x="222" y="136" width="36" height="36" fill="#E7F2F0" stroke={T3} strokeWidth="2" />
        {[143, 150, 157, 164].map((y) => <path key={y} d={`M222 ${y}h36`} stroke={T3} strokeWidth="1.5" />)}
        <g className="site-bob"><rect x="200" y="152" width="16" height="16" rx="2" fill={GOLD} /><path d="M200 160h16" stroke="#D9A93A" strokeWidth="1.5" /></g>
        <g className="site-bob [animation-delay:-2s]"><rect x="264" y="150" width="16" height="18" rx="2" fill={T2} /><path d="M272 154v10M267 159h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></g>
      </g>
      {/* medical store */}
      <g>
        <rect x="372" y="200" width="76" height="50" fill="#fff" stroke={T3} strokeWidth="2.5" />
        {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={366 + i * 14.67} y="190" width="14.67" height="14" fill={i % 2 ? "#fff" : T2} />)}
        <path d="M366 204h88" stroke={T3} strokeWidth="2" />
        <rect x="380" y="214" width="20" height="16" rx="2" fill="#E7F2F0" stroke={T3} strokeWidth="1.5" />
        <rect x="412" y="216" width="22" height="34" rx="2" fill={T} />
        <g className="site-breathe" style={{ transformBox: "fill-box" }}>
          <circle cx="410" cy="168" r="14" fill={T2} />
          <path d="M410 160v16M402 168h16" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        </g>
        <g className="site-float [--dur:6s]">
          <path d="M448 150c-9-6-12-10-12-15 0-4 3-7 6-7 3 0 5 1 6 4 1-3 3-4 6-4 3 0 6 3 6 7 0 5-3 9-12 15z" fill={ROSE} />
        </g>
      </g>
      {/* trucks heading to the store */}
      {[0, 3.5].map((d) => (
        <g key={d}>
          <animateMotion dur="7s" begin={`${d}s`} repeatCount="indefinite" rotate="auto" path={road} />
          <rect x="-18" y="-17" width="24" height="14" rx="2" fill={T} />
          <path d="M-6 -14v8M-10 -10h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M6 -13h7l5 5v5H6z" fill={T2} />
          <circle cx="-11" cy="-2" r="3.5" fill="#0E1614" /><circle cx="11" cy="-2" r="3.5" fill="#0E1614" />
        </g>
      ))}
      {/* ₹ coming back */}
      <g>
        <animateMotion dur="7s" begin="1.75s" repeatCount="indefinite" path={back} />
        <circle cx="0" cy="-16" r="9" fill={GOLD} stroke="#D9A93A" strokeWidth="1.5" />
        <text x="0" y="-12" textAnchor="middle" fontSize="10" fontWeight="700" fill="#94570A">₹</text>
      </g>
      <path className="site-twinkle" d="M150 120l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={T2} />
      <path className="site-twinkle [animation-delay:-1.4s]" d="M330 120l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={GOLD} />
    </svg>
  );
}

/** Homepage FAQ: a phone with a chat, a question answered by a person. */
export function HelpArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 220" className={className} aria-hidden focusable="false">
      <rect x="0" y="0" width="320" height="220" rx="24" fill="#F2F9F8" />
      <circle cx="250" cy="60" r="40" fill="#E7F2F0" />
      <rect x="110" y="24" width="100" height="180" rx="16" fill={T} />
      <rect x="118" y="38" width="84" height="152" rx="8" fill="#fff" />
      <g className="site-up">
        <rect x="126" y="50" width="52" height="24" rx="10" fill="#E7F2F0" />
        <text x="152" y="67" textAnchor="middle" fontSize="15" fontWeight="700" fill={T}>?</text>
      </g>
      <g className="site-up [--d:2]">
        <rect x="142" y="84" width="52" height="34" rx="10" fill={T2} />
        <path d="M150 95h36M150 103h26" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="site-up [--d:3]">
        <rect x="126" y="128" width="40" height="20" rx="10" fill="#E7F2F0" />
        {[138, 146, 154].map((x, i) => <circle key={x} cx={x} cy="138" r="2.6" fill={T} className="site-twinkle" style={{ animationDelay: `${-i * .4}s` }} />)}
      </g>
      <g className="site-float [--dur:7s] [--r:-8deg]">
        <circle cx="62" cy="76" r="26" fill={GOLD} />
        <text x="62" y="86" textAnchor="middle" fontSize="28" fontWeight="700" fill="#94570A">?</text>
      </g>
      <g className="site-float [--dur:8s] [--r:6deg]" style={{ animationDelay: "-3s" }}>
        <circle cx="262" cy="150" r="24" fill={T2} />
        <path d="M251 150l8 8 14-16" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path className="site-twinkle" d="M54 160l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={T2} />
      <path className="site-twinkle [animation-delay:-1.4s]" d="M270 26l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={GOLD} />
    </svg>
  );
}

/** Small pharmacy icons used by WhiteDecor. */
const ICONS: React.ReactNode[] = [
  // capsule
  <svg key="capsule" viewBox="0 0 64 28" className="w-full"><rect x="1" y="1" width="62" height="26" rx="13" fill="#fff" stroke={T3} strokeWidth="2" /><path d="M32 1h18a13 13 0 0 1 0 26H32z" fill={T2} /></svg>,
  // plus
  <svg key="plus" viewBox="0 0 32 32" className="w-full"><path d="M12 2h8v10h10v8H20v10h-8V20H2v-8h10z" fill={T2} opacity=".75" /></svg>,
  // tablet
  <svg key="tablet" viewBox="0 0 36 36" className="w-full"><circle cx="18" cy="18" r="16" fill="#fff" stroke={GOLD} strokeWidth="3" /><path d="M8 18h20" stroke={GOLD} strokeWidth="3" strokeLinecap="round" /></svg>,
  // heart pulse
  <svg key="heart" viewBox="0 0 48 44" className="w-full"><path d="M24 42C8 31 2 23 2 14 2 7 7 2 14 2c4 0 8 2 10 6 2-4 6-6 10-6 7 0 12 5 12 12 0 9-6 17-22 28z" fill={ROSE} opacity=".85" /><path d="M8 22h8l3-6 5 12 3-6h12" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  // leaf
  <svg key="leaf" viewBox="0 0 40 40" className="w-full"><path d="M6 34C6 14 18 4 36 4c0 20-12 30-30 30z" fill={T} opacity=".85" /><path d="M8 32L30 10" stroke={T3} strokeWidth="2" strokeLinecap="round" /></svg>,
  // rupee coin
  <svg key="coin" viewBox="0 0 36 36" className="w-full"><circle cx="18" cy="18" r="16" fill={GOLD} /><circle cx="18" cy="18" r="12" fill="#F8D57E" /><text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="700" fill="#94570A">₹</text></svg>,
  // medicine bottle
  <svg key="bottle" viewBox="0 0 32 44" className="w-full"><rect x="9" y="2" width="14" height="7" rx="2" fill={T} /><rect x="4" y="9" width="24" height="33" rx="6" fill="#fff" stroke={T3} strokeWidth="2" /><rect x="8" y="20" width="16" height="12" rx="2" fill="#E7F2F0" /><path d="M16 22v8M12 26h8" stroke={T2} strokeWidth="2.4" strokeLinecap="round" /></svg>,
  // bill
  <svg key="bill" viewBox="0 0 32 40" className="w-full"><path d="M3 2h26v36l-4-3-4 3-5-3-5 3-4-3-4 3z" fill="#fff" stroke={T3} strokeWidth="2" strokeLinejoin="round" /><path d="M9 11h14M9 17h14M9 23h8" stroke={T2} strokeWidth="2.4" strokeLinecap="round" /></svg>,
  // carton
  <svg key="box" viewBox="0 0 40 36" className="w-full"><path d="M2 10L20 2l18 8v18l-18 8-18-8z" fill="#F8D57E" stroke="#D9A93A" strokeWidth="2" strokeLinejoin="round" /><path d="M2 10l18 8 18-8M20 18v18" stroke="#D9A93A" strokeWidth="2" /></svg>,
  // blister strip
  <svg key="strip" viewBox="0 0 48 28" className="w-full"><rect x="1" y="1" width="46" height="26" rx="5" fill="#fff" stroke={T3} strokeWidth="2" />{[10, 24, 38].map((x) => <g key={x}><circle cx={x} cy="9" r="4.5" fill={T2} opacity=".8" /><circle cx={x} cy="19" r="4.5" fill={T2} opacity=".8" /></g>)}</svg>,
  // delivery truck
  <svg key="truck" viewBox="0 0 48 30" className="w-full"><rect x="1" y="4" width="28" height="18" rx="3" fill={T} /><path d="M11 9v8M7 13h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /><path d="M29 9h9l8 7v6H29z" fill={T2} /><circle cx="10" cy="24" r="4.5" fill="#0E1614" /><circle cx="37" cy="24" r="4.5" fill="#0E1614" /></svg>,
];

/** Deterministic pseudo-random numbers, so a section looks the same on the server and in the browser. */
function rng(seed: number) {
  let x = (Math.abs(Math.floor(seed)) * 9301 + 49297) % 233280 || 1;
  return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
}

const GLOWS = ["rgba(20,184,166,.14)", "rgba(245,196,81,.17)", "rgba(143,211,198,.24)", "rgba(242,139,130,.10)"];
const HEARTBEAT = "M0 30H160l10-14 10 28 10-40 10 44 10-18h170l8-10 8 20 8-30 8 34 8-14H700l10-14 10 28 10-40 10 44 10-18h170l8-10 8 20 8-30 8 34 8-14H1200";
const STAR = "M0-8l2.2 5.8L8 0l-5.8 2.2L0 8l-2.2-5.8L-8 0l5.8-2.2z";

/**
 * Background graphics and motion for a plain white section: drifting colour glows, a faded dot grid, a heartbeat line
 * that pulses across, a slowly turning dashed ring, twinkling sparkles, bubbles rising in the margins, and pharmacy
 * icons floating at the sides (big ones in the margins on wide screens, small faint ones in the corners on narrower
 * ones). Put it first inside a `relative isolate` section: it spans the full viewport width even when the section is
 * a centred column, and sits behind the content. `v` picks the arrangement, so neighbouring sections differ.
 */
export function WhiteDecor({ v = 0 }: { v?: number }) {
  const r = rng(v * 7 + 3);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const side = (i: number) => (i % 2 ? "right" : "left");
  const glows = [0, 1, 2].map((i) => ({
    pos: [["-left-40 -top-40"], ["-right-40 top-[20%]"], ["left-[30%] bottom-[-14rem]"]][i][0],
    c: GLOWS[(v + i) % GLOWS.length], dur: 18 + i * 5, delay: -(v * 3 + i * 6),
  }));
  const startIcon = Math.floor(r() * ICONS.length);
  const big = [0, 1, 2, 3, 4, 5].map((i) => ({
    icon: ICONS[(startIcon + i * 3) % ICONS.length], side: side(i + v),
    x: 1.5 + r() * 3.5, y: 8 + i * 14 + r() * 8, size: 30 + r() * 20, rot: Math.round(r() * 40 - 20), dur: 7 + r() * 5,
  }));
  const small = [["left-3 top-3"], ["right-3 bottom-3"], ["right-[12%] top-2"]].map(([pos], i) => ({ pos, icon: ICONS[(startIcon + 1 + i * 4) % ICONS.length], rot: Math.round(r() * 30 - 15) }));
  const stars = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i % 2 ? 70 + r() * 27 : 3 + r() * 27, y: 5 + r() * 90, s: .8 + r() * .8, c: pick([T2, GOLD, T3]), d: -r() * 3 }));
  const bubbles = [0, 1, 2, 3, 4, 5].map((i) => ({ side: side(i), x: r() * 7, y: 30 + r() * 65, s: 6 + r() * 10, dur: 7 + r() * 6, d: -r() * 10, c: pick([T3, "#F8D57E", "#CFE6E3"]) }));
  const ecgTop = v % 2 === 0;
  const ring = v % 3;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 -z-10 overflow-hidden">
      <div className="site-dots absolute inset-0 opacity-50" />
      {glows.map((g) => <div key={g.pos} className={`site-glow absolute ${g.pos} size-[36rem] max-w-[85vw] max-h-[85vw] rounded-full`} style={{ background: `radial-gradient(closest-side, ${g.c}, transparent)`, ["--dur" as string]: `${g.dur}s`, animationDelay: `${g.delay}s` }} />)}
      {/* a dashed ring turning slowly in one corner */}
      <svg viewBox="0 0 200 200" className={`site-rot absolute size-[220px] opacity-60 ${["-right-16 -top-16", "-left-20 bottom-[-4rem]", "right-[8%] bottom-[-5rem]"][ring]}`} style={{ ["--dur" as string]: `${40 + ring * 10}s` }}>
        <circle cx="100" cy="100" r="96" fill="none" stroke={T3} strokeWidth="1.5" strokeDasharray="4 10" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="#F8D57E" strokeWidth="1.5" strokeDasharray="2 12" />
        <circle cx="100" cy="4" r="5" fill={T2} /><circle cx="170" cy="100" r="4" fill={GOLD} />
      </svg>
      {/* heartbeat line with a pulse running along it */}
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className={`absolute inset-x-0 h-[60px] w-full opacity-60 ${ecgTop ? "top-1" : "bottom-1"}`}>
        <path d={HEARTBEAT} fill="none" stroke="#E3F0EE" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <path d={HEARTBEAT} fill="none" stroke={T2} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1000} className="site-ecg" style={{ animationDelay: `${-v * 1.3}s` }} />
      </svg>
      {stars.map((st, i) => (
        <svg key={`s${i}`} viewBox="-10 -10 20 20" className="site-twinkle absolute size-4" style={{ left: `${st.x}%`, top: `${st.y}%`, scale: st.s, animationDelay: `${st.d}s` }}><path d={STAR} fill={st.c} /></svg>
      ))}
      {bubbles.map((b, i) => (
        <span key={`b${i}`} className="site-rise absolute rounded-full" style={{ [b.side]: `${b.x}%`, top: `${b.y}%`, width: b.s, height: b.s, background: b.c, ["--dur" as string]: `${b.dur}s`, animationDelay: `${b.d}s` }} />
      ))}
      {big.map((ic, i) => (
        <div key={`i${i}`} className="site-float absolute max-[1279px]:hidden" style={{ [ic.side]: `${ic.x}%`, top: `${ic.y}%`, width: ic.size, ["--r" as string]: `${ic.rot}deg`, ["--dur" as string]: `${ic.dur}s`, animationDelay: `${-i * 1.3 - v}s` }}>{ic.icon}</div>
      ))}
      {small.map((ic, i) => (
        <div key={`m${i}`} className={`site-float absolute ${ic.pos} w-6 opacity-50 min-[1280px]:hidden`} style={{ ["--r" as string]: `${ic.rot}deg`, animationDelay: `${-i * 2 - v}s` }}>{ic.icon}</div>
      ))}
    </div>
  );
}
