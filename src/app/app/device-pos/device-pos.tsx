"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { dayMonth, hhmm } from "@/lib/dates";
import { DeviceApp } from "@/components/device/device-app";
import { card, input, errText, type Cfg, type Who } from "@/components/device/ui";
import { deviceSeedAction } from "../lab/actions";
import { DevicesPanel, DrivePanel, useDriveConnect } from "./drive-panel";
import { FinishMove, MoveFromMedoro } from "./move";
import { PaymentsPanel } from "./payments-panel";
import { DriveGate } from "./drive-gate";
import { aiGatewayStatusAction, aiStepAction, counterCancelIrnAction, counterIrnAction, einvoiceStatusAction, payLinkAction, payStatusAction } from "../lab/actions";

/** Signed-in Drive mode counter: the device app, plus first-time setup and Google Drive for the owner. */
export function DevicePos({ userId, userName, owner, canCredit, discCap, drive, fresh = false, driveResult = null }: { userId: string; userName: string; owner: boolean; canCredit: boolean; discCap: number; drive: boolean; fresh?: boolean; driveResult?: string | null }) {
  const conn = useDriveConnect(drive);
  const [paying, setPaying] = useState(false);
  const [ai, setAi] = useState<{ remote: boolean; remoteNames: boolean } | null>(null);
  const [einv, setEinv] = useState(false);
  useEffect(() => {
    void payStatusAction().then((r) => setPaying(r.ok && r.data.connected), () => {});
    void einvoiceStatusAction().then((r) => setEinv(r.ok && r.data), () => {});
    void aiGatewayStatusAction().then((r) => setAi(r.ok && r.data.enabled && r.data.model ? { remote: r.data.model === "remote", remoteNames: r.data.remoteNames } : null), () => {});
  }, []);
  const who: Who = { userId, userName, owner, canCredit, discCap, payLink: paying ? payLinkAction : undefined, ai: ai ? { ...ai, step: aiStepAction } : null, einvoice: einv ? { irn: counterIrnAction, cancel: counterCancelIrnAction } : null };
  return (
    <DriveGate fresh={fresh} drive={drive} owner={owner} access={conn.access} driveResult={driveResult}>
    <DeviceApp
      who={who}
      empty={(ready) => <Setup owner={owner} userId={userId} drive={drive} access={conn.access} ready={ready} fresh={fresh} />}
      side={drive ? <>{owner && conn.access?.status === "approved" && <FinishMove />}<DrivePanel access={conn.access} error={conn.error} /></> : owner ? <div className="text-[13px] text-muted">Connect Google Drive on the Backup page to keep this device’s data safe in your Drive and add more counters.</div> : null}
      settingsExtra={owner && drive ? <><DevicesPanel /><PaymentsPanel onChange={setPaying} /></> : null}
    />
    </DriveGate>
  );
}

/** `fresh`: the pharmacy started with its data in Drive, so there is nothing on Medoro to copy or move. */
function Setup({ owner, userId, drive, access, ready, fresh }: { owner: boolean; userId: string; drive: boolean; access: { status: string; role: string } | null; ready: (c: Cfg) => void; fresh: boolean }) {
  const toast = useToast();
  const dev = deviceDb();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [vault, setVault] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (!drive || access?.status !== "approved") return;
    dev.call("driveStatus").then((s) => { setSaved(s.snapshotAt ?? s.lastSnapshot); setVault(s.vault); }, () => setSaved(null));
  }, [drive, access?.status, dev]);

  const load = async () => {
    setBusy(true);
    const r = await deviceSeedAction();
    if (!r.ok) { toast(r.error, "red"); setBusy(false); return; }
    try {
      const c = await dev.call("importSeed", r.data, userId);
      toast(fresh ? "This device is ready. Add your medicines under Stock, or receive a supplier bill under Purchases." : `Loaded ${r.data.medicines.length} medicines and ${r.data.batches.length} batches onto this device.`, "green");
      ready(c);
    } catch (e) { toast(errText(e) || "Couldn’t load the catalogue.", "red"); }
    setBusy(false);
  };
  const restore = async () => {
    setBusy(true);
    try {
      const r = await dev.call("restore", code);
      const c = await dev.call("config");
      if (!c) throw new Error("The copy in Drive has no counter settings.");
      toast(`Restored from Google Drive (copy of ${dayMonth(new Date(r.snapshotAt))} ${hhmm(new Date(r.snapshotAt))}, ${r.applied} later changes).`, "green");
      ready(c);
    } catch (e) { toast(errText(e) || "Restore failed.", "red"); }
    setBusy(false);
  };

  const staffWaiting = !owner && drive && access?.status === "pending";
  // Once offered, the move stays on screen through its own steps (it creates the Drive copy as it finishes).
  const [moveOffered, setMoveOffered] = useState(false);
  const canMove = moveOffered || (!fresh && owner && drive && access?.status === "approved" && access.role === "owner" && vault === false);
  useEffect(() => { if (canMove) setMoveOffered(true); }, [canMove]);
  return (
    <div className="flex flex-col gap-3">
    {canMove && <MoveFromMedoro userId={userId} ready={ready} />}
    <div className={card}>
      <div className="font-semibold">{canMove ? "Or just try it out" : "Set up this device"}</div>
      {owner ? (
        <>
          {fresh ? (
            <>
              <div className="text-sm text-muted">Start your pharmacy on this device. Your medicines, stock, bills and customers are kept here and, once you set up Drive storage, in your Google Drive, encrypted with a key only you hold.{drive ? "" : " Connect Google Drive on the Backup page first, so nothing is kept on this device alone."}</div>
              <Button variant="primary" className="self-start" onClick={load} disabled={busy}><Download size={16} /> {busy ? "Starting…" : "Start my pharmacy on this device"}</Button>
            </>
          ) : (
            <>
              <div className="text-sm text-muted">This device has no catalogue yet. Load this branch’s medicines, stock and customers from Medoro once; after that, billing here works without the server.</div>
              <Button variant="primary" className="self-start" onClick={load} disabled={busy}><Download size={16} /> {busy ? "Loading…" : "Load catalogue onto this device"}</Button>
            </>
          )}
        </>
      ) : staffWaiting ? (
        <div className="text-sm text-muted">This counter has asked to join. Ask the owner to approve it on their counter under <b>Counter → Devices</b>; this page then sets itself up from Google Drive.</div>
      ) : access?.status === "removed" ? (
        <div className="text-sm text-muted">The owner removed this device from Drive mode.</div>
      ) : !saved ? (
        <div className="text-sm text-muted">{drive ? "Connecting to Google Drive…" : "The owner needs to connect Google Drive and set up Drive mode first."}</div>
      ) : null}
      {saved && (
        <div className={`${owner ? "border-t border-line pt-3" : ""} flex flex-col gap-2`}>
          <div className="font-semibold">{owner ? "Or restore from Google Drive" : "Set up from Google Drive"}</div>
          <div className="text-sm text-muted">A copy of this pharmacy was saved to Drive on {dayMonth(new Date(saved))} {hhmm(new Date(saved))}. {owner ? "Restoring brings back every medicine, batch, customer and bill. A device that was set up before opens without the code." : "This brings this counter every medicine, batch, customer and bill, and keeps it in step with the other counters."}</div>
          {owner && <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Drive recovery code (XXXX-XXXX-…)" aria-label="Drive recovery code" className={`${input} font-mono`} />}
          <Button variant={owner ? "outline" : "primary"} className="self-start" onClick={restore} disabled={busy}>{busy ? "Restoring…" : owner ? "Restore from Google Drive" : "Set up from Google Drive"}</Button>
        </div>
      )}
    </div>
    </div>
  );
}
