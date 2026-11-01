"use client";
import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, KeyRound, Download, Copy, Clock, MonitorSmartphone, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { dayMonth, hhmm } from "@/lib/dates";
import { decideDriveDeviceAction, driveDevicesAction } from "../lab/actions";

type Access = { status: "approved" | "pending" | "removed"; role: "owner" | "staff" } | null;
type Status = { vault: boolean; access: Access; unlocked: boolean; owner: boolean; pending: number; lastSnapshot: string | null; lastPush: string | null; lastPull: string | null; lastError: string | null; needsRestore: boolean };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const when = (iso: string | null) => (iso ? `${dayMonth(new Date(iso))} ${hhmm(new Date(iso))}` : "never");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A name the owner recognises when approving: the kind of device. */
export function deviceLabel() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows PC" : /Mac/i.test(ua) ? "Mac" : "Computer";
}

/** Registers this device for Drive sync (once the database is open) and keeps checking while it waits for approval. */
export function useDriveConnect(enabled: boolean) {
  const [access, setAccess] = useState<Access>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const dev = deviceDb();
    let stop = false;
    const go = async () => {
      try { const a = await dev.call("connect", deviceLabel()); if (!stop) { setAccess(a); setError(null); } return a; }
      catch (e) { if (!stop) setError(errText(e)); return null; }
    };
    let t: ReturnType<typeof setInterval> | undefined;
    void go().then((a) => { if (a?.status === "pending") t = setInterval(async () => { const b = await go(); if (b?.status !== "pending" && t) clearInterval(t); }, 20_000); });
    return () => { stop = true; if (t) clearInterval(t); };
  }, [enabled]);
  return { access, error };
}

/** Google Drive status for this device: set up, unlock, waiting for approval, last sync, save now. */
export function DrivePanel({ access, error }: { access: Access; error: string | null }) {
  const toast = useToast();
  const dev = deviceDb();
  const [st, setSt] = useState<Status | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      let s = await dev.call("driveStatus");
      if (s.vault && !s.unlocked && s.access?.status === "approved") { try { await dev.call("unlock"); s = await dev.call("driveStatus"); } catch { /* owner types the code below */ } }
      setSt(s);
    } catch { /* shown via lastError next time */ }
  }, [dev]);
  useEffect(() => { if (access) void load(); }, [access, load]);
  useEffect(() => { if (access?.status !== "approved") return; const t = setInterval(load, 10_000); return () => clearInterval(t); }, [access?.status, load]);

  const head = (icon: React.ReactNode) => <div className="flex items-center gap-2 font-semibold text-[15px]">{icon}Google Drive</div>;
  if (error) return <div className={card}>{head(<CloudOff size={18} className="text-bad" />)}<div className="text-sm text-muted">{error}</div></div>;
  if (!access || !st) return <div className={card}>{head(<Cloud size={18} className="text-teal" />)}<div className="text-sm text-muted">Connecting…</div></div>;
  if (access.status === "pending") return <div className={card}>{head(<Clock size={18} className="text-amber-600" />)}<div className="text-sm text-muted">Waiting for the owner to approve this device. They approve it on their counter under <b>Counter → Devices</b>. Bills still save here meanwhile.</div></div>;
  if (access.status === "removed") return <div className={card}>{head(<CloudOff size={18} className="text-bad" />)}<div className="text-sm text-muted">The owner removed this device from Drive mode. It no longer syncs.</div></div>;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok, "green"); } catch (e) { toast(errText(e), "red"); }
    await load(); setBusy(false);
  };
  if (code) return <RecoveryCodeCard code={code} onDone={() => setCode(null)} />;

  return (
    <div className={card}>
      {head(<Cloud size={18} className="text-teal" />)}
      {!st.vault ? (
        access.role === "owner" ? (
          <>
            <div className="text-sm text-muted">Keep this pharmacy’s data safe in your own Google Drive, encrypted with a key only you hold. Medoro can’t read it.</div>
            <Button variant="primary" className="self-start" onClick={() => run(async () => setCode(await dev.call("createVault")))} disabled={busy}>{busy ? "Setting up…" : "Set up Drive storage"}</Button>
          </>
        ) : <div className="text-sm text-muted">The owner hasn’t set up Drive storage yet.</div>
      ) : !st.unlocked ? (
        access.role === "owner" ? (
          <>
            <div className="text-sm text-muted">Your pharmacy’s data in Drive is locked on this device. Enter the Drive recovery code once to unlock it here.</div>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="XXXX-XXXX-…" aria-label="Recovery code" className="border border-line rounded-lg px-3 h-9 text-sm font-mono" />
            <Button variant="primary" className="self-start" onClick={() => run(async () => { await dev.call("unlock", typed); setTyped(""); }, "Unlocked. This device syncs with Google Drive now.")} disabled={busy || typed.replace(/[\s-]/g, "").length < 52}>Unlock</Button>
          </>
        ) : <div className="text-sm text-muted">This device doesn’t have the pharmacy’s key yet. Ask the owner to approve it again.</div>
      ) : (
        <>
          <div className="text-[13px] grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            <span className="text-muted">Changes waiting</span><span>{st.pending}</span>
            <span className="text-muted">Last upload</span><span>{when(st.lastPush)}</span>
            <span className="text-muted">Other counters’ changes</span><span>{st.owner && !st.lastPull ? "with each full copy" : when(st.lastPull)}</span>
            {st.owner && <><span className="text-muted">Last full copy</span><span>{when(st.lastSnapshot)}</span></>}
          </div>
          {st.lastError && <div className="text-[13px] text-bad">{st.lastError}</div>}
          {st.needsRestore && <Button variant="primary" className="self-start" onClick={() => run(() => dev.call("restore"), "This counter is up to date again.")} disabled={busy}>Catch up from Google Drive</Button>}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => run(() => dev.call("syncNow"), "Up to date with the other counters.")} disabled={busy}>Sync now</Button>
            {st.owner && <Button size="sm" onClick={() => run(() => dev.call("syncNow", true), "Full copy saved to Google Drive.")} disabled={busy}>Save full copy now</Button>}
          </div>
        </>
      )}
    </div>
  );
}

/** Shows the Drive recovery code once, with download and copy, until the owner confirms they saved it. */
export function RecoveryCodeCard({ code, onDone }: { code: string; onDone: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const download = () => {
    const blob = new Blob([`Medoro Drive recovery code\n\n${code}\n\nKeep this safe. You need it to open your pharmacy's data on a new or reset device.\nMedoro does not have this code and cannot recover it for you.\n`], { type: "text/plain" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "medoro-drive-recovery-code.txt" });
    a.click(); URL.revokeObjectURL(a.href);
  };
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
      <Button variant="primary" className="self-start" disabled={!saved} onClick={onDone}>Done</Button>
    </div>
  );
}

type Device = { deviceId: string; name: string; role: string; status: string; publicKey: JsonWebKey; createdAt: string; lastSeen: string | null };

/** Owner: devices that sync this pharmacy. Approving gives a device the keys; removing changes the keys. */
export function DevicesPanel() {
  const toast = useToast();
  const dev = deviceDb();
  const [rows, setRows] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await driveDevicesAction(); if (r.ok) setRows(r.data); else toast(r.error, "red"); }, [toast]);
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const approve = async (d: Device) => {
    setBusy(d.deviceId);
    try {
      await dev.call("approveDevice", d.deviceId, d.publicKey, d.role === "owner" ? "owner" : "staff", d.name);
      const r = await decideDriveDeviceAction(d.deviceId, true);
      toast(r.ok ? `${d.name} approved. It sets itself up from Google Drive.` : r.error, r.ok ? "green" : "red");
    } catch (e) { toast(errText(e), "red"); }
    setBusy(null); void load();
  };
  const remove = async (d: Device) => {
    if (!confirm(`Remove ${d.name}? It stops syncing and can’t read anything saved after now.`)) return;
    setBusy(d.deviceId);
    try {
      if (d.status === "approved") await dev.call("revokeDevice", d.deviceId);
      const r = await decideDriveDeviceAction(d.deviceId, false);
      toast(r.ok ? `${d.name} removed.` : r.error, r.ok ? "green" : "red");
    } catch (e) { toast(errText(e), "red"); }
    setBusy(null); void load();
  };

  return (
    <div className={`${card} max-w-lg`}>
      <div className="flex items-center gap-2 font-semibold"><MonitorSmartphone size={18} className="text-teal" />Devices</div>
      <div className="text-sm text-muted">Staff sign in on their counter and open Billing on this device; it then waits here for your approval. Approve only devices you recognise.</div>
      <ul className="text-sm divide-y divide-line">
        {(rows ?? []).map((d) => (
          <li key={d.deviceId} className="py-2 flex justify-between items-center gap-2 flex-wrap">
            <span>{d.name} <span className="text-muted">· {d.role} · {d.status}{d.lastSeen ? ` · seen ${when(d.lastSeen)}` : ""}</span></span>
            <span className="flex gap-1.5">
              {d.status === "pending" && <Button size="sm" variant="primary" disabled={!!busy} onClick={() => approve(d)} aria-label={`Approve ${d.name}`}><Check size={14} /> Approve</Button>}
              {d.status !== "removed" && d.role !== "owner" && <Button size="sm" variant="danger-outline" disabled={!!busy} onClick={() => remove(d)} aria-label={`Remove ${d.name}`}><X size={14} /> {d.status === "pending" ? "Refuse" : "Remove"}</Button>}
            </span>
          </li>
        ))}
        {rows && !rows.length && <li className="py-2 text-muted">No devices yet.</li>}
      </ul>
    </div>
  );
}
