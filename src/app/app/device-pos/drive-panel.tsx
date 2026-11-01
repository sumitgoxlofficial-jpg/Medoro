"use client";
import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, KeyRound, Download, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { dayMonth, hhmm } from "@/lib/dates";
import { driveAccessAction } from "../lab/actions";

type Status = { vault: boolean; unlocked: boolean; pending: number; lastSnapshot: string | null; lastPush: string | null; lastError: string | null };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const when = (iso: string | null) => (iso ? `${dayMonth(new Date(iso))} ${hhmm(new Date(iso))}` : "never");

/** Keeps the Drive pass fresh for the worker. Returns whether Drive is reachable. */
export function useDriveAccess(enabled: boolean) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const dev = deviceDb();
    let stop = false;
    const refresh = async () => {
      const r = await driveAccessAction();
      if (stop) return;
      if (!r.ok) { setError(r.error); setReady(false); return; }
      await dev.call("setDriveAccess", r.data);
      setError(null); setReady(true);
    };
    void refresh();
    const t = setInterval(refresh, 40 * 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [enabled]);
  return { ready, error };
}

/** Google Drive status for this device: set up, unlock, last saved, save now. Owner only. */
export function DrivePanel({ ready, error }: { ready: boolean; error: string | null }) {
  const toast = useToast();
  const dev = deviceDb();
  const [st, setSt] = useState<Status | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Status problems show in the panel, not as pop-ups, so they never cover billing messages.
  const load = useCallback(async () => {
    try {
      let s = await dev.call("driveStatus");
      if (s.vault && !s.unlocked) {
        // A device approved before opens with its own key; otherwise the owner types the code below.
        try { await dev.call("unlock"); s = await dev.call("driveStatus"); } catch { /* needs the code */ }
      }
      setSt(s); setProblem(null);
    } catch (e) { setProblem(`Can’t reach Google Drive right now (${e instanceof Error ? e.message : String(e)}). Bills still save on this device and upload later.`); }
  }, [dev]);

  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => { if (!ready || !st?.unlocked) return; const t = setInterval(load, 15_000); return () => clearInterval(t); }, [ready, st?.unlocked, load]);

  if (problem && !st) return <div className={card}><div className="flex items-center gap-2 font-semibold text-[15px]"><CloudOff size={18} className="text-bad" />Google Drive</div><div className="text-sm text-muted">{problem}</div></div>;
  if (error) return <div className={card}><div className="flex items-center gap-2 font-semibold text-[15px]"><CloudOff size={18} className="text-bad" />Google Drive</div><div className="text-sm text-muted">{error}</div></div>;
  if (!ready || !st) return <div className={card}><div className="flex items-center gap-2 font-semibold text-[15px]"><Cloud size={18} className="text-teal" />Google Drive</div><div className="text-sm text-muted">Connecting…</div></div>;

  const setup = async () => {
    setBusy(true);
    try { setCode(await dev.call("createVault")); await load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), "red"); }
    setBusy(false);
  };
  const unlock = async () => {
    setBusy(true);
    try { await dev.call("unlock", typed); setTyped(""); toast("Unlocked. This device saves to Google Drive now.", "green"); await load(); } catch (e) { toast(e instanceof Error ? e.message : String(e), "red"); }
    setBusy(false);
  };
  const saveNow = async () => {
    setBusy(true);
    const r = await dev.call("syncNow", true);
    if (r.lastError) toast(r.lastError, "red"); else toast("Full copy saved to Google Drive.", "green");
    await load(); setBusy(false);
  };
  const download = () => {
    const blob = new Blob([`Medoro Drive recovery code\n\n${code}\n\nKeep this safe. You need it to open your pharmacy's data on a new or reset device.\nMedoro does not have this code and cannot recover it for you.\n`], { type: "text/plain" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "medoro-drive-recovery-code.txt" });
    a.click(); URL.revokeObjectURL(a.href);
  };

  if (code) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 font-semibold text-[15px]"><KeyRound size={18} className="text-teal" />Save your Drive recovery code</div>
        <div className="text-sm text-muted">This code opens your pharmacy’s data on a new or reset device. <b>Medoro doesn’t have it and can’t recover it.</b> Download it or write it down and keep it safe.</div>
        <div className="font-mono text-[15px] bg-page border border-line rounded-lg p-3 break-all select-all" data-testid="recovery-code">{code}</div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={download}><Download size={16} /> Download</Button>
          <Button onClick={() => navigator.clipboard.writeText(code).then(() => toast("Copied.", "green"))}><Copy size={16} /> Copy</Button>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I’ve saved the recovery code somewhere safe</label>
        <Button variant="primary" className="self-start" disabled={!saved} onClick={() => setCode(null)}>Done</Button>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="flex items-center gap-2 font-semibold text-[15px]"><Cloud size={18} className="text-teal" />Google Drive</div>
      {!st.vault ? (
        <>
          <div className="text-sm text-muted">Keep this device’s pharmacy data safe in your own Google Drive, encrypted with a key only you hold. Medoro can’t read it.</div>
          <Button variant="primary" className="self-start" onClick={setup} disabled={busy}>{busy ? "Setting up…" : "Set up Drive storage"}</Button>
        </>
      ) : !st.unlocked ? (
        <>
          <div className="text-sm text-muted">Your pharmacy’s data in Drive is locked on this device. Enter the Drive recovery code once to unlock it here.</div>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="XXXX-XXXX-…" aria-label="Recovery code" className="border border-line rounded-lg px-3 h-9 text-sm font-mono" />
          <Button variant="primary" className="self-start" onClick={unlock} disabled={busy || typed.replace(/[\s-]/g, "").length < 52}>Unlock</Button>
        </>
      ) : (
        <>
          <div className="text-[13px] grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            <span className="text-muted">Changes waiting</span><span>{st.pending}</span>
            <span className="text-muted">Last upload</span><span>{when(st.lastPush)}</span>
            <span className="text-muted">Last full copy</span><span>{when(st.lastSnapshot)}</span>
          </div>
          {(st.lastError || problem) && <div className="text-[13px] text-bad">{st.lastError ?? problem}</div>}
          <Button className="self-start" onClick={saveNow} disabled={busy}>{busy ? "Saving…" : "Save full copy now"}</Button>
        </>
      )}
    </div>
  );
}
