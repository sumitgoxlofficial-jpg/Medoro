"use client";
import { useEffect, useState } from "react";

/**
 * The current time (ms), read once when the component mounts and then every `intervalMs` (0 = never again).
 * Use it instead of calling Date.now() while rendering, so time-dependent UI (greetings, lunch banners, expiry checks)
 * updates on its own and renders are pure.
 */
export function useNow(intervalMs = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Today's date in India time (YYYY-MM-DD) for a given instant. */
export const istDay = (ms: number, addDays = 0) => new Date(ms + 5.5 * 3600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
