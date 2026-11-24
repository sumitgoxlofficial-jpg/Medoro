import { describe, expect, it } from "vitest";
import { liveWorkedMin } from "./constants";

const lunch = { from: "13:00", to: "13:30" };
// India time (UTC+5:30) on 2026-11-24
const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 24, h, m) - 5.5 * 3600_000);
const at = (h: number, m = 0) => ist(h, m).toISOString();

describe("liveWorkedMin", () => {
  it("counts from check-in until now", () => {
    expect(liveWorkedMin({ inAt: at(10), outAt: null, breakMin: 0 }, ist(12).getTime(), lunch)).toBe(120);
  });
  it("pauses during lunch and takes the half hour off afterwards", () => {
    expect(liveWorkedMin({ inAt: at(10), outAt: null, breakMin: 0 }, ist(13, 15).getTime(), lunch)).toBe(180); // mid-lunch: stopped at 1:00
    expect(liveWorkedMin({ inAt: at(10), outAt: null, breakMin: 0 }, ist(15).getTime(), lunch)).toBe(270);
  });
  it("10 AM to 6:30 PM is exactly eight hours", () => {
    expect(liveWorkedMin({ inAt: at(10), outAt: null, breakMin: 0 }, ist(18, 30).getTime(), lunch)).toBe(480);
  });
  it("takes off closed breaks and a break still running", () => {
    expect(liveWorkedMin({ inAt: at(10), outAt: null, breakMin: 20 }, ist(12).getTime(), lunch)).toBe(100);
    expect(liveWorkedMin({ inAt: at(10), outAt: null, breakMin: 0 }, ist(12).getTime(), lunch, at(11, 30))).toBe(90);
  });
  it("stops at check-out", () => {
    expect(liveWorkedMin({ inAt: at(10), outAt: at(17), breakMin: 0 }, ist(23).getTime(), lunch)).toBe(390);
  });
});
