import { describe, expect, it } from "vitest";
import { backtest, confidenceOf, expiryRisk, fit, horizon, MIN_HISTORY_DAYS, predictDaily, safetyStock, stockoutDay } from "./forecast-model";

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
/** Demand that is higher on weekend days (weekday 0 and 6), series[0] being a Sunday. */
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [20, 8, 8, 8, 8, 8, 20][i % 7]);

describe("forecast model", () => {
  it("refuses to forecast without enough history or enough sales days", () => {
    expect(fit(flat(MIN_HISTORY_DAYS - 1, 5), 0)).toBeNull();
    expect(fit([...flat(60, 0), 3, 3, 3], 0)).toBeNull();     // three sale days is not a pattern
    expect(fit(flat(60, 0), 0)).toBeNull();                    // never sold: no forecast, not a forecast of zero
  });
  it("recovers a constant rate with no spread and zero backtest error", () => {
    const m = fit(flat(120, 10), 1)!;
    expect(m.level).toBeCloseTo(10); expect(m.spread).toBeCloseTo(0);
    const h = horizon(m, 7, 3);
    expect(h.total).toBeCloseTo(70); expect(h.lo).toBeCloseTo(70); expect(h.hi).toBeCloseTo(70);
    const b = backtest(flat(120, 10), 1);
    expect(b.wape).toBeCloseTo(0); expect(b.bias).toBeCloseTo(0);
    expect(confidenceOf(m, b.wape)).toBe("high");
  });
  it("learns a weekday pattern: weekend days forecast higher than weekdays", () => {
    const s = weekly(112);                                      // 16 whole weeks, series[0] = Sunday, tomorrow = Sunday again
    const m = fit(s, 0)!;
    const d = predictDaily(m, 7, 0);
    expect(d[0]).toBeGreaterThan(d[1] * 1.8);
    expect(d[6]).toBeGreaterThan(d[3] * 1.8);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(7 * m.level, 5);
    expect(horizon(m, 7, 0).total).toBeCloseTo(80, 0);          // 20 + 5×8 + 20 over one week
    expect(backtest(s, 0).wape).toBeLessThan(0.05);
  });
  it("widens the interval with the noise in the data and with the horizon", () => {
    const noisy = Array.from({ length: 120 }, (_, i) => (i % 2 ? 2 : 18));
    const m = fit(noisy, 0)!;
    expect(m.spread).toBeGreaterThan(5);
    const a = horizon(m, 7, 0), b = horizon(m, 30, 0);
    expect(a.hi - a.lo).toBeGreaterThan(0);
    expect((b.hi - b.lo) / b.total).toBeLessThan((a.hi - a.lo) / a.total);   // relative uncertainty shrinks as days add up
    expect(a.lo).toBeGreaterThanOrEqual(0);
  });
  it("does not trust a forecast that has done badly on its own history", () => {
    const erratic = Array.from({ length: 120 }, (_, i) => (i % 29 === 0 ? 200 : i % 3 === 0 ? 4 : 0));
    const m = fit(erratic, 0)!, b = backtest(erratic, 0);
    expect(b.wape).toBeGreaterThan(0.6);
    expect(confidenceOf(m, b.wape)).toBe("low");
    expect(confidenceOf(m, null)).toBe("low");
    expect(confidenceOf(fit(flat(40, 5), 0)!, 0.1)).toBe("medium");            // good, but under 90 days of history
  });
  it("safety stock grows with variability and with lead time", () => {
    expect(safetyStock(0, 5)).toBe(0);
    expect(safetyStock(4, 4)).toBe(14);                                          // 1.645 × 4 × 2 = 13.2
    expect(safetyStock(4, 9)).toBeGreaterThan(safetyStock(4, 4));
  });
  it("predicts the stockout day, with a range, and counts inbound orders", () => {
    const daily = flat(60, 10);
    expect(stockoutDay(35, [], daily, 0).point).toBe(4);
    const wide = stockoutDay(35, [], daily, 5);
    expect(wide.early).toBeLessThanOrEqual(wide.point!);
    expect(wide.late).toBeGreaterThanOrEqual(wide.point!);
    expect(stockoutDay(35, [{ day: 3, qty: 100 }], daily, 0).point).toBe(14);    // 135 units: 5 left after day 13, gone during day 14
    expect(stockoutDay(1000, [], daily, 0).point).toBeNull();                    // lasts beyond the horizon
  });
  it("estimates expiry loss first-expiry-first-out, and an earlier batch can't eat a later batch's demand", () => {
    const daily = flat(100, 2);
    const r = expiryRisk([{ id: "late", qty: 100, daysToExpiry: 90 }, { id: "soon", qty: 50, daysToExpiry: 10 }], daily);
    const soon = r.find((x) => x.id === "soon")!, late = r.find((x) => x.id === "late")!;
    expect(soon.sells).toBe(20); expect(soon.unsold).toBe(30);                    // only 10 days × 2 units before it expires
    expect(late.sells).toBeCloseTo(100 - Math.max(0, 100 - (180 - 20)), 0);       // demand to day 90 is 180; 20 went to the earlier batch; late sells all 100
    expect(late.unsold).toBe(0);
    expect(expiryRisk([{ id: "x", qty: 10, daysToExpiry: 500 }], daily)[0].horizonShort).toBe(true);
  });
});
