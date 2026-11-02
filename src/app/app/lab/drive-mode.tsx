"use client";
import { Fragment, useState, useTransition } from "react";
import type { TFn } from "@/lib/tr";
import { HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deleteMedoroCopyAction, setDriveModeAction, undoMoveAction } from "./actions";
import { dayMonth, hhmm } from "@/lib/dates";
import { useT } from "@/lib/i18n-client";

type Move = { state: "moving" | "moved" | "purged"; movedAt?: string; purgedAt?: string; undoUntil: string | null; canUndo: boolean } | null;
const when = (iso: string) => `${dayMonth(new Date(iso))} ${hhmm(new Date(iso))}`;

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

/** "Bill on Billing (device)." with the screen name as a link. */
function BillOn({ t }: { t: TFn }) {
  return <>{t("Bill on {link}.").split("{link}").map((x, i) => i ? <Fragment key={i}><a href="/app/device-pos" className="text-teal">{t("Billing (device)")}</a>{x}</Fragment> : x)}</>;
}

/** Owner's switch for the Drive mode pilot. */
export function DriveModeCard({ on, move }: { on: boolean; move: Move }) {
  const toast = useToast();
  const t = useT();
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  const flip = () => {
    if (!value && !confirm(t("Turn on Drive mode (pilot)? Billing gets an extra screen that saves bills on this device. Bills made there aren’t sent to Medoro’s server and won’t show in reports yet."))) return;
    start(async () => {
      const r = await setDriveModeAction(!value);
      if (r.ok) { setValue(r.data); toast(r.message ?? "Saved.", "green"); } else toast(r.error, "red");
    });
  };
  const undo = () => {
    if (!confirm(move?.state === "moving" ? t("Cancel the move? Medoro’s copy goes back to normal.") : t("Undo the move? Medoro’s copy is used again. Bills made on devices since the move are NOT in it; they stay in your Google Drive."))) return;
    start(async () => { const r = await undoMoveAction(); toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red"); });
  };
  const purge = () => {
    const code = prompt(t("Delete Medoro’s copy of this pharmacy’s data for good?\n\nBills, stock, customers, suppliers, accounts, stored files and the activity log are deleted from Medoro’s server. Your data stays in your Google Drive, and the move can’t be undone after this.\n\nType your pharmacy code to confirm:"));
    if (!code) return;
    start(async () => { const r = await deleteMedoroCopyAction(code); toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red"); });
  };
  if (move?.state === "purged") {
    return (
      <div className={card} data-testid="move-status">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDrive size={18} className="text-teal" />{t("Your data lives only in your Google Drive")}</div>
        <div className="text-sm text-muted">{t("Moved on {moved}; Medoro’s copy was deleted on {deleted}.", { moved: when(move.movedAt!), deleted: when(move.purgedAt!) })} <BillOn t={t} /> {t("Keep your Drive recovery code safe: Medoro can’t restore this data.")}</div>
      </div>
    );
  }
  if (move) {
    return (
      <div className={card} data-testid="move-status">
        <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDrive size={18} className="text-teal" />{move.state === "moved" ? t("Your data lives in your Google Drive") : t("Moving your data to Google Drive")}</div>
        <div className="text-sm text-muted">
          {move.state === "moved"
            ? <>{t("Moved on {when}.", { when: when(move.movedAt!) })} <BillOn t={t} /> {move.canUndo && move.undoUntil ? t("Medoro’s copy is read-only and the move can be undone until {when}.", { when: when(move.undoUntil) }) : t("Medoro’s copy is read-only.")}</>
            : <>{t("Medoro’s copy is read-only while the owner’s device copies and checks everything.")} {t("Finish it on {link}, or cancel it here.").split("{link}").map((x, i) => i ? <Fragment key={i}><a href="/app/device-pos" className="text-teal">{t("Billing (device)")}</a>{x}</Fragment> : x)}</>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {move.canUndo && <Button variant="outline" onClick={undo} disabled={pending}>{move.state === "moving" ? t("Cancel the move") : t("Undo the move")}</Button>}
          {move.state === "moved" && <Button variant="danger-outline" onClick={purge} disabled={pending}>Delete Medoro’s copy</Button>}
        </div>
      </div>
    );
  }
  return (
    <div className={card}>
      <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDrive size={18} className="text-teal" />{t("Drive mode (pilot)")}</div>
      <div className="text-sm text-muted">
        {t("Bill on each device’s own database instead of Medoro’s server. In this pilot, bills made in Drive mode stay on the device (and are queued for your Google Drive); they don’t show in reports or other devices yet. Use it on one counter to try it out.")}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant={value ? "danger-outline" : "primary"} onClick={flip} disabled={pending}>{value ? t("Turn off Drive mode") : t("Turn on Drive mode")}</Button>
        {value && <a href="/app/device-pos" className="text-[13px] text-teal">{t("Open billing on this device")} →</a>}
      </div>
    </div>
  );
}
