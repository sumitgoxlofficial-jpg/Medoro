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
import { DrivePanel, useDriveAccess } from "./drive-panel";

/** Signed-in Drive mode counter: the device app, plus first-time setup and Google Drive for the owner. */
export function DevicePos({ userId, userName, owner, canCredit, discCap, drive }: { userId: string; userName: string; owner: boolean; canCredit: boolean; discCap: number; drive: boolean }) {
  const access = useDriveAccess(owner && drive);
  const who: Who = { userId, userName, owner, canCredit, discCap };
  return (
    <DeviceApp
      who={who}
      empty={(ready) => <Setup owner={owner} userId={userId} drive={drive} access={access} ready={ready} />}
      side={owner && drive ? <DrivePanel ready={access.ready} error={access.error} /> : owner ? <div className="text-[13px] text-muted">Connect Google Drive on the Backup page to keep this device’s data safe in your Drive.</div> : null}
    />
  );
}

function Setup({ owner, userId, drive, access, ready }: { owner: boolean; userId: string; drive: boolean; access: { ready: boolean }; ready: (c: Cfg) => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (!drive || !access.ready) return;
    dev.call("driveStatus").then((s) => setSaved(s.lastSnapshot), () => setSaved(null));
  }, [drive, access.ready, dev]);

  const load = async () => {
    setBusy(true);
    const r = await deviceSeedAction();
    if (!r.ok) { toast(r.error, "red"); setBusy(false); return; }
    try {
      const c = await dev.call("importSeed", r.data, userId);
      toast(`Loaded ${r.data.medicines.length} medicines and ${r.data.batches.length} batches onto this device.`, "green");
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

  return (
    <div className={card}>
      <div className="font-semibold">Set up this device</div>
      <div className="text-sm text-muted">This device has no catalogue yet. Load this branch’s medicines, stock and customers from Medoro once; after that, billing here works without the server.</div>
      {owner ? <Button variant="primary" className="self-start" onClick={load} disabled={busy}><Download size={16} /> {busy ? "Loading…" : "Load catalogue onto this device"}</Button>
        : <div className="text-sm">Ask the owner to sign in on this device once and load the catalogue.</div>}
      {owner && saved && (
        <div className="border-t border-line pt-3 flex flex-col gap-2">
          <div className="font-semibold">Or restore from Google Drive</div>
          <div className="text-sm text-muted">A copy of this pharmacy was saved to your Drive on {dayMonth(new Date(saved))} {hhmm(new Date(saved))}. Restoring brings back every medicine, batch, customer and bill. A device that was set up before opens without the code.</div>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Drive recovery code (XXXX-XXXX-…)" aria-label="Drive recovery code" className={`${input} font-mono`} />
          <Button className="self-start" onClick={restore} disabled={busy}>{busy ? "Restoring…" : "Restore from Google Drive"}</Button>
        </div>
      )}
    </div>
  );
}
