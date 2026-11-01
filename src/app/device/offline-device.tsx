"use client";
import { useEffect, useState } from "react";
import { CloudOff, Cloud } from "lucide-react";
import { DeviceApp } from "@/components/device/device-app";

/** The device counter outside the signed-in app (offline, or a counter that only bills). */
export function OfflineDevice() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  return (
    <div className="min-h-dvh bg-bg p-4 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[19px] font-semibold">Counter · Drive mode</div>
        <div className="flex items-center gap-3 text-[13px]">
          {online ? <span className="flex items-center gap-1 text-teal"><Cloud size={15} /> Online</span> : <span className="flex items-center gap-1 text-bad"><CloudOff size={15} /> Offline: bills save on this device</span>}
          {online && <a href="/app/device-pos" className="text-teal">Open the full app →</a>}
        </div>
      </div>
      <DeviceApp />
    </div>
  );
}
