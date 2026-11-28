// The browser's built-in speech recognition (Chrome, Edge, Safari): instant, with live captions while the person speaks.
// Chrome sends the audio to Google and Safari to Apple to turn it into text; Medoro receives and keeps only the text.
// One utterance per listen(): it ends by itself when the person stops talking.

type Alt = { transcript: string; confidence: number };
type Res = { isFinal: boolean; length: number; [i: number]: Alt };
type Ev = { resultIndex: number; results: { length: number; [i: number]: Res } };
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: Ev) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; onspeechstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type Ctor = new () => Rec;

const ctor = (): Ctor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const nativeRecognitionSupported = () => !!ctor();

/** `raw` is the browser's own reason (no-speech, network, audio-capture…), sent with the turn for diagnosis. */
export type Heard = { text: string; ms: number } | { error: "no-speech" | "denied" | "unavailable" | "aborted"; raw?: string };

/**
 * Listens for one answer. `interim` gets the words as they are recognised (live captions). Resolves with the final text,
 * or why there is none: silence, microphone refused, or the service isn't reachable (then use the on-device model).
 */
export function listenOnce(lang: "hi" | "en" | "hinglish", interim: (t: string) => void, opts: { maxMs?: number } = {}): { result: Promise<Heard>; stop: () => void; abort: () => void } {
  const C = ctor();
  if (!C) return { result: Promise.resolve({ error: "unavailable" }), stop: () => {}, abort: () => {} };
  const r = new C();
  // Hindi recognition also writes the English words people mix in; the assistant understands both scripts.
  r.lang = lang === "en" ? "en-IN" : "hi-IN";
  r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  const t0 = performance.now();
  let finalText = "", lastInterim = "", err: Heard | null = null, settled = false;
  let resolve!: (h: Heard) => void;
  const result = new Promise<Heard>((ok) => { resolve = ok; });
  const finish = (h: Heard) => { if (!settled) { settled = true; clearTimeout(cap); resolve(h); } };
  const cap = setTimeout(() => { try { r.stop(); } catch { /* already stopped */ } }, opts.maxMs ?? 20000);
  r.onresult = (e) => {
    let live = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += `${res[0].transcript} `; else live += res[0].transcript;
    }
    lastInterim = live;
    interim((finalText + live).trim());
  };
  r.onerror = (e) => {
    const raw = String(e.error || "unknown").slice(0, 30);
    err = raw === "no-speech" ? { error: "no-speech", raw } : raw === "not-allowed" || raw === "service-not-allowed" ? { error: "denied", raw } : raw === "aborted" ? { error: "aborted", raw } : { error: "unavailable", raw };
  };
  r.onend = () => {
    const text = (finalText || lastInterim).trim();
    if (text) finish({ text, ms: Math.max(1, Math.round(performance.now() - t0)) });
    else finish(err ?? { error: "no-speech", raw: "ended-empty" });
  };
  try { r.start(); } catch (e) { finish({ error: e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "unavailable", raw: e instanceof Error ? `start:${e.name}`.slice(0, 30) : "start" }); }
  return { result, stop: () => { try { r.stop(); } catch { /* stopped */ } }, abort: () => { err = { error: "aborted" }; finalText = ""; lastInterim = ""; try { r.abort(); } catch { /* stopped */ } } };
}
