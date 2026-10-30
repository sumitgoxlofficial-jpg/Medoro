// QR Code encoder: byte mode, error correction level M, versions 1–10 (up to 213 bytes).
// Follows ISO/IEC 18004; mask choice uses the standard penalty rules.

/** ECC level M, per version: [EC codewords per block, blocks in group 1, data codewords per block in group 1, blocks in group 2]. Group 2 blocks hold one more data codeword. */
const ECC_M: [number, number, number, number][] = [
  [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0],
  [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_BYTES = 213;

const dataCapacity = (v: number) => { const [, b1, d1, b2] = ECC_M[v - 1]; return b1 * d1 + b2 * (d1 + 1); };

function gfMul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number) {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], div: number[]) {
  const r = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

/** Data plus error-correction codewords, interleaved, for `bytes` at version `v`. */
function codewords(bytes: Uint8Array, v: number) {
  const cap = dataCapacity(v);
  const bits: number[] = [];
  const put = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ec, b1, d1, b2] = ECC_M[v - 1];
  const div = rsDivisor(ec);
  const blocks: { d: number[]; e: number[] }[] = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d1 + 1;
    const d = data.slice(k, k + len);
    k += len;
    blocks.push({ d, e: rsRemainder(d, div) });
  }
  const out: number[] = [];
  for (let i = 0; i <= d1; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

const bchDigits = (n: number) => { let d = 0; for (; n; n >>>= 1) d++; return d; };
function bch(data: number, gen: number, shift: number) {
  let d = data << shift;
  while (bchDigits(d) - bchDigits(gen) >= 0) d ^= gen << (bchDigits(d) - bchDigits(gen));
  return (data << shift) | d;
}
const formatBits = (mask: number) => bch(mask, 0x537, 10) ^ 0x5412; // level M = 00
const versionBits = (v: number) => bch(v, 0x1f25, 12);

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0,
];

class Grid {
  m: number[][]; fn: boolean[][];
  constructor(public size: number) {
    this.m = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(r: number, c: number, dark: boolean | number, fn = true) { this.m[r][c] = dark ? 1 : 0; if (fn) this.fn[r][c] = true; }
}

function drawFunctions(g: Grid, v: number) {
  const n = g.size;
  for (const [r0, c0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      g.set(rr, cc, ring !== 2 && ring !== 4);
    }
  }
  for (let i = 8; i < n - 8; i++) { g.set(6, i, i % 2 === 0); g.set(i, 6, i % 2 === 0); }
  const pos = ALIGN[v - 1], last = pos.length - 1;
  pos.forEach((r, i) => pos.forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) g.set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }));
  drawFormat(g, 0);
  if (v >= 7) {
    const bits = versionBits(v);
    for (let i = 0; i < 18; i++) {
      const dark = (bits >>> i) & 1, a = Math.floor(i / 3), b = (i % 3) + n - 11;
      g.set(a, b, dark); g.set(b, a, dark);
    }
  }
}

function drawFormat(g: Grid, mask: number) {
  const n = g.size, bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const dark = (bits >>> i) & 1;
    g.set(i < 6 ? i : i < 8 ? i + 1 : n - 15 + i, 8, dark);
    g.set(8, i < 8 ? n - i - 1 : i < 9 ? 15 - i : 14 - i, dark);
  }
  g.set(n - 8, 8, 1);
}

function drawData(g: Grid, data: number[]) {
  const n = g.size;
  let i = 0, up = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (g.fn[r][c]) continue;
        g.set(r, c, i < data.length * 8 ? (data[i >>> 3] >>> (7 - (i & 7))) & 1 : 0, false);
        i++;
      }
    }
    up = !up;
  }
}

function applyMask(g: Grid, mask: number) {
  const f = MASKS[mask];
  for (let r = 0; r < g.size; r++) for (let c = 0; c < g.size; c++) if (!g.fn[r][c] && f(r, c)) g.m[r][c] ^= 1;
}

function penalty(m: number[][]) {
  const n = m.length;
  let p = 0, dark = 0;
  for (let a = 0; a < n; a++) {
    let runR = 0, runC = 0, lastR = -1, lastC = -1, bitsR = 0, bitsC = 0;
    for (let b = 0; b < n; b++) {
      const x = m[a][b], y = m[b][a];
      dark += x;
      if (x === lastR) runR++; else { if (runR >= 5) p += 3 + runR - 5; lastR = x; runR = 1; }
      if (y === lastC) runC++; else { if (runC >= 5) p += 3 + runC - 5; lastC = y; runC = 1; }
      bitsR = ((bitsR << 1) & 0x7ff) | x;
      bitsC = ((bitsC << 1) & 0x7ff) | y;
      if (b >= 10 && (bitsR === 0x5d0 || bitsR === 0x05d)) p += 40;
      if (b >= 10 && (bitsC === 0x5d0 || bitsC === 0x05d)) p += 40;
    }
    if (runR >= 5) p += 3 + runR - 5;
    if (runC >= 5) p += 3 + runC - 5;
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1];
    if (s === 0 || s === 4) p += 3;
  }
  return p + Math.abs(Math.ceil((dark * 100) / (n * n) / 5) - 10) * 10;
}

/** The QR matrix for `text` (UTF-8 bytes): rows of 1 (dark) and 0 (light), without the quiet zone. */
export function qrMatrix(text: string | Uint8Array, opts: { mask?: number } = {}) {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  let v = 1;
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(v) * 8) v++;
  if (v > 10) throw new Error(`Too long for a QR code here (${bytes.length} bytes, max ${QR_MAX_BYTES}).`);
  const g = new Grid(17 + 4 * v);
  drawFunctions(g, v);
  drawData(g, codewords(bytes, v));
  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(g, k); drawFormat(g, k);
      const s = penalty(g.m);
      if (s < best) { best = s; mask = k; }
      applyMask(g, k);
    }
  }
  applyMask(g, mask);
  drawFormat(g, mask);
  return { version: v, mask, modules: g.m };
}

/** An SVG image of the QR code with a 4-module quiet zone. */
export function qrSvg(text: string, opts: { size?: number; color?: string; title?: string } = {}) {
  const { modules } = qrMatrix(text);
  const n = modules.length + 8;
  let d = "";
  modules.forEach((row, r) => row.forEach((x, c) => { if (x) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${opts.size ?? n * 4}" height="${opts.size ?? n * 4}" shape-rendering="crispEdges" role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ""}><rect width="${n}" height="${n}" fill="#fff"/><path fill="${esc(opts.color ?? "#000")}" d="${d}"/></svg>`;
}
