import { describe, expect, it } from "vitest";
import { exGst, marginPct, parseScheme, priceLine, purchaseTotals, rulesOf, schemeFree } from "./pricing";

describe("purchase pricing", () => {
  it("parses schemes and works out free quantity", () => {
    expect(parseScheme("10+2")).toEqual({ buy: 10, free: 2 });
    expect(parseScheme(" 10 + 1F ")).toEqual({ buy: 10, free: 1 });
    expect(parseScheme("10-2")).toBeNull();
    expect(parseScheme("0+2")).toBeNull();
    expect(schemeFree(25, "10+2")).toBe(4);
    expect(schemeFree(9, "10+2")).toBe(0);
    expect(schemeFree(25, "")).toBe(0);
  });

  it("applies trade then cash discount; GST on the net value; landed cost spread over free units", () => {
    // 100 × ₹24 PTR, 20 free, 5% trade, 2% cash, 12% GST
    const p = priceLine({ qty: 100, freeQty: 20, rate: 2400, gstRate: 12, tradePct: 5, cashPct: 2 });
    expect(p).toMatchObject({ gross: 240000, tradeDisc: 12000, cashDisc: 4560, net: 223440, taxable: 223440, gst: 26813, payable: 250253, units: 120, landed: 1862 });
    expect(p.disc).toBe(16560);
  });

  it("GST base is configurable, and GST joins cost when it can't be claimed", () => {
    const l = { qty: 100, freeQty: 20, rate: 2400, gstRate: 12, tradePct: 5, cashPct: 2 };
    expect(priceLine(l, { gstBase: "before_cd", itc: true })).toMatchObject({ taxable: 228000, gst: 27360, net: 223440, payable: 250800, landed: 1862 });
    expect(priceLine(l, { gstBase: "gross", itc: true })).toMatchObject({ taxable: 240000, gst: 28800 });
    expect(priceLine(l, { gstBase: "net", itc: false })).toMatchObject({ cost: 250253, landed: 2085 });
  });

  it("scheme discount % comes off before trade discount; fractional percentages are exact", () => {
    const p = priceLine({ qty: 10, rate: 1000, gstRate: 5, schemePct: 10, tradePct: 2.5 });
    expect([p.schemeDisc, p.tradeDisc, p.net, p.gst]).toEqual([1000, 225, 8775, 439]);
    const t = purchaseTotals([{ qty: 10, rate: 1000, gstRate: 5, schemePct: 10, tradePct: 2.5 }, { qty: 1, rate: 500, gstRate: 12 }]);
    expect([t.net, t.gst, t.total]).toEqual([9275, 499, 9774]);
  });

  it("reads rules from settings and computes margins", () => {
    expect(rulesOf({})).toEqual({ gstBase: "net", itc: true });
    expect(rulesOf({ purchasing: { gstBase: "bad", itc: false } })).toEqual({ gstBase: "net", itc: false });
    expect(rulesOf({ purchasing: { gstBase: "gross" } })).toEqual({ gstBase: "gross", itc: true });
    expect(exGst(3360, 12)).toBe(3000);
    expect(marginPct(3000, 1862)).toBe(37.93);
    expect(marginPct(0, 10)).toBeNull();
  });
});
