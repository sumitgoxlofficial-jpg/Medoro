import { describe, expect, it } from "vitest";
import { creditFactor, priceFactor, recommend, returnsFactor, scoreSupplier, WEIGHTS, type Quote, type SupplierFacts } from "./supplier-score";

const facts = (o: Partial<SupplierFacts> = {}): SupplierFacts => ({ orders: 8, fillPct: 95, onTimePct: 90, creditDays: 30, acceptsReturns: true, returnWindowDays: 90, ...o });
const q = (id: string, landed: number, f: Partial<SupplierFacts> = {}): Quote => ({ supplierId: id, name: id.toUpperCase(), landedPaise: landed, at: "2026-11-01", facts: facts(f) });

describe("supplier scoring", () => {
  it("weights sum to 1", () => expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1));
  it("factor mappings", () => {
    expect(priceFactor(1)).toBe(100); expect(priceFactor(1.25)).toBe(0); expect(priceFactor(2)).toBe(0); expect(priceFactor(null)).toBeNull();
    expect(creditFactor(0)).toBe(0); expect(creditFactor(30)).toBe(50); expect(creditFactor(120)).toBe(100);
    expect(returnsFactor(false, 120)).toBe(0); expect(returnsFactor(true, 0)).toBe(20); expect(returnsFactor(true, 120)).toBe(100);
  });
  it("leaves out factors with no data instead of treating them as zero, and says so in the confidence", () => {
    const s = scoreSupplier(facts({ orders: 0, fillPct: null, onTimePct: null }), 1);
    expect(s.factors.find((f) => f.key === "fulfilment")!.value).toBeNull();
    expect(s.factors.find((f) => f.key === "fulfilment")!.weight).toBe(0);
    expect(s.factors.reduce((a, f) => a + f.weight, 0)).toBeCloseTo(1, 1);
    expect(s.confidence).toBe("low");
    expect(scoreSupplier(facts({ orders: 6 }), 1).confidence).toBe("high");
  });
  it("recommends the cheapest supplier when it is also reliable, and explains why", () => {
    const r = recommend([q("a", 1000), q("b", 1100)])!;
    expect(r.pickId).toBe("a");
    expect(r.cheaperButWorse).toBeNull();
    expect(r.explanation[0]).toMatch(/Lowest landed cost: ₹10\.00 per unit, 9\.1% below B/);
  });
  it("does not blindly pick the cheapest: an unreliable 5% cheaper supplier loses, and the explanation names the trade-off", () => {
    const r = recommend([q("cheap", 950, { fillPct: 55, onTimePct: 40, creditDays: 0, acceptsReturns: false }), q("solid", 1000, { fillPct: 98, onTimePct: 96, creditDays: 45 })])!;
    expect(r.pickId).toBe("solid");
    expect(r.cheaperButWorse?.name).toBe("CHEAP");
    expect(r.explanation.join(" ")).toMatch(/CHEAP is 5\.0% cheaper but scores/);
    expect(r.explanation.join(" ")).toMatch(/40% on time/);
  });
  it("a hugely cheaper supplier still wins on price when the gap is large", () => {
    const r = recommend([q("cheap", 700, { fillPct: 80, onTimePct: 75 }), q("dear", 1000)])!;
    expect(r.pickId).toBe("cheap");
  });
  it("needs two quotes and ignores non-positive ones", () => {
    expect(recommend([q("a", 1000)])).toBeNull();
    expect(recommend([q("a", 1000), q("b", 0)])).toBeNull();
  });
  it("flags low confidence when there is no order history", () => {
    const r = recommend([q("a", 1000, { orders: 0, fillPct: null, onTimePct: null }), q("b", 1200, { orders: 0, fillPct: null, onTimePct: null })])!;
    expect(r.explanation.join(" ")).toMatch(/not scored/);
    expect(r.explanation.join(" ")).toMatch(/Low confidence/);
  });
  it("is deterministic on ties", () => {
    expect(recommend([q("b", 1000), q("a", 1000)])!.pickId).toBe("a");
  });
});
