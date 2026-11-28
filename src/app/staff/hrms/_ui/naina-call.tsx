"use client";
import { useEffect, useRef, useState } from "react";
import { aiCallBegin, aiCallEnd, aiCallSpeak, aiCallTurn } from "../actions";
import { browserSpeechSupported, deviceVoiceKind, prepareRecognition, recognise, recordingFormat, sharedAudio, speakReply, stopSpeaking, voiceHelp, voicesReady } from "./speech/browser-speech";
import { listenOnce, nativeRecognitionSupported } from "./speech/native-recognition";
import { connectedTone, endTone, ringback, unlockTones } from "./speech/call-tones";
import { cx } from "./kit";
import { useLocalStorage } from "@/lib/react-state";

/**
 * A call with Naina that looks, sounds and behaves like a WhatsApp voice call, inside the HRMS: a full-screen call with her
 * photo, "Calling… / Ringing…" and a ringback tone when you call her, a running timer once she picks up, and a control
 * tray (captions, type, speaker, mute, red end button). She speaks, then listens by herself; when you stop talking she
 * answers. Tap her photo to interrupt. Captions and typing are a tap away. Turn-based (one person talks at a time).
 */
export type CallCfg = { voice: boolean; tts: boolean; serverVoice: boolean; speech: "browser" | "server" | "off"; sttModel: string; modelSource: "huggingface" | "self"; recognizer: "device" | "whisper" };
type Line = { who: "ai" | "employee"; text: string };
type Phase = "calling" | "ringing" | "connecting" | "speaking" | "listening" | "hearing" | "thinking" | "muted" | "typing" | "preparing" | "ended";
type Audio64 = { audio: string; mime: string; rest?: string } | null;
const ACTIVITY: Record<Phase, string> = { calling: "", ringing: "", connecting: "", speaking: "Naina is speaking · tap her photo to interrupt", listening: "Listening… go ahead", hearing: "Listening…", thinking: "Naina is thinking…", muted: "You’re muted", typing: "Type your answer, or tap to talk", preparing: "Getting voice ready on this phone…", ended: "" };
const CAPS_KEY = "hrms.naina.captions";
const clockMs = () => performance.now();
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** `outgoing`: you called her (Calling… → Ringing… with a ringback). Otherwise you answered her call: it connects at once. */
export function NainaVoiceCall({ id, cfg, outgoing = false, onClose }: { id: string; cfg: CallCfg; outgoing?: boolean; onClose: () => void }) {
  const browser = cfg.speech === "browser";
  // Medoro's built-in voice: the server sends audio with each reply (the device's own voice only if it doesn't).
  const fromServer = cfg.serverVoice || !browser;
  const [phase, setPhaseState] = useState<Phase>(outgoing ? "calling" : "connecting");
  const [lines, setLines] = useState<Line[]>([]);
  const [live, setLive] = useState(""), [err, setErr] = useState(""), [typed, setTyped] = useState(""), [pct, setPct] = useState(0);
  const [muted, setMuted] = useState(false), [speaker, setSpeaker] = useState(cfg.tts);
  const [secs, setSecs] = useState(0), [voiceNote, setVoiceNote] = useState(""), [hint, setHint] = useState(""), [level, setLevel] = useState(-1);
  const diag = useRef<string[]>([]); // why nothing was heard, sent with a silent turn (server log only)
  const phaseRef = useRef<Phase>(outgoing ? "calling" : "connecting"), lang = useRef<"hi" | "en" | "hinglish">("hinglish"), done = useRef(false), closed = useRef(false);
  const mutedRef = useRef(false), speakerRef = useRef(cfg.tts), nativeOk = useRef(cfg.recognizer === "device"), prepared = useRef(false);
  const stopListen = useRef<() => void>(() => {}), audioEl = useRef<HTMLAudioElement | null>(null), media = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null), connectedAt = useRef(0), stopRing = useRef<() => void>(() => {});
  // Captions: off by default as on a real call (your last choice is remembered); on when Naina can't be heard.
  const [capsPref, setCapsPref] = useLocalStorage(CAPS_KEY), [noVoice, setNoVoice] = useState(!cfg.tts), [kb, setKb] = useState(!cfg.voice);
  const caps = capsPref === "on" || (capsPref === null && noVoice), [onCall, setOnCall] = useState(false);
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const add = (l: Line[]) => setLines((x) => [...x, ...l]);

  useEffect(() => { const t = setInterval(() => { if (connectedAt.current && phaseRef.current !== "ended") setSecs(Math.floor((clockMs() - connectedAt.current) / 1000)); }, 500); return () => clearInterval(t); }, []);
  // Keep the screen on during the call, as a phone does.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null, on = true;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    void nav.wakeLock?.request("screen").then((l) => { if (on) lock = l; else void l.release().catch(() => {}); }).catch(() => {});
    return () => { on = false; void lock?.release().catch(() => {}); };
  }, []);
  // When the call ends: the hang-up beeps, "Call ended" for a moment, then the screen closes by itself.
  useEffect(() => {
    if (phase !== "ended") return;
    endTone();
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => { capRef.current?.scrollTo({ top: capRef.current.scrollHeight }); }, [lines, live]);
  useEffect(() => {
    if (!browser || !cfg.tts || cfg.serverVoice) return;
    let on = true;
    void voicesReady().then(() => { if (!on) return; const k = deviceVoiceKind(); setVoiceNote(k === "hi" ? "" : k === "en" ? `Naina is using an English voice on this device. For a Hindi voice: ${voiceHelp()}` : `This device has no voice for Naina, so her replies are shown as captions. ${voiceHelp()}`); if (k !== "hi" && k !== "en") setNoVoice(true); });
    return () => { on = false; };
  }, [browser, cfg.tts, cfg.serverVoice]);

  // ── Speaking, then listening by itself
  const say = (reply: string, speech: string, audio: Audio64, then: () => void) => {
    if (closed.current) return;
    setPhase("speaking");
    const next = () => { if (!closed.current && phaseRef.current === "speaking") then(); };
    if (speakerRef.current && audio) {
      const el = sharedAudio(); // the element the Answer tap unlocked
      if (el) {
        try {
          audioEl.current = el; el.pause();
          // A long reply is spoken sentence by sentence: each piece plays while the next one is made, so the server
          // voice never gets one long request. Interrupt / hang-up stop the chain (the phase is no longer "speaking").
          const play = (a: NonNullable<Audio64>, first: boolean) => {
            const more = a.rest ? aiCallSpeak(id, a.rest).then((r) => (r.ok ? r.data : null)).catch(() => null) : null;
            const after = !more ? next : () => {
              void more.then((b) => {
                if (closed.current || phaseRef.current !== "speaking") return;
                if (b) play(b, false); else next();
              });
            };
            el.onended = after; el.onerror = after;
            el.src = `data:${a.mime};base64,${a.audio}`;
            void el.play().catch(() => { if (!(first && browser && speakReply(speech, reply, next))) next(); });
          };
          play(audio, true);
          return;
        } catch { /* fall through to the device voice or captions */ }
      }
    }
    if (speakerRef.current && browser && speakReply(speech, reply, next)) return;
    setTimeout(next, Math.min(6000, 900 + reply.length * 25)); // no voice: time to read the caption
  };
  const afterSpeaking = () => { if (done.current) setPhase("ended"); else void listen(); };

  /**
   * Listens for one answer. The browser's recognition gives up after ~5 s of quiet, so Naina keeps listening for up to
   * three rounds before taking it as silence. Phones (iPhone above all) may only let it start from a tap: `byTap` is a
   * press of "Tap to talk", and a refusal without a tap asks for one instead of saying the microphone is blocked.
   */
  const listen = async (byTap = false) => {
    if (closed.current || done.current) return;
    if (mutedRef.current) { setPhase("muted"); return; }
    setErr(""); setLive("");
    if (cfg.voice && browser && nativeOk.current && nativeRecognitionSupported()) {
      for (let round = 0; round < 2; round++) {
        setPhase("listening");
        const h = listenOnce(lang.current, (t) => { setLive(t); if (t && phaseRef.current === "listening") setPhase("hearing"); }, { maxMs: 9000 });
        stopListen.current = h.abort;
        const r = await h.result;
        if (closed.current) return;
        if ("text" in r) { setHint(""); diag.current = []; void send({ text: r.text, sttMs: r.ms }); return; }
        if (r.error === "aborted") return; // interrupted, muted, typing, a new tap or hung up
        diag.current.push(`${round}:${r.raw ?? r.error}`);
        if (r.error === "denied") {
          if (!byTap) { setHint("Tap “Tap to talk”, then speak."); setPhase("typing"); return; }
          setErr("The microphone is blocked for this site. Allow it (the icon left of the address), or type below."); setPhase("typing"); return;
        }
        if (r.error === "unavailable") { nativeOk.current = false; break; } // the browser's service isn't reachable: on-device model
        if (round === 0) setHint("I can’t hear you yet. Speak close to the microphone.");
      }
      if (nativeOk.current) { void send({ text: "" }); return; } // still nothing: silence (Naina asks again, never a yes)
    }
    if (cfg.voice && ((browser && browserSpeechSupported()) || cfg.speech === "server")) { await record(); return; }
    setPhase("typing");
  };
  const tapToTalk = () => { silence(); setHint(""); if (mutedRef.current) { mutedRef.current = false; setMuted(false); } void listen(true); };

  // Recording one answer for the on-device model (or the AI host): it stops after a short silence.
  const stopMedia = () => {
    const m = media.current; if (!m) return;
    cancelAnimationFrame(m.raf);
    if (m.rec.state !== "inactive") m.rec.stop();
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => {});
    media.current = null;
  };
  const record = async () => {
    if (browser && !prepared.current) {
      setPhase("preparing");
      try { await prepareRecognition(cfg.sttModel, (l, t) => setPct(t ? Math.round((l / t) * 100) : 0), cfg.modelSource === "self"); prepared.current = true; }
      catch { setErr("This device couldn’t load voice recognition. Please type your answer below."); setPhase("typing"); return; }
      if (closed.current) return;
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } }); }
    catch { setErr("The microphone is blocked or missing. Allow it, or type below."); setPhase("typing"); return; }
    if (closed.current || mutedRef.current) { stream.getTracks().forEach((t) => t.stop()); if (mutedRef.current) setPhase("muted"); return; }
    setPhase("listening");
    const chunks: Blob[] = [], mime = recordingFormat().mimeType;
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize), started = clockMs();
    let spoke = false, quietSince = 0, cancelled = false;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / buf.length), t = clockMs();
      if (rms > 9) { if (!spoke) setPhase("hearing"); spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = t;
      setLevel(Math.min(1, rms / 40));
      if ((spoke && quietSince && t - quietSince > 1100) || t - started > 15000 || (!spoke && t - started > 8000)) { if (rec.state === "recording") rec.stop(); return; }
      if (media.current) media.current.raf = requestAnimationFrame(tick);
    };
    stopListen.current = () => { cancelled = true; stopMedia(); setLevel(-1); };
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" }), heard = spoke;
      stopMedia(); setLevel(-1);
      if (!heard) diag.current.push("rec:quiet");
      if (cancelled || closed.current) return;
      if (!heard || blob.size < 1200) { void send({ text: "" }); return; }
      setPhase("thinking");
      if (!browser) { void send({ audio: blob }); return; }
      void recognise(blob, cfg.sttModel).then((r) => send({ text: r.text, sttMs: r.ms || 1 })).catch(() => { setErr("I couldn’t make that out. Please say it again, or type."); void listen(); });
    };
    media.current = { rec, stream, ctx, raf: 0 };
    rec.start();
    media.current.raf = requestAnimationFrame(tick);
  };

  // ── One turn to the server
  const send = async (input: { text?: string; audio?: Blob; sttMs?: number }) => {
    if (closed.current) return;
    setPhase("thinking"); setLive("");
    const fd = new FormData();
    fd.set("id", id); fd.set("speak", speakerRef.current && fromServer ? "1" : "0");
    if (input.sttMs) fd.set("sttMs", String(input.sttMs));
    if (input.text !== undefined) fd.set("text", input.text);
    if (!input.text && !input.audio && diag.current.length) fd.set("diag", diag.current.join(",").slice(0, 200));
    diag.current = [];
    if (input.audio) fd.set("audio", input.audio, `turn.${recordingFormat().ext}`);
    const r = await aiCallTurn(fd).catch(() => null);
    if (closed.current) return;
    if (!r) { setErr("The connection dropped. The call is saved: say it again or type."); void listen(); return; }
    if (!r.ok) { setErr(r.error); setPhase("typing"); return; }
    if (r.data.lang) lang.current = r.data.lang;
    add([{ who: "employee", text: r.data.heard }, ...(r.data.reply ? [{ who: "ai" as const, text: r.data.reply }] : [])]);
    if (r.data.done) done.current = true;
    if (r.data.reply) say(r.data.reply, r.data.speech, r.data.audio, afterSpeaking); else afterSpeaking();
  };

  useEffect(() => {
    // Calling her: "Calling…", then "Ringing…" with the ringback, and she picks up after a ring or two (while her first
    // line is made). Answering her call: it connects straight away.
    unlockTones();
    stopRing.current = outgoing ? ringback() : () => {};
    const toRinging = outgoing ? setTimeout(() => { if (phaseRef.current === "calling") setPhase("ringing"); }, 1200) : undefined;
    const minRing = new Promise((ok) => setTimeout(ok, outgoing ? 3800 : 400));
    const connect = () => { stopRing.current(); clearTimeout(toRinging); connectedAt.current = clockMs(); setOnCall(true); connectedTone(); };
    void Promise.all([aiCallBegin(id, cfg.tts && fromServer), minRing]).then(([r]) => {
      if (closed.current) return;
      connect();
      if (!r.ok) { setErr(r.error); setPhase("typing"); return; }
      lang.current = r.data.lang ?? "hinglish";
      setLines(r.data.turns);
      const last = r.data.turns.at(-1);
      if (last?.who === "ai") say(last.text, r.data.speech, r.data.audio, afterSpeaking); else void listen();
    }).catch(() => { stopRing.current(); if (!closed.current) { setErr("Couldn’t connect. Check your internet and try again."); setPhase("typing"); } });
    return () => { closed.current = true; stopRing.current(); clearTimeout(toRinging); stopListen.current(); stopMedia(); audioEl.current?.pause(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Controls
  const silence = () => { stopListen.current(); stopListen.current = () => {}; stopMedia(); audioEl.current?.pause(); stopSpeaking(); };
  const interrupt = () => { silence(); void listen(true); };
  const toggleMute = () => {
    const m = !mutedRef.current; mutedRef.current = m; setMuted(m);
    if (m && (phaseRef.current === "listening" || phaseRef.current === "hearing")) { silence(); setPhase("muted"); }
    else if (!m && phaseRef.current === "muted") void listen();
  };
  const toggleSpeaker = () => { const s = !speakerRef.current; speakerRef.current = s; setSpeaker(s); if (!s) { audioEl.current?.pause(); stopSpeaking(); } };
  const hangUp = () => {
    if (phaseRef.current === "ended") { onClose(); return; }
    const wasDone = done.current; closed.current = true; stopRing.current(); silence();
    if (!wasDone) void aiCallEnd(id);
    setPhase("ended");
  };
  const toggleCaps = () => setCapsPref(caps ? "off" : "on");
  const sendTyped = () => { const t = typed.trim(); if (!t || phaseRef.current === "thinking" || phaseRef.current === "ended") return; setTyped(""); silence(); void send({ text: t }); };


  const talking = phase === "speaking", ear = phase === "listening" || phase === "hearing";
  const status = phase === "calling" ? "Calling…" : phase === "ringing" ? "Ringing…" : phase === "connecting" ? "Connecting…" : phase === "ended" ? `Call ended${secs ? ` · ${mmss(secs)}` : ""}` : mmss(secs);
  const activity = phase === "preparing" && pct ? `${ACTIVITY.preparing} ${pct}%` : !cfg.voice && phase === "typing" ? "Type your answer below" : ACTIVITY[phase];
  const showInput = phase !== "ended" && (kb || phase === "typing"), showCaps = caps || showInput;
  const canTalk = cfg.voice && (phase === "typing" || phase === "muted" || ((phase === "listening" || phase === "hearing") && !!hint));
  const tapFace = () => { if (talking) interrupt(); else if (canTalk) tapToTalk(); };
  return (
    <CallScreen label="Call with Naina" role="dialog">
      <div className="flex flex-col items-center pt-[max(20px,env(safe-area-inset-top))] px-5 gap-1 text-center">
        <div className="flex items-center gap-1.5 text-[12px] text-white/60"><Icon.Lock /> Medoro HR · in-app voice call</div>
        <div className="mt-3 text-[26px] font-semibold leading-tight tracking-[-.01em]">Naina</div>
        <div className="text-[15px] text-white/80 tabular-nums" role="status" aria-live="polite">{status}</div>
      </div>

      <div className={cx("flex-1 min-h-0 flex flex-col items-center px-4", showCaps ? "justify-start pt-4 gap-3" : "justify-center")}>
        <button type="button" onClick={tapFace} aria-label={talking ? "Interrupt Naina" : canTalk ? "Tap to talk" : "Naina"} className="relative rounded-full border-0 bg-transparent p-0 cursor-pointer flex-none">
          {talking ? <><span aria-hidden className="absolute inset-0 rounded-full bg-[#25D366]/25 motion-safe:animate-ping" /><span aria-hidden className="absolute -inset-4 rounded-full border-2 border-[#25D366]/30 motion-safe:animate-pulse" /></> : null}
          {phase === "ringing" || phase === "calling" ? <span aria-hidden className="absolute -inset-3 rounded-full border border-white/25 motion-safe:animate-ping [animation-duration:2s]" /> : null}
          {ear ? <span aria-hidden className="absolute rounded-full border-[3px] border-white/50 transition-all duration-100" style={{ inset: `${-6 - Math.max(0, level) * 18}px` }} /> : null}
          <span aria-hidden className={cx("relative rounded-full bg-gradient-to-br from-[#F9A8D4] via-[#C4B5FD] to-[#5EEAD4] flex items-center justify-center shadow-[0_12px_40px_-8px_rgba(0,0,0,.6)] transition-all duration-300", showCaps ? "size-[88px] text-[46px]" : "size-[148px] text-[82px]")}>👩🏻‍💼</span>
        </button>
        {onCall && phase !== "ended" && activity ? <div className="text-[13px] text-white/70 text-center min-h-[18px]" aria-live="polite">{activity}</div> : null}

        {showCaps ? <div ref={capRef} className="w-full flex-1 min-h-[96px] overflow-y-auto rounded-2xl bg-white/[.06] px-3 py-2.5 flex flex-col gap-1.5 text-[14px] leading-[1.45] [scrollbar-width:thin]" aria-label="Captions">
          {!lines.length && !live ? <div className="m-auto text-[12.5px] text-white/50">Captions appear here</div> : null}
          {lines.map((l, i) => <div key={i} className={cx("max-w-[86%] rounded-[10px] px-3 py-1.5", l.who === "ai" ? "self-start bg-[#202C33] rounded-tl-[3px]" : "self-end bg-[#005C4B] rounded-tr-[3px]")}>{l.text || <em className="opacity-70">(silence)</em>}</div>)}
          {live ? <div className="self-end max-w-[86%] rounded-[10px] rounded-tr-[3px] px-3 py-1.5 bg-[#005C4B]/60 italic">{live}</div> : null}
        </div> : null}
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3">
        {hint && !err ? <div role="status" className="text-[12.5px] bg-[#FEF3C7] text-[#78350F] rounded-xl px-3 py-2">{hint}</div> : null}
        {err ? <div role="alert" className="text-[12.5px] bg-[#7F1D1D]/70 rounded-xl px-3 py-2">{err}</div> : null}
        {voiceNote && speaker && phase !== "ended" ? <div className="text-[11.5px] text-white/70 bg-white/[.06] rounded-xl px-3 py-1.5">{voiceNote}</div> : null}
        {canTalk ? <button type="button" onClick={tapToTalk} className="self-center flex items-center gap-2 rounded-full bg-white text-[#0B141A] font-semibold px-5 py-2.5 text-[14px] border-0 cursor-pointer shadow-lg"><Icon.Mic /> Tap to talk</button> : null}
        {showInput ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
          <input className="flex-1 min-w-0 rounded-full bg-[#2A3942] text-white placeholder:text-white/45 px-4 py-2.5 text-[14px] outline-none border-0 focus:ring-2 focus:ring-[#25D366]/40" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead (Hindi, English or Hinglish)" aria-label="Type instead" />
          <button className="flex-none size-[42px] rounded-full bg-[#25D366] text-[#0B141A] border-0 font-bold disabled:opacity-40 flex items-center justify-center" aria-label="Send" disabled={!typed.trim() || phase === "thinking"}>➤</button>
        </form> : null}
      </div>

      <div className="mt-3 mx-3 mb-[max(12px,env(safe-area-inset-bottom))] rounded-[28px] bg-[#1F2C34] px-3 py-3.5 flex items-center justify-around">
        <TrayBtn label="Live captions" on={caps} onClick={toggleCaps} disabled={phase === "ended"}><Icon.Captions /></TrayBtn>
        <TrayBtn label="Type" on={kb} onClick={() => setKb((k) => !k)} disabled={phase === "ended"}><Icon.Keyboard /></TrayBtn>
        <TrayBtn label={speaker ? "Speaker on" : "Speaker off"} on={speaker && cfg.tts} onClick={toggleSpeaker} disabled={!cfg.tts || phase === "ended"}>{speaker ? <Icon.Speaker /> : <Icon.SpeakerOff />}</TrayBtn>
        <TrayBtn label={muted ? "Unmute" : "Mute"} on={muted} onClick={toggleMute} disabled={phase === "ended"}>{muted ? <Icon.MicOff /> : <Icon.Mic />}</TrayBtn>
        <button type="button" onClick={hangUp} aria-label={phase === "ended" ? "Close" : "End call"} title={phase === "ended" ? "Close" : "End call"} className="size-[58px] rounded-full bg-[#EA0038] hover:bg-[#C8002F] text-white border-0 cursor-pointer flex items-center justify-center shadow-lg"><Icon.HangUp /></button>
      </div>
      <div className="px-5 pb-[max(10px,env(safe-area-inset-bottom))] text-center text-[10.5px] text-white/45">Naina is an AI. Say “HR se baat karni hai” for a person, or “call mat karo” to stop her calls.{browser && cfg.recognizer === "device" && nativeRecognitionSupported() ? " Your browser’s speech service turns your voice into text; Medoro keeps only the text." : " Your voice is never stored."}</div>
    </CallScreen>
  );
}

/** The full-screen call surface (a phone-sized window on a computer), shared by the call and the incoming-call screen. */
export function CallScreen({ label, role, children }: { label: string; role: "dialog" | "alertdialog"; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-[2px] sm:p-6">
      <div role={role} aria-modal="true" aria-label={label} className="relative w-full h-[100dvh] sm:h-[min(780px,100%)] sm:max-w-[400px] sm:rounded-[32px] overflow-hidden text-white flex flex-col bg-[#0B141A] shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)]">
        <div aria-hidden className="absolute inset-0 pointer-events-none bg-[radial-gradient(120%_60%_at_50%_0%,rgba(196,181,253,.28),transparent_60%),radial-gradient(90%_50%_at_50%_100%,rgba(14,124,119,.35),transparent_70%)]" />
        <div className="relative flex flex-col flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}

function TrayBtn({ label, on, onClick, disabled, children }: { label: string; on?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on} title={label}
      className={cx("size-[50px] rounded-full flex items-center justify-center border-0 cursor-pointer disabled:opacity-35 disabled:cursor-default transition-colors", on ? "bg-white text-[#0B141A]" : "bg-transparent text-white hover:bg-white/10")}>
      {children}
    </button>
  );
}

const svg = (d: React.ReactNode, size = 24) => <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
/** Line icons for the call controls. */
export const Icon = {
  Mic: () => svg(<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" /></>),
  MicOff: () => svg(<><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M19 10a7 7 0 0 1-1.1 3.8M5 10a7 7 0 0 0 10.8 5.9M12 17v4M8 21h8M3 3l18 18" /></>),
  Speaker: () => svg(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>),
  SpeakerOff: () => svg(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m22 9-6 6M16 9l6 6" /></>),
  Captions: () => svg(<><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3" /></>),
  Keyboard: () => svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>),
  Lock: () => svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, 12),
  Chat: () => svg(<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12z" />),
  HangUp: () => <svg aria-hidden width={28} height={28} viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-3.3 0-6.4 1-8.9 2.8-.7.5-1 1.4-.7 2.2l.8 2c.3.8 1.2 1.2 2 1l2.6-.8c.7-.2 1.1-.8 1.1-1.5v-2c1.9-.5 4.3-.5 6.2 0v2c0 .7.4 1.3 1.1 1.5l2.6.8c.8.2 1.7-.2 2-1l.8-2c.3-.8 0-1.7-.7-2.2C18.4 10 15.3 9 12 9z" /></svg>,
  Phone: () => <svg aria-hidden width={28} height={28} viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" /></svg>,
};
