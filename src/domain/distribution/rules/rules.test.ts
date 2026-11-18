import { describe, expect, it } from "vitest";
import { invoiceTotals, priceWholesaleLine, rateFor, retailerMarginPct, shareOfLine } from "./pricing";
import { bestScheme, freeFor, type Scheme } from "./schemes";
import { creditCheck } from "./credit";
import { claimEligibility, expectedCredit, expiryBand, expiryLoss } from "./expiry";
import { allocateFefoReserved, ShortStockError, splitPaidFree } from "./allocation";
import { ageing, openBills } from "./ageing";
import { dlExpiryProblem, dlProblem } from "./licence";
import { assertMove, canMove } from "./orderflow";
import { creditRisk, isDeadStock, nextMonthTrend, reorderQty, schemeImpact } from "./analytics";

describe("wholesale GST pricing", () => {
  it("adds GST on the discounted ex-GST value and splits CGST/SGST", () => {
    const l = priceWholesaleLine({ qty: 10, rate: 4567, gstRate: 12, discPct: 2.5 }, false);
    expect(l.gross).toBe(45670);
    expect(l.disc).toBe(1142); // 1141.75 → 1142
    expect(l.taxable).toBe(44528);
    expect(l.tax).toBe(5343); // 5343.36
    expect(l.cgst + l.sgst).toBe(l.tax);
    expect(l.cgst).toBe(2671);
    expect(l.igst).toBe(0);
  });
  it("puts all tax in IGST for inter-state supply", () => {
    const l = priceWholesaleLine({ qty: 3, rate: 10000, gstRate: 5 }, true);
    expect([l.cgst, l.sgst, l.igst]).toEqual([0, 0, 1500]);
  });
  it("rounds the invoice to the rupee on a separate line", () => {
    const t = invoiceTotals([{ qty: 1, rate: 10033, gstRate: 12 }, { qty: 2, rate: 5011, gstRate: 5 }], false);
    expect(t.taxable).toBe(20055);
    expect(t.tax).toBe(1204 + 501);
    expect(t.total % 100).toBe(0);
    expect(t.total - t.roundOff).toBe(t.taxable + t.tax);
    expect(Math.abs(t.roundOff)).toBeLessThanOrEqual(50);
  });
  it("rejects bad input", () => {
    expect(() => priceWholesaleLine({ qty: 0, rate: 100, gstRate: 12 }, false)).toThrow();
    expect(() => priceWholesaleLine({ qty: 1, rate: 100, gstRate: 7 }, false)).toThrow();
    expect(() => priceWholesaleLine({ qty: 1, rate: 100, gstRate: 12, discPct: 120 }, false)).toThrow();
    expect(() => invoiceTotals([], false)).toThrow();
  });
  it("shares a line for a part return", () => {
    expect(shareOfLine(10000, 1200, 3, 10)).toEqual({ taxable: 3000, tax: 360 });
    expect(() => shareOfLine(10000, 1200, 11, 10)).toThrow();
  });
  it("picks the chemist's rate", () => {
    expect(rateFor({ ptr: 1000, pts: 900 }, "ptr")).toBe(1000);
    expect(rateFor({ ptr: 1000, pts: 900 }, "pts")).toBe(900);
    expect(rateFor({ ptr: 1000, pts: 0 }, "pts")).toBe(1000);
    expect(rateFor({ ptr: 1000, pts: 900 }, "ptr", { rate: 950, validTo: "2099-01-01" }, "2026-11-18")).toBe(950);
    expect(rateFor({ ptr: 1000, pts: 900 }, "ptr", { rate: 950, validTo: "2026-01-01" }, "2026-11-18")).toBe(1000);
  });
  it("computes the retailer's margin on MRP", () => {
    expect(retailerMarginPct(1120, 800, 12)).toBe(20);
  });
});

const S = (o: Partial<Scheme>): Scheme => ({ id: "s", code: "S", name: "S", kind: "free", medicineId: "m1", companyId: null, buyQty: 10, freeQty: 1, discPct: 0, minQty: 1, customerIds: [], validFrom: "2026-01-01", validTo: "2026-12-31", active: true, ...o });

describe("schemes", () => {
  const line = { medicineId: "m1", companyId: "c1", qty: 25, customerId: "cu1" };
  it("gives free goods per full slab", () => {
    expect(freeFor(25, 10, 1)).toBe(2);
    expect(freeFor(9, 10, 1)).toBe(0);
    expect(bestScheme([S({})], line, "2026-11-18")).toMatchObject({ freeQty: 2, label: "10+1" });
  });
  it("respects dates, minimum quantity, active flag and chemist list", () => {
    expect(bestScheme([S({ validTo: "2026-10-01" })], line, "2026-11-18").schemeId).toBeNull();
    expect(bestScheme([S({ minQty: 30 })], line, "2026-11-18").schemeId).toBeNull();
    expect(bestScheme([S({ active: false })], line, "2026-11-18").schemeId).toBeNull();
    expect(bestScheme([S({ customerIds: ["other"] })], line, "2026-11-18").schemeId).toBeNull();
    expect(bestScheme([S({ customerIds: ["cu1"] })], line, "2026-11-18").schemeId).toBe("s");
  });
  it("applies company-wide schemes and picks the most valuable one", () => {
    const company = S({ id: "c", medicineId: null, companyId: "c1", kind: "discount", discPct: 12 as never, buyQty: 0, freeQty: 0 });
    const r = bestScheme([S({}), company], line, "2026-11-18"); // 10+1 on 25 = 2/27 = 7.4% < 12%
    expect(r).toMatchObject({ schemeId: "c", discPct: 12, freeQty: 0 });
  });
});

describe("credit control", () => {
  const base = { limit: 100000_00, balance: 50000_00, orderValue: 10000_00, pendingOrders: 0, oldestOpenDays: 10, creditDays: 21, graceDays: 7, status: "active", dlExpiry: "2027-12-31", today: "2026-11-18" };
  it("passes inside limit and terms", () => expect(creditCheck(base)).toMatchObject({ ok: true, hard: false, available: 50000_00 }));
  it("holds over limit", () => expect(creditCheck({ ...base, orderValue: 60000_00 }).reasons[0]).toMatch(/limit exceeded by ₹10000.00/));
  it("counts approved-but-unbilled orders in exposure", () => expect(creditCheck({ ...base, pendingOrders: 45000_00 }).ok).toBe(false));
  it("holds overdue accounts", () => expect(creditCheck({ ...base, oldestOpenDays: 29 }).ok).toBe(false));
  it("hard-stops expired licences and blocked accounts", () => {
    expect(creditCheck({ ...base, dlExpiry: "2026-11-01" })).toMatchObject({ ok: false, hard: true });
    expect(creditCheck({ ...base, status: "blocked" })).toMatchObject({ ok: false, hard: true });
    expect(creditCheck({ ...base, dlExpiry: null })).toMatchObject({ hard: true });
  });
  it("treats a zero limit as cash-only", () => expect(creditCheck({ ...base, limit: 0, balance: 0 }).ok).toBe(false));
});

describe("expiry", () => {
  const p = { claimBeforeDays: 90, claimAfterDays: 180, claimCreditPct: 80 };
  it("bands", () => expect([-1, 0, 15, 45, 75, 150, 400].map(expiryBand)).toEqual(["expired", "expired", "30", "60", "90", "180", "ok"]));
  it("claim window", () => {
    expect(claimEligibility(120, p).eligible).toBe(false);
    expect(claimEligibility(60, p).eligible).toBe(true);
    expect(claimEligibility(-100, p).eligible).toBe(true);
    expect(claimEligibility(-200, p).eligible).toBe(false);
  });
  it("credit and loss", () => {
    expect(expectedCredit(10000, p)).toBe(8000);
    expect(expiryLoss(100, 1, 30, 50, p)).toEqual({ unsold: 70, loss: 700, recoverable: 2800 });
    expect(expiryLoss(10, 1, 30, 50, p).unsold).toBe(0);
  });
});

describe("FEFO allocation with reservations", () => {
  const B = [
    { id: "b1", medicineId: "m", batchNo: "A", expiry: "2027-01-31", qtyAvailable: 30, status: "ok" },
    { id: "b2", medicineId: "m", batchNo: "B", expiry: "2026-12-31", qtyAvailable: 20, status: "ok" },
    { id: "b3", medicineId: "m", batchNo: "C", expiry: "2026-11-25", qtyAvailable: 50, status: "ok" },
    { id: "b4", medicineId: "m", batchNo: "D", expiry: "2027-06-30", qtyAvailable: 50, status: "quarantine" },
  ];
  it("takes earliest expiry first and skips short-dated and quarantined", () => {
    const a = allocateFefoReserved(B, "m", 40, { today: "2026-11-18", minShelfDays: 30 });
    expect(a.map((x) => [x.batchId, x.units])).toEqual([["b2", 20], ["b1", 20]]);
  });
  it("honours reservations from open pick lists", () => {
    const a = allocateFefoReserved(B, "m", 20, { today: "2026-11-18", minShelfDays: 30, reserved: { b2: 15 } });
    expect(a.map((x) => [x.batchId, x.units])).toEqual([["b2", 5], ["b1", 15]]);
  });
  it("allocates whole packs only", () => {
    const a = allocateFefoReserved([{ ...B[1], qtyAvailable: 25 }, B[0]], "m", 40, { today: "2026-11-18", packSize: 10 });
    expect(a.map((x) => x.units)).toEqual([20, 20]);
  });
  it("reports what is available when short", () => {
    try { allocateFefoReserved(B, "m", 60, { today: "2026-11-18", minShelfDays: 30 }); expect.fail(); }
    catch (e) { expect(e).toBeInstanceOf(ShortStockError); expect((e as ShortStockError).available).toBe(50); }
  });
  it("splits paid and free", () => {
    expect(splitPaidFree([{ batchId: "x", batchNo: "x", expiry: "", rack: null, units: 8 }, { batchId: "y", batchNo: "y", expiry: "", rack: null, units: 3 }], 10).map((x) => x.paidUnits)).toEqual([8, 2]);
  });
});

describe("FIFO outstanding and ageing", () => {
  const bills = [
    { id: "1", no: "I1", date: "2026-08-01", dueDate: "2026-08-22", total: 1000 },
    { id: "2", no: "I2", date: "2026-10-01", dueDate: "2026-10-22", total: 2000 },
    { id: "3", no: "I3", date: "2026-11-10", dueDate: "2026-12-01", total: 3000 },
  ];
  it("clears oldest bills first", () => {
    const o = openBills(bills, 4000, "2026-11-18");
    expect(o.map((b) => [b.no, b.open])).toEqual([["I2", 1000], ["I3", 3000]]);
    expect(o[0].overdueDays).toBe(27);
  });
  it("shows unbilled balance as opening / on account", () => expect(openBills(bills, 7000, "2026-11-18")[0]).toMatchObject({ id: "opening", open: 1000 }));
  it("has nothing open when paid or in advance", () => expect(openBills(bills, -500, "2026-11-18")).toEqual([]));
  it("buckets", () => expect(ageing(openBills(bills, 6000, "2026-11-18"))).toMatchObject({ "0-30": 3000, "31-60": 2000, "91-120": 1000 }));
});

describe("licences", () => {
  it("checks shape and expiry", () => {
    expect(dlProblem("MH-PZ1-123456", "Form 20B")).toBeNull();
    expect(dlProblem("20B/KA/BNG/1234", "Form 20B")).toBeNull();
    expect(dlProblem("", "Form 20B")).toMatch(/required/);
    expect(dlProblem("ABC", "Form 20B")).toMatch(/doesn’t look/);
    expect(dlProblem("MH-PZ-AB", "Form 20B")).toMatch(/serial/);
    expect(dlExpiryProblem("2026-01-01", "2026-11-18")).toMatch(/expired/);
    expect(dlExpiryProblem("2027-01-01", "2026-11-18")).toBeNull();
  });
});

describe("order lifecycle", () => {
  it("allows only the next steps", () => {
    expect(canMove("pending", "approved")).toBe(true);
    expect(canMove("pending", "invoiced")).toBe(false);
    expect(canMove("delivered", "cancelled")).toBe(false);
    expect(() => assertMove("approved", "invoiced")).toThrow(/approved/);
  });
});

describe("analytics", () => {
  it("reorders up to cover when below the reorder point", () => {
    expect(reorderQty({ onHand: 20, onOrder: 0, reserved: 0, dailyDemand: 5, leadDays: 3, coverDays: 14, safetyDays: 2, packSize: 1 })).toEqual({ packs: 75, reorderPoint: 25, target: 95 });
    expect(reorderQty({ onHand: 200, onOrder: 0, reserved: 0, dailyDemand: 5, leadDays: 3, coverDays: 14, safetyDays: 2, packSize: 1 }).packs).toBe(0);
    expect(reorderQty({ onHand: 0, onOrder: 0, reserved: 0, dailyDemand: 1, leadDays: 1, coverDays: 1, safetyDays: 1, packSize: 10, minOrder: 5 }).packs).toBe(5);
  });
  it("finds dead stock", () => {
    expect(isDeadStock(null, "2026-11-18", 5)).toBe(true);
    expect(isDeadStock("2026-11-01", "2026-11-18", 5)).toBe(false);
    expect(isDeadStock("2026-07-01", "2026-11-18", 5)).toBe(true);
    expect(isDeadStock("2026-07-01", "2026-11-18", 0)).toBe(false);
  });
  it("scores credit risk", () => {
    expect(creditRisk({ limit: 100, balance: 20, overdue: 0, oldestDays: 5, creditDays: 21, bounces90d: 0, paidLast90: 100, billedLast90: 100 }).level).toBe("low");
    const r = creditRisk({ limit: 100, balance: 130, overdue: 100, oldestDays: 120, creditDays: 21, bounces90d: 2, paidLast90: 10, billedLast90: 100 });
    expect(r.level).toBe("high");
    expect(r.factors.length).toBeGreaterThanOrEqual(4);
  });
  it("judges scheme impact", () => expect(schemeImpact({ before: { qty: 100, margin: 1000 }, during: { qty: 150, margin: 1300 }, schemeCost: 500 })).toEqual({ qtyChangePct: 50, extraMargin: 300, uplift: -200 }));
  it("trends", () => {
    expect(nextMonthTrend([100, 200])).toBeNull();
    expect(nextMonthTrend([100, 200, 300])?.next).toBe(400);
  });
});

import { stockBand } from "../portal-rules";
import { distEntitlements, distPlanOf } from "../plans";
import { distPerms } from "../perms";

describe("portal stock visibility", () => {
  it("never reveals exact stock unless the distributor allows it", () => {
    expect(stockBand(250, "band")).toEqual({ label: "In stock", tone: "green", packs: null });
    expect(stockBand(4, "band").packs).toBeNull();
    expect(stockBand(0, "band").label).toBe("Out of stock");
    expect(stockBand(250, "none")).toMatchObject({ packs: null, label: "Ask distributor" });
    expect(stockBand(250, "exact").packs).toBe(250);
  });
});

describe("distribution plans and permissions", () => {
  it("maps plan names and opens everything in trial", () => {
    expect(distPlanOf("Distribution Professional")).toBe("dist_pro");
    expect(distPlanOf("Professional")).toBeNull();
    expect(distEntitlements({ plan: "Distribution Standard", status: "active", unlicensed: false }).features).toEqual(["warehouse"]);
    expect(distEntitlements({ plan: "Distribution Standard", status: "trial", unlicensed: false }).open).toBe("trial");
    expect(distEntitlements({ plan: "Distribution Standard", status: "active", unlicensed: false }).limits.godowns).toBe(1);
  });
  it("applies grants and revokes, ignoring unknown keys", () => {
    expect(distPerms(["order", "sale", "bogus"], ["approve"], ["order"])).toEqual(["approve"]);
  });
});

import { distHostingAllowed } from "../hosting";
describe("hosting policy", () => {
  it("keeps MEDORO's hosted Drive-only policy unless the operator opts in", () => {
    expect(distHostingAllowed({})).toBe(true); // own server
    expect(distHostingAllowed({ PUBLIC_SIGNUP: "1" })).toBe(false);
    expect(distHostingAllowed({ PUBLIC_SIGNUP: "1", DIST_HOSTED: "1" })).toBe(true);
  });
});
