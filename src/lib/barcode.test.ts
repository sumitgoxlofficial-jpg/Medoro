import { describe, expect, it } from "vitest";
import { asEan13, barcodeSvg, code128Values, code128Widths, ean13Bits, gs1Check, internalCode } from "./barcode";

describe("Code 128", () => {
  it("encodes text in code set B with the mod-103 check symbol", () => {
    // PJJ123C: Start B (104), P=48, J=42, J=42, 1=17, 2=18, 3=19, C=35; check (104 + Σ i·v) mod 103 = 55.
    expect(code128Values("PJJ123C")).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  });

  it("packs even digit runs into code set C", () => {
    expect(code128Values("12345678")).toEqual([105, 12, 34, 56, 78, 47, 106]);
    // A run of 4+ digits after letters switches to C; an odd leading digit stays in B.
    expect(code128Values("AB12345")).toEqual([104, 33, 34, 17, 99, 23, 45, expect.any(Number), 106]);
  });

  it("produces 11 modules per symbol and a 13-module stop, starting and ending with a bar", () => {
    const w = code128Widths("Medoro-42");
    const symbols = code128Values("Medoro-42").length;
    expect(w.reduce((a, b) => a + b, 0)).toBe((symbols - 1) * 11 + 13);
    expect(w.length % 2).toBe(1);
    expect(w.slice(0, 6).join("")).toBe("211214"); // Start B
    expect(w.slice(-7).join("")).toBe("2331112"); // Stop
    expect(() => code128Values("₹")).toThrow();
  });
});

describe("EAN-13", () => {
  it("computes GS1 check digits", () => {
    expect(gs1Check("400638133393")).toBe(1);
    expect(gs1Check("590123412345")).toBe(7);
    expect(asEan13("4006381333931")).toBe("4006381333931");
    expect(asEan13("4006381333932")).toBeNull();
    expect(asEan13("036000291452")).toBe("0036000291452"); // UPC-A
    expect(asEan13("12345")).toBeNull();
  });

  it("encodes 5901234123457 with first-digit parity LGGLLG", () => {
    const left = ["0001011", "0100111", "0110011", "0010011", "0111101", "0011101"].join(""); // 9L 0G 1G 2L 3L 4G
    const right = ["1100110", "1101100", "1000010", "1011100", "1001110", "1000100"].join(""); // 1 2 3 4 5 7
    expect(ean13Bits("5901234123457")).toBe("101" + left + "01010" + right + "101");
    expect(ean13Bits("5901234123457")).toHaveLength(95);
  });

  it("issues in-store codes with prefix 29 and a valid check digit", () => {
    expect(internalCode(1)).toBe("2900000000018");
    expect(asEan13(internalCode(123456))).toBe(internalCode(123456));
    expect(() => internalCode(10_000_000_000)).toThrow();
  });
});

describe("SVG", () => {
  it("draws EAN-13 for valid GS1 numbers and Code 128 otherwise, escaping the caption", () => {
    expect(barcodeSvg("5901234123457").kind).toBe("ean13");
    expect(barcodeSvg("8901234567890").kind).toBe("ean13");
    expect(barcodeSvg("8901234567891").kind).toBe("code128"); // bad check digit
    const s = barcodeSvg("A<B&C");
    expect(s.kind).toBe("code128");
    expect(s.svg).toContain("A&lt;B&amp;C");
    expect(s.svg.match(/<rect/g)!.length).toBe(code128Widths("A<B&C").filter((_, i) => i % 2 === 0).length);
  });
});
