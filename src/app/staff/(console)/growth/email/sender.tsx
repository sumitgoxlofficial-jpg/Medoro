"use client";
import { useState } from "react";
import { confirmEmailSetup, disconnect, startEmailSetup } from "../../../growth-actions";
import { Panel, btn, btnPrimary, fieldCls, lbl, useRun } from "../../ui";

export function EmailSender({ status, config, provider, canManage }: { status: string | null; config: Record<string, string> | null; provider: string; canManage: boolean }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ fromName: config?.fromName ?? "Medoro", replyTo: config?.replyTo ?? "", postalAddress: config?.postalAddress ?? "" });
  const [code, setCode] = useState("");
  return (
    <Panel title="Email sender" sub={provider ? `Provider: ${provider} (MAIL_PROVIDER), from ${config?.from ?? "MAIL_FROM"}` : "No email provider configured on this server (set MAIL_PROVIDER and MAIL_FROM)."}>
      <div className="p-4 text-[13.5px] flex flex-col gap-3">
        <span>Status: <strong>{status === "connected" ? "Confirmed" : status === "pending" ? "Waiting for the code from the test email" : "Not set up"}</strong></span>
        {canManage ? (<>
          <div className="grid gap-2.5 grid-cols-1 min-[900px]:grid-cols-3">
            <label className={lbl}>Sender name<input className={fieldCls} value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></label>
            <label className={lbl}>Reply-to (optional)<input className={fieldCls} value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} /></label>
            <label className={lbl}>Postal address (shown in every email)<input className={fieldCls} value={f.postalAddress} onChange={(e) => setF({ ...f, postalAddress: e.target.value })} /></label>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className={btnPrimary} disabled={busy || !provider} onClick={() => run(() => startEmailSetup(f))}>Send test email</button>
            {status === "pending" ? <><input className={fieldCls + " !w-[140px]"} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" /><button className={btn} disabled={busy} onClick={() => run(() => confirmEmailSetup(code))}>Confirm</button></> : null}
            {status ? <button className={btn} disabled={busy} onClick={() => run(() => disconnect("email"))}>Disconnect</button> : null}
          </div>
        </>) : null}
      </div>
    </Panel>
  );
}
