import { describe, expect, it } from "vitest";
import { growthPct, periodDays, previousPeriod, rank, ratioPct, turnover } from "./benchmark-rules";

describe("benchmark rules", () => {
  it("growth is null without a previous period instead of infinite", () => {
    expect(growthPct(120, 100)).toBe(20); expect(growthPct(80, 100)).toBe(-20); expect(growthPct(50, 0)).toBeNull();
  });
  it("ratios and turnover avoid dividing by zero", () => {
    expect(ratioPct(1, 8)).toBe(12.5); expect(ratioPct(1, 0)).toBeNull();
    expect(turnover(3000, 30, 1000)).toBe(36.5); // 3000 over 30 days ≈ 36,500 a year on 1000 of stock
    expect(turnover(3000, 30, 0)).toBeNull();
  });
  it("ranks best first, shares ties, skips missing values, and needs two branches", () => {
    expect(rank([10, 30, 20], "high")).toEqual([3, 1, 2]);
    expect(rank([10, 30, 20], "low")).toEqual([1, 3, 2]);
    expect(rank([5, 5, 1], "high")).toEqual([1, 1, 3]);
    expect(rank([5, null, 1], "high")).toEqual([1, null, 2]);
    expect(rank([5, null], "high")).toEqual([null, null]);
    expect(rank([5], "low")).toEqual([null]);
  });
  it("the previous period has the same length and ends the day before", () => {
    expect(periodDays("2026-11-01", "2026-11-30")).toBe(30);
    expect(previousPeriod("2026-11-01", "2026-11-30")).toEqual({ fromDay: "2026-10-02", toDay: "2026-10-31", days: 30 });
  });
});
