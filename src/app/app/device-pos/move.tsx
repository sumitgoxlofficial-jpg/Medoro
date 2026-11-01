"use client";
import { useEffect, useState } from "react";
import { CloudUpload, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb, deviceId } from "@/drivedb/device";
import type { MoveBase } from "@/domain/system/drive-move";
import type { MoveCheck } from "@/drivedb/migrate-in";
import { card, errText, type Cfg } from "@/components/device/ui";
import { completeMoveAction, moveExportAction, moveStatusAction, startMoveAction, undoMoveAction } from "../lab/actions";
import { RecoveryCodeCard } from "./drive-panel";

const PARTS = [["sales", "bills"], ["returns", "credit notes"], ["purchases", "purchase bills"], ["movements", "stock movements"], ["loyalty", "loyalty points"]] as const;
type Step = { kind: "idle" } | { kind: "copying"; what: string; done: number } | { kind: "checking" } | { kind: "failed"; checks: MoveCheck[]; error?: string; retrySave?: number }
  | { kind: "saving" } | { kind: "code"; code: string; cfg: Cfg; checks: number };

/**
 * Phase 7, on the owner's device: copies every record from Medoro, checks the counts and totals match, saves it
 * to Google Drive encrypted, and only then marks the move done. Medoro's copy is read-only from the start.
 */
export function MoveFromMedoro({ userId, ready }: { userId: string; ready: (c: Cfg) => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [warnings, setWarnings] = useState<string[]>([]);

  const unwrap = <T,>(r: { ok: true; data: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.data; };

  const go = async () => {
    if (!confirm("Move all of this pharmacy’s data from Medoro into your Google Drive?\n\nWhile it moves, Medoro’s copy is read-only: bill on this device. You can undo the move for 7 days.")) return;
    try {
      unwrap(await startMoveAction());
      setStep({ kind: "copying", what: "medicines, stock and customers", done: 0 });
      const base = unwrap(await moveExportAction("base")) as MoveBase;
      setWarnings(base.warnings);
      await dev.call("moveBegin", base);
      for (const [part, what] of PARTS) {
        let next: string | null = null, done = 0;
        do {
          const page = unwrap(await moveExportAction(part, next)) as { rows: unknown[]; next: string | null };
          done += await dev.call("movePart", part, page.rows);
          setStep({ kind: "copying", what, done });
          next = page.next;
        } while (next);
      }
      setStep({ kind: "checking" });
      const res = await dev.call("moveFinish", userId);
      if (!res.ok) { setStep({ kind: "failed", checks: res.checks }); return; }
      await save(res.checks.length);
    } catch (e) { setStep({ kind: "failed", checks: [], error: errText(e) }); }
  };

  /** Saves the first full copy to Drive (new keys, recovery code), then records the move as done. */
  const save = async (checks: number) => {
    setStep({ kind: "saving" });
    try {
      const st = await dev.call("driveStatus");
      const code = st.vault ? null : await dev.call("createVault");
      let after = await dev.call("driveStatus");
      if (!after.lastSnapshot || after.lastError) { await dev.call("syncNow", true); after = await dev.call("driveStatus"); }
      if (after.lastError || !after.lastSnapshot) throw new Error(`Couldn’t save to Google Drive: ${after.lastError ?? "no copy saved"}. Check the connection and try again.`);
      unwrap(await completeMoveAction({ device: deviceId(), checks }));
      const cfg = await dev.call("config");
      if (!cfg) throw new Error("The device has no counter settings.");
      if (code) setStep({ kind: "code", code, cfg, checks });
      else { toast("Your data now lives in your Google Drive.", "green"); ready(cfg); }
    } catch (e) { setStep({ kind: "failed", checks: [], error: errText(e), retrySave: checks }); }
  };

  const cancel = async () => {
    if (!confirm("Cancel the move? Medoro’s copy goes back to normal and this device is cleared.")) return;
    try { unwrap(await undoMoveAction()); await dev.call("wipe"); setStep({ kind: "idle" }); toast("Move cancelled. Medoro’s copy is in use again.", "green"); }
    catch (e) { toast(errText(e), "red"); }
  };

  if (step.kind === "code") {
    return (
      <div className="flex flex-col gap-3">
        <div className={card}><div className="flex items-center gap-2 font-semibold text-[15px]"><CheckCircle2 size={18} className="text-teal" />Moved and checked</div>
          <div className="text-sm text-muted">All {step.checks} checks matched and the data is saved in your Google Drive, encrypted. Medoro’s copy stays read-only; you can undo the move for 7 days.</div></div>
        <RecoveryCodeCard code={step.code} onDone={() => ready(step.cfg)} />
      </div>
    );
  }

  const busy = step.kind === "copying" || step.kind === "checking" || step.kind === "saving";
  return (
    <div className={card} data-testid="move-card">
      <div className="flex items-center gap-2 font-semibold"><CloudUpload size={18} className="text-teal" />Move all my data from Medoro</div>
      <div className="text-sm text-muted">Copies every medicine, batch, customer, supplier, bill, credit note and purchase onto this device, checks that the counts and totals match Medoro’s exactly, then saves it to your Google Drive, encrypted with a key only you hold. After that, Medoro keeps no working copy: its copy stays read-only for 7 days (you can undo the move then), and is deleted only when you confirm.</div>
      {step.kind === "idle" && <Button variant="primary" className="self-start" onClick={go}>Move all my data</Button>}
      {step.kind === "copying" && <div className="text-sm" role="status">Copying {step.what}… {step.done ? step.done.toLocaleString("en-IN") : ""}</div>}
      {step.kind === "checking" && <div className="text-sm" role="status">Checking counts and totals against Medoro…</div>}
      {step.kind === "saving" && <div className="text-sm" role="status">Saving to your Google Drive…</div>}
      {warnings.length > 0 && <ul className="text-[13px] text-muted list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {step.kind === "failed" && (
        <>
          {step.error && <div className="text-sm text-bad">{step.error}</div>}
          {step.checks.length > 0 && (
            <>
              <div className="text-sm text-bad">The copy on this device doesn’t match Medoro’s, so it wasn’t used. Nothing changed in Medoro.</div>
              <ul className="text-[13px] flex flex-col gap-0.5">
                {step.checks.filter((c) => !c.ok).map((c) => <li key={c.name} className="flex gap-1.5 items-start"><XCircle size={14} className="text-bad mt-0.5 shrink-0" />{c.name}: expected {c.expected}, found {c.got}{c.detail ? ` (${c.detail})` : ""}</li>)}
              </ul>
            </>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={() => (step.retrySave ? save(step.retrySave) : go())}>Try again</Button>
            <Button variant="danger-outline" onClick={cancel}>Cancel the move</Button>
          </div>
        </>
      )}
      {busy && <div className="text-[13px] text-muted">Keep this page open.</div>}
    </div>
  );
}

/** A move whose data is on this device but wasn't recorded as done (the page closed while saving to Drive). */
export function FinishMove() {
  const toast = useToast();
  const dev = deviceDb();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([moveStatusAction(), dev.call("config")]).then(([st, cfg]) => setShow(st.ok && st.data?.state === "moving" && !!cfg?.movedFromMedoro), () => {});
  }, [dev]);
  if (!show) return null;
  const finish = async () => {
    setBusy(true);
    try {
      const st = await dev.call("driveStatus");
      if (!st.lastSnapshot) throw new Error("Set up Drive storage below first, so your data is saved in your Google Drive.");
      if (st.pending) await dev.call("syncNow", true);
      const r = await completeMoveAction({ device: deviceId(), checks: 0 });
      if (!r.ok) throw new Error(r.error);
      toast("Your data now lives in your Google Drive.", "green"); setShow(false);
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };
  return (
    <div className={card}>
      <div className="flex items-center gap-2 font-semibold text-[15px]"><CloudUpload size={18} className="text-teal" />Finish moving to Google Drive</div>
      <div className="text-sm text-muted">Your data is on this device and checked. Save it to Google Drive, then finish the move. Until then, Medoro’s copy stays read-only.</div>
      <Button variant="primary" className="self-start" onClick={finish} disabled={busy}>{busy ? "Finishing…" : "Finish the move"}</Button>
    </div>
  );
}
