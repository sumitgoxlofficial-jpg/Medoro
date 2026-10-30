import { describe, expect, it } from "vitest";
import { cartTotals } from "./money";
import { baseQty, fmtQty, fmtSold, packLabel, parseQty, qtyInput, splitQty, stockValue, unitCost, unitPrice } from "./units";

const strip15 = { packSize: 15, packUnit: "strip", looseUnit: "tab" };

describe("multi-unit stock", () => {
  it("converts sold units to stock units", () => {
    expect(baseQty(2, "pack", 15)).toBe(30);
    expect(baseQty(2, undefined, 15)).toBe(30);
    expect(baseQty(7, "loose", 15)).toBe(7);
    expect(baseQty(3, "pack", 1)).toBe(3);
  });

  it("prices a loose unit at MRP ÷ pack size rounded down, so a full strip sold loose never exceeds MRP", () => {
    expect(unitPrice(3250, "loose", 15)).toBe(216); // ₹32.50 / 15 = 216.67 paise
    expect(unitPrice(3250, "loose", 15) * 15).toBeLessThanOrEqual(3250);
    expect(unitPrice(3360, "loose", 15)).toBe(224); // exact
    expect(unitPrice(3250, "pack", 15)).toBe(3250);
    expect(unitPrice(999, "loose", 1)).toBe(999); // pack-only medicines ignore "loose"
    for (const [mrp, ps] of [[1, 10], [101, 3], [11999, 7], [4567, 30]]) expect(unitPrice(mrp, "loose", ps) * ps).toBeLessThanOrEqual(mrp);
  });

  it("spreads cost and values stock per pack to the paisa", () => {
    expect(unitCost(2450, "loose", 15)).toBe(163); // 163.33
    expect(unitCost(2450, "pack", 15)).toBe(2450);
    expect(stockValue(2450, 30, 15)).toBe(4900);
    expect(stockValue(2450, 7, 15)).toBe(1143); // 1143.33
    expect(stockValue(2450, -7, 15)).toBe(-1143);
    expect(stockValue(2450, 4, 1)).toBe(9800);
  });

  it("back-calculates GST per loose line the same way as per pack", () => {
    const t = cartTotals([{ mrpPaise: unitPrice(3250, "loose", 15), qty: 5, gstRate: 12 }, { mrpPaise: 3250, qty: 1, gstRate: 12 }], 10);
    expect(t.lines[0].amount).toBe(1080);
    expect(t.lines[0].discount).toBe(108);
    expect(t.lines[0].taxable).toBe(868); // round(972 × 100 / 112)
    expect(t.cgst + t.sgst + t.taxable).toBe(t.net);
    expect(t.total % 100).toBe(0);
  });

  it("shows stock as packs plus a loose remainder", () => {
    expect(splitQty(47, 15)).toEqual({ sign: 1, packs: 3, loose: 2 });
    expect(fmtQty(47, strip15)).toBe("3 strips + 2 tabs");
    expect(fmtQty(15, strip15)).toBe("1 strip");
    expect(fmtQty(1, strip15)).toBe("1 tab");
    expect(fmtQty(0, strip15)).toBe("0 strips");
    expect(fmtQty(-16, strip15)).toBe("−1 strip + 1 tab");
    expect(fmtQty(47, { packSize: 1, packUnit: "pack", looseUnit: "unit" })).toBe("47");
    expect(fmtSold(5, "loose", strip15)).toBe("5 tabs");
    expect(fmtSold(2, "pack", strip15)).toBe("2 strips");
    expect(fmtSold(2, "pack", { packSize: 1, packUnit: "pack", looseUnit: "unit" })).toBe("2");
    expect(packLabel({ ...strip15, caseSize: 10, caseUnit: "box" })).toBe("1 box = 10 strips · 1 strip = 15 tabs");
  });

  it("reads counted quantities as packs or packs+loose", () => {
    expect(parseQty("3", 15)).toBe(45);
    expect(parseQty("3+2", 15)).toBe(47);
    expect(parseQty("0 + 14", 15)).toBe(14);
    expect(parseQty("3+15", 15)).toBeNull();
    expect(parseQty("3+1", 1)).toBeNull();
    expect(parseQty("12", 1)).toBe(12);
    expect(parseQty("x", 15)).toBeNull();
    expect(qtyInput(47, 15)).toBe("3+2");
    expect(qtyInput(45, 15)).toBe("3");
    expect(parseQty(qtyInput(59, 15), 15)).toBe(59);
  });
});
