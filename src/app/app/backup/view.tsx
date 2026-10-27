"use client";
import { useEffect, useState, useTransition } from "react";
import { HardDriveUpload, KeyRound, Download, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { dayMonth, hhmm } from "@/lib/dates";
import { backupNowAction, disconnectAction, prepareRestoreAction, restoreAction, settingsAction } from "./actions";
import { RestorePanel, type PendingRestore } from "./restore-panel";

type H = { id: string; at: string; kind: string; size: number; sha: string | null; status: string; error: string | null; drive: boolean; local: boolean };
const ST: Record<string, [string, Tone]> = { verified: ["Verified", "green"], partial: ["Server only", "amber"], failed: ["Failed", "red"], running: ["Running", "blue"], expired: ["Expired", "gray"] };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const FLASH: Record<string, [string, "green" | "red"]> = { ok: ["Google Drive connected.", "green"], denied: ["Google access was not granted.", "red"], error: ["Couldn’t connect Google Drive. Try again.", "red"], state: ["The Google sign-in expired. Try again.", "red"], forbidden: ["Your role can’t connect integrations.", "red"] };

export function BackupView({ history, drive, driveApp, fingerprint, keyDate, settings, flash, canRestore, pendingRestore, code }: {
  history: H[]; drive: { account: string; since: string } | null; driveApp: boolean; fingerprint: string | null; keyDate: string | null; settings: { schedule: string; retention: number }; flash: string | null;
  canRestore: boolean; pendingRestore: PendingRestore | null; code: string;
}) {
  const toast = useToast();
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
      {pendingRestore ? <RestorePanel key={pendingRestore.runId} p={pendingRestore} code={code} /> : null}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className={card}>
          <div className="flex items-center gap-2 font-semibold text-[15px]"><HardDriveUpload size={18} className="text-teal" />Google Drive</div>
          {drive ? (
            <>
              <div className="grid grid-cols-[110px_1fr] gap-1 text-[13.5px]"><span className="text-muted">Account</span><span>{drive.account || "Connected"}</span><span className="text-muted">Folder</span><span>/Medoro Backups</span><span className="text-muted">OAuth scope</span><span className="font-mono text-[12.5px]">drive.file</span></div>
              <Button variant="danger-outline" className="self-start" disabled={pending} onClick={() => start(async () => { const r = await disconnectAction(); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); })}>Disconnect & revoke</Button>
            </>
          ) : driveApp ? (
            <>
              <div className="text-[13px] text-muted">Medoro asks only for access to files it creates. It cannot read the rest of your Drive.</div>
              <a href="/api/integrations/google/start" className="self-start bg-teal text-white rounded-lg px-3 py-2 text-[13.5px] font-semibold no-underline hover:bg-teal-hover hover:text-white">Connect Google Drive</a>
            </>
          ) : (
            <div className="text-[13px] text-muted flex gap-2"><CloudOff size={16} className="flex-none mt-0.5" /><span>Google sign-in isn’t configured on this server. Set <span className="font-mono text-[12px]">GOOGLE_OAUTH_CLIENT_ID</span>, <span className="font-mono text-[12px]">GOOGLE_OAUTH_CLIENT_SECRET</span> and <span className="font-mono text-[12px]">GOOGLE_OAUTH_REDIRECT_URI</span>. Until then backups are kept on this server only.</span></div>
          )}
        </div>
        <div className={card}>
          <div className="flex items-center gap-2 font-semibold text-[15px]"><KeyRound size={18} className="text-teal" />Encryption</div>
          <div className="text-[13.5px]">AES-256-GCM with a fresh key per backup, encrypted on your server before anything leaves it.</div>
          <div className="text-[13px] text-muted">That key is wrapped by your recovery-kit key, which never goes to Drive or Medoro.{keyDate ? ` Kit created ${dayMonth(new Date(keyDate), true)}.` : ""}{fingerprint ? <> Fingerprint <span className="font-mono">{fingerprint}</span>.</> : " No key found."}</div>
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Schedule & retention</div>
          <label className="flex items-center justify-between text-[13.5px]">Daily at<input type="time" value={s.schedule} onChange={(e) => setS({ ...s, schedule: e.target.value })} className="border border-input rounded-md px-2 py-1" /></label>
          <label className="flex items-center justify-between text-[13.5px]">Keep backups for<select value={s.retention} onChange={(e) => setS({ ...s, retention: Number(e.target.value) })} className="border border-input rounded-md px-2 py-1 bg-white">{[[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <div className="flex gap-2">
            {s.schedule !== settings.schedule || s.retention !== settings.retention ? <Button disabled={pending} onClick={() => start(async () => { const r = await settingsAction(s.schedule, s.retention); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); })}>Save</Button> : null}
            <Button variant="primary" disabled={running} onClick={async () => { setRunning(true); const r = await backupNowAction(); setRunning(false); toast(r.ok ? `Backup verified · ${(r.data.size / 1048576).toFixed(2)} MB${r.data.drive ? " · uploaded to Drive" : " · kept on this server"}${r.data.note ? ". " + r.data.note : ""}` : r.error, r.ok ? (r.data.note ? "amber" : "green") : "red"); }}>{running ? "Backing up…" : "Back up now"}</Button>
          </div>
          <div className="text-[12px] text-faint">Times are India time. Failed scheduled backups retry up to 3 times that day.</div>
        </div>
      </div>
      {running ? <div className="bg-white border border-teal-line rounded-xl px-4 py-3 text-[13.5px]">Snapshot → encrypt → write → verify{drive ? " → upload" : ""}… <div className="h-1.5 bg-line-soft rounded mt-2 overflow-hidden"><div className="h-full w-1/2 bg-teal animate-pulse" /></div></div> : null}
      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto">
        <div className="font-semibold text-[15px] px-4 pt-3.5 pb-2">Backup history</div>
        {history.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-subtle">{["Time", "Type", "Size", "SHA-256", "Status", ""].map((x) => <th key={x} className="text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9]">{x}</th>)}</tr></thead>
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
                      {h.local && (h.status === "verified" || h.status === "partial") ? (
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
      <Modal open={!!restore} onClose={() => setRestore(null)} title="Test restore" sub={restore ? `${dayMonth(new Date(restore.h.at), true)} · ${restore.h.kind}` : ""} width={460} footer={<Button onClick={() => setRestore(null)}>Close</Button>}>
        {restore && !restore.result && !restore.error ? <div className="text-[13.5px]">Checking checksum → unwrapping key → decrypting → comparing every table with the manifest…</div> : null}
        {restore?.result ? <div className="text-[13.5px] text-ok bg-ok-bg rounded-lg p-3">Verified. {restore.result} Live data has not been changed.</div> : null}
        {restore?.error ? <div className="text-[13.5px] text-bad bg-bad-bg rounded-lg p-3">{restore.error}</div> : null}
        <div className="text-[12px] text-faint">To bring a backup back, use Restore… on its row: it loads into a test copy first, and live data changes only after you confirm.</div>
      </Modal>
    </div>
  );
}
