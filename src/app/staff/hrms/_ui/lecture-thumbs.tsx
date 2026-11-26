"use client";
// Thumbnails for the Sales Academy lectures: one illustration per topic, drawn in SVG (sharp at any size, no image files).
// Each lecture has its own colour scene within the Medoro palette; lessons HR adds later get the generic one. Motion uses
// the HRMS classes (hr-bob, hr-twinkle, hr-drift…), which stop with reduced motion.

type Scene = { from: string; to: string; accent: string; art: React.ReactNode };
const W = "#ffffff", GOLD = "#F5C451", MINT = "#5EEAD4", INK = "#0B3B3A";
const soft = "rgba(255,255,255,.16)", softer = "rgba(255,255,255,.10)";
const Star = ({ x, y, s = 1, c = GOLD, d = "0s" }: { x: number; y: number; s?: number; c?: string; d?: string }) => (
  <path className="hr-twinkle" style={{ animationDelay: d }} transform={`translate(${x} ${y}) scale(${s})`} d="M0-7l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={c} />
);

const SCENES: Record<string, Scene> = {
  welcome: {
    from: "#0B5E5B", to: "#14907F", accent: GOLD,
    art: <>
      <g className="hr-bob"><rect x="182" y="40" width="92" height="88" rx="10" fill={W} /><rect x="182" y="40" width="92" height="24" rx="10" fill={GOLD} /><rect x="182" y="56" width="92" height="8" fill={GOLD} />
        <circle cx="204" cy="38" r="4" fill={INK} /><circle cx="252" cy="38" r="4" fill={INK} />
        <text x="228" y="104" textAnchor="middle" fontSize="34" fontWeight="800" fill="#0B5E5B">1</text><text x="228" y="120" textAnchor="middle" fontSize="9" fontWeight="700" fill="#64748B">DAY</text></g>
      <g className="hr-drift" style={{ ["--dur" as string]: "8s" }}><path d="M226 22l22-9 22 9-22 9z" fill={INK} /><path d="M236 26v7c5 3 19 3 24 0v-7" fill={INK} /><path d="M270 22v11" stroke={GOLD} strokeWidth="2" /></g>
      {[[160, 50, MINT], [292, 70, GOLD], [168, 120, GOLD], [296, 128, MINT], [150, 86, W]].map(([x, y, c], k) => <rect key={k} className="hr-twinkle" style={{ animationDelay: `${k * .4}s` }} x={x as number} y={y as number} width="6" height="10" rx="1.5" fill={c as string} transform={`rotate(${k * 35} ${x} ${y})`} />)}
    </>,
  },
  "intro-medoro": {
    from: "#0B4F6C", to: "#0B5E5B", accent: MINT,
    art: <>
      <g className="hr-bob"><rect x="150" y="34" width="140" height="96" rx="9" fill={W} /><rect x="150" y="34" width="140" height="16" rx="9" fill="#E2E8F0" /><rect x="150" y="44" width="140" height="6" fill="#E2E8F0" />
        <circle cx="160" cy="42" r="2.5" fill="#F28B82" /><circle cx="168" cy="42" r="2.5" fill={GOLD} /><circle cx="176" cy="42" r="2.5" fill="#14B8A6" />
        <image href="/medoro-mark.png" x="160" y="58" width="26" height="22" />
        <rect x="192" y="60" width="50" height="6" rx="3" fill="#0B5E5B" /><rect x="192" y="71" width="34" height="5" rx="2.5" fill="#94A3B8" />
        {[0, 1, 2, 3, 4].map((k) => <rect key={k} x={166 + k * 22} y={124 - [22, 34, 28, 42, 36][k]} width="14" height={[22, 34, 28, 42, 36][k]} rx="3" fill={k === 3 ? GOLD : "#14B8A6"} />)}</g>
      <Star x={302} y={30} /><Star x={136} y={118} s={.8} c={MINT} d="1s" />
    </>,
  },
  "pharmacy-owners": {
    from: "#155E75", to: "#0E7490", accent: GOLD,
    art: <>
      <g className="hr-bob"><path d="M150 62l78-26 78 26z" fill={GOLD} /><rect x="156" y="62" width="144" height="70" rx="4" fill={W} />
        <rect x="166" y="72" width="48" height="58" rx="3" fill="#CFFAFE" /><rect x="222" y="72" width="68" height="28" rx="3" fill="#ECFEFF" />
        {[0, 1, 2].map((k) => <rect key={k} x="170" y={80 + k * 16} width="40" height="4" rx="2" fill="#0E7490" opacity=".5" />)}
        {[0, 1, 2, 3].map((k) => <rect key={k} x={228 + k * 15} y="80" width="10" height="14" rx="2" fill={["#F28B82", "#14B8A6", GOLD, "#60A5FA"][k]} />)}
        <rect x="236" y="106" width="40" height="24" rx="3" fill="#0E7490" /></g>
      <g className="hr-breathe" style={{ transformOrigin: "290px 40px" }}><circle cx="290" cy="40" r="15" fill="#22C55E" /><path d="M290 32v16M282 40h16" stroke={W} strokeWidth="5" strokeLinecap="round" /></g>
      <Star x={140} y={44} c={MINT} />
    </>,
  },
  "features-benefits": {
    from: "#0B5E5B", to: "#0F766E", accent: GOLD,
    art: <>
      {[0, 1, 2].map((k) => <g key={k} className="hr-bob" style={{ animationDelay: `${k * .5}s` }}><rect x="146" y={30 + k * 34} width="62" height="26" rx="7" fill={W} /><rect x="154" y={39 + k * 34} width="32" height="5" rx="2.5" fill="#0F766E" /><rect x="154" y={47 + k * 34} width="20" height="4" rx="2" fill="#94A3B8" /></g>)}
      <path className="hr-draw" pathLength={1} d="M212 43c20 0 22 35 44 35M212 77h44M212 111c20 0 22-33 44-33" stroke={GOLD} strokeWidth="3" fill="none" strokeLinecap="round" />
      <g className="hr-breathe" style={{ transformOrigin: "278px 78px" }}><circle cx="278" cy="78" r="24" fill={GOLD} /><path d="M268 79l7 7 14-15" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
    </>,
  },
  communication: {
    from: "#3730A3", to: "#0B5E5B", accent: MINT,
    art: <>
      <g className="hr-bob"><path d="M150 40h82a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10h-52l-16 14v-14h-14a10 10 0 0 1-10-10v-30a10 10 0 0 1 10-10z" fill={W} />
        {[0, 1, 2].map((k) => <rect key={k} x="160" y={52 + k * 10} width={[62, 48, 54][k]} height="5" rx="2.5" fill="#A5B4FC" />)}</g>
      <g className="hr-bob" style={{ animationDelay: "1s" }}><path d="M300 74h-62a9 9 0 0 0-9 9v26a9 9 0 0 0 9 9h40l14 12v-12h8a9 9 0 0 0 9-9v-26a9 9 0 0 0-9-9z" fill={MINT} />
        <circle cx="252" cy="96" r="4" fill={INK} /><circle cx="266" cy="96" r="4" fill={INK} /><circle cx="280" cy="96" r="4" fill={INK} /></g>
      {[0, 1, 2].map((k) => <path key={k} className="hr-twinkle" style={{ animationDelay: `${k * .35}s` }} d={`M${292 + k * 7} ${36 - k * 2}a${10 + k * 6} ${10 + k * 6} 0 0 1 0 ${22 + k * 10}`} stroke={GOLD} strokeWidth="2.5" fill="none" strokeLinecap="round" />)}
    </>,
  },
  "cold-calling": {
    from: "#0B5E5B", to: "#0369A1", accent: GOLD,
    art: <>
      <g className="hr-swing" style={{ transformOrigin: "210px 40px" }}><rect x="184" y="34" width="56" height="100" rx="11" fill={W} /><rect x="190" y="44" width="44" height="72" rx="5" fill="#E0F2FE" />
        <circle cx="212" cy="66" r="11" fill="#0369A1" /><path d="M207 65c2 4 4 6 8 8l3-3 4 2-1 4c-7 0-14-7-14-14l4-1 2 4z" fill={W} />
        <rect x="198" y="86" width="28" height="5" rx="2.5" fill="#0369A1" opacity=".6" /><rect x="202" y="96" width="20" height="4" rx="2" fill="#94A3B8" /><circle cx="212" cy="125" r="3.5" fill="#CBD5E1" /></g>
      {[0, 1, 2].map((k) => <path key={k} className="hr-twinkle" style={{ animationDelay: `${k * .3}s` }} d={`M${250 + k * 9} ${58 - k * 5}a${14 + k * 9} ${14 + k * 9} 0 0 1 0 ${34 + k * 12}`} stroke={GOLD} strokeWidth="3" fill="none" strokeLinecap="round" />)}
      <g className="hr-bob" style={{ animationDelay: ".6s" }}><circle cx="150" cy="48" r="20" fill={GOLD} /><text x="150" y="53" textAnchor="middle" fontSize="13" fontWeight="800" fill={INK}>20s</text></g>
    </>,
  },
  discovery: {
    from: "#0F766E", to: "#4338CA", accent: GOLD,
    art: <>
      <g className="hr-bob"><rect x="156" y="36" width="80" height="98" rx="8" fill={W} /><rect x="180" y="30" width="32" height="12" rx="4" fill={GOLD} />
        {[0, 1, 2, 3].map((k) => <g key={k}><circle cx="170" cy={60 + k * 18} r="4" fill={k < 2 ? "#14B8A6" : "#CBD5E1"} /><rect x="180" y={57 + k * 18} width={[44, 36, 46, 30][k]} height="5" rx="2.5" fill="#CBD5E1" /></g>)}</g>
      <g className="hr-drift" style={{ ["--dur" as string]: "6s" }}><circle cx="258" cy="70" r="26" fill="rgba(255,255,255,.22)" stroke={W} strokeWidth="7" /><path d="M276 89l20 20" stroke={W} strokeWidth="9" strokeLinecap="round" />
        <text x="258" y="80" textAnchor="middle" fontSize="28" fontWeight="800" fill={GOLD}>?</text></g>
      <Star x={300} y={36} c={MINT} />
    </>,
  },
  "product-demo": {
    from: "#0B5E5B", to: "#1D4ED8", accent: GOLD,
    art: <>
      <g className="hr-bob"><rect x="158" y="34" width="132" height="84" rx="8" fill={W} /><rect x="166" y="42" width="116" height="68" rx="4" fill="#0B5E5B" />
        <path className="hr-draw" pathLength={1} d="M174 96l18-14 16 8 20-22 18 10 22-18" stroke={GOLD} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M144 118h160l-10 12h-140z" fill="#E2E8F0" /></g>
      <g className="hr-breathe" style={{ transformOrigin: "224px 72px" }}><circle cx="224" cy="72" r="15" fill="rgba(255,255,255,.92)" /><path d="M219 64l13 8-13 8z" fill="#0B5E5B" /></g>
      <Star x={310} y={40} /><Star x={140} y={50} s={.8} c={MINT} d=".8s" />
    </>,
  },
  "objection-handling": {
    from: "#7C2D12", to: "#0B5E5B", accent: GOLD,
    art: <>
      <g className="hr-bob" style={{ animationDelay: ".4s" }}><path d="M150 40h70a9 9 0 0 1 9 9v26a9 9 0 0 1-9 9h-46l-14 12v-12h-10a9 9 0 0 1-9-9v-26a9 9 0 0 1 9-9z" fill="#FED7AA" /><text x="185" y="72" textAnchor="middle" fontSize="26" fontWeight="800" fill="#9A3412">?!</text></g>
      <g className="hr-bob"><path d="M262 34l36 12v26c0 24-16 38-36 46-20-8-36-22-36-46v-26z" fill={W} /><path d="M248 74l10 10 20-22" stroke="#0B5E5B" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
      <path className="hr-draw" pathLength={1} d="M200 104c14 18 34 20 50 8" stroke={GOLD} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="1" />
      <Star x={308} y={118} c={MINT} />
    </>,
  },
  "negotiation-closing": {
    from: "#0B5E5B", to: "#B45309", accent: GOLD,
    art: <>
      <g className="hr-bob"><circle cx="268" cy="62" r="34" fill={W} /><circle cx="268" cy="62" r="23" fill="#FDE68A" /><circle cx="268" cy="62" r="12" fill={W} /><circle cx="268" cy="62" r="5" fill="#B45309" /></g>
      <g className="hr-drift" style={{ ["--dur" as string]: "5s" }}><path d="M226 30l38 30" stroke={INK} strokeWidth="3.5" strokeLinecap="round" /><path d="M222 26l-3 9 8-1z" fill={GOLD} /></g>
      <g className="hr-bob" style={{ animationDelay: ".7s" }}>
        <path d="M140 112l26-22 18 6 16-10 22 14-10 14-16-6-14 10-14 0z" fill={W} />
        <path d="M150 104l20 12M164 98l18 12M180 94l16 12" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="132" y="104" width="14" height="22" rx="3" fill={GOLD} transform="rotate(-38 139 115)" /><rect x="214" y="96" width="14" height="22" rx="3" fill={MINT} transform="rotate(38 221 107)" />
      </g>
    </>,
  },
  "crm-reporting": {
    from: "#0B5E5B", to: "#5B21B6", accent: GOLD,
    art: <>
      {[0, 1, 2].map((c) => <g key={c} className="hr-bob" style={{ animationDelay: `${c * .45}s` }}><rect x={144 + c * 46} y="32" width="40" height="96" rx="7" fill={softer} stroke={soft} />
        {Array.from({ length: [3, 2, 1][c] }, (_, k) => <rect key={k} x={149 + c * 46} y={40 + k * 24} width="30" height="18" rx="4" fill={c === 2 ? GOLD : W} />)}</g>)}
      <g className="hr-bob" style={{ animationDelay: ".9s" }}><rect x="284" y="62" width="30" height="66" rx="6" fill={W} />{[0, 1, 2].map((k) => <rect key={k} x={289 + k * 8} y={120 - [16, 28, 40][k]} width="5" height={[16, 28, 40][k]} rx="2" fill={k === 2 ? GOLD : "#7C3AED"} />)}</g>
      <path className="hr-draw" pathLength={1} d="M180 50h10M226 50h10" stroke={MINT} strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  "practical-briefing": {
    from: "#0B5E5B", to: "#9D174D", accent: GOLD,
    art: <>
      <g className="hr-bob"><rect x="196" y="30" width="30" height="54" rx="15" fill={W} /><path d="M184 66a27 27 0 0 0 54 0" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" /><path d="M211 94v18M196 114h30" stroke={W} strokeWidth="5" strokeLinecap="round" />
        {[0, 1, 2].map((k) => <rect key={k} x="203" y={42 + k * 10} width="16" height="3" rx="1.5" fill="#CBD5E1" />)}</g>
      <g className="hr-drift" style={{ ["--dur" as string]: "7s" }}><circle cx="276" cy="56" r="22" fill={W} /><rect x="271" y="28" width="10" height="7" rx="2" fill={GOLD} /><path className="hr-hand" style={{ transformOrigin: "276px 56px" }} d="M276 56v-13" stroke="#9D174D" strokeWidth="3" strokeLinecap="round" /><circle cx="276" cy="56" r="3" fill="#9D174D" /></g>
      {[0, 1, 2, 3, 4].map((k) => <path key={k} transform={`translate(${148 + k * 15} 128) scale(.9)`} d="M0-7l2 5 5 0-4 3 2 5-5-3-5 3 2-5-4-3 5 0z" fill={k < 4 ? GOLD : "rgba(255,255,255,.35)"} />)}
    </>,
  },
};
const GENERIC: Scene = {
  from: "#0B5E5B", to: "#14907F", accent: GOLD,
  art: <g className="hr-bob"><rect x="166" y="36" width="116" height="84" rx="9" fill={W} /><rect x="178" y="50" width="56" height="7" rx="3.5" fill={GOLD} />{[0, 1, 2].map((k) => <rect key={k} x="178" y={66 + k * 12} width={[86, 70, 78][k]} height="5" rx="2.5" fill="#CBD5E1" />)}<Star x={300} y={40} /></g>,
};

/** Sessions without a lesson number get a short word on the cover instead. */
const WORDS: Record<string, string> = { welcome: "Welcome", "features-benefits": "Features", "practical-briefing": "Practical" };

/** A lecture's thumbnail at 16:9: "LESSON 3" (the number in its title) or a short word, the length, and the topic illustration. */
export function LectureThumb({ slug, title, n, minutes, className }: { slug: string; title: string; n: number; minutes: number; className?: string }) {
  const s = SCENES[slug] ?? GENERIC;
  const num = title.match(/^Lesson (\d+)\b/)?.[1];
  const word = num ? "" : WORDS[slug] ?? "";
  const id = `lt-${slug.replace(/[^a-z0-9]/gi, "")}-${n}`;
  return (
    <svg viewBox="0 0 320 180" className={className} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${title} thumbnail`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={s.from} /><stop offset="1" stopColor={s.to} /></linearGradient>
        <pattern id={`${id}-g`} width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.07)" /></pattern>
      </defs>
      <rect width="320" height="180" fill={`url(#${id})`} />
      <rect width="320" height="180" fill={`url(#${id}-g)`} />
      <circle cx="300" cy="-10" r="90" fill="rgba(255,255,255,.06)" />
      <circle cx="40" cy="200" r="80" fill="rgba(0,0,0,.10)" />
      <g fill="none">{s.art}</g>
      <g>
        <text x="20" y="34" fontSize="10" fontWeight="700" letterSpacing="1.6" fill="rgba(255,255,255,.75)">{num ? "LESSON" : "SESSION"}</text>
        {word ? <text x="19" y="72" fontSize="25" fontWeight="800" fill={W}>{word}<tspan fill={s.accent}>.</tspan></text>
          : <text x="18" y="84" fontSize="46" fontWeight="800" fill={W}>{num ?? String(n).padStart(2, "0")}<tspan fill={s.accent}>.</tspan></text>}
        <rect x="18" y="146" width="66" height="20" rx="10" fill="rgba(0,0,0,.28)" />
        <text x="51" y="160" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={W}>{minutes} min</text>
      </g>
    </svg>
  );
}
