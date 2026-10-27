"use client";
import { useState, useTransition } from "react";
import { startSupportSession } from "./actions";

export function StartButton({ token }: { token: string }) {
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  return (
    <>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
      <button disabled={busy} onClick={() => start(async () => { const r = await startSupportSession(token); if (r?.error) setErr(r.error); })} className="bg-teal text-white rounded-[10px] p-3 text-[15px] font-semibold cursor-pointer disabled:opacity-60">{busy ? "Starting…" : "Start read-only session"}</button>
    </>
  );
}
