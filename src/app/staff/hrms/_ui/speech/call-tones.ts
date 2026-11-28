"use client";
/**
 * The sounds of a phone call, made in the browser (no audio files): the ringback you hear while the other side rings,
 * an incoming ringtone with a buzz on phones, the short blip when the call connects and the beeps when it ends.
 * Browsers only play sound after a tap on the page, so `unlockTones()` runs on the Call / Answer tap.
 */
let ctx: AudioContext | null = null;
const audio = () => { try { ctx ??= new AudioContext(); return ctx; } catch { return null; } };
export function unlockTones() { const c = audio(); if (c && c.state === "suspended") void c.resume().catch(() => {}); }

/** One tone: frequencies mixed, from `at` (seconds from now) for `len` seconds, with soft edges. */
function tone(c: AudioContext, out: AudioNode, freqs: number[], at: number, len: number, vol: number, type: OscillatorType = "sine") {
  const t0 = c.currentTime + at, g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.03, len - 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  g.connect(out);
  for (const f of freqs) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g); o.start(t0); o.stop(t0 + len + 0.02); }
}

/** Repeats `pattern` every `every` ms until the returned stop is called. */
function loop(pattern: (c: AudioContext, out: GainNode) => void, every: number, buzz?: number[]) {
  const c = audio();
  let stopped = false, t: ReturnType<typeof setTimeout> | undefined;
  if (!c) return () => {};
  const out = c.createGain(); out.gain.value = 1; out.connect(c.destination);
  const once = () => {
    if (stopped) return;
    try { if (buzz) navigator.vibrate?.(buzz); } catch { /* no vibration */ }
    void c.resume().then(() => { if (!stopped) pattern(c, out); }).catch(() => {});
    t = setTimeout(once, every);
  };
  once();
  return () => {
    stopped = true; clearTimeout(t);
    try { navigator.vibrate?.(0); } catch { /* no vibration */ }
    try { out.gain.setValueAtTime(out.gain.value, c.currentTime); out.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05); setTimeout(() => out.disconnect(), 120); } catch { /* already gone */ }
  };
}

/** The ringback heard by the caller while the phone rings (the Indian double ring: 400 + 450 Hz, ring-ring, pause). */
export const ringback = () => loop((c, out) => { tone(c, out, [400, 450], 0, 0.4, 0.16); tone(c, out, [400, 450], 0.6, 0.4, 0.16); }, 3000);

/** The incoming ringtone: a bright four-note phrase, twice, with a buzz on phones that can vibrate. */
export const ringtone = () => loop((c, out) => {
  [0, 1.1].forEach((s) => ([[0, 988], [0.14, 1319], [0.28, 1175], [0.42, 1568]] as const).forEach(([t, f]) => {
    tone(c, out, [f], s + t, 0.22, 0.32, "triangle");
    tone(c, out, [f * 2], s + t, 0.12, 0.04, "sine");
  }));
}, 3200, [600, 300, 600]);

/** The short rising blip when the call connects. */
export function connectedTone() { const c = audio(); if (!c) return; void c.resume().then(() => { tone(c, c.destination, [660], 0, 0.09, 0.14); tone(c, c.destination, [990], 0.11, 0.12, 0.14); }).catch(() => {}); }
/** Three falling beeps when the call ends. */
export function endTone() { const c = audio(); if (!c) return; void c.resume().then(() => { [620, 520, 420].forEach((f, i) => tone(c, c.destination, [f], i * 0.2, 0.14, 0.16)); }).catch(() => {}); }
