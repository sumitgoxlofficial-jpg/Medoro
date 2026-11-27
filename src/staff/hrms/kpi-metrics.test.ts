import { describe, expect, it } from "vitest";
import { explain, periodOf, previousPeriod, scoreOf, weighted } from "./kpi-metrics";

describe("KPI formulas", () => {
  it("scores higher-is-better against the target, capped at 100", () => {
    expect(scoreOf("higher", 45, 50)).toBe(90);
    expect(scoreOf("higher", 80, 50)).toBe(100);
    expect(scoreOf("higher", 0, 50)).toBe(0);
    expect(scoreOf("higher", 3, 0)).toBe(100);
  });
  it("scores lower-is-better: full marks within the limit, then down by the share over it", () => {
    expect(scoreOf("lower", 2, 2)).toBe(100);
    expect(scoreOf("lower", 3, 2)).toBe(50);
    expect(scoreOf("lower", 5, 2)).toBe(0);
    expect(scoreOf("lower", 1, 0)).toBe(0);
  });
  it("no value has no score and is left out of the weighted total", () => {
    expect(scoreOf("higher", null, 10)).toBeNull();
    expect(weighted([{ score: 100, weight: 30 }, { score: 50, weight: 10 }, { score: null, weight: 60 }])).toBe(88);
    expect(weighted([{ score: null, weight: 10 }])).toBeNull();
  });
  it("names month and quarter periods", () => {
    expect(periodOf("month", "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28", label: "Feb 2026" });
    expect(periodOf("quarter", "2026-11-27")).toEqual({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026 (Oct–Dec)" });
    expect(previousPeriod("month", "2026-01-01").start).toBe("2025-12-01");
  });
  it("explains a result with the value, the target, the score and the formula", () => {
    const t = explain({ metric: "tasks_on_time_pct", unit: "%", target: 90, better: "higher" }, 80, 89, "8 of 10 tasks due were done on time", "On-time delivery");
    expect(t).toContain("8 of 10 tasks due were done on time = 80% against a target of 90%");
    expect(t).toContain("score 89/100");
    expect(t).toContain("Formula:");
  });
});
