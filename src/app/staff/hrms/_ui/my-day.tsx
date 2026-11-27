"use client";
import Link from "next/link";
import { CalendarCheck, Coffee, Hourglass, LogIn, LogOut, Moon, Sparkles, Sun, Trophy, UtensilsCrossed, Zap } from "lucide-react";
import type { MyDay } from "@/staff/hrms/time";
import { liveWorkedMin, toMin } from "@/staff/hrms/constants";
import { useNow } from "@/lib/use-now";
import { cx } from "./kit";

// "My day": each employee's own working day at a glance. The P / A mark, hours worked (ticking live), breaks, lunch,
// idle time and how much of the target is left, a timeline of the day and the month so far. The motion (sun crossing
// the sky, the ring filling, striped "working" bar, staggered tiles) lives in globals.css under .md-*, and is switched
// off by .hr-motion for people who prefer reduced motion.

const IST = 5.5 * 3600_000;
const MARK: Record<MyDay["code"], { letter: string; bg: string; fg: string; ring: string; name: string }> = {
  P: { letter: "P", bg: "#D6F3EF", fg: "#0B5E5B", ring: "#14B8A6", name: "Present" },
  L: { letter: "P", bg: "#FEF3C7", fg: "#B45309", ring: "#F59E0B", name: "Present (late)" },
  A: { letter: "A", bg: "#FEE2E2", fg: "#DC2626", ring: "#DC2626", name: "Absent" },
  LV: { letter: "L", bg: "#DBEAFE", fg: "#1E40AF", ring: "#3B82F6", name: "On leave" },
  H: { letter: "H", bg: "#FFFBEB", fg: "#92400E", ring: "#D97706", name: "Holiday" },
  WO: { letter: "WO", bg: "#F1F5F9", fg: "#475569", ring: "#94A3B8", name: "Weekly off" },
};
const dur = (m: number) => { const t = Math.max(0, Math.round(m)); return `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, "0")}m`; };
const clock = (ms: number) => { const d = new Date(ms + IST); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const hourLabel = (ms: number) => { const h = new Date(ms + IST).getUTCHours(); return `${h % 12 || 12}${h < 12 ? "a" : "p"}`; };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

type Month = { present: number; late: number; absent: number; leave: number; workDays: number };

/** The working day as the sun's path: it rises at the start time and sets when a full day ends; the moon after. */
function SunPath({ f, night }: { f: number; night: boolean }) {
  const a = Math.PI * (night ? 0.8 : f), x = 80 - 56 * Math.cos(a), y = 64 - 56 * Math.sin(a); // the moon sits high in the evening sky
  return (
    <svg viewBox="0 0 160 72" className="w-[150px] h-[68px] max-[560px]:hidden" aria-hidden>
      <path d="M24 64a56 56 0 0 1 112 0" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2" strokeDasharray="3 5" />
      <path d="M24 64a56 56 0 0 1 112 0" fill="none" stroke="#F5C451" strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray={`${f} 1`} className="md-arc" />
      <line x1="8" y1="64" x2="152" y2="64" stroke="rgba(255,255,255,.45)" strokeWidth="1.5" />
      <path className="hr-twinkle" d="M20 14l1.2 3.8 3.8 1.2-3.8 1.2L20 24l-1.2-3.8-3.8-1.2 3.8-1.2z" fill="#fff" opacity=".8" />
      <path className="hr-twinkle [animation-delay:-1.3s]" d="M140 8l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="#5EEAD4" />
      <g transform={`translate(${x} ${y})`} className="md-sun">
        {night ? <>
          <mask id="md-moon"><rect x="-14" y="-14" width="28" height="28" fill="#fff" /><circle r="9" cx="5" cy="-4" fill="#000" /></mask>
          <circle r="14" fill="#E2E8F0" opacity=".18" className="md-glow" />
          <circle r="9" fill="#F1F5F9" mask="url(#md-moon)" />
        </> : <>
          <circle r="16" fill="#F5C451" opacity=".25" className="md-glow" />
          <g className="md-rays">{Array.from({ length: 8 }, (_, i) => <line key={i} x1="0" y1="-13" x2="0" y2="-16.5" stroke="#F5C451" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 45})`} />)}</g>
          <circle r="9" fill="#F5C451" />
        </>}
      </g>
    </svg>
  );
}

export function MyDayCard({ d, month, link = false, checkin = true }: { d: MyDay; month?: Month; link?: boolean; checkin?: boolean }) {
  const now = useNow(1000);
  const mark = MARK[d.code];
  const day0 = Date.parse(`${d.day}T00:00:00+05:30`);
  const at = (hhmm: string) => day0 + toMin(hhmm) * 60_000;
  const inMs = d.inAt ? Date.parse(d.inAt) : null, outMs = d.outAt ? Date.parse(d.outAt) : null;
  const endMs = outMs ?? now;
  const openBreak = !outMs ? d.breaks.find((b) => !b.endAt) ?? null : null;
  const worked = d.inAt ? liveWorkedMin({ inAt: d.inAt, outAt: d.outAt, breakMin: d.breakMin }, now, d.lunch, openBreak?.startAt) : 0;
  const lunchMin = inMs ? Math.max(0, (Math.min(endMs, at(d.lunch.to)) - Math.max(inMs, at(d.lunch.from))) / 60_000) : 0;
  const breakMin = d.breakMin + (openBreak && openBreak.kind !== "Lunch" ? Math.max(0, (now - Date.parse(openBreak.startAt)) / 60_000) : 0);
  const active = Math.max(0, worked - d.idleMin);
  const pct = d.targetMin ? clamp01(worked / d.targetMin) : 0;
  const over = worked - d.targetMin, reached = !!inMs && over >= 0;
  const nowM = Math.floor(((now + IST) % 86_400_000) / 60_000);
  const lunchNow = !!inMs && !outMs && nowM >= toMin(d.lunch.from) && nowM < toMin(d.lunch.to);
  const working = !!inMs && !outMs && !openBreak && !lunchNow;
  const state = !inMs ? null : outMs ? "Checked out · day complete" : openBreak ? `On a break (${openBreak.kind}) · clock paused` : lunchNow ? "Lunch hour · clock paused" : "Working now";
  const secs = Math.floor(worked * 60);
  const R = 52, C = 2 * Math.PI * R, hours = Math.max(1, Math.round(d.targetMin / 60));

  // The day: from the start time (or check-in, if earlier) to the end of a full day (or now, if later).
  const lunchSpan = Math.max(0, toMin(d.lunch.to) - toMin(d.lunch.from));
  const planEnd = at(d.start) + (d.targetMin + lunchSpan) * 60_000;
  const sunF = clamp01((now - at(d.start)) / (planEnd - at(d.start)));
  const t0 = Math.min(at(d.start), inMs ?? Infinity) - 30 * 60_000, t1 = Math.max(planEnd, endMs) + 30 * 60_000;
  const x = (ms: number) => `${Math.max(0, Math.min(100, ((ms - t0) * 100) / (t1 - t0)))}%`;
  const w = (a: number, b: number) => `${Math.max(0, ((Math.min(b, t1) - Math.max(a, t0)) * 100) / (t1 - t0))}%`;
  const ticks: number[] = []; for (let h = Math.ceil(t0 / 3_600_000) * 3_600_000; h <= t1; h += 3_600_000) ticks.push(h);
  const step = ticks.length > 10 ? 2 : 1;

  const tiles: { l: string; v: string; sub?: string; Icon: typeof Sun; c: string }[] = [
    { l: "Check-in", v: inMs ? clock(inMs) : "—", sub: inMs ? (d.code === "L" ? `after ${d.start}` : "on time") : `start ${d.start}`, Icon: LogIn, c: "#0B5E5B" },
    { l: "Check-out", v: outMs ? clock(outMs) : "—", sub: outMs ? "done for today" : inMs ? "still in" : "", Icon: LogOut, c: "#475569" },
    { l: "Active time", v: dur(active), sub: d.idleMin ? `${dur(d.idleMin)} idle${d.idleNow ? " · idle now" : ""}` : "no idle time", Icon: Zap, c: "#7C3AED" },
    { l: "Breaks", v: dur(breakMin), sub: `${d.breaks.filter((b) => b.kind !== "Lunch").length} taken`, Icon: Coffee, c: "#B45309" },
    { l: "Lunch", v: dur(lunchMin), sub: `${d.lunch.from}–${d.lunch.to}`, Icon: UtensilsCrossed, c: "#64748B" },
    reached ? { l: "Overtime", v: dur(over), sub: "target reached", Icon: Trophy, c: "#B7791F" } : { l: "Remaining", v: dur(-over), sub: `of ${dur(d.targetMin)}`, Icon: Hourglass, c: "#0E7490" },
  ];
  const mP = month ? month.present + month.late : 0, mTot = month ? mP + month.absent + month.leave : 0;
  const attendancePct = month && mP + month.absent > 0 ? Math.round((mP * 100) / (mP + month.absent)) : null;

  return (
    <section className="md-card bg-white border border-[#a8b6c8] rounded-xl shadow-[0_2px_6px_rgba(15,23,42,.12)] overflow-hidden" aria-label="My day">
      {/* Banner: the day as the sun's path */}
      <div className="relative overflow-hidden text-white px-5 py-3.5 flex items-center gap-3 flex-wrap" style={{ background: "linear-gradient(135deg,#0B5E5B,#14907F 60%,#1BA597)" }}>
        <div aria-hidden className="pointer-events-none absolute inset-0"><div className="md-dots absolute inset-0" /><div className="hr-sheen absolute inset-y-0 -left-1/3 w-1/3" /></div>
        <div className="relative flex flex-col min-w-0">
          <span className="text-[10.5px] tracking-[.14em] font-semibold text-white/70 uppercase flex items-center gap-1.5"><CalendarCheck className="size-3.5" />My day</span>
          <h3 className="text-[16px] font-bold leading-snug">{new Date(day0 + IST).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h3>
          <span className="text-[12px] text-white/80">Target {dur(d.targetMin)} · day starts {d.start}</span>
        </div>
        <div className="relative ml-auto flex items-center gap-3">
          <div className="flex flex-col items-end gap-1.5">
            {state ? <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1"><span className="relative flex size-2">{working ? <i className="md-ping absolute inset-0 rounded-full bg-[#5EEAD4]" /> : null}<i className="relative size-2 rounded-full" style={{ background: working ? "#5EEAD4" : outMs ? "#CBD5E1" : "#F5C451" }} /></span>{state}</span> : null}
            {link ? <Link href="/staff/hrms/attendance" className="text-[12px] font-semibold text-white no-underline hover:underline">Attendance →</Link> : null}
          </div>
          <SunPath f={sunF} night={now > planEnd || !!outMs} />
        </div>
      </div>

      <div className="p-5 flex flex-wrap gap-6 items-center">
        <div className="flex items-center justify-between gap-6 flex-wrap max-[560px]:w-full">
          {/* The mark */}
          <div className="flex items-center gap-3.5 min-w-[180px]">
            <div className="relative">
              {d.code === "P" || d.code === "L" ? <span aria-hidden className={cx("absolute -inset-1.5 rounded-[20px] border-2", working && "md-halo")} style={{ borderColor: mark.ring }} /> : null}
              <div className={cx("md-mark relative size-[64px] rounded-2xl flex items-center justify-center font-extrabold tracking-tight border-2", d.code === "A" && "md-nudge")} style={{ background: mark.bg, color: mark.fg, borderColor: mark.ring, fontSize: mark.letter.length > 1 ? 22 : 32 }} aria-label={mark.name}>{mark.letter}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#64748B]">Today’s status</div>
              <div className="text-[17px] font-bold" style={{ color: mark.fg }}>{mark.name}</div>
              <div className="text-[12px] text-[#64748B]">{inMs ? `Checked in at ${clock(inMs)}` : d.label}{d.halfLeave ? " · half-day leave" : ""}</div>
            </div>
          </div>

          {/* Hours ring: gradient fill that draws in, an hour tick per target hour and a glowing tip */}
          <div className="relative size-[140px] flex-none" role="img" aria-label={`${dur(worked)} worked of ${dur(d.targetMin)}`}>
            <svg viewBox="0 0 132 132" className="size-full -rotate-90 overflow-visible">
              <defs>
                <linearGradient id="md-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={reached ? "#F5C451" : "#5EEAD4"} /><stop offset="1" stopColor={reached ? "#B7791F" : d.code === "L" ? "#F59E0B" : "#0B5E5B"} /></linearGradient>
              </defs>
              <circle cx="66" cy="66" r={R} fill="none" stroke="#EEF2F6" strokeWidth="11" />
              {Array.from({ length: hours }, (_, i) => <line key={i} x1={66 + R + 8} y1="66" x2={66 + R + 11} y2="66" stroke={i / hours < pct ? "#14B8A6" : "#CBD5E1"} strokeWidth="2" strokeLinecap="round" transform={`rotate(${(i * 360) / hours} 66 66)`} />)}
              <circle cx="66" cy="66" r={R} fill="none" stroke="url(#md-grad)" strokeWidth="11" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} className="md-ring" style={{ ["--md-c" as string]: C }} />
              {inMs && pct > 0 ? <g transform={`rotate(${pct * 360} 66 66)`} className="md-tip-wrap"><circle cx={66 + R} cy="66" r="9" fill={reached ? "#F5C451" : "#5EEAD4"} opacity=".35" className={working ? "md-glow" : ""} /><circle cx={66 + R} cy="66" r="4.5" fill="#fff" stroke={reached ? "#B7791F" : "#0B5E5B"} strokeWidth="2" /></g> : null}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              {reached ? <Trophy className="md-pop size-4 text-[#B7791F] mb-0.5" /> : <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#64748B]">Worked</div>}
              <div className="text-[21px] font-bold tabular-nums text-[#0f172a] leading-tight" suppressHydrationWarning>{Math.floor(secs / 3600)}:{String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}<span className="text-[13px] text-[#94A3B8]">:{String(secs % 60).padStart(2, "0")}</span></div>
              <div className="text-[11px] text-[#64748B]" suppressHydrationWarning>{Math.round(pct * 100)}% of target</div>
            </div>
            {reached ? <div aria-hidden className="absolute inset-0 pointer-events-none">{[[6, 18], [118, 10], [128, 104], [2, 112]].map(([l, t], i) => <Sparkles key={i} className="hr-twinkle absolute size-3.5 text-[#F5C451]" style={{ left: l, top: t, animationDelay: `${-i * 0.7}s` }} />)}</div> : null}
          </div>
        </div>

        {/* Figures */}
        <div className="flex-1 min-w-[260px] grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {tiles.map(({ l, v, sub, Icon, c }, i) => (
            <div key={l} className="md-tile rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 min-w-0 flex gap-2.5 items-start" style={{ ["--i" as string]: i }}>
              <span className="md-ico flex-none size-8 rounded-lg flex items-center justify-center mt-0.5" style={{ background: `${c}1A`, color: c }}><Icon className="size-4" /></span>
              <div className="min-w-0">
                <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#64748B]">{l}</div>
                <div className="text-[16px] font-bold text-[#0f172a] tabular-nums truncate" suppressHydrationWarning>{v}</div>
                {sub ? <div className="text-[11px] text-[#64748B] truncate" suppressHydrationWarning>{sub}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {inMs ? (
        <div className="px-5 pb-4">
          <div className="relative h-8 rounded-lg bg-[#F1F5F9] overflow-hidden" aria-hidden>
            <div className="absolute inset-y-0 bg-[#E2E8F0]" style={{ left: x(at(d.start)), width: w(at(d.start), planEnd) }} />
            <div className={cx("md-bar absolute inset-y-1 rounded-md bg-[#14B8A6]", working && "md-stripes")} style={{ left: x(inMs), width: w(inMs, endMs) }} />
            <div className="absolute inset-y-1 bg-[repeating-linear-gradient(135deg,#CBD5E1_0_4px,#E2E8F0_4px_8px)]" style={{ left: x(Math.max(inMs, at(d.lunch.from))), width: w(Math.max(inMs, at(d.lunch.from)), Math.min(endMs, at(d.lunch.to))) }} />
            {d.breaks.map((b, i) => { const s = Date.parse(b.startAt), e = b.endAt ? Date.parse(b.endAt) : endMs; return <div key={i} className="md-pop absolute inset-y-1 rounded-sm bg-[#F59E0B]" style={{ left: x(s), width: w(s, e), animationDelay: `${0.6 + i * 0.1}s` }} />; })}
            {!outMs ? <div className="absolute inset-y-0 w-0.5 bg-[#0f172a]" style={{ left: x(now) }}><i className="md-ping absolute -top-0.5 -left-[3px] size-2 rounded-full bg-[#0f172a]" /></div> : null}
          </div>
          <div className="relative h-4 mt-1 text-[10px] text-[#94A3B8]">{ticks.filter((_, i) => i % step === 0).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>{hourLabel(t)}</span>)}</div>
          <div className="flex gap-4 flex-wrap text-[11px] text-[#475569] mt-1.5">
            {[["#14B8A6", "Working"], ["#F59E0B", "Break"], ["#CBD5E1", "Lunch"], ["#E2E8F0", "Planned day"]].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
          </div>
        </div>
      ) : checkin && d.code === "A" ? (
        <div className="px-5 pb-4"><div className="md-tile rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-[13px] text-[#991B1B] flex items-center gap-3"><span className="md-nudge flex-none size-8 rounded-full bg-white border border-[#FECACA] flex items-center justify-center"><LogIn className="size-4" /></span><span>You haven’t checked in today. Until you do, today shows as <strong>A (absent)</strong>. Check in to start your day.</span></div></div>
      ) : !inMs ? (
        <div className="px-5 pb-4"><div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] px-4 py-3 text-[13px] text-[#475569] flex items-center gap-3">{d.code === "H" || d.code === "WO" ? <Sun className="hr-bob size-5 text-[#D97706]" /> : <Moon className="hr-bob size-5 text-[#1E40AF]" />}Enjoy your day off. Nothing to track today.</div></div>
      ) : null}

      {/* This month */}
      {month ? (
        <div className="px-5 py-3 bg-[#F8FAFC] border-t border-[#EEF2F6]">
          <div className="flex items-center gap-x-6 gap-y-2 flex-wrap text-[12.5px]">
            <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#64748B]">This month</span>
            <span><b className="text-[#0B5E5B]">P</b> {mP}{month.late ? <span className="text-[#B45309]"> ({month.late} late)</span> : null}</span>
            <span><b className="text-[#DC2626]">A</b> {month.absent}</span>
            <span><b className="text-[#1E40AF]">L</b> {month.leave}</span>
            <span className="text-[#64748B]">{month.workDays} working day{month.workDays === 1 ? "" : "s"} so far</span>
            {attendancePct !== null ? <span className="ml-auto font-semibold" style={{ color: attendancePct >= 90 ? "#0B5E5B" : attendancePct >= 75 ? "#B45309" : "#DC2626" }}>{attendancePct}% attendance</span> : null}
          </div>
          {mTot ? (
            <div className="flex h-2 rounded-full overflow-hidden bg-[#E2E8F0] mt-2" role="img" aria-label={`${mP} present, ${month.absent} absent, ${month.leave} leave`}>
              {[[month.present, "#14B8A6"], [month.late, "#F59E0B"], [month.absent, "#DC2626"], [month.leave, "#3B82F6"]].map(([n, c], i) => (n as number) > 0 ? <div key={i} className="md-bar h-full" style={{ width: `${((n as number) * 100) / mTot}%`, background: c as string, animationDelay: `${0.3 + i * 0.12}s` }} /> : null)}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
