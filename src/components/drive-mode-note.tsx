import { driveModeMessage } from "@/lib/drive-mode-note";

/** Shown on server-side analysis screens for Drive-mode pharmacies (wording and rule in lib/drive-mode-note.ts, which is unit-tested). */
export function DriveModeNote({ moved }: { moved?: boolean }) {
  const text = driveModeMessage(moved);
  if (!text) return null;
  return <p role="note" data-testid="drive-mode-note" className="m-0 mb-3 text-[12.5px] text-slate-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 max-w-[1400px]">{text}</p>;
}
