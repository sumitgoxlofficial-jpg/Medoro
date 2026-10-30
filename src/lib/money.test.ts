import { describe, expect, it } from "vitest";
import { cartTotals, inr, inr0, shareOf, taxableFromInclusive, toPaise } from "./money";

describe("money", () => {
  it("formats rupees the Indian way", () => {
    expect(inr(123456789)).toBe("₹12,34,567.89");
    expect(inr0(-4999)).toBe("−₹50");
    expect(toPaise("33.6")).toBe(3360);
  });

  it("back-calculates GST from an MRP-inclusive price", () => {
    expect(taxableFromInclusive(11200, 12)).toBe(10000);
    expect(taxableFromInclusive(11800, 18)).toBe(10000);
  });

  it("matches the prototype for a two-line cart with discount", () => {
    const t = cartTotals([
      { mrpPaise: 3360, qty: 2, gstRate: 12, costPaise: 2380 },
      { mrpPaise: 12500, qty: 1, gstRate: 18, costPaise: 8200 },
    ], 5);
    expect(t.mrpTotal).toBe(19220);
    expect(t.discount).toBe(336 + 625);
    expect(t.net).toBe(19220 - 961);
    expect(t.total % 100).toBe(0);
    expect(Math.abs(t.roundOff)).toBeLessThanOrEqual(50);
    expect(t.cgst + t.sgst).toBe(t.tax);
    expect(t.taxable + t.tax).toBe(t.net);
    expect(t.cost).toBe(2380 * 2 + 8200);
  });

  it("holds the invariants for many random carts", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let i = 0; i < 2000; i++) {
      const items = Array.from({ length: 1 + rnd(6) }, () => ({
        mrpPaise: 100 + rnd(50000), qty: 1 + rnd(10), gstRate: [0, 5, 12, 18, 28][rnd(5)],
      }));
      const t = cartTotals(items, rnd(21));
      expect(t.lines.reduce((a, l) => a + l.net, 0)).toBe(t.net);
      expect(t.cgst + t.sgst).toBe(t.tax);
      expect(t.sgst - t.cgst).toBeGreaterThanOrEqual(0);
      expect(t.sgst - t.cgst).toBeLessThanOrEqual(1);
      expect(Math.abs(t.roundOff)).toBeLessThanOrEqual(50);
      expect(t.total).toBe(t.net + t.roundOff);
    }
  });

  it("splits partial returns so they never add up to more than the line", () => {
    expect([0, 1, 2].map((d) => shareOf(101, 3, d, 1))).toEqual([34, 33, 34]);
    expect(shareOf(101, 3, 0, 1) + shareOf(101, 3, 1, 2)).toBe(101);
    for (const [total, qty] of [[55800, 4], [99999, 7], [1, 3]]) {
      let sum = 0;
      for (let d = 0; d < qty; d++) sum += shareOf(total, qty, d, 1);
      expect(sum).toBe(total);
    }
  });
});
