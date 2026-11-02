import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale } from "./pharmacy";
import { addSupplier, createReturn, recordPurchase } from "./trade";
import { recordCount } from "./ops";
import {
  addToDraft, anomalies, linesFor, centralBuying, draftCsv, draftGroups, forecast, getDraft, insights, intelSettings, markReviewed, orderText,
  priceComparison, salesMargins, saveDraft, saveIntelSettings, seasonal, slowStock, stockMargins, suggestionLines,
} from "./insights";
import { addDays, todayISO } from "@/lib/dates";

const B = "b1", U = "u1";
let db: DriveDB;
// Only Date is faked, so purchases get distinct times and "today" is fixed (11:30 am in India).
const T0 = new Date("2026-10-01T06:00:00.000Z");
const at = (days: number, h = 0) => vi.setSystemTime(new Date(T0.getTime() + days * 86400_000 + h * 3600_000));
beforeEach(async () => { db = await memoryDb("C1"); vi.useFakeTimers({ toFake: ["Date"] }); at(0); });
afterEach(() => vi.useRealTimers());

const buy = (supplierId: string, billNo: string, lines: { medicineId: string; packs: number; freePacks?: number; costPaise: number; mrpPaise: number; batchNo?: string }[]) =>
  recordPurchase(db, { branchId: B, supplierId, billNo, billDate: todayISO(), userId: U, lines: lines.map((l, i) => ({ batchNo: l.batchNo ?? `${billNo}-${i}`, expiryDate: "2030-01-31", ...l })) });
const sell = (medicineId: string, qty: number, extra: { discountPct?: number } = {}) =>
  createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId, qty }], pay: { mode: "cash" }, ...extra });

function shop() {
  const s1 = addSupplier(db, { name: "Agency One", phone: "9822000001" });
  const s2 = addSupplier(db, { name: "Agency Two" });
  const a = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200, packSize: 15, packUnit: "strip", form: "Tablet" });
  const b = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500, reorderLevel: 10, form: "Tablet" });
  const c = addMedicine(db, { name: "Cough syrup", gstRate: 12, mrpPaise: 9000, packUnit: "bottle", form: "Syrup" });
  buy(s2.id, "P0", [{ medicineId: a.id, packs: 10, costPaise: 1800, mrpPaise: 3200 }]);
  at(1);
  buy(s1.id, "P1", [{ medicineId: a.id, packs: 40, costPaise: 2000, mrpPaise: 3200 }, { medicineId: c.id, packs: 2, costPaise: 6000, mrpPaise: 9000 }]);
  buy(s2.id, "P2", [{ medicineId: b.id, packs: 2, freePacks: 2, costPaise: 3000, mrpPaise: 15500 }]);
  at(2);
  return { s1, s2, a, b, c };
}

describe("settings", () => {
  it("defaults to the web's policy, saves valid values and refuses others", () => {
    expect(intelSettings(db)).toEqual({ policy: { cover: 21, safety: 2 }, anomaly: { disc: 5, refunds: 2 } });
    expect(saveIntelSettings(db, { policy: { cover: 7, safety: 3 } }).policy).toEqual({ cover: 7, safety: 3 });
    expect(() => saveIntelSettings(db, { policy: { cover: 10, safety: 2 } })).toThrow(/Invalid policy/);
    expect(() => saveIntelSettings(db, { anomaly: { disc: -1, refunds: 2 } })).toThrow(/Invalid threshold/);
    expect(intelSettings(db).anomaly).toEqual({ disc: 5, refunds: 2 });
  });
});

describe("reorder forecast", () => {
  it("suggests by sales rate, reorder level and stock-out, with the last supplier and landed cost", () => {
    const { s1, s2, a, b, c } = shop();
    sell(a.id, 14); // 0.5 strip a day over 28 days; 36 strips left
    sell(c.id, 2); // sold out
    const f = forecast(db, B, { cover: 21, safety: 2 });
    const row = (id: string) => f.rows.find((r) => r.id === id)!;
    expect(row(a.id)).toMatchObject({ stock: 36, velocity: 0.5, rop: 2, suggestion: 0, why: "ok", cover: 72, supplierId: s1.id, cost: 2000 });
    // Pan 40: 4 packs (2 paid + 2 free) under a reorder level of 10; landed cost ₹15 a pack.
    expect(row(b.id)).toMatchObject({ stock: 4, suggestion: 6, why: "below", supplierId: s2.id, cost: 1500 });
    // Syrup: 2 in 28 days, none left: 21 days' cover (2) on top of the reorder point (1).
    expect(row(c.id)).toMatchObject({ stock: 0, suggestion: 3, why: "out", supplier: "Agency One" });
    expect(f.needs.map((r) => r.id)).toEqual([b.id, c.id]);
    expect(forecast(db, B, { cover: 7, safety: 2 }).needs.find((r) => r.id === c.id)!.suggestion).toBe(2);
    // Another branch's stock and sales don't count here.
    expect(forecast(db, "b2", { cover: 21, safety: 2 }).needs.map((r) => r.id)).toEqual([b.id]);
  });

  it("returns are taken off the sales rate", () => {
    const { a } = shop();
    const s = sell(a.id, 14);
    const item = db.from<{ id: string }>("saleItem").eq("saleId", s.saleId).first()!.id;
    createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 7 }] });
    expect(forecast(db, B, { cover: 21, safety: 2 }).rows.find((r) => r.id === a.id)!.velocity).toBe(0.25);
  });

  it("central buying combines branches per supplier", () => {
    const { s2, b } = shop();
    const plan = centralBuying(db, [{ id: B, name: "Main" }, { id: "b2", name: "Station Road" }], { cover: 21, safety: 2 });
    const two = plan.suppliers.find((s) => s.supplierId === s2.id)!;
    expect(two.lines.find((l) => l.medicineId === b.id)).toMatchObject({ qty: { [B]: 6 }, total: 6 });
    // b2 has no purchases, so its Pan 40 (reorder level 10) has no supplier on record.
    expect(plan.suppliers.at(-1)).toMatchObject({ supplierId: null });
    expect(plan.suppliers.at(-1)!.lines[0]).toMatchObject({ medicineId: b.id, qty: { b2: 10 } });
  });
});

describe("draft order list", () => {
  it("turns suggestions into a list per supplier, keeps the larger quantity, and shares as text and CSV", () => {
    const { s1, b, c } = shop();
    sell(c.id, 2);
    const lines = suggestionLines(db, B);
    expect(lines.map((l) => [l.name, l.qty])).toEqual([["Pan 40", 6], ["Cough syrup", 3]]);
    addToDraft(db, lines);
    addToDraft(db, [{ ...lines[0], qty: 4 }, { medicineId: "x", name: "Azee 500", unit: "strip", qty: 2, ratePaise: 7000, supplierId: null }]);
    expect(getDraft(db).lines.find((l) => l.medicineId === b.id)!.qty).toBe(6);
    const g = draftGroups(db);
    expect(g.map((x) => x.supplier)).toEqual(["Agency One", "Agency Two", null]);
    expect(g[0]).toMatchObject({ supplierId: s1.id, phone: "9822000001", valuePaise: 18000 });
    const text = orderText(g[0], { name: "Asha Medicals", tradeName: "", gstin: "", dl: "", address: "", phone: "020 1234" });
    expect(text).toContain("Order from Asha Medicals");
    expect(text).toContain("1. Cough syrup × 3 bottles");
    expect(text).toContain("Call 020 1234");
    expect(draftCsv(g)[0]).toEqual(["Supplier", "Medicine", "Quantity", "Unit", "Rate (₹)", "Value (₹)"]);
    expect(draftCsv(g)).toContainEqual(["Agency Two", "Pan 40", 6, "pack", "15.00", "90.00"]);
    expect(() => saveDraft(db, [{ ...lines[0], qty: 0 }])).toThrow(/1 or more/);
    expect(saveDraft(db, []).lines).toEqual([]);
    expect(linesFor(db, B, [{ medicineId: b.id, qty: 5 }, { medicineId: "gone", qty: 1 }])).toEqual([{ medicineId: b.id, name: "Pan 40", unit: "pack", qty: 5, ratePaise: 1500, supplierId: g[1].supplierId }]);
  });
});

describe("supplier prices, slow stock and margins", () => {
  it("compares the latest landed rate per supplier", () => {
    const { a } = shop();
    const p = priceComparison(db);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ name: "Dolo 650", best: "Agency Two", savingPct: 10 });
    expect(p[0].quotes.map((q) => [q.supplier, q.rate])).toEqual([["Agency Two", 1800], ["Agency One", 2000]]);
    expect(a.id).toBeTruthy();
  });

  it("finds dead and slow stock after 30 days on the shelf", () => {
    const { a, b } = shop();
    sell(a.id, 2);
    const later = new Date(Date.now() + 40 * 86400_000);
    const slow = slowStock(db, B, { now: later });
    expect(slow.find((x) => x.id === b.id)).toMatchObject({ kind: "dead", packs: 4, value: 6000 });
    expect(slow.find((x) => x.id === a.id)).toMatchObject({ kind: "slow", packs: 48 });
    expect(slowStock(db, B)).toEqual([]); // nothing has been on the shelf 30 days yet
  });

  it("margins on landed cost, net of returns, by item, category and supplier", () => {
    const { b } = shop();
    const s = sell(b.id, 3);
    const item = db.from<{ id: string }>("saleItem").eq("saleId", s.saleId).first()!.id;
    createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] });
    const from = addDays(todayISO(), -29) + "T00:00:00.000Z", to = new Date(Date.now() + 1000).toISOString();
    const [row] = salesMargins(db, B, from, to, "item");
    // 2 kept at ₹155 incl. 12% GST = ₹138.39 ex-GST each; cost ₹30 a pack, halved by the free packs.
    expect(row).toMatchObject({ name: "Pan 40", qty: 2, sales: 27679, cost: 3000 });
    expect(salesMargins(db, B, from, to, "supplier")[0].name).toBe("Agency Two");
    expect(salesMargins(db, B, from, to, "category")[0].name).toBe("Tablet");
    const st = stockMargins(db, B).find((x) => x.id === b.id)!;
    expect(st).toMatchObject({ qty: 2, cost: 3000 });
  });
});

describe("anomalies", () => {
  it("flags big discounts, many refunds, count differences, rate rises and night bills; reviews stick", () => {
    const { a } = shop();
    sell(a.id, 1, { discountPct: 10 });
    for (let i = 0; i < 3; i++) {
      const s = sell(a.id, 1);
      const item = db.from<{ id: string }>("saleItem").eq("saleId", s.saleId).first()!.id;
      createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "x", condition: "opened", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] });
    }
    const batch = db.from<{ id: string }>("batch").eq("batchNo", "P1-0").first()!.id;
    recordCount(db, { branchId: B, userId: U, counts: [{ batchId: batch, counted: 0 }] }); // 30+ strips at ₹20 missing
    at(2, 12); // 11:30 pm in India
    sell(a.id, 1);
    const list = anomalies(db, B, { disc: 5, refunds: 2 });
    const rules = list.map((x) => x.rule).sort();
    expect(rules).toEqual(["cost", "count", "disc", "night", "refunds"]);
    expect(list.find((x) => x.rule === "cost")!.vars).toMatchObject({ name: "Dolo 650", prev: 1800, cur: 2000 });
    expect(list.find((x) => x.rule === "refunds")!.vars).toMatchObject({ n: 3 });
    expect(anomalies(db, B, { disc: 20, refunds: 5 }).map((x) => x.rule).sort()).toEqual(["cost", "count", "night"]);
    const disc = list.find((x) => x.rule === "disc")!;
    markReviewed(db, disc.key, "Discount", "Owner");
    expect(anomalies(db, B, { disc: 5, refunds: 2 }).find((x) => x.key === disc.key)!.reviewed).toMatchObject({ by: "Owner" });
    // A week later nothing is flagged.
    expect(anomalies(db, B, { disc: 5, refunds: 2 }, new Date(Date.now() + 8 * 86400_000))).toEqual([]);
  });
});

describe("seasonal pre-stock", () => {
  it("needs 12 months of bills, then finds items that sell above average in a coming month", () => {
    const { b } = shop();
    sell(b.id, 3);
    expect(seasonal(db, B).ready).toBe(false);
    // Twenty months on, the month of that sale is two months ahead.
    const now = new Date(Date.UTC(2028, 7, 15, 6)), target = 9; // Oct, the sale's month in India
    const r = seasonal(db, B, now, todayISO());
    expect(r.ready).toBe(true);
    expect(r.targets).toContain(target);
    expect(r.plans[target].map((x) => x.name)).toEqual(["Pan 40"]);
    expect(r.plans[target][0].lift).toBeGreaterThan(100);
  });
});

describe("the screen", () => {
  it("returns every section in one call", () => {
    shop();
    const d = insights(db, B, { branches: [{ id: B, name: "Main" }] });
    expect(Object.keys(d).sort()).toEqual(["anomalies", "central", "forecast", "margins", "prices", "settings", "slow"]);
    expect(d.central).toBeNull();
  });
});
