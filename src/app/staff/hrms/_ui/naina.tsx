"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Data } from "@/staff/hrms/screens";
import { aiNainaCall, aiNainaEnd, aiNainaPushKey, aiNainaPushRemove, aiNainaPushSave, aiNainaSend, aiNainaThread } from "../actions";
import { Conversation } from "./screens-aicall";
import { unlockSpeech } from "./speech/browser-speech";
import { ding } from "./chat-notify";
import { cx, dayLong, timeLabel } from "./kit";

/**
 * Naina, Medoro HR's AI assistant, inside Team Chat: a pinned one-to-one chat (typed), a voice call from the chat header,
 * and an in-app ringing call when she needs to ask about attendance or overtime. Nothing here uses a phone line: it all
 * runs in the HRMS, on the same conversation engine and rules as the AI HR Assistant.
 */
export const NAINA = "naina";
export type NainaInfo = NonNullable<Data<"chat">["naina"]>;
type Cfg = Pick<NainaInfo, "voice" | "tts" | "speech" | "sttModel" | "modelSource">;
type Thread = { id: string; reason: string; day: string; status: string; self: boolean; turns: { who: "ai" | "employee"; text: string; at: string }[] }[];
const ABOUT: Record<string, string> = { late: "today's check-in", absent: "today's attendance", missing_checkout: "today's check-out", overtime: "an overtime request", manual: "an HR follow-up" };

export function NainaFace({ size = 48 }: { size?: number }) {
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }}>
      <span aria-hidden className="rounded-full bg-gradient-to-br from-[#F9A8D4] via-[#C4B5FD] to-[#5EEAD4] flex items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.55 }}>👩🏻‍💼</span>
      <span aria-hidden className="absolute bottom-0 right-0 rounded-full border-2 border-white bg-[#14B8A6]" style={{ width: size * 0.28, height: size * 0.28 }} />
    </span>
  );
}

/** The pinned row at the top of the chat list. */
export function NainaRow({ info, active, onPick }: { info: NainaInfo; active: boolean; onPick: () => void }) {
  const waiting = info.open && !info.open.self && info.open.status !== "in_progress";
  return (
    <button role="listitem" onClick={onPick} aria-current={active ? "true" : undefined} aria-label="Naina, AI HR assistant" className={cx("w-full text-left flex gap-3 pl-3 pr-0 border-0 cursor-pointer items-center", active ? "bg-[#D9EAE5]/85" : "bg-transparent hover:bg-white/70")}>
      <NainaFace />
      <span className="min-w-0 flex-1 py-3 pr-3 border-b border-[#0B5E5B]/[.07]">
        <span className="flex items-baseline gap-2"><span className={cx("text-[15.5px] text-[#111B21] truncate", waiting ? "font-bold" : "font-medium")}>Naina</span><span className="text-[10.5px] font-bold text-[#7C3AED] bg-[#EDE9FE] rounded-full px-1.5 py-px">AI HR</span><span className="ml-auto text-[11.5px] text-[#667781] flex-none">Pinned</span></span>
        <span className="flex items-center gap-2 mt-0.5"><span className={cx("text-[13.5px] truncate", waiting ? "text-[#111B21]" : "text-[#667781]")}>{waiting ? `Wants to talk about ${ABOUT[info.open!.reason] ?? "something"}` : "Ask about leave, attendance, payslips…"}</span>
          {waiting ? <span className="ml-auto flex-none bg-[#14A38F] text-white text-[11px] font-bold rounded-full min-w-[20px] h-[20px] px-1.5 flex items-center justify-center">1</span> : null}</span>
      </span>
    </button>
  );
}

/** The voice call with Naina: the AI HR conversation (speak or type) in a call window. */
export function NainaCall({ id, cfg, onClose }: { id: string; cfg: Cfg; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Call with Naina" className="fixed inset-0 z-[110] bg-[#0f172a]/60 backdrop-blur-[2px] flex items-start justify-center overflow-auto py-8 px-4">
      <div className="w-full max-w-[560px] flex flex-col gap-3">
        <div className="flex items-center gap-3 text-white"><NainaFace size={52} /><div><div className="font-bold text-[17px]">Naina · on call</div><div className="text-[12.5px] text-white/80">AI assistant from Medoro HR · inside the HRMS, no phone needed</div></div></div>
        <div className="bg-white rounded-2xl overflow-hidden"><Conversation id={id} voice={cfg.voice} tts={cfg.tts} mode={cfg.speech} model={cfg.sttModel} selfHosted={cfg.modelSource === "self"} onClose={onClose} /></div>
      </div>
    </div>
  );
}

/** URL-safe base64 (the server's push key) to the bytes the browser wants. */
function keyBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on" | "busy";
/**
 * "Let Naina ring this device": free browser push, so her call rings even when the HRMS is closed. iPhones need the
 * HRMS added to the Home Screen first (Apple's rule). Turning it off removes this device.
 */
function PushSwitch() {
  const [st, setSt] = useState<PushState>("busy"), [msg, setMsg] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent), standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      let next: PushState;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = ios && !standalone ? "ios-install" : "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
        next = (await reg?.pushManager.getSubscription().catch(() => null)) ? "on" : "off";
      }
      if (live) setSt(next);
    })();
    return () => { live = false; };
  }, []);
  const turnOn = async () => {
    setSt("busy"); setMsg("");
    try {
      if ((await Notification.requestPermission()) !== "granted") { setSt("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const k = await aiNainaPushKey();
      if (!k.ok) { setMsg(k.error); setSt("off"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.data.publicKey) });
      const r = await aiNainaPushSave(sub.toJSON());
      if (!r.ok) { await sub.unsubscribe().catch(() => false); setMsg(r.error); setSt("off"); return; }
      setSt("on");
    } catch { setMsg("This browser couldn’t turn on notifications. Try Chrome, Edge, Firefox or Safari."); setSt("off"); }
  };
  const turnOff = async () => {
    setSt("busy");
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (sub) { await aiNainaPushRemove(sub.endpoint).catch(() => null); await sub.unsubscribe().catch(() => false); }
    setSt("off");
  };
  if (st === "on") return <div className="self-center text-[12px] text-[#0B5E5B] bg-white/90 rounded-lg px-3 py-1.5 shadow-sm">🔔 Naina can ring this device even when the HRMS is closed. <button className="underline bg-transparent border-0 cursor-pointer text-[#64748B]" onClick={() => void turnOff()}>Turn off</button></div>;
  if (st === "busy" || st === "unsupported") return null;
  return (
    <div className="self-center max-w-[520px] flex flex-col gap-1.5 items-center text-center text-[12.5px] bg-white rounded-xl px-3 py-2.5 shadow-sm">
      <span>🔔 <b>Let Naina ring this device</b>, even when the HRMS is closed (free, no phone number).</span>
      {st === "ios-install" ? <span className="text-[#64748B]">On iPhone: tap Share → <b>Add to Home Screen</b>, open Medoro from there, then come back here.</span>
        : st === "denied" ? <span className="text-[#B45309]">Notifications are blocked for this site. Allow them in the browser’s site settings (the icon left of the address), then reload.</span>
        : <button className="bg-[#0B5E5B] text-white border-0 rounded-lg px-3 py-1.5 font-semibold cursor-pointer" onClick={() => void turnOn()}>Turn on</button>}
      {msg ? <span className="text-[#B3261E]">{msg}</span> : null}
    </div>
  );
}

const headerBar = "relative flex items-center gap-1 h-[64px] flex-none bg-gradient-to-r from-[#0B5E5B] to-[#0E7C77] text-white";
const barBtn = "flex-none h-10 px-3 rounded-full flex items-center justify-center gap-1.5 bg-white/12 text-white border-0 cursor-pointer hover:bg-white/20 disabled:opacity-50 text-[13px] font-semibold";

/** Naina's conversation pane in Team Chat. */
export function NainaPanel({ info: first, onBack }: { info: NainaInfo; onBack: () => void }) {
  const [info, setInfo] = useState<NainaInfo | null>(first);
  const [thread, setThread] = useState<Thread>([]);
  const [draft, setDraft] = useState(""), [sending, setSending] = useState(false), [err, setErr] = useState(""), [loaded, setLoaded] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [call, setCall] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const r = await aiNainaThread().catch(() => null);
    if (r?.ok) { setThread(r.data.thread); setInfo(r.data.info); }
    setLoaded(true);
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [thread, pendingText, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setErr(""); setDraft(""); setPendingText(text);
    const r = await aiNainaSend(text).catch(() => null);
    if (!r) setErr("Couldn’t reach the server. Check your connection and try again.");
    else if (!r.ok) { setErr(r.error); setDraft(text); }
    await load();
    setPendingText(null); setSending(false);
  };
  const startCall = async () => {
    if (!info) return;
    if (info.speech === "browser") unlockSpeech(); // the tap allows the device voice to speak
    setErr("");
    const r = await aiNainaCall().catch(() => null);
    if (!r) { setErr("Couldn’t reach the server. Check your connection and try again."); return; }
    if (!r.ok) { setErr(r.error); return; }
    setCall(r.data);
  };
  const close = async () => { setSending(true); await aiNainaEnd().catch(() => null); await load(); setSending(false); };
  const live = info?.open?.status === "in_progress";
  const waiting = info?.open && !info.open.self && info.open.status !== "in_progress";

  return (
    <>
      <div className={cx(headerBar, "pl-2 pr-2 min-[860px]:pl-4")}>
        <button className="min-[860px]:hidden flex-none size-10 rounded-full flex items-center justify-center bg-transparent text-white border-0 cursor-pointer" aria-label="Back to chats" onClick={onBack}>←</button>
        <span className="flex items-center gap-3 min-w-0 mr-auto"><NainaFace size={42} /><span className="min-w-0"><span className="block font-semibold text-[16.5px] truncate leading-tight">Naina <span className="text-[11px] font-bold bg-white/20 rounded-full px-1.5 py-px align-middle">AI HR</span></span><span className="block text-[12.5px] text-white/75 truncate">AI assistant from Medoro HR · always available</span></span></span>
        <button className={barBtn} onClick={() => void startCall()} disabled={!info || sending} aria-label="Call Naina" title="Voice call with Naina (inside the HRMS)">📞 <span className="max-[560px]:hidden">Call</span></button>
        {live ? <button className={barBtn} onClick={() => void close()} disabled={sending} title="End this conversation">End chat</button> : null}
      </div>
      <div ref={log} className="relative flex-1 overflow-y-auto px-[4%] max-[560px]:px-2.5 py-3 flex flex-col gap-1.5 [scrollbar-width:thin]" aria-live="polite">
        <div className="self-center max-w-[520px] text-center text-[12px] text-[#54656F] bg-[#FFF7D6] rounded-lg px-3 py-2 my-2 shadow-[0_1px_.5px_rgba(11,20,26,.13)]">🤖 Naina is an AI. She answers from Medoro’s approved policies and notes what you tell her; HR or your manager decide anything. Say “HR se baat karni hai” for a person, or “call mat karo” to stop her calls. Only you and authorised HR can see this chat.</div>
        <PushSwitch />
        {waiting ? <div className="self-center flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm text-[13px]"><span>📞 Naina wants to talk about <b>{ABOUT[info!.open!.reason]}</b>.</span><button className="bg-[#0B5E5B] text-white border-0 rounded-lg px-3 py-1.5 font-semibold cursor-pointer" onClick={() => void startCall()}>Answer</button><span className="text-[#667781]">or reply below</span></div> : null}
        {thread.map((c) => (
          <div key={c.id} className="flex flex-col gap-1.5">
            <div className="self-center text-[12px] font-medium bg-white/95 text-[#54656F] rounded-lg px-3 py-1 my-2 shadow-[0_1px_.5px_rgba(11,20,26,.13)]">{c.turns[0] ? dayLong(c.turns[0].at) : c.day} · {c.self ? "You started a chat" : `About ${ABOUT[c.reason] ?? c.reason}`}</div>
            {c.turns.map((t, i) => (
              <div key={i} className={cx("max-w-[78%] rounded-[10px] px-3 py-1.5 text-[14px] leading-[1.45] shadow-[0_1px_.5px_rgba(11,20,26,.13)] whitespace-pre-wrap", t.who === "ai" ? "self-start bg-white rounded-tl-[3px]" : "self-end bg-[#D9FDD3] rounded-tr-[3px]")}>
                {t.text || <em className="text-[#94A3B8]">(no answer)</em>}<span className="block text-right text-[10.5px] text-[#667781] mt-0.5">{timeLabel(t.at)}</span>
              </div>
            ))}
            {!OPEN_STATUS.has(c.status) ? <div className="self-center text-[11.5px] text-[#667781] my-1">Conversation ended</div> : null}
          </div>
        ))}
        {pendingText ? <div className="self-end max-w-[78%] rounded-[10px] rounded-tr-[3px] px-3 py-1.5 text-[14px] bg-[#D9FDD3] opacity-70">{pendingText}</div> : null}
        {sending ? <div className="self-start text-[12.5px] text-[#54656F] bg-white rounded-[10px] px-3 py-1.5">Naina is typing…</div> : null}
        {loaded && !thread.length && !waiting && !sending ? <div className="m-auto text-[13px] text-[#54656F] bg-white/90 rounded-lg px-4 py-2 text-center">Say hello 👋 Ask Naina about leave, attendance, holidays, payslips or how to do something in the HRMS.<br />Or press 📞 to talk by voice.</div> : null}
      </div>
      {err ? <div role="alert" className="relative text-[12.5px] text-[#B3261E] bg-[#FDECEA] px-4 py-2">{err}</div> : null}
      <div className="relative bg-[#F0F2F5] px-2 min-[860px]:px-4 py-2.5 flex gap-1 items-end flex-none">
        <textarea className="flex-1 min-w-0 mx-1 resize-none max-h-[140px] min-h-[42px] bg-white rounded-[21px] border-0 outline-none px-4 py-[10px] text-[14.5px] leading-[22px] text-[#111B21] placeholder:text-[#8696A0] shadow-[0_1px_.5px_rgba(11,20,26,.08)] focus:ring-2 focus:ring-[#0B5E5B]/20" rows={1} placeholder="Message Naina (Hindi, English or Hinglish)" aria-label="Message Naina" value={draft} maxLength={1000}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="flex-none size-[42px] rounded-full flex items-center justify-center bg-[#0B5E5B] text-white border-0 cursor-pointer hover:bg-[#094A48] disabled:bg-[#9DB8B5] disabled:cursor-default" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send to Naina">➤</button>
      </div>
      {call && info ? <NainaCall id={call} cfg={info} onClose={() => { setCall(null); void load(); }} /> : null}
    </>
  );
}
const OPEN_STATUS = new Set(["scheduled", "notified", "in_progress"]);

type Ring = { id: string; reason: string; attempts: number; cfg: Cfg } | null;
const seenKey = (r: NonNullable<Ring>) => `hrms.naina.declined.${r.id}.${r.attempts}`;
const declined = (r: NonNullable<Ring>) => { try { return sessionStorage.getItem(seenKey(r)) === "1"; } catch { return false; } };

/**
 * Naina's incoming call, on every HRMS page: a ringing banner with Answer, Chat or Decline. It rings for a conversation
 * the scheduler has opened (within calling hours, retried a few times, then handed to HR). Declining hides this ring only.
 */
export function NainaRinger({ screen }: { screen: string }) {
  const router = useRouter();
  const [ring, setRing] = useState<Ring>(null), [call, setCall] = useState<{ id: string; cfg: Cfg } | null>(null);
  const callRef = useRef(false);
  useEffect(() => { callRef.current = !!call; }, [call]);
  useEffect(() => {
    let stop = false, t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch("/staff/hrms/naina/ring", { cache: "no-store" });
        if (r.ok) { const j = (await r.json()) as { ring: Ring }; if (!callRef.current) setRing(j.ring && !declined(j.ring) ? j.ring : null); }
      } catch { /* offline: try again */ }
      if (!stop) t = setTimeout(tick, document.visibilityState === "visible" ? 8000 : 30000);
    };
    t = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(t); };
  }, []);
  // The ringtone: the chat chime every 3 seconds for half a minute.
  useEffect(() => {
    if (!ring) return;
    ding();
    let n = 0;
    const iv = setInterval(() => { if (++n >= 10) clearInterval(iv); else ding(); }, 3000);
    return () => clearInterval(iv);
  }, [ring]);
  if (call) return <NainaCall id={call.id} cfg={call.cfg} onClose={() => setCall(null)} />;
  if (!ring) return null;
  const answer = () => { if (ring.cfg.speech === "browser") unlockSpeech(); setCall({ id: ring.id, cfg: ring.cfg }); setRing(null); };
  const decline = () => { try { sessionStorage.setItem(seenKey(ring), "1"); } catch { /* private window */ } setRing(null); };
  return (
    <div role="alertdialog" aria-label="Naina is calling" className="fixed top-4 left-1/2 -translate-x-1/2 z-[105] w-[min(420px,calc(100vw-24px))] bg-[#0B5E5B] text-white rounded-2xl px-4 py-3.5 shadow-[0_16px_40px_-10px_rgba(0,0,0,.45)] flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="animate-pulse"><NainaFace size={48} /></span>
        <div className="flex-1 min-w-0"><div className="text-[12px] opacity-80">Incoming call · HRMS</div><div className="font-bold text-[16px]">Naina · AI HR</div><div className="text-[12.5px] opacity-85 truncate">About {ABOUT[ring.reason] ?? "something"}</div></div>
      </div>
      <div className="flex gap-2">
        <button onClick={answer} className="flex-1 bg-[#22C55E] text-white border-0 rounded-xl py-2 text-[14px] font-bold cursor-pointer">📞 Answer</button>
        {screen !== "chat" ? <button onClick={() => { setRing(null); router.push(`/staff/hrms/chat?c=${NAINA}`); }} className="flex-1 bg-white/15 text-white border-0 rounded-xl py-2 text-[14px] font-semibold cursor-pointer">💬 Chat</button> : null}
        <button onClick={decline} className="flex-1 bg-[#DC2626] text-white border-0 rounded-xl py-2 text-[14px] font-semibold cursor-pointer">Decline</button>
      </div>
    </div>
  );
}
