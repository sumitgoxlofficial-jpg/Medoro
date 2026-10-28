"use client";
import { useEffect } from "react";

/** Registers the service worker (production builds, or NEXT_PUBLIC_SW=1 in development). */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW !== "1") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
