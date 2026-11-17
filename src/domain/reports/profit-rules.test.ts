import { describe, expect, it } from "vitest";
import { costVariation, flagDiscounts, pct, reconcile } from "./profit-rules";

describe("profit rules", () => {
  it("reconciles within rounding and reports a real difference", () => {
    expect(reconcile(1_000_000, 1_000_050).status).toBe("reconciled");
    expect(reconcile(1_000_000, 1_000_000).diff).toBe(0);
    const r = reconcile(1_000_000, 1_020_000);
    expect(r.status).toBe("differs");
    expect(r.diff).toBe(-20000);
    expect(reconcile(0, 0).status).toBe("reconciled");
    expect(reconcile(50, 0).status).toBe("reconciled");   // under ₹1
    expect(reconcile(500, 0).status).toBe("differs");
  });
  it("pct handles a zero base without inventing a number", () => { expect(pct(5, 0)).toBeNull(); expect(pct(1, 8)).toBe(12.5); });
  it("cost variation needs two purchases and flags a 10% spread", () => {
    expect(costVariation([1000])).toBeNull();
    const v = costVariation([1000, 1050, 1200])!;
    expect(v).toMatchObject({ n: 3, min: 1000, max: 1200, latest: 1200, spreadPct: 20, flagged: true });
    expect(v.latestVsAvgPct).toBeGreaterThan(0);
    expect(costVariation([1000, 1040])!.flagged).toBe(false);
    expect(costVariation([0, 0, 1000])).toBeNull(); // zero costs are not data
  });
  it("flags only cashiers with enough bills and a clearly higher discount rate", () => {
    const r = flagDiscounts([
      { userId: "a", bills: 100, discountPaise: 1000, grossPaise: 100000 },
      { userId: "b", bills: 100, discountPaise: 1000, grossPaise: 100000 },
      { userId: "c", bills: 100, discountPaise: 8000, grossPaise: 100000 },   // 8% against ~3.3% overall
      { userId: "d", bills: 5, discountPaise: 900, grossPaise: 1000 },         // 90% but only 5 bills: not flagged
    ]);
    expect(r.rows.find((x) => x.userId === "c")!.flagged).toBe(true);
    expect(r.rows.find((x) => x.userId === "d")!.flagged).toBe(false);
    expect(r.rows.find((x) => x.userId === "a")!.flagged).toBe(false);
    expect(flagDiscounts([]).overallPct).toBeNull();
  });
});
