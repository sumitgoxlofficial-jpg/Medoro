import { describe, expect, it } from "vitest";
import { maskAadhaar, onlyDigits, spacedAadhaar, validAadhaar, verhoeff, verhoeffDigit } from "./aadhaar";

describe("aadhaar", () => {
  it("implements the Verhoeff check (Wikipedia's 236 → 3)", () => {
    expect(verhoeffDigit("236")).toBe(3);
    expect(verhoeff("2363")).toBe(true);
    expect(verhoeff("2364")).toBe(false);
  });
  it("accepts a well-formed number, in any spacing, and rejects typing mistakes", () => {
    const body = "23412341234", n = body + verhoeffDigit(body);
    expect(validAadhaar(n)).toBe(true);
    expect(validAadhaar(spacedAadhaar(n))).toBe(true);
    const wrong = n.slice(0, 11) + String((Number(n[11]) + 1) % 10);
    expect(validAadhaar(wrong)).toBe(false);
    const swapped = n[1] + n[0] + n.slice(2);
    expect(n[0] === n[1] ? true : validAadhaar(swapped)).toBe(n[0] === n[1]); // a swap of different digits is caught
    expect(validAadhaar("12345678901")).toBe(false); // 11 digits
    expect(validAadhaar("0" + n.slice(1))).toBe(false); // can't start with 0 or 1
    expect(validAadhaar("1" + n.slice(1))).toBe(false);
  });
  it("shows only the last four digits", () => {
    expect(maskAadhaar("9012")).toBe("XXXX XXXX 9012");
    expect(maskAadhaar("")).toBe("");
    expect(spacedAadhaar("234123412346")).toBe("2341 2341 2346");
    expect(onlyDigits("2341-2341 2346")).toBe("234123412346");
  });
});
