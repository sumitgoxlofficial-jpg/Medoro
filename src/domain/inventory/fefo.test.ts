import { describe, expect, it } from "vitest";
import { allocateFefo, isSellable, nextFefo } from "./fefo";

const T = "2026-10-27";
const b = (id: string, exp: string, qty: number, status = "ok") => ({ id, medicineId: "m1", expiryDate: exp, qtyAvailable: qty, status });

describe("FEFO", () => {
  const batches = [b("late", "2027-08-31", 22), b("early", "2026-11-20", 18), b("expired", "2026-10-15", 4), b("q", "2026-11-01", 9, "quarantine"), b("today", T, 5)];

  it("blocks expired, expiring-today, quarantined and empty batches", () => {
    expect(isSellable(batches[2], T)).toBe(false);
    expect(isSellable(batches[3], T)).toBe(false);
    expect(isSellable(batches[4], T)).toBe(false);
    expect(isSellable(b("z", "2027-01-01", 0), T)).toBe(false);
    expect(isSellable(batches[1], T)).toBe(true);
  });

  it("picks the earliest sellable expiry, moving on when the cart uses it up", () => {
    expect(nextFefo(batches, "m1", {}, T)?.id).toBe("early");
    expect(nextFefo(batches, "m1", { early: 18 }, T)?.id).toBe("late");
    expect(nextFefo(batches, "m1", { early: 18, late: 22 }, T)).toBeUndefined();
  });

  it("splits a quantity across batches and refuses to oversell", () => {
    expect(allocateFefo(batches, "m1", 20, T).map((x) => [x.batch.id, x.qty])).toEqual([["early", 18], ["late", 2]]);
    expect(() => allocateFefo(batches, "m1", 41, T)).toThrow(/Only 40/);
  });
});
