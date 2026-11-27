"use client";
import { useCallback, useEffect, useState } from "react";
import { AlarmClock, LogOut } from "lucide-react";
import type { Shell } from "@/staff/hrms/screens";
import { toMin } from "@/staff/hrms/constants";
import { useNow } from "@/lib/use-now";
import { checkOut, hrSignOut } from "../actions";
import { Modal, btnCls, cx, primaryCls, useRun } from "./kit";
import { SelfieModal } from "./monitor";

// Check-out is compulsory. A day left open is closed at midnight as a missed check-out: no hours, and half a day's loss
// of pay until HR approves a correction. So while someone is checked in, the HRMS:
//  * keeps a Check out button in the top bar,
//  * once their working day is over, shows a reminder bar and asks before the tab is closed,
//  * asks them to check out before they sign out.

const IST = 5.5 * 3600_000;
const clock = (ms: number) => { const d = new Date(ms + IST); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/** The end of a full working day for today (start time + work hours + the lunch hour), in ms. */
export function dayEndMs(sh: Pick<Shell, "today" | "start" | "workHours" | "lunch">) {
  const lunch = Math.max(0, toMin(sh.lunch.to) - toMin(sh.lunch.from));
  return Date.parse(`${sh.today}T00:00:00+05:30`) + (toMin(sh.start) + sh.workHours * 60 + lunch) * 60_000;
}

export function useCheckoutGuard(sh: Shell) {
  const now = useNow(30_000);
  const { run, busy } = useRun();
  const [ask, setAsk] = useState(false), [shot, setShot] = useState<null | { thenSignOut: boolean }>(null);
  const open = sh.checkin && !!sh.att.inAt && !sh.att.outAt;
  const end = dayEndMs(sh), overdue = open && now >= end;

  // Closing the tab after the working day without checking out: the browser asks first.
  useEffect(() => {
    if (!overdue) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [overdue]);

  const doOut = useCallback((thenSignOut: boolean, selfie?: string) => run(() => checkOut(selfie), () => { setShot(null); setAsk(false); if (thenSignOut) void hrSignOut(); }), [run]);
  const startOut = useCallback((thenSignOut: boolean) => (sh.selfie ? setShot({ thenSignOut }) : doOut(thenSignOut)), [sh.selfie, doOut]);
  /** Sign out, asking to check out first while checked in. */
  const signOut = useCallback(() => { if (open) setAsk(true); else void hrSignOut(); }, [open]);

  const button = open ? (
    <button disabled={busy} onClick={() => startOut(false)} className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer border disabled:opacity-60", overdue ? "md-nudge bg-[#B45309] border-[#B45309] text-white" : "bg-white border-[#CDD2D7] text-[#B45309] hover:border-[#B45309]")}>
      <LogOut className="size-3.5" />Check out
    </button>
  ) : null;

  const node = (
    <>
      {overdue ? (
        <div role="alert" className="fixed z-40 bottom-4 left-1/2 -translate-x-1/2 w-[min(640px,calc(100vw-24px))] bg-white border border-[#F59E0B] rounded-xl shadow-[0_18px_40px_-16px_rgba(15,23,42,.45)] px-4 py-3 flex items-center gap-3 flex-wrap print:hidden">
          <span className="md-nudge flex-none size-9 rounded-full bg-[#FEF3C7] text-[#B45309] flex items-center justify-center"><AlarmClock className="size-[18px]" /></span>
          <div className="flex-1 min-w-[200px] text-[13px] text-[#334155]"><strong className="block text-[#0f172a]">Your working day ended at {clock(end)}. Please check out.</strong>Check-out is compulsory: a missed check-out counts as half a day’s loss of pay.</div>
          <button className={primaryCls} disabled={busy} onClick={() => startOut(false)}>Check out now</button>
        </div>
      ) : null}
      {ask ? (
        <Modal title="Check out before you sign out" onClose={() => setAsk(false)}>
          <p className="text-[13.5px] text-[#334155]">You’re still checked in. Check-out is compulsory: if today is left open, it counts as a <strong>missed check-out</strong>, with no hours credited and half a day’s loss of pay until HR approves a correction.</p>
          <div className="flex gap-2 flex-wrap justify-end">
            <button className={btnCls} onClick={() => setAsk(false)}>Stay signed in</button>
            <button className={btnCls} onClick={() => void hrSignOut()}>Sign out, I’m still working</button>
            <button className={primaryCls} disabled={busy} onClick={() => startOut(true)}>Check out &amp; sign out</button>
          </div>
        </Modal>
      ) : null}
      {shot ? <SelfieModal title="Check out: take a selfie" busy={busy} onClose={() => setShot(null)} onDone={(img) => doOut(shot.thenSignOut, img)} /> : null}
    </>
  );
  return { node, button, signOut };
}
