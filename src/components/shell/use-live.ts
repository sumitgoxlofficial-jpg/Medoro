"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DRIVEDB_EVENT, LIVE_EVENT } from "@/drivedb/live-events";
import { hardNavigate } from "@/lib/hard-nav";

export type LiveState = "connecting" | "live" | "offline";

/**
 * Re-checks after each refresh: while the page still predates the newest change, refresh again after these delays.
 * Measured in the audit: a dropped refresh is followed by up to 3 more dropped ones, each next one applying about as
 * often as the first; 7 attempts within ~15 s catch up every time in testing, and no retry happens once it applied.
 */
const CHECK_MS = [1000, 1000, 2000, 2000, 4000, 4000];

/**
 * Subscribes to /api/events and refreshes the current screen shortly after another device
 * changes something in this pharmacy. Client state (a cart being built, form inputs) is kept;
 * only server-rendered data is re-fetched.
 *
 * `renderedAt` is the server time the app layout was rendered (it changes only when a refresh is applied). Each change
 * event carries `at`, the time it was relayed, after its commit. While the page predates the newest change, the hook
 * keeps refreshing with backoff: the router occasionally drops a refresh result (BUG-08 in docs/audit), and a change
 * that arrives while the tab is hidden or the stream is reconnecting must still reach the screen.
 */
export function useLive(renderedAt?: number): LiveState {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const check = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wanted = useRef(0), rendered = useRef(renderedAt ?? 0), attempts = useRef(0);
  const verify = renderedAt !== undefined;
  const behind = () => verify && rendered.current < wanted.current;

  // A new render arrived: the refresh applied if the page is now at least as new as the newest change.
  useEffect(() => {
    if (renderedAt === undefined) return;
    rendered.current = Math.max(rendered.current, renderedAt);
    if (!behind() && check.current) { clearTimeout(check.current); check.current = null; }
  });

  useEffect(() => {
    let es: EventSource | null = null, closed = false, retry: ReturnType<typeof setTimeout> | null = null, connectedBefore = false;
    const clear = () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (check.current) { clearTimeout(check.current); check.current = null; }
    };
    // Refresh now (if visible), then confirm it applied; hidden tabs catch up when shown (see `vis`).
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      if (!verify) return;
      attempts.current++;
      check.current = setTimeout(() => {
        check.current = null;
        if (behind() && attempts.current <= CHECK_MS.length) refresh();
      }, CHECK_MS[Math.min(attempts.current, CHECK_MS.length) - 1]);
    };
    // Batch bursts (a sale touches several tables) into one refresh.
    const schedule = (delay: number) => { clear(); attempts.current = 0; timer.current = setTimeout(() => { timer.current = null; refresh(); }, delay); };
    const open = () => {
      es = new EventSource("/api/events");
      es.addEventListener("ready", () => {
        setState("live");
        // Reconnected: changes made while the stream was down were never sent, so bring the screen up to date.
        if (connectedBefore) { wanted.current = Math.max(wanted.current, rendered.current + 1); schedule(0); }
        connectedBefore = true;
      });
      es.addEventListener("change", (ev) => {
        // A Drive counter uploaded changes: the counter on this page syncs at once (src/drivedb/device.ts).
        // Nothing server-rendered changed, so the page itself isn't refreshed.
        let c: { t?: string; d?: string; at?: number } = {};
        try { c = JSON.parse((ev as MessageEvent<string>).data); } catch { /* old server */ }
        if (c.t === "drivedb") { window.dispatchEvent(new CustomEvent(DRIVEDB_EVENT, { detail: { device: c.d ?? "" } })); return; }
        wanted.current = Math.max(wanted.current, typeof c.at === "number" ? c.at : Date.now());
        schedule(700);
      });
      es.addEventListener("signedout", () => { closed = true; es?.close(); hardNavigate("/signin"); });
      es.onerror = () => {
        setState(navigator.onLine ? "connecting" : "offline");
        if (es?.readyState === EventSource.CLOSED && !closed) { retry = setTimeout(open, 30_000); }
      };
    };
    open();
    // Coming back to the tab: catch up on changes that arrived while it was hidden, or refresh after a long absence.
    let hiddenAt = 0;
    const vis = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (behind() || (hiddenAt && Date.now() - hiddenAt > 60_000)) schedule(0);
    };
    const off = () => setState("offline"), on = () => setState("connecting");
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("offline", off); window.addEventListener("online", on);
    return () => {
      closed = true; es?.close(); if (retry) clearTimeout(retry); clear();
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("offline", off); window.removeEventListener("online", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `verify` only depends on whether the layout passes renderedAt
  }, [router]);
  useEffect(() => { window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { live: state === "live" } })); }, [state]);
  return state;
}
