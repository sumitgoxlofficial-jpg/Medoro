/**
 * Decorative graphics for the HRMS sign-in page: a team circle with orbiting HR icons and floating "live" cards
 * (check-in, leave, payslip, tasks). aria-hidden; motion comes from globals.css and stops with reduced motion
 * (.hr-motion rule).
 */
const T2 = "#14B8A6", T3 = "#8FD3C6", GOLD = "#F5C451", ROSE = "#F28B82";

export function TeamOrbit({ className }: { className?: string }) {
  const people: [number, number, string, string][] = [[200, 92, "#2459C9", "AK"], [296, 170, "#0A9A80", "SR"], [250, 290, "#E08A1E", "PM"], [140, 284, "#B4479A", "NV"], [104, 168, T2, "RJ"]];
  return (
    <svg viewBox="0 0 400 380" className={className} aria-hidden focusable="false">
      <circle cx="200" cy="190" r="150" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1.5" strokeDasharray="4 8" className="hr-spin" />
      <circle cx="200" cy="190" r="104" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1.5" className="hr-spin-rev" strokeDasharray="2 10" />
      {/* centre: the Medoro team */}
      <circle cx="200" cy="190" r="52" fill="rgba(20,184,166,.18)" className="hr-pulse" />
      <circle cx="200" cy="190" r="38" fill="#fff" />
      <path d="M200 172v36M182 190h36" stroke="#0B5E5B" strokeWidth="9" strokeLinecap="round" />
      {/* people around the circle */}
      {people.map(([x, y, c, n], i) => (
        <g key={n} className="hr-bob" style={{ animationDelay: `${-i * 0.7}s` }}>
          <path d={`M200 190L${x} ${y}`} stroke="rgba(255,255,255,.16)" strokeWidth="1.5" />
          <circle cx={x} cy={y} r="22" fill={c} stroke="#0B5E5B" strokeWidth="4" />
          <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Inter, system-ui, sans-serif">{n}</text>
        </g>
      ))}
      {/* orbiting HR icons */}
      <g className="hr-orbit">
        <g transform="translate(350 190)"><g className="hr-counter"><circle r="16" fill={GOLD} /><text y="5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#94570A">₹</text></g></g>
        <g transform="translate(50 190)"><g className="hr-counter"><circle r="16" fill={ROSE} /><path d="M-6 0l4 4 8-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g></g>
        <g transform="translate(200 40)"><g className="hr-counter"><circle r="16" fill={T3} /><circle r="7" fill="none" stroke="#0B5E5B" strokeWidth="2.4" /><path d="M0-3v3l2 2" stroke="#0B5E5B" strokeWidth="2" strokeLinecap="round" /></g></g>
      </g>
      <path className="hr-twinkle" d="M340 70l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={GOLD} />
      <path className="hr-twinkle" style={{ animationDelay: "-1.3s" }} d="M60 320l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={T2} />
    </svg>
  );
}

/** Small cards that pop in around the illustration and bob. */
export const HR_CARDS: [string, string, string, string][] = [
  ["✓", "Checked in · 9:02 AM", "#DCF2E7", "-left-[8%] top-0"],
  ["🌴", "Leave approved", "#FDF2E1", "-right-[10%] top-[14%]"],
  ["₹", "Payslip for October is ready", "#FFF4D6", "-left-[10%] bottom-[10%]"],
  ["☑", "3 tasks done today", "#E7F2F0", "-right-[6%] -bottom-[2%]"],
];

/** An employee ID badge on a lanyard that swings gently above the sign-in title. */
export function IdBadge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 150" className={className} aria-hidden focusable="false">
      <g className="hr-swing">
        <path d="M44 0l16 42L76 0" stroke="#14B8A6" strokeWidth="7" fill="none" strokeLinejoin="round" />
        <rect x="52" y="38" width="16" height="12" rx="3" fill="#94A3B8" />
        <rect x="20" y="46" width="80" height="100" rx="12" fill="#fff" stroke="#CFE6E3" strokeWidth="2" />
        <rect x="20" y="46" width="80" height="24" rx="12" fill="#0B5E5B" />
        <rect x="20" y="58" width="80" height="12" fill="#0B5E5B" />
        <path d="M56 58h8M60 54v8" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="92" r="14" fill="#E7F2F0" />
        <circle cx="60" cy="88" r="6" fill="#0B5E5B" />
        <path d="M49 102c2-7 7-9 11-9s9 2 11 9" fill="#0B5E5B" />
        <rect x="36" y="114" width="48" height="6" rx="3" fill="#CBD5E1" />
        <rect x="44" y="126" width="32" height="5" rx="2.5" fill="#E2E8F0" />
      </g>
    </svg>
  );
}

/** Faint HR icons drifting around the white sign-in side. */
export function SideIcons() {
  const s = { fill: "none", stroke: "#14B8A6", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const icons: [string, React.ReactNode][] = [
    ["left-[7%] top-[12%] [--dur:9s]", <svg key="cal" viewBox="0 0 24 24" className="size-10" {...s}><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M8 2v4M16 2v4M3 10h18M8 15h2M14 15h2" /></svg>],
    ["right-[8%] top-[9%] [--dur:11s]", <svg key="clk" viewBox="0 0 24 24" className="size-11" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>],
    ["left-[10%] bottom-[14%] [--dur:10s]", <svg key="brief" viewBox="0 0 24 24" className="size-10" {...s}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></svg>],
    ["right-[9%] bottom-[12%] [--dur:8.5s]", <svg key="rupee" viewBox="0 0 24 24" className="size-11" {...s} stroke="#E0A82E"><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M13 8c2 0 2 3 0 3h-4l4 5" /></svg>],
    ["right-[16%] top-[46%] [--dur:12s] max-[1200px]:hidden", <svg key="chk" viewBox="0 0 24 24" className="size-8" {...s}><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>],
    ["left-[14%] top-[44%] [--dur:10.5s] max-[1200px]:hidden", <svg key="plus" viewBox="0 0 24 24" className="size-8" {...s} stroke="#F28B82"><path d="M12 5v14M5 12h14" /></svg>],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 max-[640px]:hidden">
      <div className="hr-corner absolute left-0 top-0 size-48" />
      <div className="hr-corner absolute right-0 bottom-0 size-56 rotate-180" />
      {icons.map(([pos, svg], i) => <div key={i} className={`hr-drift absolute opacity-40 ${pos}`} style={{ animationDelay: `${-i * 1.4}s` }}>{svg}</div>)}
    </div>
  );
}
