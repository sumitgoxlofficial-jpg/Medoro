"use client";
import { useEffect, useState } from "react";
import { Cloud, CloudOff, HardDrive, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deviceDb, deviceId } from "@/drivedb/device";
import { errText } from "@/components/device/ui";
import { useT } from "@/lib/i18n-client";
import { RecoveryCodeCard } from "./drive-panel";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5 flex flex-col gap-3 max-w-xl";
type Access = { status: "approved" | "pending" | "removed"; role: "owner" | "staff" } | null;

/**
 * For a pharmacy that keeps its data in Google Drive: a new counter can't start billing until Google Drive is
 * connected and Drive storage is set up (keys made, recovery code saved), so no bill ever lives on one device only.
 * A counter that is already set up is never blocked, even if Drive is disconnected later: it keeps billing and syncs
 * when Drive is back.
 */
export function DriveGate({ fresh, move = false, drive, owner, access, driveResult, children }: { fresh: boolean; move?: boolean; drive: boolean; owner: boolean; access: Access; driveResult: string | null; children: React.ReactNode }) {
  const dev = deviceDb();
  const [state, setState] = useState<"checking" | "pass" | "connect" | "storage" | "waiting">(fresh ? "checking" : "pass");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    if (!fresh || state === "pass") return;
    let stop = false;
    (async () => {
      try {
        await dev.call("open", deviceId());
        if (await dev.call("config")) { if (!stop) setState("pass"); return; } // already set up: never blocked
        if (!drive) { if (!stop) setState("connect"); return; }
        if (move) { if (!stop) setState("pass"); return; } // moving from Medoro: the move itself sets up Drive storage
        if (!access) return; // registering this device with Drive mode
        if (access.status !== "approved") { if (!stop) setState("waiting"); return; }
        const st = await dev.call("driveStatus");
        if (!stop) setState(st.vault ? "pass" : owner ? "storage" : "waiting");
      } catch (e) { if (!stop) setErr(errText(e)); }
    })();
    return () => { stop = true; };
  }, [fresh, move, drive, access, owner, dev, state]);

  if (state === "pass" && !code) return <>{children}</>;
  if (code) return <RecoveryCodeCard code={code} onDone={() => { setCode(null); setState("pass"); }} />;

  const setUp = async () => {
    setBusy(true); setErr(null);
    try { setCode(await dev.call("createVault")); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const failed = driveResult && driveResult !== "ok" ? t({ denied: "Google Drive wasn’t connected: access was declined.", scope: "Not all Google Drive access was allowed. Connect again and tick both Google Drive boxes on Google’s screen.", error: "Connecting Google Drive failed. Try again.", state: "That sign-in expired. Try again.", forbidden: "Only the owner can connect Google Drive." }[driveResult] ?? "Google Drive wasn’t connected. Try again.") : null;

  return (
    <div className={card} data-testid="drive-gate">
      {state === "checking" && <div className="text-sm text-muted flex items-center gap-2"><Cloud size={18} className="text-teal" />{t("Checking Google Drive…")}</div>}
      {state === "connect" && (owner ? (
        <>
          <div className="flex items-center gap-2 font-semibold text-[16px]"><CloudOff size={20} className="text-teal" />{t("Step 1 of 2: connect your Google Drive")}</div>
          <div className="text-sm text-muted">{move ? t("Medoro now keeps every pharmacy’s data in its own Google Drive, not on Medoro’s server. Connect yours, then move your data into it (step 2).") : t("Your pharmacy keeps its records in your own Google Drive, so connect it before the first bill.")} {t("Medoro can see only the files it creates there, and everything is encrypted with a key only you hold.")}</div>
          {failed && <div className="text-sm text-bad">{failed}</div>}
          <a href="/api/integrations/google/start?back=device" className="self-start bg-teal text-white rounded-lg px-4 py-2.5 text-sm font-semibold no-underline hover:bg-teal-hover hover:text-white">{t("Connect Google Drive")}</a>
        </>
      ) : <div className="text-sm text-muted">{t("The owner needs to connect the pharmacy’s Google Drive before counters can start billing. Ask them to open Billing (device) on their counter.")}</div>)}
      {state === "storage" && (
        <>
          <div className="flex items-center gap-2 font-semibold text-[16px]"><HardDrive size={20} className="text-teal" />{t("Step 2 of 2: set up Drive storage")}</div>
          <div className="text-sm text-muted">{t("This makes your pharmacy’s encryption keys and a recovery code. Every bill is then saved to your Google Drive, encrypted, and other counters and a new device can open it. Medoro never has the key.")}</div>
          <Button variant="primary" className="self-start" onClick={setUp} disabled={busy}>{busy ? t("Setting up…") : t("Set up Drive storage")}</Button>
        </>
      )}
      {state === "waiting" && (
        <div className="text-sm text-muted flex items-start gap-2"><Clock size={18} className="text-amber-600 shrink-0" />{access?.status === "removed" ? t("The owner removed this device from Drive mode.") : access?.status === "pending" ? <>{t("Waiting for the owner to approve this device under")} <b>{t("Counter → Devices")}</b> {t("on their counter.")}</> : t("The owner needs to set up Drive storage on their counter before this counter can start.")}</div>
      )}
      {err && <div className="text-sm text-bad">{t(err)}</div>}
    </div>
  );
}
