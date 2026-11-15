import { describe, expect, it } from "vitest";
import { pharmaPricing } from "./pharma-pricing";

describe("PTR and PTS from MRP", () => {
  it("takes margins off the selling price", () => {
    // MRP ₹105 at 5%: ₹100 without GST; 20% retailer margin → PTR ₹80; 10% stockist margin → PTS ₹72.
    const p = pharmaPricing({ mrpPaise: 10500, gstRate: 5, retailerMargin: 20, stockistMargin: 10, basis: "selling", qty: 10 });
    expect(p.base).toBe(10000);
    expect(p.ptr).toBe(8000);
    expect(p.pts).toBe(7200);
    expect(p.ptrWithGst).toBe(8400);
    expect(p.retailerProfit).toBe(2000);
    expect(p.stockistProfit).toBe(800);
    expect(p.outputGst).toBe(500);
    expect(p.inputGst).toBe(400);
    expect(p.netGst).toBe(100);
    expect(p.cgst + p.sgst).toBe(500);
    expect(p.marginOnSale).toBeCloseTo(20);
    expect(p.markupOnCost).toBeCloseTo(25);
    expect(p.order).toEqual({ cost: 84000, sales: 105000, profit: 20000, netGst: 1000 });
  });

  it("supports markup on cost", () => {
    // ₹120 without GST at 20% markup → PTR ₹100; 10% markup → PTS ₹90.91.
    const p = pharmaPricing({ mrpPaise: 14160, gstRate: 18, retailerMargin: 20, stockistMargin: 10, basis: "markup", qty: 1 });
    expect(p.base).toBe(12000);
    expect(p.ptr).toBe(10000);
    expect(p.pts).toBe(9091);
    expect(p.markupOnCost).toBeCloseTo(20);
  });

  it("handles zero GST and zero margins", () => {
    const p = pharmaPricing({ mrpPaise: 5000, gstRate: 0, retailerMargin: 0, stockistMargin: 0, basis: "selling", qty: 0 });
    expect(p.base).toBe(5000);
    expect(p.ptr).toBe(5000);
    expect(p.netGst).toBe(0);
    expect(p.order.profit).toBe(0);
  });
});
