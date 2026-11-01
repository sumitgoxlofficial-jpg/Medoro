"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, HardDriveUpload, KeyRound, FileUp } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { setupDriveBackups, setupPreviewFromDrive, setupRestoreFromDrive } from "./restore-actions";
import { useSetupDrive } from "./drive-connect";

type Preview = { pharmacy: string; code: string; backupAt: string; fingerprint: string; sales: number; medicines: number; users: number; branches: number; files: number };
type Done = { pharmacy: string; code: string; mfaReset: number; drive: boolean };
type DriveFile = { id: string; name: string; size: number; createdTime: string; pharmacy: string | null; code: string | null };
type R<T> = { ok: true; data: T } | { ok: false; error: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const inp = "border border-input rounded-lg px-3 py-2.5 text-[14px] outline-none bg-white focus:border-teal focus:ring-2 focus:ring-teal/15 w-full";

/** New server: restore the pharmacy from a backup file or Google Drive, opened with the recovery kit. */
export function RestoreSetup({ driveApp, driveAccount, onBack, signup = false }: { driveApp: boolean; driveAccount: string | null; onBack: () => void; signup?: boolean }) {
  const router = useRouter();
  const drive = useSetupDrive(driveAccount);
  const [source, setSource] = useState<"file" | "drive">(driveAccount || (signup && driveApp) ? "drive" : "file");
  const [file, setFile] = useState<File | null>(null);
  const [list, setList] = useState<DriveFile[] | null>(null);
  const [pick, setPick] = useState("");
  const [kit, setKit] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();

  const post = async <T,>(step: "check" | "restore"): Promise<R<T>> => {
    const fd = new FormData(); fd.set("file", file!); fd.set("kit", kit); fd.set("step", step); fd.set("code", code);
    return fetch("/api/setup/restore", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: "Upload failed. Check the connection and try again." }));
  };
  const reset = () => { setPreview(null); setCode(""); setErr(""); };
  const check = () => start(async () => {
    setErr("");
    const r = source === "file" ? await post<Preview>("check") : await setupPreviewFromDrive(pick, kit);
    if (r.ok) setPreview(r.data); else setErr(r.error);
  });
  const restore = () => start(async () => {
    setErr("");
    const r = source === "file" ? await post<Done>("restore") : await setupRestoreFromDrive(pick, kit, code);
    if (r.ok) setDone(r.data); else setErr(r.error);
  });
  const loadList = () => start(async () => { const r = await setupDriveBackups(); if (r.ok) setList(r.data); else setErr(r.error); });
  const ready = !!kit.trim() && (source === "file" ? !!file : !!pick);

  if (done) return (
    <div className="w-[min(860px,100%)] bg-white border border-[#E3E6E9] rounded-[14px] px-7 py-8 flex flex-col items-center text-center gap-3">
      <CircleCheck size={44} className="text-ok" />
      <div className="text-[22px] font-semibold">{done.pharmacy} is restored</div>
      <div className="text-[13.5px] text-muted max-w-[560px]">
        Everyone signs in with their usual accounts. Pharmacy code <span className="font-mono text-ink">{done.code}</span>. The recovery kit is now this server’s backup key{done.drive ? " and Google Drive is connected" : ""}.
        {done.mfaReset ? ` ${done.mfaReset} person(s) will set up their authenticator app again when they sign in, because this server has a different HOST_KEY.` : ""} Reconnect WhatsApp in Settings.
      </div>
      <Button variant="primary" size="lg" onClick={() => router.replace("/signin?restored=1")}>Sign in</Button>
    </div>
  );

  return (
    <div className="w-[min(860px,100%)] bg-white border border-[#E3E6E9] rounded-[14px] px-7 py-[26px] flex flex-col gap-4">
      <div className="text-[19px] font-semibold">Restore from a backup</div>
      <div className="text-[13.5px] text-muted -mt-2">{signup ? "Used Medoro before? Like WhatsApp, bring your pharmacy back from its backup in your Google Drive: connect the same Google account, pick the backup, and enter the recovery kit you saved when you created the account. It’s checked in a test copy before anything is kept." : "Moving to a new server, or the old one was lost? Bring your pharmacy back from a Medoro backup (.mdrbak) and the recovery kit you printed at setup. The backup is loaded into a test copy and checked before anything is kept."}</div>
      <div className="flex gap-2">
        {(["file", "drive"] as const).map((s) => (
          <button key={s} type="button" onClick={() => { setSource(s); reset(); }} className="flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[13.5px] cursor-pointer"
            style={{ background: source === s ? "#F0F7F6" : "#fff", border: source === s ? "2px solid #0B5E5B" : "1px solid #E3E6E9" }}>
            {s === "file" ? <><FileUp size={17} className="text-teal" />Backup file</> : <><HardDriveUpload size={17} className="text-teal" />Google Drive</>}
          </button>
        ))}
      </div>
      {source === "file" ? (
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">Backup file (downloaded from Backup & restore, or copied from Google Drive)
          <input type="file" accept=".mdrbak,application/octet-stream" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} className="text-[13.5px] text-ink" />
        </label>
      ) : !driveApp ? (
        <div className="text-[13px] text-muted">Google sign-in isn’t configured on this server (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI). Download the backup from drive.google.com and use “Backup file”.</div>
      ) : drive.account ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[13.5px] flex-wrap">Connected as <strong>{drive.account}</strong>
            <Button size="sm" onClick={loadList} disabled={busy}>{list ? "Refresh list" : "Show backups"}</Button>
            <button type="button" className="text-[12.5px] text-muted underline cursor-pointer" onClick={() => { void drive.forget(); setList(null); setPick(""); reset(); }}>Use another account</button>
          </div>
          {list ? (list.length ? (
            <div className="border border-line rounded-lg max-h-[260px] overflow-auto">
              {list.map((f) => (
                <label key={f.id} className={cn("flex items-center gap-3 px-3 py-2 border-b border-row last:border-0 text-[13px] cursor-pointer", pick === f.id && "bg-[#F0F7F6]")}>
                  <input type="radio" name="drivefile" className="accent-teal" checked={pick === f.id} onChange={() => { setPick(f.id); reset(); }} />
                  <span className="flex-1">{f.pharmacy ? <strong>{f.pharmacy} </strong> : null}{f.code ? <span className="font-mono text-muted">{f.code} · </span> : null}{when(f.createdTime)}</span>
                  <span className="text-faint">{(f.size / 1048576).toFixed(2)} MB</span>
                </label>
              ))}
            </div>
          ) : <div className="text-[13px] text-fainter">No Medoro backups found. Medoro can only see backups uploaded with this server’s Google OAuth client; otherwise download the file from drive.google.com and use “Backup file”.</div>) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button className="self-start" onClick={drive.connect}>Connect Google Drive</Button>
          <span className="text-[12.5px] text-faint">Opens Google in a new window. Medoro asks only for files it created.</span>
          {drive.msg ? <span className="text-[13px] text-bad">{drive.msg}</span> : null}
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-[13px] text-muted"><span className="flex items-center gap-1.5"><KeyRound size={15} className="text-teal" />Recovery kit: paste the whole kit or its 43-character backup decryption key</span>
        <textarea value={kit} onChange={(e) => { setKit(e.target.value); reset(); }} rows={3} className={cn(inp, "font-mono text-[13px]")} aria-label="Recovery kit" autoComplete="off" spellCheck={false} />
        <span className="text-[12.5px]">or open the kit file: <input type="file" accept=".html,.txt,text/html,text/plain" className="text-[12.5px]" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setKit(await f.text()); reset(); } }} /></span>
      </label>
      {preview ? (
        <div className="flex flex-col gap-2.5 border border-teal-line bg-[#F7FBFA] rounded-[10px] p-3.5">
          <div className="text-[14px]"><strong>{preview.pharmacy}</strong> <span className="font-mono text-muted">{preview.code}</span> · backup of {when(preview.backupAt)}</div>
          <div className="text-[13px] text-muted">{preview.branches} branch(es) · {preview.users} user(s) · {preview.medicines} medicines · {preview.sales} invoices · {preview.files} stored file(s) · key fingerprint <span className="font-mono">{preview.fingerprint}</span> matches</div>
          <label className="flex flex-col gap-1 text-[13px] text-muted">Type the pharmacy code <strong className="font-mono text-ink">{preview.code}</strong> to restore it on this server
            <input value={code} onChange={(e) => setCode(e.target.value)} className={cn(inp, "font-mono uppercase max-w-[260px]")} aria-label="Pharmacy code" autoComplete="off" />
          </label>
        </div>
      ) : null}
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
      <div className="flex justify-between gap-2.5 pt-1">
        <Button onClick={onBack} disabled={busy}>{signup ? "Create a new account instead" : "Set up a new pharmacy instead"}</Button>
        {preview
          ? <Button variant="primary" onClick={restore} disabled={busy || code.trim().toUpperCase() !== preview.code.toUpperCase()}>{busy ? "Restoring…" : "Restore"}</Button>
          : <Button variant="primary" onClick={check} disabled={busy || !ready}>{busy ? "Decrypting…" : "Check backup"}</Button>}
      </div>
    </div>
  );
}
