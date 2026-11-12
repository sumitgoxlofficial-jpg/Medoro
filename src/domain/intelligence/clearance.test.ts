import { describe, expect, it } from "vitest";
import { clearance } from "./clearance";

describe("clearance discount", () => {
  const a = { mrp: 10000, cost: 6000, gstRate: 12 }; // ₹100 MRP, ₹60 cost (+12% GST = ₹67.20 to break even)
  it("is bigger the closer expiry is", () => {
    expect(clearance({ ...a, days: 10 }).pct).toBe(30);
    expect(clearance({ ...a, days: 25 }).pct).toBe(20);
    expect(clearance({ ...a, days: 50 }).pct).toBe(10);
    expect(clearance({ ...a, days: 120 }).pct).toBe(5);
  });
  it("never goes below cost", () => {
    const c = clearance({ ...a, days: 10 });
    expect(c.floor).toBe(6720); expect(c.pct).toBe(30); expect(c.price).toBe(7000); expect(c.limited).toBe(false);
    const tight = clearance({ mrp: 10000, cost: 7600, gstRate: 12, days: 10 }); // cost + GST = ₹85.12: only 14% room
    expect(tight).toMatchObject({ pct: 14, limited: true }); expect(tight.price).toBeGreaterThanOrEqual(tight.floor);
  });
  it("offers nothing when even a small discount would lose money", () => {
    expect(clearance({ mrp: 10000, cost: 9500, gstRate: 12, days: 5 })).toMatchObject({ pct: 0, price: 10000, limited: true });
    expect(clearance({ mrp: 0, cost: 100, gstRate: 12, days: 5 }).pct).toBe(0);
  });
});
