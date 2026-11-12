"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatRow } from "@/staff/hrms/chat";

/**
 * New-message alerts, like WhatsApp Web: a short two-note sound, a banner at the top of the page while you are in the HRMS,
 * a desktop notification when the tab is in the background (after you allow it once), and an unread count in the tab title.
 * Alerts only for messages that arrive while the HRMS is open (a closed tab can't ring), never for a chat you are looking at.
 */
const SOUND_KEY = "hrms.chat.sound", ASKED_KEY = "hrms.chat.asked";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const soundOn = () => get(SOUND_KEY) !== "off";

let ctx: AudioContext | null = null;
const audio = () => { try { ctx ??= new AudioContext(); return ctx; } catch { return null; } };
/** Browsers only allow sound after the person has clicked or typed on the page once. */
function unlock() { const c = audio(); if (c && c.state === "suspended") void c.resume(); }

/** Two soft notes. */
export function ding() {
  const c = audio();
  if (!c || !soundOn()) return;
  void c.resume().then(() => {
    ([[0, 988], [0.14, 1319]] as const).forEach(([t, f]) => {
      const o = c.createOscillator(), g = c.createGain(), at = c.currentTime + t;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.28, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      o.connect(g).connect(c.destination); o.start(at); o.stop(at + 0.4);
    });
  }).catch(() => undefined);
}

type Fresh = { id: string; title: string; text: string; count: number };
const body = (c: ChatRow) => (c.kind === "group" && c.lastBy ? `${c.lastBy}: ` : "") + (c.last || "New message");

export function ChatNotifier({ screen }: { screen: string }) {
  const router = useRouter();
  const prev = useRef<Map<string, number> | null>(null);
  const baseTitle = useRef("");
  const [banner, setBanner] = useState<Fresh | null>(null);
  const [ask, setAsk] = useState(false);
  const hideT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChat = screen === "chat";

  const open = useCallback((id: string) => { window.focus(); setBanner(null); router.push(`/staff/hrms/chat?c=${encodeURIComponent(id)}`); }, [router]);

  const handle = useCallback((chats: ChatRow[], active: string) => {
    const before = prev.current;
    prev.current = new Map(chats.map((c) => [c.id, c.unread]));
    if (!before) return; // the first look only sets the baseline: nothing already waiting rings
    const visible = document.visibilityState === "visible";
    const fresh = chats.filter((c) => c.unread > (before.get(c.id) ?? 0) && !(visible && active === c.id));
    if (!fresh.length) return;
    const top = fresh[0];
    const n: Fresh = { id: top.id, title: top.title, text: body(top), count: fresh.length };
    ding();
    if (!visible) {
      baseTitle.current ||= document.title.replace(/^\(\d+\) /, "");
      const total = chats.reduce((a, c) => a + c.unread, 0);
      document.title = `(${total}) ${baseTitle.current}`;
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          const note = new Notification(n.count > 1 ? `${n.count} chats have new messages` : n.title, { body: n.count > 1 ? `${n.title}: ${n.text}` : n.text, tag: n.count > 1 ? "hrms-chat" : n.id, icon: "/email-logo.png" });
          note.onclick = () => { note.close(); open(n.id); };
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
    } else if (!(onChat)) {
      setBanner(n);
      clearTimeout(hideT.current);
      hideT.current = setTimeout(() => setBanner(null), 7000);
    }
  }, [open, onChat]);

  // On the chat screen the chat polls and tells us; everywhere else we ask for the list ourselves.
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ chats: ChatRow[]; active: string }>).detail; handle(d.chats, d.active); };
    window.addEventListener("hrms:chats", on);
    return () => window.removeEventListener("hrms:chats", on);
  }, [handle]);
  useEffect(() => {
    if (onChat) return;
    let stop = false, t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch("/staff/hrms/chat/poll?open=0", { cache: "no-store" });
        if (r.ok) { const j = (await r.json()) as { chats: ChatRow[] }; handle(j.chats, ""); }
      } catch { /* offline: try again */ }
      if (!stop) t = setTimeout(tick, document.visibilityState === "visible" ? 6000 : 20000);
    };
    t = setTimeout(tick, 1500);
    return () => { stop = true; clearTimeout(t); };
  }, [onChat, handle]);

  // Coming back to the tab clears the count in the title.
  useEffect(() => {
    const vis = () => { if (document.visibilityState === "visible" && baseTitle.current) { document.title = baseTitle.current; baseTitle.current = ""; } };
    document.addEventListener("visibilitychange", vis);
    const gesture = () => unlock();
    window.addEventListener("pointerdown", gesture); window.addEventListener("keydown", gesture);
    return () => { document.removeEventListener("visibilitychange", vis); window.removeEventListener("pointerdown", gesture); window.removeEventListener("keydown", gesture); };
  }, []);

  useEffect(() => { if ("Notification" in window && Notification.permission === "default" && !get(ASKED_KEY)) setAsk(true); }, []);
  const allow = async () => { put(ASKED_KEY, "1"); setAsk(false); unlock(); try { await Notification.requestPermission(); } catch { /* ignore */ } ding(); };

  return (
    <>
      {banner ? (
        <button onClick={() => open(banner.id)} aria-live="polite" className="fixed z-[60] top-3 left-1/2 -translate-x-1/2 w-[min(92vw,420px)] flex items-center gap-3 text-left bg-white border border-[#CBD5E1] rounded-xl shadow-lg px-4 py-3 cursor-pointer">
          <span className="text-[20px]" aria-hidden>💬</span>
          <span className="min-w-0 flex-1"><span className="block font-bold text-[13.5px] truncate">{banner.count > 1 ? `${banner.count} chats have new messages` : banner.title}</span><span className="block text-[12.5px] text-[#475569] truncate">{banner.count > 1 ? `${banner.title}: ${banner.text}` : banner.text}</span></span>
        </button>
      ) : null}
      {ask ? (
        <div role="dialog" aria-label="Message notifications" className="fixed z-[60] bottom-4 right-4 w-[min(92vw,340px)] bg-white border border-[#CBD5E1] rounded-xl shadow-lg p-4 flex flex-col gap-2.5">
          <div className="font-bold text-[13.5px]">🔔 Get notified of new chat messages?</div>
          <div className="text-[12.5px] text-[#475569]">A pop-up and a sound when someone messages you, even while you are in another tab.</div>
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] bg-white text-[13px] cursor-pointer" onClick={() => { put(ASKED_KEY, "1"); setAsk(false); }}>Not now</button>
            <button className="px-3 py-1.5 rounded-lg bg-[#0B5E5B] text-white text-[13px] font-semibold border-0 cursor-pointer" onClick={() => void allow()}>Turn on</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A bell in the chat list: sound on or off (the banner and pop-up stay). */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(soundOn()); }, []);
  return (
    <button type="button" title={on ? "Message sound is on" : "Message sound is off"} aria-label={on ? "Turn message sound off" : "Turn message sound on"} aria-pressed={on}
      onClick={() => { const n = !on; put(SOUND_KEY, n ? "on" : "off"); setOn(n); if (n) { unlock(); ding(); } }}
      className="flex-none px-2.5 rounded-lg border border-[#CBD5E1] bg-white text-[15px] cursor-pointer">{on ? "🔔" : "🔕"}</button>
  );
}
