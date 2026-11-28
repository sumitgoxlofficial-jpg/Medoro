"use client";
import { useEffect, useRef, useState } from "react";
import { aiCallBegin, aiCallEnd, aiCallTurn } from "../actions";
import { browserSpeechSupported, deviceVoiceKind, prepareRecognition, recognise, recordingFormat, speakReply, stopSpeaking, voiceHelp, voicesReady } from "./speech/browser-speech";
import { listenOnce, nativeRecognitionSupported } from "./speech/native-recognition";
import { cx } from "./kit";

/**
 * A call with Naina that works like a phone call, inside the HRMS: she speaks, then listens by herself; when you stop
 * talking she answers. Live captions show both sides. Mute, speaker, interrupt and end work as on a phone; typing is
 * always there as a fallback. Turn-based (one person talks at a time), not a phone line.
 */
export type CallCfg = { voice: boolean; tts: boolean; speech: "browser" | "server" | "off"; sttModel: string; modelSource: "huggingface" | "self"; recognizer: "device" | "whisper" };
type Line = { who: "ai" | "employee"; text: string };
type Phase = "connecting" | "speaking" | "listening" | "hearing" | "thinking" | "muted" | "typing" | "preparing" | "ended";
type Audio64 = { audio: string; mime: string } | null;
const STATUS: Record<Phase, string> = { connecting: "Connecting…", speaking: "Naina is speaking", listening: "Listening… go ahead", hearing: "Listening…", thinking: "Naina is thinking…", muted: "You’re muted", typing: "Type your answer below", preparing: "Getting voice ready on this phone…", ended: "Call ended" };
const clockMs = () => performance.now();
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function NainaVoiceCall({ id, cfg, onClose }: { id: string; cfg: CallCfg; onClose: () => void }) {
  const browser = cfg.speech === "browser";
  const [phase, setPhaseState] = useState<Phase>("connecting");
  const [lines, setLines] = useState<Line[]>([]);
  const [live, setLive] = useState(""), [err, setErr] = useState(""), [typed, setTyped] = useState(""), [pct, setPct] = useState(0);
  const [muted, setMuted] = useState(false), [speaker, setSpeaker] = useState(cfg.tts);
  const [secs, setSecs] = useState(0), [voiceNote, setVoiceNote] = useState("");
  const phaseRef = useRef<Phase>("connecting"), lang = useRef<"hi" | "en" | "hinglish">("hinglish"), done = useRef(false), closed = useRef(false);
  const mutedRef = useRef(false), speakerRef = useRef(cfg.tts), nativeOk = useRef(cfg.recognizer === "device"), prepared = useRef(false);
  const stopListen = useRef<() => void>(() => {}), audioEl = useRef<HTMLAudioElement | null>(null), media = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null);
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const add = (l: Line[]) => setLines((x) => [...x, ...l]);

  useEffect(() => { const t = setInterval(() => { if (phaseRef.current !== "ended" && phaseRef.current !== "connecting") setSecs((s) => s + 1); }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { capRef.current?.scrollTo({ top: capRef.current.scrollHeight }); }, [lines, live]);
  useEffect(() => {
    if (!browser || !cfg.tts) return;
    let on = true;
    void voicesReady().then(() => { if (!on) return; const k = deviceVoiceKind(); setVoiceNote(k === "hi" ? "" : k === "en" ? `Naina is using an English voice on this device. For a Hindi voice: ${voiceHelp()}` : `This device has no voice for Naina, so her replies are shown as captions. ${voiceHelp()}`); });
    return () => { on = false; };
  }, [browser, cfg.tts]);

  // ── Speaking, then listening by itself
  const say = (reply: string, speech: string, audio: Audio64, then: () => void) => {
    if (closed.current) return;
    setPhase("speaking");
    const next = () => { if (!closed.current && phaseRef.current === "speaking") then(); };
    if (speakerRef.current && audio) {
      try { audioEl.current?.pause(); const el = new Audio(`data:${audio.mime};base64,${audio.audio}`); audioEl.current = el; el.onended = next; el.onerror = next; void el.play().catch(next); return; } catch { /* fall through to captions */ }
    }
    if (speakerRef.current && browser && speakReply(speech, reply, next)) return;
    setTimeout(next, Math.min(6000, 900 + reply.length * 25)); // no voice: time to read the caption
  };
  const afterSpeaking = () => { if (done.current) setPhase("ended"); else void listen(); };

  const listen = async () => {
    if (closed.current || done.current) return;
    if (mutedRef.current) { setPhase("muted"); return; }
    setErr(""); setLive("");
    if (cfg.voice && browser && nativeOk.current && nativeRecognitionSupported()) {
      setPhase("listening");
      const h = listenOnce(lang.current, (t) => { setLive(t); if (t && phaseRef.current === "listening") setPhase("hearing"); });
      stopListen.current = h.abort;
      const r = await h.result;
      if (closed.current) return;
      if ("text" in r) { void send({ text: r.text, sttMs: r.ms }); return; }
      if (r.error === "aborted") return; // interrupted, muted, typing or hung up
      if (r.error === "no-speech") { void send({ text: "" }); return; } // silence: Naina asks again, never takes it as yes
      if (r.error === "denied") { setErr("The microphone is blocked for this site. Allow it (the icon left of the address), or type below."); setPhase("typing"); return; }
      nativeOk.current = false; // the browser's recognition isn't reachable here: use the model on the device
    }
    if (cfg.voice && ((browser && browserSpeechSupported()) || cfg.speech === "server")) { await record(); return; }
    setPhase("typing");
  };

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
      if ((spoke && quietSince && t - quietSince > 1100) || t - started > 15000 || (!spoke && t - started > 8000)) { if (rec.state === "recording") rec.stop(); return; }
      if (media.current) media.current.raf = requestAnimationFrame(tick);
    };
    stopListen.current = () => { cancelled = true; stopMedia(); };
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" }), heard = spoke;
      stopMedia();
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
    fd.set("id", id); fd.set("speak", speakerRef.current && !browser ? "1" : "0");
    if (input.sttMs) fd.set("sttMs", String(input.sttMs));
    if (input.text !== undefined) fd.set("text", input.text);
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
    void aiCallBegin(id, cfg.tts && !browser).then((r) => {
      if (closed.current) return;
      if (!r.ok) { setErr(r.error); setPhase("typing"); return; }
      lang.current = r.data.lang ?? "hinglish";
      setLines(r.data.turns);
      const last = r.data.turns.at(-1);
      if (last?.who === "ai") say(last.text, r.data.speech, r.data.audio, afterSpeaking); else void listen();
    }).catch(() => { if (!closed.current) { setErr("Couldn’t connect. Check your internet and try again."); setPhase("typing"); } });
    return () => { closed.current = true; stopListen.current(); stopMedia(); audioEl.current?.pause(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Controls
  const silence = () => { stopListen.current(); stopListen.current = () => {}; stopMedia(); audioEl.current?.pause(); stopSpeaking(); };
  const interrupt = () => { silence(); void listen(); };
  const toggleMute = () => {
    const m = !mutedRef.current; mutedRef.current = m; setMuted(m);
    if (m && (phaseRef.current === "listening" || phaseRef.current === "hearing")) { silence(); setPhase("muted"); }
    else if (!m && phaseRef.current === "muted") void listen();
  };
  const toggleSpeaker = () => { const s = !speakerRef.current; speakerRef.current = s; setSpeaker(s); if (!s) { audioEl.current?.pause(); stopSpeaking(); } };
  const hangUp = () => { const wasDone = done.current; closed.current = true; silence(); if (!wasDone) void aiCallEnd(id); onClose(); };
  const sendTyped = () => { const t = typed.trim(); if (!t || phaseRef.current === "thinking" || phaseRef.current === "ended") return; setTyped(""); silence(); void send({ text: t }); };

  const talking = phase === "speaking", ear = phase === "listening" || phase === "hearing";
  return (
    <div className="w-full rounded-3xl overflow-hidden bg-gradient-to-b from-[#0B3B3A] via-[#0B5E5B] to-[#0E7C77] text-white shadow-[0_30px_60px_-20px_rgba(0,0,0,.55)] flex flex-col max-h-[calc(100dvh-48px)]">
      <div className="flex flex-col items-center pt-7 pb-4 px-5 gap-2">
        <div className="relative">
          {talking ? <span aria-hidden className="absolute -inset-3 rounded-full bg-white/15 animate-ping" /> : null}
          {ear ? <span aria-hidden className="absolute -inset-2 rounded-full ring-4 ring-[#5EEAD4]/70 animate-pulse" /> : null}
          <span aria-hidden className="relative size-24 rounded-full bg-gradient-to-br from-[#F9A8D4] via-[#C4B5FD] to-[#5EEAD4] flex items-center justify-center text-[52px] shadow-lg">👩🏻‍💼</span>
        </div>
        <div className="text-[22px] font-bold leading-tight">Naina</div>
        <div className="text-[12.5px] text-white/75">AI HR assistant · Medoro HR</div>
        <div className="flex items-center gap-2 text-[13.5px]" role="status" aria-live="polite"><span className={cx("size-2 rounded-full", phase === "ended" ? "bg-[#F87171]" : ear ? "bg-[#5EEAD4] animate-pulse" : "bg-white/70")} />{phase === "preparing" && pct ? `${STATUS.preparing} ${pct}%` : STATUS[phase]}<span className="text-white/60 tabular-nums">· {mmss(secs)}</span></div>
      </div>

      <div ref={capRef} className="mx-4 mb-3 flex-1 min-h-[140px] max-h-[34vh] overflow-y-auto rounded-2xl bg-black/20 px-3 py-2.5 flex flex-col gap-1.5 text-[14px] leading-[1.45]" aria-label="Captions">
        {lines.map((l, i) => <div key={i} className={cx("max-w-[88%] rounded-xl px-3 py-1.5", l.who === "ai" ? "self-start bg-white/12" : "self-end bg-[#D9FDD3] text-[#111B21]")}>{l.text || <em className="opacity-70">(silence)</em>}</div>)}
        {live ? <div className="self-end max-w-[88%] rounded-xl px-3 py-1.5 bg-[#D9FDD3]/70 text-[#111B21] italic">{live}</div> : null}
      </div>

      {err ? <div role="alert" className="mx-4 mb-2 text-[12.5px] bg-[#7F1D1D]/60 rounded-lg px-3 py-2">{err}</div> : null}
      {voiceNote && speaker ? <div className="mx-4 mb-2 text-[11.5px] text-white/80 bg-black/15 rounded-lg px-3 py-1.5">{voiceNote}</div> : null}

      {phase !== "ended" ? <form className="mx-4 mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
        <input className="flex-1 min-w-0 rounded-full bg-white/95 text-[#111B21] px-4 py-2 text-[14px] outline-none" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead (Hindi, English or Hinglish)" aria-label="Type instead" />
        <button className="rounded-full bg-white text-[#0B5E5B] font-bold px-4 text-[13.5px] disabled:opacity-50" disabled={!typed.trim() || phase === "thinking"}>Send</button>
      </form> : null}

      <div className="flex items-center justify-center gap-5 pb-6 pt-1">
        {phase === "ended" ? <button onClick={onClose} className="rounded-full bg-white text-[#0B5E5B] font-bold px-8 py-3 text-[15px]">Close</button> : <>
          <CallBtn label={muted ? "Unmute" : "Mute"} on={muted} onClick={toggleMute}>{muted ? "🔇" : "🎙️"}</CallBtn>
          <CallBtn label={speaker ? "Speaker on" : "Speaker off"} on={!speaker} onClick={toggleSpeaker} disabled={!cfg.tts}>{speaker ? "🔊" : "🔈"}</CallBtn>
          {talking ? <CallBtn label="Interrupt" onClick={interrupt}>✋</CallBtn> : phase === "typing" && cfg.voice ? <CallBtn label="Talk" onClick={() => void listen()}>🗣️</CallBtn> : null}
          <button onClick={hangUp} aria-label="End call" className="size-16 rounded-full bg-[#DC2626] hover:bg-[#B91C1C] flex items-center justify-center text-[26px] shadow-lg rotate-[135deg]">📞</button>
        </>}
      </div>
      <div className="px-5 pb-4 text-center text-[11px] text-white/60">Naina is an AI. Say “HR se baat karni hai” for a person, or “call mat karo” to stop her calls.{browser && cfg.recognizer === "device" && nativeRecognitionSupported() ? " Your browser’s speech service turns your voice into text; Medoro keeps only the text." : " Your voice is never stored."}</div>
    </div>
  );
}

function CallBtn({ label, on, onClick, disabled, children }: { label: string; on?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on} className="flex flex-col items-center gap-1 disabled:opacity-40">
      <span className={cx("size-14 rounded-full flex items-center justify-center text-[22px]", on ? "bg-white text-[#0B5E5B]" : "bg-white/15 hover:bg-white/25")}>{children}</span>
      <span className="text-[11px] text-white/80">{label}</span>
    </button>
  );
}
