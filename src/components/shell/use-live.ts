"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
      es.addEventListener("change", () => {
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
  return state;
}
