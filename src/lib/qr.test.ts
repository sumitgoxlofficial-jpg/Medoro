import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { qrMatrix, qrSvg, QR_MAX_BYTES } from "./qr";

/** Reference matrix from the `qrcode` package, forced to byte mode and level M. */
function reference(text: string, mask?: number) {
  const q = QRCode.create([{ data: text, mode: "byte" }] as unknown as QRCode.QRCodeSegment[], { errorCorrectionLevel: "M", ...(mask == null ? {} : { maskPattern: mask as QRCode.QRCodeMaskPattern }) });
  const n = q.modules.size;
  return { version: q.version, mask: q.maskPattern, modules: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.modules.get(r, c))) };
}

describe("qr encoder", () => {
  it("encodes the known version 1-M vector for “01234567” as bytes", () => {
    const { version, modules } = qrMatrix("01234567", { mask: 2 });
    expect(version).toBe(1);
    expect(modules).toHaveLength(21);
    // Finder pattern corners and the always-dark module.
    expect(modules[0].slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(modules[1].slice(0, 7)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(modules[13][8]).toBe(1);
    // Format bits for level M, mask 2: 101111001111100.
    const fmt = [0, 1, 2, 3, 4, 5, 7, 8].map((c) => modules[8][c]).concat([7, 5, 4, 3, 2, 1, 0].map((r) => modules[r][8]));
    expect(fmt.join("")).toBe("101111001111100");
  });

  const samples = ["A", "medoro-kit:v1:SANJ-PUNE:" + "Q".repeat(43), "https://medoro.in/legal#grievance", "x".repeat(100), "€ ₹ हिन्दी".repeat(5), "z".repeat(QR_MAX_BYTES)];
  it.each(samples)("matches the reference encoder for every mask: %#", (text) => {
    for (let mask = 0; mask < 8; mask++) {
      const ref = reference(text, mask), mine = qrMatrix(text, { mask });
      expect(mine.version).toBe(ref.version);
      expect(mine.modules).toEqual(ref.modules);
    }
  });

  it.each(samples)("chooses the same mask as the reference: %#", (text) => {
    const ref = reference(text), mine = qrMatrix(text);
    expect(mine.mask).toBe(ref.mask);
    expect(mine.modules).toEqual(ref.modules);
  });

  it("covers versions 1 to 10 and rejects longer input", () => {
    const versions = new Set<number>();
    for (let len = 1; len <= QR_MAX_BYTES; len += 7) versions.add(qrMatrix("k".repeat(len)).version);
    expect([...versions].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => qrMatrix("k".repeat(QR_MAX_BYTES + 1))).toThrow(/Too long/);
  });

  it("renders an SVG with a quiet zone and escaped label", () => {
    const svg = qrSvg("hello", { title: `Key "x" <y>` });
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 29 29"/);
    expect(svg).toContain('aria-label="Key &quot;x&quot; &lt;y&gt;"');
    expect(svg).toContain("M4 4h1v1h-1z");
  });
});
