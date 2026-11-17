import { describe, expect, it } from "vitest";
import { customerStats, lastMonths, retention, type Purchase } from "./customer-segments";

const TODAY = "2026-11-17";
const add = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400_000).toISOString().slice(0, 10);
const buys = (...ds: [number, number?][]): Purchase[] => ds.map(([ago, p = 10000]) => ({ day: add(TODAY, -ago), netPaise: p }));

describe("customer stats and segments", () => {
  it("returns null with no purchases", () => expect(customerStats([], TODAY)).toBeNull());
  it("a customer whose first bill was within 30 days is new", () => {
    const s = customerStats(buys([5]), TODAY)!;
    expect(s.segment).toBe("new");
    expect(s.value12mPaise).toBeNull(); // no projection from one bill
  });
  it("loyal: many visit days on a steady rhythm", () => {
    const s = customerStats(buys([200], [170], [140], [110], [80], [50], [20]), TODAY)!;
    expect(s.visits).toBe(7);
    expect(s.usualGapDays).toBe(30);
    expect(s.segment).toBe("loyal");
  });
  it("at risk: overdue by more than 1.5 times the usual gap", () => {
    const s = customerStats(buys([260], [230], [200], [170], [140], [110], [80]), TODAY)!; // 30-day rhythm, silent 80 days
    expect(s.recencyDays).toBe(80);
    expect(s.segment).toBe("at_risk");
  });
  it("lapsed: silent for 90+ days and 3 times the usual gap", () => {
    expect(customerStats(buys([300], [270], [240]), TODAY)!.segment).toBe("lapsed"); // gap 30, silent 240
    // a monthly buyer silent for 80 days is not yet lapsed (needs 90 days)
    expect(customerStats(buys([200], [170], [140], [110], [80]), TODAY)!.segment).not.toBe("lapsed");
  });
  it("a slow buyer is judged against their own rhythm, not a fixed number", () => {
    const s = customerStats(buys([400], [220], [100]), TODAY)!; // gap ~150 days, silent 100
    expect(s.usualGapDays).toBe(150);
    expect(s.segment).not.toBe("lapsed");
    expect(s.segment).not.toBe("at_risk");
  });
  it("regular vs occasional by visit days in 12 months", () => {
    expect(customerStats(buys([150], [100], [50]), TODAY)!.segment).toBe("regular");
    expect(customerStats(buys([300], [100]), TODAY)!.segment).toBe("occasional");
  });
  it("two bills on one day are one visit but two baskets", () => {
    const s = customerStats([{ day: "2026-10-01", netPaise: 30000 }, { day: "2026-10-01", netPaise: 10000 }], TODAY)!;
    expect(s.visits).toBe(1); expect(s.purchases).toBe(2); expect(s.avgBasketPaise).toBe(20000); expect(s.netPaise).toBe(40000);
  });
  it("projects 12-month value only with 3+ visit days over 90+ days, from observed spend", () => {
    const s = customerStats(buys([360, 12000], [240, 12000], [120, 12000], [10, 12000]), TODAY)!;
    expect(s.spend12mPaise).toBe(48000);
    expect(s.monthlyPaise).toBe(Math.round(48000 / (360 / 30.4))); // spend over the actual tenure, capped at 12 months
    expect(s.value12mPaise).toBe(s.monthlyPaise! * 12);
    expect(customerStats(buys([100], [50]), TODAY)!.value12mPaise).toBeNull();
  });
  it("lists calendar months across a year boundary", () => expect(lastMonths("2026-02-10", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]));
  it("retention is the share of last month's buyers who bought again", () => {
    const m = new Map<string, Set<string>>([["a", new Set(["2026-09", "2026-10"])], ["b", new Set(["2026-09"])], ["c", new Set(["2026-10"])], ["d", new Set(["2026-09", "2026-10"])]]);
    const r = retention(m, ["2026-09", "2026-10", "2026-11"]);
    expect(r[0].rate).toBeNull();
    expect(r[1]).toMatchObject({ base: 3, kept: 2, rate: 66.7 });
    expect(r[2]).toMatchObject({ base: 3, kept: 0, rate: 0 });
    expect(retention(new Map(), ["2026-09", "2026-10"])[1].rate).toBeNull(); // no base: no rate, not 0 or 100
  });
});
