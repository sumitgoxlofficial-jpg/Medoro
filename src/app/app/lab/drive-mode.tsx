"use client";
import { useState, useTransition } from "react";
import { HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setDriveModeAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

/** Owner's switch for the Drive mode pilot. */
export function DriveModeCard({ on }: { on: boolean }) {
  const toast = useToast();
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  const flip = () => {
    if (!value && !confirm("Turn on Drive mode (pilot)? Billing gets an extra screen that saves bills on this device. Bills made there aren’t sent to Medoro’s server and won’t show in reports yet.")) return;
    start(async () => {
      const r = await setDriveModeAction(!value);
      if (r.ok) { setValue(r.data); toast(r.message ?? "Saved.", "green"); } else toast(r.error, "red");
    });
  };
  return (
    <div className={card}>
      <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDrive size={18} className="text-teal" />Drive mode (pilot)</div>
      <div className="text-sm text-muted">
        Bill on each device’s own database instead of Medoro’s server. In this pilot, bills made in Drive mode stay on the device
        (and are queued for your Google Drive); they don’t show in reports or other devices yet. Use it on one counter to try it out.
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant={value ? "danger-outline" : "primary"} onClick={flip} disabled={pending}>{value ? "Turn off Drive mode" : "Turn on Drive mode"}</Button>
        {value && <a href="/app/device-pos" className="text-[13px] text-teal">Open billing on this device →</a>}
      </div>
    </div>
  );
}
