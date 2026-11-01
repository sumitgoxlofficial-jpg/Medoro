"use client";
import { useState, useTransition } from "react";
import { HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deleteMedoroCopyAction, setDriveModeAction, undoMoveAction } from "./actions";
import { dayMonth, hhmm } from "@/lib/dates";

type Move = { state: "moving" | "moved" | "purged"; movedAt?: string; purgedAt?: string; undoUntil: string | null; canUndo: boolean } | null;
const when = (iso: string) => `${dayMonth(new Date(iso))} ${hhmm(new Date(iso))}`;

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

/** Owner's switch for the Drive mode pilot. */
export function DriveModeCard({ on, move }: { on: boolean; move: Move }) {
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
  const undo = () => {
    if (!confirm(move?.state === "moving" ? "Cancel the move? Medoro’s copy goes back to normal." : "Undo the move? Medoro’s copy is used again. Bills made on devices since the move are NOT in it; they stay in your Google Drive.")) return;
    start(async () => { const r = await undoMoveAction(); toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red"); });
  };
  const purge = () => {
    const code = prompt("Delete Medoro’s copy of this pharmacy’s data for good?\n\nBills, stock, customers, suppliers, accounts and stored files are deleted from Medoro’s server. Your data stays in your Google Drive, and the move can’t be undone after this.\n\nType your pharmacy code to confirm:");
    if (!code) return;
    start(async () => { const r = await deleteMedoroCopyAction(code); toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red"); });
  };
  if (move?.state === "purged") {
    return (
      <div className={card} data-testid="move-status">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDrive size={18} className="text-teal" />Your data lives only in your Google Drive</div>
        <div className="text-sm text-muted">Moved on {when(move.movedAt!)}; Medoro’s copy was deleted on {when(move.purgedAt!)}. Bill on <a href="/app/device-pos" className="text-teal">Billing (device)</a>. Keep your Drive recovery code safe: Medoro can’t restore this data.</div>
      </div>
    );
  }
  if (move) {
    return (
      <div className={card} data-testid="move-status">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDrive size={18} className="text-teal" />{move.state === "moved" ? "Your data lives in your Google Drive" : "Moving your data to Google Drive"}</div>
        <div className="text-sm text-muted">
          {move.state === "moved"
            ? <>Moved on {when(move.movedAt!)}. Bill on <a href="/app/device-pos" className="text-teal">Billing (device)</a>. Medoro’s copy is read-only{move.canUndo && move.undoUntil ? <> and the move can be undone until {when(move.undoUntil)}</> : ""}.</>
            : <>Medoro’s copy is read-only while the owner’s device copies and checks everything. Finish it on <a href="/app/device-pos" className="text-teal">Billing (device)</a>, or cancel it here.</>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {move.canUndo && <Button variant="outline" onClick={undo} disabled={pending}>{move.state === "moving" ? "Cancel the move" : "Undo the move"}</Button>}
          {move.state === "moved" && <Button variant="danger-outline" onClick={purge} disabled={pending}>Delete Medoro’s copy</Button>}
        </div>
      </div>
    );
  }
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
