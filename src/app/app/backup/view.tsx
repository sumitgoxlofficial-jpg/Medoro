"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HardDriveUpload, KeyRound, Download, CloudOff, TriangleAlert, DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { dayMonth, hhmm } from "@/lib/dates";
import type { DriveState } from "@/domain/system/gdrive";
import { backupNowAction, disconnectAction, driveBackupsAction, prepareRestoreAction, reenterKitAction, restoreAction, restoreFromDriveAction, settingsAction } from "./actions";
import { RestorePanel, type PendingRestore } from "./restore-panel";

type H = { id: string; at: string; kind: string; size: number; sha: string | null; status: string; error: string | null; drive: boolean; local: boolean };
const ST: Record<string, [string, Tone]> = { verified: ["Verified", "green"], partial: ["Partial", "amber"], failed: ["Failed", "red"], running: ["Running", "blue"], expired: ["Expired", "gray"] };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const FLASH: Record<string, [string, "green" | "red"]> = { ok: ["Google Drive connected.", "green"], denied: ["Google access was not granted.", "red"], error: ["Couldn’t connect Google Drive. Try again.", "red"], state: ["The Google sign-in expired. Try again.", "red"], forbidden: ["Your role can’t connect integrations.", "red"], scope: ["Drive access wasn’t ticked on Google’s consent screen. Connect again and allow it.", "red"] };
type DriveFile = { id: string; name: string; size: number; createdTime: string; known: boolean };

export function BackupView({ history, drive, folder, driveApp, fingerprint, keyDate, keyState, settings, flash, problems, canRestore, pendingRestore, code, hostCron }: {
  history: H[]; drive: DriveState; folder: string; driveApp: boolean; fingerprint: string | null; keyDate: string | null; keyState: "ok" | "missing" | "unreadable";
  settings: { schedule: string; retention: number; files: "server" | "gdrive"; every: number }; flash: string | null; problems: string[];
  canRestore: boolean; pendingRestore: PendingRestore | null; code: string; hostCron: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const connected = drive.status === "connected";
  const [kit, setKit] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const prepared = (r: { ok: true } | { ok: false; error: string }) => {
    setLoading(null);
    if (!r.ok) return toast(r.error, "red");
    toast("Test copy ready. Review it at the top of the page.", "green");
    router.refresh(); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const upload = () => {
    if (!file) return;
    setLoading("upload");
    const fd = new FormData(); fd.set("file", file); fd.set("kit", kit);
    fetch("/api/backups/import", { method: "POST", body: fd }).then((r) => r.json()).then(prepared, () => prepared({ ok: false, error: "Upload failed. Check the connection and try again." }));
  };
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const [s, setS] = useState(settings);
  const [restore, setRestore] = useState<{ h: H; result?: string; error?: string } | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const prepare = (h: H) => {
    if (pendingRestore && !confirm("This replaces the restore that’s waiting for review. Continue?")) return;
    setPreparing(h.id);
    start(async () => {
      const r = await prepareRestoreAction(h.id);
      setPreparing(null);
      if (!r.ok) toast(r.error, "red");
      else { toast("Test copy ready. Review it at the top of the page.", "green"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  };
  useEffect(() => { if (flash && FLASH[flash]) toast(...FLASH[flash]); }, [flash, toast]);
  return (
    <div className="flex flex-col gap-4 max-w-[1300px]">
      {problems.length ? (
        <div role="alert" className="flex gap-2.5 items-start bg-bad-bg border border-[#F0C8C3] rounded-xl p-3.5 text-[13.5px] text-bad">
          <TriangleAlert size={17} className="flex-none mt-0.5" /><div className="flex flex-col gap-0.5">{problems.map((x) => <span key={x}>{x}</span>)}</div>
        </div>
      ) : null}
      {pendingRestore ? <RestorePanel key={pendingRestore.runId} p={pendingRestore} code={code} /> : null}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className={card}>
          <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDriveUpload size={18} className="text-teal" />Google Drive</div>
          {drive.status === "connected" ? (
            <>
              <div className="grid grid-cols-[110px_1fr] gap-1 text-[13.5px]"><span className="text-muted">Account</span><span>{drive.account || "Connected"}</span><span className="text-muted">Folder</span><span>{folder}</span><span className="text-muted">Access</span><span>Only files Medoro creates</span></div>
              {canRestore ? <a href="/app/lab" className="self-start text-[13px] text-teal">Coming soon: keep all data in your Drive. Test this device&nbsp;→</a> : null}
              <Button variant="danger-outline" className="self-start" disabled={pending} onClick={() => start(async () => { const r = await disconnectAction(); toast(r.ok ? r.data : r.error, r.ok ? "green" : "red"); })}>Disconnect & revoke</Button>
            </>
          ) : drive.status === "lost" && driveApp ? (
            <>
              <div className="text-[13px] text-bad bg-bad-bg rounded-lg p-2.5">Google stopped accepting Medoro’s access{drive.account ? ` to ${drive.account}` : ""} on {dayMonth(new Date(drive.at), true)}. Backups are kept on this server until you reconnect.{drive.reason ? <span className="block text-[12px] mt-0.5">{drive.reason}</span> : null}</div>
              <a href="/api/integrations/google/start" className="self-start bg-teal text-white rounded-lg px-3 py-2 text-[13.5px] font-semibold no-underline hover:bg-teal-hover hover:text-white">Reconnect Google Drive</a>
            </>
          ) : driveApp ? (
            <>
              <div className="text-[13px] text-muted">Medoro asks only for access to files it creates. It cannot read the rest of your Drive.</div>
              <a href="/api/integrations/google/start" className="self-start bg-teal text-white rounded-lg px-3 py-2 text-[13.5px] font-semibold no-underline hover:bg-teal-hover hover:text-white">Connect Google Drive</a>
            </>
          ) : (
            <div className="text-[13px] text-muted flex gap-2"><CloudOff size={16} className="flex-none mt-0.5" /><div className="flex flex-col gap-1"><span>Google Drive backup isn’t set up on this server yet. Ask whoever set up your Medoro server to turn on Google sign-in. Until then, backups are kept on this server.</span><details><summary className="cursor-pointer text-[12px] text-faint">Technical details</summary><span className="block mt-1 text-[12px]">Set <span className="font-mono">GOOGLE_OAUTH_CLIENT_ID</span>, <span className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</span> and <span className="font-mono">GOOGLE_OAUTH_REDIRECT_URI</span> on the server.</span></details></div></div>
          )}
        </div>
        <div className={card}>
          <div className="flex items-center gap-2 font-semibold text-[15px]"><KeyRound size={18} className="text-teal" />Encryption</div>
          <div className="text-[13.5px]">Every backup is encrypted on your server, with its own key, before it’s stored.</div>
          <div className="text-[13px] text-muted">Each backup’s key is wrapped by your recovery-kit key. This server keeps a copy of that key, locked with this server’s own key, so it can back up and restore on its own; it never goes to Drive or Medoro. On a new server, the printed kit opens your backups.{keyDate ? ` Kit created ${dayMonth(new Date(keyDate), true)}.` : ""}{fingerprint ? <> Fingerprint <span className="font-mono">{fingerprint}</span>.</> : " No key found."}</div>
          {keyState !== "ok" ? (
            <div className="flex flex-col gap-2 bg-bad-bg rounded-lg p-2.5">
              <span className="text-[13px] text-bad">{keyState === "missing" ? "This server has no backup key." : "This server can’t open its copy of the backup key (the server’s key changed)."} Backups stop until you enter the recovery kit.</span>
              <textarea value={kit} onChange={(e) => setKit(e.target.value)} rows={2} placeholder="Paste the recovery kit or its 43-character key" aria-label="Recovery kit" className="border border-input rounded-md px-2 py-1.5 text-[12.5px] font-mono bg-white" />
              <Button variant="primary" className="self-start" disabled={pending || !kit.trim()} onClick={() => start(async () => { const r = await reenterKitAction(kit); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok) setKit(""); })}>Use this kit</Button>
            </div>
          ) : null}
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Schedule & retention</div>
          <label className="flex items-center justify-between gap-3 text-[13.5px]">Back up<select value={s.every} onChange={(e) => setS({ ...s, every: Number(e.target.value) })} className="h-10 min-w-[140px] px-2.5 rounded-lg border border-line bg-white">{[[24, "Once a day"], [6, "Every 6 hours"], [3, "Every 3 hours"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3 text-[13.5px]">{s.every === 24 ? "Daily at" : "Nightly at"}<input type="time" value={s.schedule} onChange={(e) => setS({ ...s, schedule: e.target.value })} className="h-10 min-w-[140px] px-2.5 rounded-lg border border-line bg-white" /></label>
          <label className="flex items-center justify-between gap-3 text-[13.5px]">Keep backups for<select value={s.retention} onChange={(e) => setS({ ...s, retention: Number(e.target.value) })} className="h-10 min-w-[140px] px-2.5 rounded-lg border border-line bg-white">{[[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="flex items-center justify-between gap-3 text-[13.5px]" title="Invoice scans and other uploaded documents">Uploaded files<select value={s.files} onChange={(e) => {
            const v = e.target.value as "server" | "gdrive";
            // Choosing Drive before it's connected takes the owner straight to Google's connect screen.
            if (v === "gdrive" && !connected && settings.files !== "gdrive") {
              if (driveApp) { toast("Connect your Google Drive first. Opening Google…", "blue"); window.location.href = "/api/integrations/google/start"; }
              else toast("Google Drive isn’t set up on this server yet.", "red");
              return;
            }
            setS({ ...s, files: v });
          }} className="h-10 min-w-[140px] px-2.5 rounded-lg border border-line bg-white"><option value="server">On this server</option><option value="gdrive" disabled={!driveApp && !connected && settings.files !== "gdrive"}>{connected || settings.files === "gdrive" ? "In Google Drive" : "In Google Drive (connect)"}</option></select></label>
          {s.files === "gdrive" ? <div className="text-[12px] text-faint -mt-1">New uploads go straight to {folder}/files. If Drive can’t be reached they wait on the server and move to Drive with the next backup.</div> : null}
          <div className="flex gap-2">
            {s.schedule !== settings.schedule || s.retention !== settings.retention || s.files !== settings.files || s.every !== settings.every ? <Button disabled={pending} onClick={() => start(async () => { const r = await settingsAction(s.schedule, s.retention, s.files, s.every); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); })}>Save</Button> : null}
            <Button variant="primary" disabled={running} onClick={async () => { setRunning(true); const r = await backupNowAction(); setRunning(false); toast(r.ok ? `Backup verified · ${(r.data.size / 1048576).toFixed(2)} MB${r.data.drive ? " · saved in your Google Drive" : " · kept on this server until Drive is connected"}${r.data.note ? ". " + r.data.note : ""}` : r.error, r.ok ? (r.data.note ? "amber" : "green") : "red"); }}>{running ? "Backing up…" : "Back up now"}</Button>
          </div>
          <div className="text-[12px] text-faint">{s.every !== 24 ? `Besides the nightly backup, a new one starts every ${s.every} hours while anyone is using Medoro. ` : ""}{hostCron ? "On this hosting the nightly backup runs at about 03:00 India time, whatever time is set here. If it fails, use Back up now." : "Times are India time. A failed scheduled backup is retried up to 2 more times that day, at least 30 minutes apart."}</div>
        </div>
      </div>
      {running ? <div className="bg-white border border-teal-line rounded-xl px-4 py-3 text-[13.5px]">Snapshot → encrypt → write → verify{connected ? " → upload" : ""}… <div className="h-1.5 bg-line-soft rounded mt-2 overflow-hidden"><div className="h-full w-1/2 bg-teal animate-pulse" /></div></div> : null}
      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto tbl-scroll">
        <div className="font-semibold text-[15px] px-4 pt-3.5 pb-2">Backup history</div>
        {history.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-subtle">{["Time", "Type", "Size", "Checksum", "Status", ""].map((x) => <th key={x} className="text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9]">{x}</th>)}</tr></thead>
            <tbody>
              {history.map((h) => {
                const [label, tone] = ST[h.status] ?? [h.status, "gray"];
                return (
                  <tr key={h.id}>
                    <td className="px-3.5 py-2.5 border-b border-row">{dayMonth(new Date(h.at), true)} · {hhmm(new Date(h.at))}</td>
                    <td className="px-3.5 py-2.5 border-b border-row capitalize">{h.kind}</td>
                    <td className="px-3.5 py-2.5 border-b border-row tnum">{h.size ? `${(h.size / 1048576).toFixed(2)} MB` : "—"}</td>
                    <td className="px-3.5 py-2.5 border-b border-row font-mono text-[12px]">{h.sha ? `${h.sha.slice(0, 6)}…${h.sha.slice(-4)}` : "—"}</td>
                    <td className="px-3.5 py-2.5 border-b border-row"><Badge tone={tone}>{label}{h.drive ? " · Drive" : ""}</Badge>{h.error ? <div className="text-[12px] text-bad mt-0.5 max-w-[320px]">{h.error}</div> : null}</td>
                    <td className="px-3.5 py-2.5 border-b border-row text-right whitespace-nowrap">
                      {(h.local || h.drive) && (h.status === "verified" || h.status === "partial") ? (
                        <div className="flex gap-1.5 justify-end">
                          <Button size="sm" onClick={() => { setRestore({ h }); start(async () => { const r = await restoreAction(h.id); setRestore(r.ok ? { h, result: `${r.data.sales} invoices, ${r.data.batches} batches and ${r.data.vouchers} vouchers decrypted and match the manifest.` } : { h, error: r.error }); }); }}>Test restore</Button>
                          {canRestore ? <Button size="sm" disabled={!!preparing} onClick={() => prepare(h)}>{preparing === h.id ? "Preparing test copy…" : "Restore…"}</Button> : null}
                          <a href={`/api/backups/${h.id}`} className="flex items-center gap-1 border border-input rounded-md px-2 h-7 text-[12.5px] text-ink no-underline hover:border-teal" aria-label="Download encrypted file"><Download size={13} /></a>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="px-4 pb-4 text-[13px] text-fainter">No backups yet. Take one now, or wait for the daily schedule.</div>}
      </div>
      {canRestore ? (
        <div className={card}>
          <div className="flex items-center gap-2 font-semibold text-[15px]"><DatabaseBackup size={18} className="text-teal" />{connected ? "Restore a backup file, or one from Google Drive" : "Restore a backup file"}</div>
          <div className="text-[13px] text-muted">For a backup that isn’t in the history above, e.g. downloaded earlier or made on another server. It opens with this server’s key; if it was made with a different copy of the key, paste the recovery kit. It loads into a test copy first and live data changes only after you confirm.</div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="inline-flex items-center justify-center gap-1.5 h-[34px] max-md:h-10 px-3 rounded-lg border border-line bg-white text-ink text-[13px] font-medium shadow-card cursor-pointer hover:bg-page hover:border-input focus-within:outline-2 focus-within:outline-teal">
              <HardDriveUpload size={15} />Choose backup file…
              <input type="file" accept=".mdrbak,application/octet-stream" aria-label="Backup file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
            </label>
            <span className={`text-[13px] min-w-0 truncate max-w-[260px] ${file ? "text-ink" : "text-faint"}`}>{file ? file.name : "No file chosen"}</span>
          </div>
          <textarea value={kit} onChange={(e) => setKit(e.target.value)} rows={2} placeholder="Recovery kit or its 43-character key (optional)" aria-label="Recovery kit for restore" className="border border-input rounded-md px-2 py-1.5 text-[12.5px] font-mono placeholder:font-sans placeholder:text-[13px] max-w-[560px]" />
          <div className="flex gap-2 items-center flex-wrap">
            <Button disabled={!file || !!loading} onClick={upload}>{loading === "upload" ? "Decrypting and loading…" : "Load uploaded file"}</Button>
            {connected ? <Button disabled={!!loading} onClick={() => { setLoading("list"); driveBackupsAction().then((r) => { setLoading(null); if (r.ok) setDriveFiles(r.data); else toast(r.error, "red"); }); }}>{loading === "list" ? "Looking in Drive…" : "Show backups in Google Drive"}</Button> : null}
          </div>
          {driveFiles ? (driveFiles.length ? (
            <div className="border border-line rounded-lg max-h-[280px] overflow-auto">
              {driveFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 border-b border-row last:border-0 text-[13px]">
                  <span className="flex-1">{dayMonth(new Date(f.createdTime), true)} · {hhmm(new Date(f.createdTime))}<span className="text-faint"> · {(f.size / 1048576).toFixed(2)} MB{f.known ? " · also on this server" : ""}</span></span>
                  <Button size="sm" disabled={!!loading} onClick={() => { setLoading(f.id); restoreFromDriveAction(f.id, kit).then(prepared); }}>{loading === f.id ? "Downloading…" : "Restore…"}</Button>
                </div>
              ))}
            </div>
          ) : <div className="text-[13px] text-fainter">No Medoro backups of this pharmacy in the connected Drive.</div>) : null}
        </div>
      ) : null}
      <Modal open={!!restore} onClose={() => setRestore(null)} title="Test restore" sub={restore ? `${dayMonth(new Date(restore.h.at), true)} · ${restore.h.kind}` : ""} width={460} footer={<Button onClick={() => setRestore(null)}>Close</Button>}>
        {restore && !restore.result && !restore.error ? <div className="text-[13.5px]">Checking checksum → unwrapping key → decrypting → comparing every table with the manifest…</div> : null}
        {restore?.result ? <div className="text-[13.5px] text-ok bg-ok-bg rounded-lg p-3">Verified. {restore.result} Live data has not been changed.</div> : null}
        {restore?.error ? <div className="text-[13.5px] text-bad bg-bad-bg rounded-lg p-3">{restore.error}</div> : null}
        <div className="text-[12px] text-faint">To bring a backup back, use Restore… on its row: it loads into a test copy first, and live data changes only after you confirm.</div>
      </Modal>
    </div>
  );
}
