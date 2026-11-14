"use client";
import type { IconId } from "@/staff/hrms/constants";

/**
 * The teal header strip at the top of every HRMS screen: the screen's title and purpose on the left and a small
 * animated scene on the right that matches what the screen is for (a ticking clock for attendance, a plane on its way
 * for leave, coins for pay, and so on). Decorative parts are aria-hidden; motion lives in globals.css under
 * "HRMS screen heroes" and stops with reduced motion.
 */
export function ScreenHero({ icon, title, sub }: { icon: IconId; title: string; sub: string }) {
  return (
    <div className="hr-hero relative overflow-hidden rounded-2xl text-white flex items-center gap-4 px-6 py-4 max-[560px]:px-4 min-h-[92px]" style={{ background: "linear-gradient(135deg,#0B5E5B,#14907F)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="hr-dots absolute inset-0" />
        <div className="hr-sheen absolute inset-y-0 -left-1/3 w-1/3" />
        <svg viewBox="0 0 10 10" className="hr-twinkle absolute right-[36%] top-3 size-2.5"><path d={STAR} fill="#F5C451" /></svg>
        <svg viewBox="0 0 10 10" className="hr-twinkle absolute right-[48%] bottom-3 size-2 [animation-delay:-1.4s]"><path d={STAR} fill="#5EEAD4" /></svg>
      </div>
      <div className="relative flex-1 min-w-0">
        <h1 className="text-[21px] font-bold leading-tight">{title}</h1>
        {sub ? <p className="text-[13px] text-white/80 mt-0.5">{sub}</p> : null}
      </div>
      <svg aria-hidden viewBox="0 0 140 80" className="relative flex-none w-[150px] h-auto max-[560px]:w-[96px] max-[380px]:hidden" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <Scene icon={icon} />
      </svg>
    </div>
  );
}

const STAR = "M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z";
const GOLD = "#F5C451", MINT = "#5EEAD4", ROSE = "#F28B82";
const soft = "rgba(255,255,255,.16)";

function Scene({ icon }: { icon: IconId }) {
  switch (icon) {
    case "clock": // attendance: a clock whose hands turn, with a check-in tick popping beside it
      return <>
        <circle cx="62" cy="40" r="28" fill={soft} />
        <circle cx="62" cy="40" r="28" />
        {[0, 90, 180, 270].map((a) => <path key={a} d="M62 16v4" transform={`rotate(${a} 62 40)`} />)}
        <path className="hr-hand-slow" d="M62 40V26" strokeWidth="3" />
        <path className="hr-hand" d="M62 40h14" stroke={GOLD} />
        <circle cx="62" cy="40" r="2.6" fill="#fff" />
        <g className="hr-pop-loop"><circle cx="112" cy="22" r="11" fill={MINT} stroke="none" /><path d="M107 22l3.5 3.5 6-6.5" stroke="#0B5E5B" strokeWidth="2.6" /></g>
      </>;
    case "plane": // leave: a plane flying along a dotted path to a palm tree
      return <>
        <path d="M8 66c30-4 50-30 96-40" stroke="rgba(255,255,255,.45)" strokeDasharray="3 6" className="hr-dash" />
        <g className="hr-fly"><path d="M0 0l16 6-16 6 4-6z" fill="#fff" stroke="none" /></g>
        <path d="M118 74V46" stroke={GOLD} strokeWidth="3" />
        <path className="hr-sway" d="M118 46c-8-6-16-4-20 2M118 46c8-6 16-4 20 2M118 46c-4-8-2-14 4-16M118 46c4-8 12-10 16-6" stroke={MINT} />
        <path d="M100 74h36" stroke="rgba(255,255,255,.5)" />
      </>;
    case "rupee": // pay: coins dropping onto a growing stack
      return <>
        {[0, 1, 2].map((i) => <ellipse key={i} cx="58" cy={66 - i * 9} rx="18" ry="5.5" fill={GOLD} stroke="#D9A93A" strokeWidth="1.6" />)}
        <g className="hr-drop"><circle cx="58" cy="18" r="9" fill={GOLD} stroke="#D9A93A" strokeWidth="1.6" /><text x="58" y="22" textAnchor="middle" fontSize="11" fontWeight="700" fill="#94570A" stroke="none">₹</text></g>
        <rect x="92" y="22" width="34" height="44" rx="5" fill={soft} />
        <path d="M99 34h20M99 42h14M99 50h18" />
        <path className="hr-draw" pathLength={1} d="M99 58h20" stroke={MINT} />
      </>;
    case "target": // tasks and goals: a target with an arrow landing in the bull's-eye
      return <>
        <circle cx="64" cy="40" r="28" fill={soft} /><circle cx="64" cy="40" r="28" /><circle cx="64" cy="40" r="18" /><circle cx="64" cy="40" r="8" fill={ROSE} stroke="none" />
        <g className="hr-arrow"><path d="M64 40l44-26" stroke={GOLD} strokeWidth="3" /><path d="M108 14l-9 1M108 14l-3 8" stroke={GOLD} strokeWidth="3" /></g>
        <circle className="hr-ping" cx="64" cy="40" r="8" stroke={ROSE} />
      </>;
    case "box": // boards and projects: three columns with cards moving across
      return <>
        {[18, 58, 98].map((x) => <rect key={x} x={x} y="10" width="32" height="62" rx="6" fill={soft} stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />)}
        <rect x="22" y="18" width="24" height="10" rx="3" fill="#fff" stroke="none" />
        <rect x="22" y="32" width="24" height="10" rx="3" fill="rgba(255,255,255,.6)" stroke="none" />
        <rect x="102" y="18" width="24" height="10" rx="3" fill={MINT} stroke="none" />
        <rect className="hr-move" x="22" y="46" width="24" height="10" rx="3" fill={GOLD} stroke="none" />
      </>;
    case "users": // people: three people, the middle one bobbing, linked by a line
      return <>
        <path d="M30 40h80" stroke="rgba(255,255,255,.35)" strokeDasharray="3 5" className="hr-dash" />
        {[[30, "#fff", 0], [70, GOLD, 1], [110, MINT, 2]].map(([x, c, i]) => (
          <g key={x as number} className="hr-bob" style={{ animationDelay: `${-(i as number) * 0.8}s` }}>
            <circle cx={x as number} cy="30" r="9" fill={c as string} stroke="none" />
            <path d={`M${(x as number) - 15} 62c2-12 8-17 15-17s13 5 15 17`} fill={c as string} stroke="none" />
          </g>
        ))}
      </>;
    case "cal": // calendar: a month grid with today's square pulsing
      return <>
        <rect x="30" y="12" width="80" height="60" rx="8" fill={soft} /><rect x="30" y="12" width="80" height="60" rx="8" />
        <path d="M30 26h80M50 6v10M90 6v10" />
        {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => <rect key={`${c}${r}`} x={38 + c * 17} y={33 + r * 12} width="10" height="7" rx="2" fill="rgba(255,255,255,.4)" stroke="none" />))}
        <rect className="hr-pulse-sq" x="72" y="45" width="10" height="7" rx="2" fill={GOLD} stroke="none" />
      </>;
    case "briefcase": // jobs and assets: a briefcase with a star rising out of it
      return <>
        <rect x="38" y="30" width="64" height="40" rx="7" fill={soft} /><rect x="38" y="30" width="64" height="40" rx="7" />
        <path d="M58 30v-6a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v6M38 46h64" />
        <rect x="64" y="42" width="12" height="8" rx="2" fill={GOLD} stroke="none" />
        <path className="hr-rise" d={STAR} transform="translate(100 10) scale(1.6)" fill={GOLD} stroke="none" />
      </>;
    case "shield": // access and security: a shield with a tick and a ring pulsing out
      return <>
        <circle className="hr-ping" cx="70" cy="40" r="22" stroke={MINT} />
        <path d="M70 6l26 9v20c0 18-12 30-26 38-14-8-26-20-26-38V15z" fill={soft} />
        <path d="M60 40l8 8 14-16" stroke={GOLD} strokeWidth="3.4" />
      </>;
    case "file": // reports and logs: a document whose lines write themselves, with a bar chart beside it
      return <>
        <path d="M28 8h34l12 12v52H28z" fill={soft} /><path d="M28 8h34l12 12v52H28zM62 8v12h12" />
        <path className="hr-draw" pathLength={1} d="M36 32h28" /><path className="hr-draw [animation-delay:.4s]" pathLength={1} d="M36 42h22" /><path className="hr-draw [animation-delay:.8s]" pathLength={1} d="M36 52h26" />
        {[0, 1, 2].map((i) => <rect key={i} className="hr-grow" style={{ animationDelay: `${i * 0.25}s` }} x={88 + i * 14} y={72 - (18 + i * 12)} width="9" height={18 + i * 12} rx="2" fill={[MINT, "#fff", GOLD][i]} stroke="none" />)}
      </>;
    case "sliders": // settings and automations: three sliders with knobs gliding
      return <>
        {[20, 40, 60].map((y, i) => <g key={y}><path d={`M24 ${y}h92`} stroke="rgba(255,255,255,.45)" /><circle className="hr-knob" style={{ animationDelay: `${-i * 1.1}s` }} cx={50 + i * 18} cy={y} r="6" fill={[GOLD, "#fff", MINT][i]} stroke="none" /></g>)}
      </>;
    case "sparkle": // Ally and marketing: sparkles twinkling around a bright star
      return <>
        <path className="hr-breathe-c" d={STAR} transform="translate(52 22) scale(3.6)" fill={GOLD} stroke="none" />
        <g transform="translate(100 12) scale(1.4)"><path className="hr-twinkle" d={STAR} fill="#fff" stroke="none" /></g>
        <g transform="translate(30 54) scale(1.2)"><path className="hr-twinkle [animation-delay:-1s]" d={STAR} fill={MINT} stroke="none" /></g>
        <g transform="translate(108 52) scale(1)"><path className="hr-twinkle [animation-delay:-2s]" d={STAR} fill="#fff" stroke="none" /></g>
      </>;
    case "chat": // chat: two bubbles, one with typing dots
      return <>
        <path d="M18 14h62a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H38l-12 10V50h-8a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill={soft} />
        {[34, 48, 62].map((x, i) => <circle key={x} className="hr-typing" style={{ animationDelay: `${i * 0.18}s` }} cx={x} cy="32" r="3.6" fill="#fff" stroke="none" />)}
        <g className="hr-pop-loop"><path d="M84 40h40a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6h-4v8l-9-8H84a6 6 0 0 1-6-6V46a6 6 0 0 1 6-6z" fill={MINT} stroke="none" /><path d="M88 52h28" stroke="#0B5E5B" /></g>
      </>;
    case "help": // support: a lifebuoy turning slowly
      return <>
        <g className="hr-turn"><circle cx="70" cy="40" r="28" fill={soft} /><circle cx="70" cy="40" r="28" /><circle cx="70" cy="40" r="12" />
          {[45, 135, 225, 315].map((a) => <path key={a} d="M70 12v16" stroke={ROSE} strokeWidth="7" transform={`rotate(${a} 70 40)`} />)}</g>
        <g transform="translate(112 12) scale(1.3)"><path className="hr-twinkle" d={STAR} fill={GOLD} stroke="none" /></g>
      </>;
    default:
      return <g transform="translate(56 26) scale(2.8)"><path className="hr-twinkle" d={STAR} fill={GOLD} stroke="none" /></g>;
  }
}
