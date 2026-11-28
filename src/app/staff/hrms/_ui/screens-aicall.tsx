"use client";
import { useEffect, useRef, useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { aiCallBegin, aiCallConsent, aiCallEnd, aiCallTurn } from "../actions";
import { browserSpeechSupported, deviceVoiceAvailable, prepareRecognition, recognise, recordingFormat, speakOnDevice, stopSpeaking, unlockSpeech, voiceHelp, voicesReady } from "./speech/browser-speech";
import { Card, Empty, Pill, btnCls, cx, dangerCls, dayLabel, inputCls, primaryCls, useRun } from "./kit";

type D = Data<"aicall">;
type Turn = { who: "ai" | "employee"; text: string };
const ABOUT: Record<string, string> = { late: "today's check-in", absent: "today's attendance", missing_checkout: "today's check-out", overtime: "an overtime request", manual: "an HR follow-up" };

/**
 * The employee's side of an AI HR conversation. Voice is turn-based: the browser records one answer (it stops by itself
 * after a short silence, or when you press the button), the self-hosted speech service turns it into text, and the
 * assistant answers in its Hindi female voice. This is not a phone call and not continuous streaming. Typing works
 * the same way, always, and is the fallback when the microphone or the voice service isn't available.
 */
export function AiCallScreen({ d }: { d: D }) {
  const { run, busy } = useRun();
  const [active, setActive] = useState<string | null>(null);
  return <>
    {!d.enabled ? <Card pad><div className="text-[13px] text-[#64748B]">The AI HR Assistant isn&apos;t switched on for the company yet.</div></Card> : null}
    {active ? <Conversation id={active} voice={d.voice} tts={d.tts} mode={d.speech} model={d.sttModel} selfHosted={d.modelSource === "self"} onClose={() => setActive(null)} /> : <>
      <Card title="Waiting for you" sub="The assistant checks in about attendance or an overtime request. It is an AI: it only notes what you say; HR or your manager decide anything.">
        {d.open.length ? <div className="flex flex-col gap-2 px-5 pb-4">{d.open.map((c) => <div key={c.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-lg px-3 py-2.5"><div className="flex-1"><div className="text-[13.5px] font-semibold">About {ABOUT[c.reason]}</div><div className="text-[12px] text-[#64748B]">{dayLabel(c.day)} · {c.status === "in_progress" ? "started" : "waiting"}</div></div><button className={primaryCls} onClick={() => { if (d.speech === "browser") unlockSpeech(); setActive(c.id); }}>{c.status === "in_progress" ? "Continue" : "Talk now"}</button></div>)}</div> : <Empty>Nothing waiting. You&apos;ll get a notification when the assistant has a question.</Empty>}
      </Card>
      <Card title="Your choice" sub="You can switch AI conversations off at any time; HR can still contact you directly.">
        <div className="px-5 pb-4 flex items-center gap-3 text-[13px]"><Pill tone={d.allowed ? "green" : "gray"}>{d.allowed ? "AI conversations on" : "AI conversations off"}</Pill><button className={d.allowed ? dangerCls : btnCls} disabled={busy} onClick={() => run(() => aiCallConsent(!d.allowed))}>{d.allowed ? "Turn off" : "Turn on"}</button></div>
        <div className="px-5 pb-4 text-[12px] text-[#64748B]">What is kept: the text of the conversation and a short summary, sealed and visible only to authorised HR, deleted after {d.retentionDays} days. Your voice recording is never stored. Microphone access is used only while you press Speak.</div>
      </Card>
      {d.past.length ? <Card title="Earlier conversations"><div className="flex flex-col gap-1.5 px-5 pb-4">{d.past.map((c) => <div key={c.id} className="text-[12.5px]"><strong>{dayLabel(c.day)}</strong> · {ABOUT[c.reason]} · <Pill tone="gray">{c.status.replace("_", " ")}</Pill> {c.summary ? <span className="text-[#64748B]">{c.summary}</span> : null}</div>)}</div></Card> : null}
    </>}
  </>;
}

export function Conversation({ id, voice, tts, mode, model, selfHosted, onClose }: { id: string; voice: boolean; tts: boolean; mode: "browser" | "server" | "off"; model: string; selfHosted: boolean; onClose: () => void }) {
  const browser = mode === "browser";
  const canVoice = voice && (!browser || browserSpeechSupported());
  const [prep, setPrep] = useState<"" | "loading" | "ready">("");
  // In free (browser) mode, replies are spoken by the device's own voice: tell the person when it has none.
  const [noVoice, setNoVoice] = useState(false);
  useEffect(() => { if (!browser || !tts) return; let live = true; void voicesReady().then(() => { if (live) setNoVoice(!deviceVoiceAvailable("hi")); }); return () => { live = false; }; }, [browser, tts]);
  const [pct, setPct] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [rec, setRec] = useState<"idle" | "listening" | "sending">("idle");
  const [speakOut, setSpeakOut] = useState(tts);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRef = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const play = (a: { audio: string; mime: string } | null, speech = "") => {
    if (!speakOut) return;
    if (!a) { if (browser && speech) speakOnDevice(speech, /[\u0900-\u097F]/.test(speech) ? "hi" : "en"); return; }
    try { audioRef.current?.pause(); const el = new Audio(`data:${a.mime};base64,${a.audio}`); audioRef.current = el; void el.play().catch(() => {}); } catch { /* the text is on screen */ }
  };
  useEffect(() => {
    let cancelled = false;
    void aiCallBegin(id, tts && !browser).then((r) => {
      if (cancelled) return;
      if (!r.ok) { setErr(r.error); return; }
      setTurns(r.data.turns); play(r.data.audio, r.data.speech);
    }).catch(() => { if (!cancelled) setErr("Couldn't reach the server. Check your connection and try again."); });
    return () => { cancelled = true; stopMedia(); audioRef.current?.pause(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);

  const send = async (input: { text?: string; audio?: Blob; sttMs?: number }) => {
    setBusy(true); setErr("");
    audioRef.current?.pause(); stopSpeaking(); // the employee speaking interrupts the assistant
    const fd = new FormData();
    fd.set("id", id); fd.set("speak", speakOut && !browser ? "1" : "0");
    if (input.sttMs) fd.set("sttMs", String(input.sttMs));
    if (input.text !== undefined) fd.set("text", input.text);
    if (input.audio) fd.set("audio", input.audio, `turn.${recordingFormat().ext}`);
    try {
      const r = await aiCallTurn(fd);
      if (!r.ok) { setErr(r.error); return; }
      setTurns((t) => [...t, { who: "employee", text: r.data.heard }, ...(r.data.reply ? [{ who: "ai" as const, text: r.data.reply }] : [])]);
      play(r.data.audio, r.data.speech);
      if (r.data.done) setDone(true);
    } catch { setErr("The connection dropped. Your conversation is saved; try again."); }
    finally { setBusy(false); setRec("idle"); }
  };

  function stopMedia() {
    const m = mediaRef.current; if (!m) return;
    cancelAnimationFrame(m.raf);
    if (m.rec.state !== "inactive") m.rec.stop();
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => {});
    mediaRef.current = null;
  }
  const listen = async () => {
    if (rec === "listening") { const m = mediaRef.current; if (m?.rec.state === "recording") m.rec.stop(); return; }
    setErr(""); audioRef.current?.pause(); stopSpeaking();
    if (browser && prep !== "ready") {
      // First use on this device: download the speech model once (kept in the browser cache afterwards).
      setPrep("loading");
      try { await prepareRecognition(model, (l, t) => setPct(t ? Math.round((l / t) * 100) : 0), selfHosted); setPrep("ready"); }
      catch { setPrep(""); setErr("This device couldn't load voice recognition. Please type your answer below."); return; }
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } }); }
    catch { setErr("Microphone permission was denied or no microphone was found. You can type your answer below."); return; }
    const chunks: Blob[] = [];
    const mime = recordingFormat().mimeType;
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const started = performance.now(); let spoke = false, quietSince = 0;
    // End of speech: after the person has spoken, 1.2 s below the noise floor ends the turn; 15 s is the longest answer.
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / buf.length), t = performance.now();
      if (rms > 9) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = t;
      if ((spoke && quietSince && t - quietSince > 1200) || t - started > 15000 || (!spoke && t - started > 7000)) { if (r.state === "recording") r.stop(); return; }
      if (mediaRef.current) mediaRef.current.raf = requestAnimationFrame(tick);
    };
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      const hadSpeech = spoke;
      stopMedia();
      if (!hadSpeech || blob.size < 1200) { setRec("idle"); void send({ text: "" }); return; } // silence counts as no answer, never as yes
      setRec("sending");
      if (!browser) { void send({ audio: blob }); return; }
      void recognise(blob, model).then((r) => send({ text: r.text, sttMs: r.ms || 1 })).catch(() => { setRec("idle"); setErr("I couldn't make out that recording. Try again or type your answer."); });
    };
    mediaRef.current = { rec: r, stream, ctx, raf: 0 };
    r.start(); setRec("listening");
    mediaRef.current.raf = requestAnimationFrame(tick);
  };

  return <Card title="Naina · AI HR assistant" sub="Naina is an AI assistant from Medoro HR. Say “HR se baat karni hai” for a person, or “call mat karo” to stop." right={<><label className="flex gap-1.5 items-center text-[12px]"><input type="checkbox" checked={speakOut} disabled={!tts} onChange={(e) => setSpeakOut(e.target.checked)} />Voice replies{!tts ? " (unavailable)" : ""}</label><button className={btnCls} onClick={() => { if (!done) void aiCallEnd(id); onClose(); }}>{done ? "Close" : "End"}</button></>}>
    <div className="px-5 pb-4 flex flex-col gap-2" aria-live="polite">
      {turns.map((t, i) => <div key={i} className={cx("rounded-lg px-3 py-2 text-[13.5px] max-w-[88%]", t.who === "ai" ? "self-start bg-[#E6F4F2]" : "self-end bg-[#EEF2FF]")}>{t.text || <em className="text-[#94A3B8]">(no answer)</em>}</div>)}
      {busy ? <div className="self-start text-[12px] text-[#64748B]">…</div> : null}
      <div ref={endRef} />
      {err ? <div className="text-[12.5px] text-[#B3261E]">{err}</div> : null}
      {done ? <div className="text-[12.5px] text-[#0B5E5B] font-semibold">Conversation finished. Thank you.</div> : <>
        {noVoice && speakOut ? <div className="text-[12px] text-[#B45309] bg-[#FEF3C7] rounded-lg px-3 py-2">This device has no Hindi voice installed, so replies are shown as text only. {voiceHelp()}</div> : null}
        {browser && voice && !canVoice ? <div className="text-[12px] text-[#64748B]">This browser can&apos;t record voice. Please type, or use Chrome, Edge or Safari.</div> : null}
        {prep === "loading" ? <div className="text-[12.5px] text-[#64748B]">Getting voice recognition ready on this device (one time, free){pct ? `: ${pct}%` : "…"}</div> : null}
        {canVoice ? <button className={cx(primaryCls, "justify-center py-3 text-[14px]", rec === "listening" && "!bg-[#B3261E]")} disabled={busy || rec === "sending" || prep === "loading"} onClick={() => void listen()} aria-pressed={rec === "listening"}>{rec === "listening" ? "Listening… tap to finish" : rec === "sending" ? "Sending…" : "🎤 Speak"}</button> : <div className="text-[12px] text-[#64748B]">Voice isn&apos;t available right now; please type.</div>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; const t = text; setText(""); void send({ text: t }); }}><input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer (Hindi, English or Hinglish)" disabled={busy} /><button className={btnCls} disabled={busy || !text.trim()}>Send</button></form>
      </>}
    </div>
  </Card>;
}
