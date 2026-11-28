"use client";
// Free speech for the AI HR Assistant, entirely in the browser:
//  * listening: Whisper in a Web Worker (stt.worker.ts), audio decoded to 16 kHz mono on the device;
//  * speaking: the device's own Hindi (or English) text-to-speech voice through the Web Speech API. Only voices
//    installed on the device are used (localService), so the text isn't sent to an online voice service.
// Nothing here costs money or needs a server; when the device can't do it, the conversation continues as text.

type Msg = { id: number; type: "progress" | "ready" | "text" | "error"; text?: string; ms?: number; error?: string; loaded?: number; total?: number };
let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, { resolve: (m: Msg) => void; progress?: (loaded: number, total: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./stt.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<Msg>) => {
    const w = waiting.get(e.data.id); if (!w) return;
    if (e.data.type === "progress") { w.progress?.(e.data.loaded ?? 0, e.data.total ?? 0); return; }
    waiting.delete(e.data.id); w.resolve(e.data);
  };
  worker.onerror = () => { for (const [, w] of waiting) w.resolve({ id: 0, type: "error", error: "Speech recognition couldn't start on this device." }); waiting.clear(); worker = null; };
  return worker;
}
function ask(msg: Record<string, unknown>, progress?: (l: number, t: number) => void): Promise<Msg> {
  const id = ++seq;
  return new Promise((resolve) => { waiting.set(id, { resolve, progress }); getWorker().postMessage({ id, ...msg }); });
}

export const browserSpeechSupported = () => typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";

/** Downloads (first time) and starts the model. */
export async function prepareRecognition(model: string, progress?: (loaded: number, total: number) => void) {
  const r = await ask({ type: "load", model }, progress);
  if (r.type === "error") throw new Error(r.error);
}

/** Decodes a recorded clip to 16 kHz mono samples, the input Whisper expects. */
export async function toPcm16k(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try { return (await ctx.decodeAudioData(await blob.arrayBuffer())).getChannelData(0).slice(); }
  finally { void ctx.close(); }
}

export async function recognise(blob: Blob, model: string, language?: "hi" | "en"): Promise<{ text: string; ms: number }> {
  const pcm = await toPcm16k(blob);
  const r = await ask({ type: "transcribe", model, audio: pcm, language });
  if (r.type === "error") throw new Error(r.error);
  return { text: r.text ?? "", ms: r.ms ?? 0 };
}

/** The best installed female-sounding voice for the language, or any installed voice for it, or none. */
export function pickVoice(lang: "hi" | "en"): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const local = speechSynthesis.getVoices().filter((v) => v.localService);
  const want = lang === "hi" ? /^hi([-_]|$)/i : /^en[-_]IN/i;
  const female = /female|swara|kalpana|lekha|heera|neerja|aditi|priya|veena|zira|google/i;
  const of = local.filter((v) => want.test(v.lang));
  const en = lang === "en" ? local.filter((v) => /^en/i.test(v.lang)) : [];
  return of.find((v) => female.test(v.name)) ?? of[0] ?? en.find((v) => female.test(v.name)) ?? en[0] ?? null;
}
export const deviceVoiceAvailable = (lang: "hi" | "en") => !!pickVoice(lang);

/** Speaks a reply with the device voice. Returns false if no suitable installed voice exists. */
export function speakOnDevice(text: string, lang: "hi" | "en"): boolean {
  const v = pickVoice(lang);
  if (!v || !text) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\(([^)]*Source|स्रोत)[^)]*\)/g, ""));
  u.voice = v; u.lang = v.lang; u.rate = 0.95; u.pitch = 1.05;
  speechSynthesis.speak(u);
  return true;
}
export const stopSpeaking = () => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); };
