"use client";
import { useCallback, useEffect, useState } from "react";
import { setupDriveForget, setupDriveStatus } from "./restore-actions";

const START = "/api/integrations/google/start?setup=1";
const MSG: Record<string, string> = { scope: "Drive access wasn’t allowed on Google’s screen. Connect again and tick the Drive permission.", denied: "Google access was not granted.", state: "The Google sign-in expired. Try again.", error: "Couldn’t connect Google Drive. Try again.", forbidden: "Setup is closed." };

/** Google Drive connected during setup (before the pharmacy exists). Consent runs in a popup so the wizard keeps its state. */
export function useSetupDrive(initial: string | null) {
  const [account, setAccount] = useState(initial);
  const [msg, setMsg] = useState("");
  const refresh = useCallback(async () => { const r = await setupDriveStatus(); if (r.ok) setAccount(r.data); }, []);
  useEffect(() => {
    const ch = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("medoro-drive");
    if (ch) ch.onmessage = (e) => { setMsg(e.data === "ok" ? "" : MSG[String(e.data)] ?? MSG.error); void refresh(); };
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { ch?.close(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  const connect = () => {
    setMsg("");
    if (!window.open(START, "medoro-google", "popup,width=520,height=680")) window.location.href = START;
  };
  const forget = async () => { await setupDriveForget(); setAccount(null); };
  return { account, msg, connect, forget };
}
