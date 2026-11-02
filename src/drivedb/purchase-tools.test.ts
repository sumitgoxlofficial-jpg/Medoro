import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, receiveStock } from "./pharmacy";
import { addSupplier, recordPurchase } from "./trade";
import { paySupplier, supplierDues, supplierLedger } from "./books";
import { TABLES } from "./schema";
import {
  acknowledgeClaim, claimBatches, claimSuggestions, creditClaim, ebillHistory, ebillLineCost, ebillPreview, ebillSave, listClaims, marginReport,
  priceHistory, pricingRules, raiseClaim, savePricingRules, saveSupplierTerms, supplierTerms, type EbillPreview,
} from "./purchase-tools";

const B = "b1", U = "u1", TODAY = "2026-11-01";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });
const fixture = (f: string) => new Uint8Array(readFileSync(path.join(__dirname, "../../tests/fixtures/ebill", f)));
const stock = (batchId: string) => Number(db.engine.all<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId = ?", [batchId])[0].q);
const ready = (p: EbillPreview) => { if (p.needsMapping) throw new Error("needs mapping"); return p; };

it("migration 14 creates exactly the tables and columns the SDK allows, append-only where it should be", () => {
  for (const t of ["purchaseSetting", "supplierTerms", "supplierItemMap", "ebillImport", "supplierClaim", "claimEvent"] as const) {
    const cols = db.engine.all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name);
    expect(cols.sort()).toEqual([...TABLES[t].columns].sort());
  }
  expect(() => db.from("claimEvent").eq("id", "x").update({ amountPaise: 1 })).toThrow(/can't be changed/);
});

describe("pricing", () => {
  it("defaults to GST on the net value with input credit, and saves rules", () => {
    expect(pricingRules(db)).toEqual({ gstBase: "net", itc: true, minMarginPct: 0 });
    expect(savePricingRules(db, { gstBase: "before_cd", itc: false, minMarginPct: 12.5 })).toEqual({ gstBase: "before_cd", itc: false, minMarginPct: 12.5 });
    expect(savePricingRules(db, { gstBase: "net", itc: true })).toMatchObject({ gstBase: "net", minMarginPct: 0 });
    expect(() => savePricingRules(db, { gstBase: "odd" as "net", itc: true })).toThrow();
  });

  it("prices a line: scheme free goods, discounts, rate per pack after discounts and landed cost", () => {
    // 100 packs at ₹24, 5% trade discount, 20 free: net ₹2,280 → ₹22.80 a pack; landed over 120 packs = ₹19.00.
    const c = ebillLineCost({ qty: 100, free: 20, scheme: "", ptr: 2400, schemePct: 0, discPct: 5, cdPct: 0, mrp: 3360 }, 12);
    expect(c).toMatchObject({ free: 20, ratePaise: 2280, taxable: 228000, gst: 27360, gstDiff: 0, landed: 1900 });
    expect(c.margin).toBeCloseTo(36.67, 1);
    expect(ebillLineCost({ qty: 25, free: 0, scheme: "10+2", ptr: 1000, schemePct: 0, discPct: 0, cdPct: 0 }, 12).free).toBe(4);
    // GST on the undiscounted value: the bill shows more GST than the counter books on the net value.
    expect(ebillLineCost({ qty: 10, free: 0, scheme: "", ptr: 1000, schemePct: 0, discPct: 10, cdPct: 0 }, 12, { gstBase: "gross", itc: true }).gstDiff).toBe(1200 - 1080);
  });

  it("reports margins on MRP from the latest purchase, flags low ones, and keeps each supplier's rates", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3360 });
    const a = addSupplier(db, { name: "Agency A" }), b = addSupplier(db, { name: "Agency B" });
    recordPurchase(db, { branchId: B, supplierId: a.id, billNo: "1", billDate: "2026-10-01", userId: U, lines: [{ medicineId: m.id, batchNo: "X1", expiryDate: "2028-01-31", packs: 10, costPaise: 2000, mrpPaise: 3360 }] }, TODAY);
    recordPurchase(db, { branchId: B, supplierId: b.id, billNo: "2", billDate: "2026-10-20", userId: U, lines: [{ medicineId: m.id, batchNo: "X2", expiryDate: "2028-01-31", packs: 10, freePacks: 2, costPaise: 2400, mrpPaise: 3360 }] }, TODAY);
    const r = marginReport(db).rows[0];
    expect(r).toMatchObject({ supplier: "Agency B", ratePaise: 2400, landedPaise: 2000, sellExGstPaise: 3000, changePaise: 400, low: false });
    expect(r.margin).toBeCloseTo(33.33, 1);
    savePricingRules(db, { gstBase: "net", itc: true, minMarginPct: 40 });
    expect(marginReport(db, { lowOnly: true }).rows).toHaveLength(1);
    savePricingRules(db, { gstBase: "net", itc: false, minMarginPct: 40 }); // GST joins the cost
    expect(marginReport(db).rows[0].landedPaise).toBe(2240);
    const h = priceHistory(db, m.id);
    expect(h.rows.map((x) => x.effectivePaise)).toEqual([2000, 2000]);
    expect(h.suppliers.map((s) => [s.supplier, s.lastPaise, s.bills]).sort()).toEqual([["Agency A", 2000, 1], ["Agency B", 2000, 1]]);
  });
});

describe("supplier e-bills", () => {
  const setup = () => {
    const s = addSupplier(db, { name: "Mahavir Medical Agencies" });
    const dolo = addMedicine(db, { name: "Dolo 650", strength: "650mg", gstRate: 12, mrpPaise: 3360, packSize: 15 });
    const pan = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500, packSize: 15 });
    return { s, dolo, pan };
  };

  it("reads the file on the device, matches by name, saves as a purchase, learns, and refuses the same file again", async () => {
    const { s, dolo, pan } = setup();
    const p = ready(await ebillPreview(db, { supplierId: s.id, fileName: "marg-retailer.csv", bytes: fixture("marg-retailer.csv") }));
    expect(p.invoiceNo).toBe("MMA/2627/0412");
    expect(p.lines.map((l) => [l.medicineId, l.matchedBy])).toEqual([[dolo.id, "name"], [pan.id, "name"], [null, null]]);
    expect(p.already).toBeNull();

    // The user adds the third medicine and saves.
    const aug = addMedicine(db, { name: "Augmentin 625 Duo", gstRate: 12, mrpPaise: 22350, packSize: 10 });
    const lines = p.lines.map((l) => ({ ...l, medicineId: l.medicineId ?? aug.id, batch: l.batch, expiry: l.expiry!, ptr: l.ptr!, mrp: l.mrp }));
    const r = ebillSave(db, { branchId: B, supplierId: s.id, userId: U, fingerprint: p.fingerprint, fileName: "marg-retailer.csv", billNo: p.invoiceNo, billDate: p.invoiceDate, lines }, TODAY);
    // Dolo: 100 × ₹24 less 5% = ₹2,280; Pan 20 × ₹110; Augmentin 10 × ₹168 → ₹6,160 + 12% GST.
    expect(r).toMatchObject({ taxablePaise: 616000, taxPaise: 73920, totalPaise: 689920, lines: 3 });
    const doloBatch = db.from<{ id: string; expiryDate: string; costPaise: number }>("batch").eq("batchNo", "DL2611").first()!;
    expect(doloBatch).toMatchObject({ expiryDate: "2028-11-30", costPaise: 2280 });
    expect(stock(doloBatch.id)).toBe(120 * 15); // paid + free packs, in units
    expect(supplierDues(db)[0].duePaise).toBe(689920);
    expect(ebillHistory(db)[0]).toMatchObject({ billNo: "MMA/2627/0412", lines: 3 });

    // Next time: learned by item code; the same file is flagged and refused.
    const again = ready(await ebillPreview(db, { supplierId: s.id, fileName: "marg-retailer.csv", bytes: fixture("marg-retailer.csv") }));
    expect(again.lines.map((l) => l.matchedBy)).toEqual(["code", "code", "code"]);
    expect(again.lines[0].lastRate).toBe(2280);
    expect(again.already?.billNo).toBe("MMA/2627/0412");
    expect(() => ebillSave(db, { branchId: B, supplierId: s.id, userId: U, fingerprint: again.fingerprint, billNo: "OTHER-NO", billDate: p.invoiceDate, lines }, TODAY)).toThrow(/already entered as bill MMA\/2627\/0412/);
    // A changed file with the same bill number is stopped by the purchase's own check.
    expect(() => ebillSave(db, { branchId: B, supplierId: s.id, userId: U, fingerprint: "f".repeat(64), billNo: p.invoiceNo, billDate: p.invoiceDate, lines }, TODAY)).toThrow(/already entered/);
    expect(db.from("purchase").count()).toBe(1);
  });

  it("asks for columns when it can't tell, and remembers them for the supplier", async () => {
    const { s } = setup();
    const bytes = fixture("pipe-distributor.txt");
    const first = await ebillPreview(db, { supplierId: s.id, fileName: "pipe-distributor.txt", bytes });
    expect(first.needsMapping).toBe(true);
    const mapping = { headerRow: -1, rowFilter: { col: 0, value: "d" }, cols: { code: 1, name: 2, pack: 3, batch: 4, expiry: 5, qty: 6, free: 7, scheme: 8, mrp: 9, ptr: 10, gst: 11, schemePct: 12, cdPct: 13 } };
    const read = ready(await ebillPreview(db, { supplierId: s.id, fileName: "pipe-distributor.txt", bytes, mapping, remember: true }));
    expect(read.lines.length).toBeGreaterThan(0);
    expect(supplierTerms(db, s.id).ebillMapping?.rowFilter).toEqual({ col: 0, value: "d" });
    expect((await ebillPreview(db, { supplierId: s.id, fileName: "pipe-distributor.txt", bytes })).needsMapping).toBe(false);
  });

  it("refuses big files, unknown suppliers and lines without a medicine", async () => {
    const { s } = setup();
    await expect(ebillPreview(db, { supplierId: s.id, fileName: "x.csv", bytes: new Uint8Array(3 * 1024 * 1024) })).rejects.toThrow(/2 MB/);
    await expect(ebillPreview(db, { supplierId: "nope", fileName: "x.csv", bytes: fixture("marg-retailer.csv") })).rejects.toThrow(/supplier/);
    expect(() => ebillSave(db, { branchId: B, supplierId: s.id, userId: U, fingerprint: "a".repeat(64), billNo: "1", billDate: TODAY, lines: [{ medicineId: "", batch: "A", expiry: "2028-01", qty: 1, ptr: 100 }] }, TODAY)).toThrow(/Pick or add a medicine/);
  });
});

describe("supplier claims", () => {
  const setup = () => {
    const s = addSupplier(db, { name: "Agency" });
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200, packSize: 10, allowLoose: true });
    recordPurchase(db, { branchId: B, supplierId: s.id, billNo: "P1", billDate: "2026-10-01", userId: U, lines: [{ medicineId: m.id, batchNo: "A", expiryDate: "2026-12-31", packs: 10, costPaise: 2000, mrpPaise: 3200 }] }, TODAY);
    const batch = db.from<{ id: string }>("batch").eq("batchNo", "A").first()!;
    return { s, m, batch };
  };

  it("suggests stock inside the supplier's return window and raises a claim that takes stock out but not the dues", () => {
    const { s, m, batch } = setup();
    expect(claimSuggestions(db, B, TODAY)).toMatchObject([{ supplier: "Agency", window: 90, items: [{ batchNo: "A", qty: 100, value: 20000, days: 60 }] }]);
    saveSupplierTerms(db, { supplierId: s.id, acceptsReturns: true, returnWindowDays: 30 });
    expect(claimSuggestions(db, B, TODAY)).toEqual([]);
    expect(claimBatches(db, m.id, B, TODAY)).toMatchObject([{ batchNo: "A", supplier: "Agency", qty: 100 }]);

    expect(() => raiseClaim(db, { branchId: B, batchId: batch.id, qty: 500, reason: "near_expiry", userId: U, series: "C1" }, TODAY)).toThrow(/Only 100 in stock/);
    expect(() => raiseClaim(db, { branchId: "other", batchId: batch.id, qty: 5, reason: "near_expiry", userId: U, series: "C1" }, TODAY)).toThrow(/branch/);
    const due = supplierDues(db)[0].duePaise;
    const c = raiseClaim(db, { branchId: B, batchId: batch.id, qty: 50, reason: "near_expiry", note: "given to salesman", userId: U, series: "C1" }, TODAY);
    expect(c).toMatchObject({ claimNo: "CLM-C1-2627-0001", claimPaise: 10000 + 1200 });
    expect(stock(batch.id)).toBe(50);
    expect(supplierDues(db)[0].duePaise).toBe(due);
    expect(listClaims(db, TODAY)).toMatchObject({ rows: [{ status: "raised", open: 11200, qty: 50 }], aging: [{ supplier: "Agency", count: 1, open: 11200 }] });

    saveSupplierTerms(db, { supplierId: s.id, acceptsReturns: false, returnWindowDays: 30 });
    expect(() => raiseClaim(db, { branchId: B, batchId: batch.id, qty: 5, reason: "expiry", userId: U, series: "C1" }, TODAY)).toThrow(/doesn’t accept expiry returns/);
    expect(raiseClaim(db, { branchId: B, batchId: batch.id, qty: 5, reason: "breakage", userId: U, series: "C1" }, TODAY).claimNo).toBe("CLM-C1-2627-0002");
  });

  it("refuses opening stock with no supplier", () => {
    const m = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 1000 });
    const b = receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "O", expiryDate: "2027-01-31", qty: 10, costPaise: 500, mrpPaise: 1000, type: "opening", userId: U });
    expect(() => raiseClaim(db, { branchId: B, batchId: b, qty: 1, reason: "breakage", userId: U, series: "C1" }, TODAY)).toThrow(/no supplier on record/);
  });

  it("acknowledges, takes part credits that lower the dues, and closes with a write-off or as rejected", () => {
    const { batch } = setup();
    const c = raiseClaim(db, { branchId: B, batchId: batch.id, qty: 50, reason: "near_expiry", userId: U, series: "C1" }, TODAY);
    const start = supplierDues(db)[0].duePaise; // 22400
    acknowledgeClaim(db, { claimId: c.claimId, userId: U });
    expect(() => acknowledgeClaim(db, { claimId: c.claimId, userId: U })).toThrow(/already acknowledged/);
    expect(() => creditClaim(db, { claimId: c.claimId, userId: U, amountPaise: 5000 })).toThrow(/credit note number/);
    expect(() => creditClaim(db, { claimId: c.claimId, userId: U, amountPaise: 0 })).toThrow(/credit amount/);

    expect(creditClaim(db, { claimId: c.claimId, userId: U, ref: "CN-7", amountPaise: 6000 })).toEqual({ status: "acknowledged", open: 5200 });
    expect(supplierDues(db)[0]).toMatchObject({ credited: 6000, duePaise: start - 6000 });
    expect(() => creditClaim(db, { claimId: c.claimId, userId: U, amountPaise: 0, close: true, reason: "" })).toThrow(/why the rest/);
    expect(creditClaim(db, { claimId: c.claimId, userId: U, ref: "CN-9", amountPaise: 3000, close: true, reason: "80% of PTR only" })).toEqual({ status: "credited", open: 0 });
    const row = listClaims(db, TODAY).rows[0];
    expect(row).toMatchObject({ status: "credited", credit: 9000, writeOff: 2200, writeOffReason: "80% of PTR only", open: 0 });
    expect(row.credits.map((x) => x.ref)).toEqual(["CN-7", "CN-9"]);
    expect(() => creditClaim(db, { claimId: c.claimId, userId: U, ref: "CN-10", amountPaise: 100 })).toThrow(/already closed/);
    expect(supplierDues(db)[0].duePaise).toBe(start - 9000);
    expect(supplierLedger(db, row.supplierId).map((r) => r.kind)).toEqual(["bill", "credit", "credit"]);
    expect(() => paySupplier(db, { supplierId: row.supplierId, amountPaise: start, mode: "cash", userId: U })).toThrow(/owed only/);

    const c2 = raiseClaim(db, { branchId: B, batchId: batch.id, qty: 10, reason: "breakage", userId: U, series: "C1" }, TODAY);
    expect(creditClaim(db, { claimId: c2.claimId, userId: U, amountPaise: 0, close: true, reason: "Supplier refused" }).status).toBe("rejected");
  });

  it("a credit above the claim settles it in full and the excess still lowers the dues", () => {
    const { batch } = setup();
    const c = raiseClaim(db, { branchId: B, batchId: batch.id, qty: 10, reason: "breakage", userId: U, series: "C1" }, TODAY); // ₹22.40
    const start = supplierDues(db)[0].duePaise;
    expect(creditClaim(db, { claimId: c.claimId, userId: U, ref: "CN-1", amountPaise: 2500 })).toEqual({ status: "credited", open: 0 });
    expect(supplierDues(db)[0].duePaise).toBe(start - 2500);
  });
});
