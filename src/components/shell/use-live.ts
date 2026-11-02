"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DRIVEDB_EVENT, LIVE_EVENT } from "@/drivedb/live-events";

export type LiveState = "connecting" | "live" | "offline";


/**
 * Subscribes to /api/events and refreshes the current screen shortly after another device
 * changes something in this pharmacy. Client state (a cart being built, form inputs) is kept;
 * only server-rendered data is re-fetched.
 */
export function useLive(): LiveState {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let es: EventSource | null = null, closed = false, retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      es = new EventSource("/api/events");
      es.addEventListener("ready", () => setState("live"));
      es.addEventListener("change", (ev) => {
        // A Drive counter uploaded changes: the counter on this page syncs at once (src/drivedb/device.ts).
        // Nothing server-rendered changed, so the page itself isn't refreshed.
        let c: { t?: string; d?: string } = {};
        try { c = JSON.parse((ev as MessageEvent<string>).data); } catch { /* old server */ }
        if (c.t === "drivedb") { window.dispatchEvent(new CustomEvent(DRIVEDB_EVENT, { detail: { device: c.d ?? "" } })); return; }
        if (timer.current) clearTimeout(timer.current);
        // Batch bursts (a sale touches several tables) into one refresh, and skip while the tab is hidden.
        timer.current = setTimeout(() => { if (document.visibilityState === "visible") router.refresh(); }, 700);
      });
      es.addEventListener("signedout", () => { closed = true; es?.close(); window.location.href = "/signin"; });
      es.onerror = () => {
        setState(navigator.onLine ? "connecting" : "offline");
        if (es?.readyState === EventSource.CLOSED && !closed) { retry = setTimeout(open, 5000); }
      };
    };
    open();
    const vis = () => { if (document.visibilityState === "visible") router.refresh(); };
    const off = () => setState("offline"), on = () => setState("connecting");
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("offline", off); window.addEventListener("online", on);
    return () => {
      closed = true; es?.close(); if (retry) clearTimeout(retry); if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("offline", off); window.removeEventListener("online", on);
    };
  }, [router]);
  useEffect(() => { window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { live: state === "live" } })); }, [state]);
  return state;
}
