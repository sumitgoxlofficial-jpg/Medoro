"use client";
import { useEffect, useState } from "react";
import { getDevice, getQueue, syncNow } from "@/lib/offline/store";

/**
 * On a counter with offline billing turned on, keeps the device ready for the next outage:
 * sends any bills made offline, refreshes the price list and stock allowance every few minutes,
 * and asks the service worker to keep the offline billing page cached.
 */
export function useOfflineAgent(branchId: string) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (stop || !navigator.onLine) return;
      const d = await getDevice().catch(() => undefined);
      if (!d || d.branchId !== branchId) { setEnabled(false); return; }
      setEnabled(true);
      const pending = (await getQueue()).some((b) => b.state === "pending");
      await syncNow().catch(() => undefined);
      navigator.serviceWorker?.controller?.postMessage("warm");
      if (pending && !stop) window.dispatchEvent(new CustomEvent("medoro:offline-synced"));
    };
    tick();
    timer = setInterval(tick, 5 * 60_000);
    window.addEventListener("online", tick);
    return () => { stop = true; if (timer) clearInterval(timer); window.removeEventListener("online", tick); };
  }, [branchId]);
  return enabled;
}
