/**
 * Hybrid logical clock. Stamps sort the same way on every device: wall time first, then a counter for
 * changes in the same millisecond (or when this device's clock is behind one it has seen), then the
 * device id as a tie-break. Format: "<13-digit ms>-<4-digit counter>-<device>".
 */
export type Hlc = { ms: number; n: number; device: string };

export const formatHlc = (h: Hlc) => `${String(h.ms).padStart(13, "0")}-${String(h.n).padStart(4, "0")}-${h.device}`;

export function parseHlc(s: string): Hlc {
  const m = /^(\d{13})-(\d{4})-(.+)$/.exec(s);
  if (!m) throw new Error(`Bad clock stamp: ${s}`);
  return { ms: Number(m[1]), n: Number(m[2]), device: m[3] };
}

export class Clock {
  private last: { ms: number; n: number };
  constructor(readonly device: string, last?: string | null, private now: () => number = Date.now) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(device)) throw new Error("Device id must be 1–40 letters, digits or _.");
    const p = last ? parseHlc(last) : null;
    this.last = p ? { ms: p.ms, n: p.n } : { ms: 0, n: 0 };
  }
  /** A new stamp for a local change. */
  tick(): string {
    const t = this.now();
    this.last = t > this.last.ms ? { ms: t, n: 0 } : { ms: this.last.ms, n: this.last.n + 1 };
    if (this.last.n > 9999) this.last = { ms: this.last.ms + 1, n: 0 };
    return formatHlc({ ...this.last, device: this.device });
  }
  /** Moves this clock past a stamp received from another device. */
  observe(stamp: string) {
    const r = parseHlc(stamp), t = this.now();
    const ms = Math.max(t, r.ms, this.last.ms);
    const n = ms === this.last.ms && ms === r.ms ? Math.max(this.last.n, r.n) + 1 : ms === this.last.ms ? this.last.n + 1 : ms === r.ms ? r.n + 1 : 0;
    this.last = { ms, n };
  }
  get current() { return formatHlc({ ...this.last, device: this.device }); }
}
