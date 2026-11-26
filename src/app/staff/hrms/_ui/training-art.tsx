"use client";
import { useMemo, useState } from "react";
import { Award, BookOpen, CheckCircle2, ClipboardCheck, Mic, MonitorPlay } from "lucide-react";
import { CountUp } from "@/components/welcome-banner";
import { cx } from "./kit";

// Graphics for the Sales Academy screens. Colour: one teal hue for magnitude, gold for the pass mark / certificate, and
// status (done, current, locked) always carried by an icon and a word as well as colour. Motion classes live in
// globals.css (tr-*) and stop with reduced motion.

const TEAL = "#0B5E5B", MINT = "#14B8A6", GOLD = "#D9A93A", TRACK = "#E2E8F0";

export type Step = { id: string; label: string; detail: string; state: "done" | "current" | "todo" };
const STEP_ICON = { learn: BookOpen, tour: MonitorPlay, quiz: ClipboardCheck, practical: Mic, cert: Award } as const;

/** The learner's road to the certificate: five milestones on a drawn path, the current one pulsing. */
export function JourneyMap({ steps }: { steps: Step[] }) {
  const W = 1000, H = 144, xs = steps.map((_, k) => 60 + (k * (W - 120)) / (steps.length - 1));
  const y = (k: number) => (k % 2 ? 56 : 86);
  const pathTo = (n: number) => xs.slice(0, n + 1).map((x, k) => (k ? `S ${x - (xs[1] - xs[0]) / 2} ${y(k)} ${x} ${y(k)}` : `M ${x} ${y(k)}`)).join(" ");
  const d = pathTo(steps.length - 1);
  const open = steps.findIndex((s) => s.state !== "done");
  const reach = open === -1 ? steps.length - 1 : open; // the gold line runs up to the current step
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-[640px]:hidden" role="img" aria-label={`Progress: ${steps.map((s) => `${s.label} ${s.state === "done" ? "done" : s.state === "current" ? "in progress" : "to do"}`).join(", ")}`}>
        <path d={d} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
        {reach > 0 ? <path d={pathTo(reach)} fill="none" stroke="#F5C451" strokeWidth="4" strokeLinecap="round" pathLength={1} className="tr-path" /> : null}
        {steps.map((s, k) => {
          const Icon = STEP_ICON[s.id as keyof typeof STEP_ICON] ?? BookOpen;
          return (
            <g key={s.id} className="tr-node" style={{ ["--d" as string]: k }}>
              {s.state === "current" ? <circle cx={xs[k]} cy={y(k)} r="9" fill="none" stroke="#F5C451" strokeWidth="2" className="tr-ring" /> : null}
              <circle cx={xs[k]} cy={y(k)} r="18" fill={s.state === "done" ? "#F5C451" : s.state === "current" ? "#fff" : "rgba(255,255,255,.14)"} stroke={s.state === "todo" ? "rgba(255,255,255,.35)" : "none"} />
              <foreignObject x={xs[k] - 9} y={y(k) - 9} width="18" height="18"><Icon size={18} color={s.state === "todo" ? "rgba(255,255,255,.7)" : TEAL} aria-hidden /></foreignObject>
              <text x={xs[k]} y={k % 2 ? 18 : 124} textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{s.label}</text>
              <text x={xs[k]} y={k % 2 ? 33 : 139} textAnchor="middle" fontSize="11.5" fill="rgba(255,255,255,.7)">{s.detail}</text>
            </g>
          );
        })}
      </svg>
      {/* Phones: the same five steps as a compact list. */}
      <ol className="min-[641px]:hidden flex flex-col gap-1.5">
        {steps.map((s) => <li key={s.id} className="flex items-center gap-2 text-[13px] text-white"><span className={cx("size-5 rounded-full flex items-center justify-center flex-none", s.state === "done" ? "bg-[#F5C451]" : s.state === "current" ? "bg-white" : "bg-white/15")}>{s.state === "done" ? <CheckCircle2 size={13} color={TEAL} /> : null}</span><span className="font-semibold">{s.label}</span><span className="text-white/70 ml-auto">{s.state === "done" ? "Done" : s.state === "current" ? "Now" : "To do"} · {s.detail}</span></li>)}
      </ol>
    </div>
  );
}

/** Final score on a half-circle meter, with the pass mark as a gold tick. */
export function ScoreGauge({ score, pass, size = 220 }: { score: number; pass: number; size?: number }) {
  const r = 80, cx0 = 100, cy0 = 100, len = Math.PI * r;
  const at = (v: number) => { const a = Math.PI * (1 - v / 100); return [cx0 + r * Math.cos(a), cy0 - r * Math.sin(a)]; };
  const [px, py] = at(pass), [ix, iy] = [cx0 + (r - 16) * Math.cos(Math.PI * (1 - pass / 100)), cy0 - (r - 16) * Math.sin(Math.PI * (1 - pass / 100))];
  const ok = score >= pass;
  return (
    <div className="relative" style={{ width: size }}>
      <svg viewBox="0 0 200 118" className="w-full h-auto" role="img" aria-label={`Score ${score} out of 100; pass mark ${pass}`}>
        <path d={`M 20 100 A ${r} ${r} 0 0 1 180 100`} fill="none" stroke={TRACK} strokeWidth="14" strokeLinecap="round" />
        <path d={`M 20 100 A ${r} ${r} 0 0 1 180 100`} fill="none" stroke={ok ? TEAL : MINT} strokeWidth="14" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - Math.min(100, score) / 100)} className="tr-arc" style={{ ["--len" as string]: len }} />
        <line x1={ix} y1={iy} x2={px} y2={py} stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
        <text x={px} y={py - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#94570A">PASS {pass}</text>
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-[34px] font-extrabold leading-none tabular-nums" style={{ color: ok ? TEAL : "#0f172a" }}><CountUp value={score} format={String} /><span className="text-[15px] font-semibold text-[#64748B]">/100</span></div>
        <div className="text-[11.5px] font-semibold mt-1" style={{ color: ok ? TEAL : "#B45309" }}>{ok ? "✓ Above the pass mark" : `${pass - score} marks to the pass mark`}</div>
      </div>
    </div>
  );
}

/** Marks per area: one teal bar each against its maximum, value written beside it, hover for the source. */
export function AreaBars({ rows }: { rows: { id: string; label: string; got: number; max: number; from: string }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((a, k) => (
        <li key={a.id} className="relative" onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(a.id)} onBlur={() => setHover(null)} tabIndex={0}>
          <div className="flex text-[12.5px] mb-1"><span className="flex-1 font-semibold text-[#0f172a]">{a.label}</span><span className="tabular-nums text-[#334155]">{a.got.toFixed(1)} <span className="text-[#64748B]">/ {a.max}</span></span></div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: TRACK }}>
            <div className="h-full rounded-full hr-fill" style={{ width: `${Math.min(100, (a.got / a.max) * 100)}%`, background: `linear-gradient(90deg, ${MINT}, ${TEAL})`, animationDelay: `${0.25 + k * 0.08}s` }} />
          </div>
          {hover === a.id ? <div role="tooltip" className="absolute z-10 right-0 -top-9 rounded-lg bg-[#0f172a] text-white text-[11.5px] px-2.5 py-1.5 shadow-lg whitespace-nowrap max-w-[320px] truncate">{a.from}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** A small celebration: pieces fly out from the centre once (nothing with reduced motion). */
export function Burst({ n = 26 }: { n?: number }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2, dist = 70 + ((k * 37) % 60);
    return { x: `${Math.cos(a) * dist}px`, y: `${Math.sin(a) * dist - 20}px`, r: `${(k * 53) % 360}deg`, c: ["#F5C451", "#14B8A6", "#0B5E5B", "#5EEAD4"][k % 4], delay: `${(k % 5) * 30}ms` };
  }), [n]);
  return <span aria-hidden className="tr-burst pointer-events-none absolute inset-0">{bits.map((b, k) => <i key={k} style={{ background: b.c, ["--x" as string]: b.x, ["--y" as string]: b.y, ["--r" as string]: b.r, animationDelay: b.delay }} />)}</span>;
}

/** A score ring for quiz results. */
export function ResultRing({ pct, passed, size = 96 }: { pct: number; passed: boolean; size?: number }) {
  const r = 40, len = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${pct}%`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={TRACK} strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={passed ? TEAL : "#DC2626"} strokeWidth="9" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - pct / 100)} transform="rotate(-90 50 50)" className="tr-arc" style={{ ["--len" as string]: len }} />
      <text x="50" y="56" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0f172a">{pct}%</text>
    </svg>
  );
}

/** A preview of the certificate as issued (the PDF is the real document). */
export function CertificatePreview({ name, programme, certNo, date, score, muted }: { name: string; programme: string; certNo: string; date: string; score: number | null; muted?: boolean }) {
  return (
    <div className={cx("relative overflow-hidden rounded-2xl bg-white p-[clamp(14px,3vw,26px)] border-[3px] border-[#0B5E5B] shadow-[0_24px_50px_-28px_rgba(11,94,91,.7)]", !muted && "tr-shine", muted && "opacity-70 grayscale-[.6]")}>
      <div className="absolute inset-[7px] rounded-xl border border-[#D9A93A] pointer-events-none" />
      <svg aria-hidden className="absolute -right-10 -top-10 size-40 opacity-[.08]" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke={TEAL} strokeWidth="6" /><circle cx="50" cy="50" r="30" fill="none" stroke={GOLD} strokeWidth="4" /></svg>
      <div className="relative flex flex-col items-center text-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/medoro-mark.png" alt="" className="h-9 w-auto" />
        <div className="text-[clamp(11px,1.4vw,14px)] font-extrabold tracking-[.08em] text-[#0B5E5B] mt-1">MEDORO SALES TRAINING CERTIFICATE</div>
        <div className="text-[11px] italic text-[#64748B] mt-1">This is to certify that</div>
        <div className="text-[clamp(18px,2.6vw,26px)] font-extrabold text-[#0f172a] leading-tight">{name}</div>
        <div className="text-[11.5px] text-[#64748B]">has completed the <strong className="text-[#0B5E5B]">{programme}</strong></div>
        <div className="text-[11.5px] text-[#334155]">{date}{score !== null ? ` · final score ${score}/100` : ""}</div>
        <div className="mt-2 flex items-center gap-2 text-[10.5px] text-[#64748B]"><span className="size-6 rounded-full bg-gradient-to-br from-[#F5C451] to-[#D9A93A] flex items-center justify-center text-white"><Award size={13} /></span>{certNo}</div>
      </div>
    </div>
  );
}

/** HR overview: how many people sit at each stage of the programme. One hue, counts written on the bars. */
export function Pipeline({ stages }: { stages: { label: string; n: number; hint: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.n));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(120px,1fr))]" role="list">
      {stages.map((s, k) => (
        <div key={s.label} role="listitem" tabIndex={0} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(k)} onBlur={() => setHover(null)} className="relative flex flex-col gap-1.5">
          <div className="h-[120px] rounded-xl bg-[#F1F5F9] flex items-end p-1.5">
            {s.n ? <div className="w-full rounded-lg hr-fill-y flex items-start justify-center pt-1 text-white text-[13px] font-bold" style={{ height: `${Math.max(22, (s.n / max) * 100)}%`, background: `linear-gradient(180deg, ${k === stages.length - 1 ? GOLD : MINT}, ${TEAL})`, animationDelay: `${0.15 + k * 0.1}s` }}>{s.n}</div>
              : <div className="w-full text-center text-[13px] font-bold text-[#94A3B8] pb-1">0</div>}
          </div>
          <div className="text-[12px] font-semibold text-center text-[#334155] leading-tight">{s.label}</div>
          {hover === k ? <div role="tooltip" className="absolute z-10 left-1/2 -translate-x-1/2 -top-8 rounded-lg bg-[#0f172a] text-white text-[11.5px] px-2.5 py-1.5 whitespace-nowrap shadow-lg">{s.n} {s.n === 1 ? "person" : "people"} · {s.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** Illustration for the install card and empty states: a slide deck, a play button and a certificate. */
export function AcademyArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 180" className={className} aria-hidden fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="140" cy="92" r="78" fill="#D6F3EF" className="hr-breathe" style={{ transformOrigin: "140px 92px" }} />
      <g className="hr-bob">
        <rect x="58" y="40" width="136" height="88" rx="10" fill="#0B5E5B" />
        <rect x="70" y="54" width="60" height="7" rx="3.5" fill="#F5C451" />
        <rect x="70" y="70" width="96" height="5" rx="2.5" fill="#5EEAD4" opacity=".8" />
        <rect x="70" y="82" width="80" height="5" rx="2.5" fill="#5EEAD4" opacity=".6" />
        <rect x="70" y="94" width="88" height="5" rx="2.5" fill="#5EEAD4" opacity=".45" />
        <circle cx="172" cy="104" r="14" fill="#fff" /><path d="M168 97l11 7-11 7z" fill="#0B5E5B" />
        <path d="M126 128v18M108 152h36" stroke="#0B5E5B" strokeWidth="5" />
      </g>
      <g className="hr-drift" style={{ ["--dur" as string]: "7s" }}>
        <rect x="186" y="106" width="58" height="42" rx="6" fill="#fff" stroke="#D9A93A" strokeWidth="3" />
        <circle cx="215" cy="122" r="8" fill="#F5C451" /><path d="M210 132l-3 10 8-4 8 4-3-10" fill="#D9A93A" />
      </g>
      <g className="hr-twinkle"><path d="M40 52l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#F5C451" /></g>
      <g className="hr-twinkle" style={{ animationDelay: "1.2s" }}><path d="M226 40l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#14B8A6" /></g>
    </svg>
  );
}
