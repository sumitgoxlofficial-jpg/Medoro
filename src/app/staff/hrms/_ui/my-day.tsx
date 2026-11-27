"use client";
import Link from "next/link";
import type { MyDay } from "@/staff/hrms/time";
import { liveWorkedMin, toMin } from "@/staff/hrms/constants";
import { useNow } from "@/lib/use-now";
import { cx } from "./kit";

// "My day": each employee's own working day at a glance. The P / A mark, hours worked (ticking live), breaks, lunch,
// idle time and how much of the target is left, plus a timeline of the day.

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

type Month = { present: number; late: number; absent: number; leave: number; workDays: number };

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
  const pct = d.targetMin ? Math.min(1, worked / d.targetMin) : 0;
  const over = worked - d.targetMin;
  const nowM = Math.floor(((now + IST) % 86_400_000) / 60_000);
  const lunchNow = !!inMs && !outMs && nowM >= toMin(d.lunch.from) && nowM < toMin(d.lunch.to);
  const state = !inMs ? null : outMs ? "Checked out · day complete" : openBreak ? `On a break (${openBreak.kind}) · clock paused` : lunchNow ? "Lunch hour · clock paused" : "Working now";
  const secs = Math.floor(worked * 60);
  const R = 52, C = 2 * Math.PI * R;

  // The day timeline: from the start time (or check-in, if earlier) to the end of a full day (or now, if later).
  const planEnd = at(d.start) + (d.targetMin + Math.max(0, toMin(d.lunch.to) - toMin(d.lunch.from))) * 60_000;
  const t0 = Math.min(at(d.start), inMs ?? Infinity) - 30 * 60_000, t1 = Math.max(planEnd, endMs) + 30 * 60_000;
  const x = (ms: number) => `${Math.max(0, Math.min(100, ((ms - t0) * 100) / (t1 - t0)))}%`;
  const w = (a: number, b: number) => `${Math.max(0, ((Math.min(b, t1) - Math.max(a, t0)) * 100) / (t1 - t0))}%`;
  const ticks: number[] = []; for (let h = Math.ceil(t0 / 3_600_000) * 3_600_000; h <= t1; h += 3_600_000) ticks.push(h);
  const step = ticks.length > 10 ? 2 : 1;

  const tiles: [string, string, string?][] = [
    ["Check-in", inMs ? clock(inMs) : "—", inMs ? (d.code === "L" ? `after ${d.start}` : "on time") : `start ${d.start}`],
    ["Check-out", outMs ? clock(outMs) : "—", outMs ? "" : inMs ? "still in" : ""],
    ["Active time", dur(active), d.idleMin ? `${dur(d.idleMin)} idle${d.idleNow ? " · idle now" : ""}` : "no idle time"],
    ["Breaks", dur(breakMin), `${d.breaks.filter((b) => b.kind !== "Lunch").length} taken`],
    ["Lunch", dur(lunchMin), `${d.lunch.from}–${d.lunch.to}`],
    [over >= 0 ? "Overtime" : "Remaining", dur(Math.abs(over)), over >= 0 ? "target reached" : `of ${dur(d.targetMin)}`],
  ];
  const attendancePct = month && month.present + month.late + month.absent > 0 ? Math.round(((month.present + month.late) * 100) / (month.present + month.late + month.absent)) : null;

  return (
    <section className="bg-white border border-[#a8b6c8] rounded-xl shadow-[0_2px_6px_rgba(15,23,42,.12)] overflow-hidden" aria-label="My day">
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-wrap border-b border-[#EEF2F6]">
        <div className="flex flex-col">
          <h3 className="text-[14.5px] font-bold text-[#0f172a]">My day</h3>
          <span className="text-[12px] text-[#64748B]">{new Date(day0 + IST).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} · target {dur(d.targetMin)}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {state ? <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#475569]"><i className={cx("size-2 rounded-full", state === "Working now" && "animate-pulse")} style={{ background: state === "Working now" ? "#14B8A6" : outMs ? "#64748B" : "#F59E0B" }} />{state}</span> : null}
          {link ? <Link href="/staff/hrms/attendance" className="text-[12.5px] font-semibold text-[#0B5E5B]">Attendance →</Link> : null}
        </div>
      </div>

      <div className="p-5 flex flex-wrap gap-6 items-center">
        <div className="flex items-center justify-between gap-6 flex-wrap max-[560px]:w-full">
        {/* The mark */}
        <div className="flex items-center gap-3.5 min-w-[180px]">
          <div className="size-[64px] rounded-2xl flex items-center justify-center font-extrabold tracking-tight border-2" style={{ background: mark.bg, color: mark.fg, borderColor: mark.ring, fontSize: mark.letter.length > 1 ? 22 : 32 }} aria-label={mark.name}>{mark.letter}</div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#64748B]">Today’s status</div>
            <div className="text-[17px] font-bold" style={{ color: mark.fg }}>{mark.name}</div>
            <div className="text-[12px] text-[#64748B]">{inMs ? `Checked in at ${clock(inMs)}` : d.label}{d.halfLeave ? " · half-day leave" : ""}</div>
          </div>
        </div>

        {/* Hours ring */}
        <div className="relative size-[132px] flex-none" role="img" aria-label={`${dur(worked)} worked of ${dur(d.targetMin)}`}>
          <svg viewBox="0 0 132 132" className="size-full -rotate-90">
            <circle cx="66" cy="66" r={R} fill="none" stroke="#EEF2F6" strokeWidth="11" />
            <circle cx="66" cy="66" r={R} fill="none" stroke={over >= 0 ? "#0B5E5B" : mark.ring} strokeWidth="11" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: "stroke-dashoffset 1s linear" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#64748B]">Worked</div>
            <div className="text-[20px] font-bold tabular-nums text-[#0f172a] leading-tight" suppressHydrationWarning>{Math.floor(secs / 3600)}:{String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}<span className="text-[13px] text-[#94A3B8]">:{String(secs % 60).padStart(2, "0")}</span></div>
            <div className="text-[11px] text-[#64748B]" suppressHydrationWarning>{Math.round(pct * 100)}% of target</div>
          </div>
        </div>
        </div>

        {/* Figures */}
        <div className="flex-1 min-w-[260px] grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {tiles.map(([l, v, sub]) => (
            <div key={l} className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#64748B]">{l}</div>
              <div className="text-[16px] font-bold text-[#0f172a] tabular-nums truncate" suppressHydrationWarning>{v}</div>
              {sub ? <div className="text-[11px] text-[#64748B] truncate" suppressHydrationWarning>{sub}</div> : null}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {inMs ? (
        <div className="px-5 pb-4">
          <div className="relative h-7 rounded-md bg-[#F1F5F9] overflow-hidden" aria-hidden>
            <div className="absolute inset-y-0 bg-[#E2E8F0]" style={{ left: x(at(d.start)), width: w(at(d.start), planEnd) }} title="Planned day" />
            <div className="absolute inset-y-1 rounded bg-[#14B8A6]" style={{ left: x(inMs), width: w(inMs, endMs) }} />
            <div className="absolute inset-y-1 bg-[repeating-linear-gradient(135deg,#CBD5E1_0_4px,#E2E8F0_4px_8px)]" style={{ left: x(Math.max(inMs, at(d.lunch.from))), width: w(Math.max(inMs, at(d.lunch.from)), Math.min(endMs, at(d.lunch.to))) }} />
            {d.breaks.map((b, i) => { const s = Date.parse(b.startAt), e = b.endAt ? Date.parse(b.endAt) : endMs; return <div key={i} className="absolute inset-y-1 bg-[#F59E0B]" style={{ left: x(s), width: w(s, e) }} />; })}
            {!outMs ? <div className="absolute inset-y-0 w-0.5 bg-[#0f172a]" style={{ left: x(now) }} /> : null}
          </div>
          <div className="relative h-4 mt-1 text-[10px] text-[#94A3B8]">{ticks.filter((_, i) => i % step === 0).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>{hourLabel(t)}</span>)}</div>
          <div className="flex gap-4 flex-wrap text-[11px] text-[#475569] mt-1.5">
            {[["#14B8A6", "Working"], ["#F59E0B", "Break"], ["#CBD5E1", "Lunch"], ["#E2E8F0", "Planned day"]].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
          </div>
        </div>
      ) : checkin && (d.code === "A") ? (
        <div className="px-5 pb-4"><div className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-[13px] text-[#991B1B]">You haven’t checked in today. Until you do, today shows as <strong>A (absent)</strong>. Check in to start your day.</div></div>
      ) : null}

      {/* This month */}
      {month ? (
        <div className="px-5 py-3 bg-[#F8FAFC] border-t border-[#EEF2F6] flex items-center gap-x-6 gap-y-2 flex-wrap text-[12.5px]">
          <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#64748B]">This month</span>
          <span><b className="text-[#0B5E5B]">P</b> {month.present + month.late}{month.late ? <span className="text-[#B45309]"> ({month.late} late)</span> : null}</span>
          <span><b className="text-[#DC2626]">A</b> {month.absent}</span>
          <span><b className="text-[#1E40AF]">L</b> {month.leave}</span>
          <span className="text-[#64748B]">{month.workDays} working day{month.workDays === 1 ? "" : "s"} so far</span>
          {attendancePct !== null ? <span className="ml-auto font-semibold" style={{ color: attendancePct >= 90 ? "#0B5E5B" : attendancePct >= 75 ? "#B45309" : "#DC2626" }}>{attendancePct}% attendance</span> : null}
        </div>
      ) : null}
    </section>
  );
}
