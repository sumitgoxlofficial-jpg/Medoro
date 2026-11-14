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
