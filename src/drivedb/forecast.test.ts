import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale } from "./pharmacy";
import { addSupplier, recordPurchase } from "./trade";
import { deviceAccuracy, deviceForecast, forecastScreen, snapshotIfDue } from "./forecast";
import { fit, horizon } from "@/domain/intelligence/forecast-model";
import { todayISO } from "@/lib/dates";

const B = "b1", U = "u1";
let db: DriveDB;
// Only Date is faked: day 0 is Thursday 1 Oct 2026, 11:30 am in India.
const T0 = new Date("2026-10-01T06:00:00.000Z");
const at = (days: number) => vi.setSystemTime(new Date(T0.getTime() + days * 86400_000));
beforeEach(async () => { db = await memoryDb("C1"); vi.useFakeTimers({ toFake: ["Date"] }); at(0); });
afterEach(() => vi.useRealTimers());

const qtyOn = (day: number) => 3 + (day % 7 === 5 ? 4 : 0); // a steady 3 a day, 7 on every sixth day of the cycle

function shop() {
  const sup = addSupplier(db, { name: "Agency One", phone: "9822000001" });
  const dolo = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200, packSize: 15, packUnit: "strip", form: "Tablet" });
  const pan = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500, form: "Tablet" });
  const rare = addMedicine(db, { name: "Rare tonic", gstRate: 12, mrpPaise: 9000, form: "Syrup" });
  recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "P1", billDate: todayISO(), userId: U, lines: [
    { medicineId: dolo.id, batchNo: "D1", expiryDate: "2030-01-31", packs: 600, costPaise: 2000, mrpPaise: 3200 },
    { medicineId: pan.id, batchNo: "P1", expiryDate: "2030-01-31", packs: 20, costPaise: 9000, mrpPaise: 15500 },
    { medicineId: rare.id, batchNo: "R1", expiryDate: "2030-01-31", packs: 10, costPaise: 5000, mrpPaise: 9000 },
  ] });
  for (let d = 0; d < 60; d++) {
    at(d);
    createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: dolo.id, qty: qtyOn(d) }], pay: { mode: "cash" } });
    if (d < 20) createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: pan.id, qty: 1 }], pay: { mode: "cash" } });
    if (d === 58) createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: rare.id, qty: 1 }], pay: { mode: "cash" } });
  }
  at(60);
  return { dolo, pan, rare };
}

describe("device demand forecast", () => {
  it("gives the same numbers as the shared model for the same bills, with a range", () => {
    const { dolo } = shop();
    const f = deviceForecast(db, B);
    const row = f.rows.find((r) => r.medicineId === dolo.id)!;
    const series = Array.from({ length: 60 }, (_, d) => qtyOn(d)); // days 0..59, ending yesterday
    const m = fit(series, 4)!; // 1 Oct 2026 is a Thursday
    const h7 = horizon(m, 7, new Date("2026-11-30T00:00:00Z").getUTCDay());
    expect(row.week.point).toBeCloseTo(Math.round(h7.total * 10) / 10, 5);
    expect(row.week.lo).toBeLessThanOrEqual(row.week.point);
    expect(row.week.hi).toBeGreaterThanOrEqual(row.week.point);
    expect(row.histDays).toBe(60);
    expect(row.leadSource).toBe("counter default");
    expect(row.leadDays).toBe(1);
    expect(row.inbound).toBe(0);
  });

  it("recommends a reorder for an item that has run out, with the reason and the last supplier", () => {
    const { pan } = shop();
    const row = deviceForecast(db, B).rows.find((r) => r.medicineId === pan.id)!;
    expect(row.stock).toBe(0);
    expect(row.rec?.qty).toBeGreaterThan(0);
    expect(row.rec?.reason).toMatch(/0 in stock/);
    expect(row.supplier).toBe("Agency One");
  });

  it("gives no forecast, and counts it, for an item without enough history", () => {
    const { rare } = shop();
    const f = deviceForecast(db, B);
    expect(f.rows.some((r) => r.medicineId === rare.id)).toBe(false);
    expect(f.insufficient).toBe(1);
  });

  it("changes nothing when it only reads, and saves one snapshot a week when opened", () => {
    shop();
    const before = db.getMeta("forecast:snaps");
    deviceForecast(db, B);
    expect(db.getMeta("forecast:snaps")).toBe(before);
    expect(forecastScreen(db, B).snapshotSaved).toBe(true);
    expect(forecastScreen(db, B).snapshotSaved).toBe(false); // same week
    at(66);
    expect(snapshotIfDue(db, B, deviceForecast(db, B))).toBe(false); // 6 days later, still the same week
    at(67);
    expect(snapshotIfDue(db, B, deviceForecast(db, B))).toBe(true);
  });

  it("scores a saved forecast against what sold once its week is over, and never before", () => {
    const { dolo } = shop();
    forecastScreen(db, B); // saved on day 60
    expect(deviceAccuracy(db, B).overall.items).toBe(0);
    expect(deviceAccuracy(db, B).pendingWeeks).toBe(1);
    for (let d = 60; d < 68; d++) {
      at(d);
      createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: dolo.id, qty: qtyOn(d) }], pay: { mode: "cash" } });
    }
    at(68);
    const acc = deviceAccuracy(db, B);
    expect(acc.pendingWeeks).toBe(0);
    expect(acc.overall.items).toBeGreaterThan(0);
    expect(acc.overall.wape).not.toBeNull();
    expect(acc.weeks[0].generatedOn).toBe("2026-11-30");
  });
});
