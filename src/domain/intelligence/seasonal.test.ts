import { describe, expect, it } from "vitest";
import { monthCoverage, seasonalLine } from "./seasonal";

describe("seasonal demand", () => {
  it("counts each calendar month once per year observed, with partial months as fractions", () => {
    const cov = monthCoverage(new Date("2025-05-01T00:00:00+05:30"), new Date("2026-11-01T00:00:00+05:30"));
    expect(cov.map((x) => +x.toFixed(6))).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1]);
    const half = monthCoverage(new Date("2026-04-16T00:00:00+05:30"), new Date("2026-05-01T00:00:00+05:30"));
    expect(half[3]).toBeCloseTo(0.5);
  });

  it("flat demand over 18 months shows no lift for months seen twice", () => {
    const cov = [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1];
    const sums = cov.map((c) => 10 * c);
    const l = seasonalLine(sums, cov, 5, 3)!;
    expect(l.lift).toBeCloseTo(0);
    expect(l.expected).toBe(10);
    expect(l.consumed).toBe(5 + 10); // half of April, all of May
  });

  it("finds a real peak and ignores medicines with no sales", () => {
    const cov = new Array(12).fill(2);
    const sums = new Array(12).fill(20); sums[6] = 80;
    const l = seasonalLine(sums, cov, 6, 4)!;
    expect(Math.round(l.lift)).toBe(Math.round((40 / 12.5 - 1) * 100));
    expect(l.expected).toBe(40);
    expect(seasonalLine(new Array(12).fill(0), cov, 6, 4)).toBeNull();
  });
});