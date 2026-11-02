"use client";
import { useState, useTransition } from "react";
import { startSupportSession } from "./actions";
import { useT } from "@/lib/i18n-client";

export function StartButton({ token }: { token: string }) {
  const t = useT();
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  return (
    <>
      {err ? <div role="alert" className="text-[13px] text-bad">{t(err)}</div> : null}
      <button disabled={busy} onClick={() => start(async () => { const r = await startSupportSession(token); if (r?.error) setErr(r.error); })} className="bg-teal text-white rounded-[10px] p-3 text-[15px] font-semibold cursor-pointer disabled:opacity-60">{t(busy ? "Starting…" : "Start read-only session")}</button>
    </>
  );
}
