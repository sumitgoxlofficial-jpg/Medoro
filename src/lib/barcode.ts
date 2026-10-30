// Barcode encoders for shelf and batch labels. Output is a list of bar/space module widths, rendered to SVG.

const C128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

/** Code 128 symbol values (start, data, check, stop). Uses code set C for runs of 4+ digits, B otherwise. */
export function code128Values(text: string): number[] {
  if (!text || ![...text].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)) throw new Error("Code 128 labels take printable ASCII only.");
  const digitsAt = (i: number) => { let n = 0; while (i + n < text.length && /\d/.test(text[i + n])) n++; return n; };
  const out: number[] = [];
  let set: "B" | "C" = digitsAt(0) >= 4 && digitsAt(0) % 2 === 0 ? "C" : digitsAt(0) === text.length && text.length >= 2 && text.length % 2 === 0 ? "C" : "B";
  out.push(set === "C" ? START_C : START_B);
  let i = 0;
  while (i < text.length) {
    const run = digitsAt(i);
    if (set === "B" && run >= 4) {
      // Switch to C for an even number of digits; an odd leading digit stays in B.
      if (run % 2) { out.push(text.charCodeAt(i) - 32); i++; }
      out.push(CODE_C); set = "C";
      continue;
    }
    if (set === "C") {
      if (run >= 2) { out.push(Number(text.slice(i, i + 2))); i += 2; continue; }
      out.push(CODE_B); set = "B";
      continue;
    }
    out.push(text.charCodeAt(i) - 32); i++;
  }
  const check = out.reduce((a, v, k) => a + v * (k || 1), 0) % 103;
  out.push(check, STOP);
  return out;
}

/** Module widths (bar, space, bar, …) for Code 128, starting and ending with a bar. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => [...C128[v]].map(Number));
}

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** GS1 check digit for the given digits (without the check digit). */
export function gs1Check(digits: string): number {
  const sum = [...digits].reverse().reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** A valid EAN-13 (or UPC-A, as EAN-13 with a leading 0), or null. */
export function asEan13(code: string): string | null {
  const c = code.length === 12 ? "0" + code : code;
  return /^\d{13}$/.test(c) && gs1Check(c.slice(0, 12)) === Number(c[12]) ? c : null;
}

/** EAN-13 as a 95-module bit string (1 = bar). */
export function ean13Bits(code: string): string {
  const c = asEan13(code);
  if (!c) throw new Error("Not a valid EAN-13.");
  const p = PARITY[Number(c[0])];
  const left = [...c.slice(1, 7)].map((d, i) => (p[i] === "L" ? L : G)[Number(d)]).join("");
  const right = [...c.slice(7)].map((d) => R[Number(d)]).join("");
  return "101" + left + "01010" + right + "101";
}

/** In-store EAN-13 for items without a manufacturer barcode: prefix 2 (restricted circulation) + number + check. */
export function internalCode(n: number, prefix = "29"): string {
  const body = prefix + String(n).padStart(12 - prefix.length, "0");
  if (body.length !== 12 || !/^\d+$/.test(body)) throw new Error("Internal barcode number out of range.");
  return body + gs1Check(body);
}

export type BarcodeSvgOpts = { height?: number; module?: number; text?: boolean };

/** SVG for a code: EAN-13 when it is a valid 12/13-digit GS1 number, Code 128 otherwise. */
export function barcodeSvg(code: string, o: BarcodeSvgOpts = {}): { svg: string; kind: "ean13" | "code128"; width: number } {
  const h = o.height ?? 40, m = o.module ?? 1, quiet = 10 * m, textH = o.text === false ? 0 : 11;
  const ean = asEan13(code);
  const rects: string[] = [];
  let x = quiet;
  if (ean) {
    const bits = ean13Bits(ean);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === "1") {
        const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
        rects.push(`<rect x="${x + i * m}" y="0" width="${m}" height="${h + (guard ? textH / 2 : 0)}"/>`);
      }
    }
    x += bits.length * m;
  } else {
    code128Widths(code).forEach((w, i) => { if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w * m}" height="${h}"/>`); x += w * m; });
  }
  const width = x + quiet;
  const label = o.text === false ? "" : `<text x="${width / 2}" y="${h + textH}" font-family="monospace" font-size="10" text-anchor="middle">${escapeXml(ean ?? code)}</text>`;
  return { kind: ean ? "ean13" : "code128", width, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h + textH + 1}" width="${width}" height="${h + textH + 1}" shape-rendering="crispEdges"><g fill="#000">${rects.join("")}</g>${label}</svg>` };
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
