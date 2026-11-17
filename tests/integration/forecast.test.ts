import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { createPo, setPoStatus } from "@/domain/purchasing/service";
import { saveSupplier } from "@/domain/parties/service";
import { draftForecastOrders, forecastAccuracy, forecastIntel, snapshotForecasts } from "@/domain/intelligence/forecast-intel";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const base = { form: "Tablet" as const, manufacturer: "Alkem", pack: "10", schedule: "" as const, reorderLevel: 0, barcode: "", hsn: "3004", rack: "", gstRate: 12 };
let steady = "", sparse = "", expiring = "", supplier = "";

/** A real bill, moved back `daysAgo` days (sales are append-only, so the trigger is bypassed for the date only). */
async function sellBack(medicineId: string, qty: number, daysAgo: number) {
  const c = await ctxFor("Manager");
  const batch = await db.batch.findFirstOrThrow({ where: { medicineId, branchId: c.branchId, qtyAvailable: { gte: qty } }, orderBy: { expiryDate: "desc" } });
  const s = await commitSale(c, { idempotencyKey: key(), lines: [{ medicineId, batchId: batch.id, qty }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
  await db.$transaction([db.$executeRaw`SET LOCAL session_replication_role = replica`, db.$executeRaw`UPDATE "Sale" SET at = ${new Date(Date.now() - daysAgo * 86400_000)} WHERE id = ${s.saleId}`]);
}

describe("forecasting", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const own = await ctxFor();
    supplier = await saveSupplier(own, null, { name: "Fast Pharma", creditDays: "15", leadDays: "2" });
    steady = await createMedicine(own, { ...base, name: "Steady Tab", generic: "Steadyne", strength: "10 mg", mrp: "100" });
    sparse = await createMedicine(own, { ...base, name: "Sparse Tab", generic: "Sparsene", strength: "5 mg", mrp: "50" });
    expiring = await createMedicine(own, { ...base, name: "Slow Tab", generic: "Slowne", strength: "20 mg", mrp: "60" });
    const m = await ctxFor("Manager");
    const recv = (medicineId: string, qty: number, expiry: string, no: string) => receiveBatch(m, { medicineId, batchNo: no, expiry, qty, cost: "40", mrp: "100", supplierId: supplier, invoiceNo: "INV-" + no, acceptShortExpiry: true });
    await recv(steady, 400, addDays(todayISO(), 400), "S1");
    await recv(sparse, 50, addDays(todayISO(), 400), "P1");
    await recv(expiring, 80, addDays(todayISO(), 400), "L1");
    for (let d = 60; d >= 1; d--) {
      await sellBack(steady, d % 2 ? 2 : 4, d);          // averages 3 packs a day
      await sellBack(expiring, 1, d);                     // 1 pack a day
    }
    await sellBack(sparse, 1, 40); await sellBack(sparse, 1, 12);   // two sales in 60 days: no pattern
    // Left on the shelf: steady 400 − 180 = 220 → bring down to 20 by writing nothing off; instead use a smaller receipt below
    await recv(expiring, 100, addDays(todayISO(), 20), "E20");
  });

  it("forecasts from real bills, with an interval, history and a measured track record, and refuses sparse items", async () => {
    const f = await forecastIntel(await ctxFor());
    const a = f.rows.find((r) => r.name.startsWith("Steady Tab"))!;
    expect(a).toBeDefined();
    expect(a.histDays).toBeGreaterThanOrEqual(58);
    expect(a.tomorrow.point).toBeGreaterThan(1.5); expect(a.tomorrow.point).toBeLessThan(4.5);
    expect(a.week.point).toBeGreaterThan(17); expect(a.week.point).toBeLessThan(25);
    expect(a.week.lo).toBeLessThan(a.week.point); expect(a.week.hi).toBeGreaterThan(a.week.point);
    expect(a.month.point).toBeGreaterThan(80); expect(a.month.point).toBeLessThan(100);
    expect(a.weeklyActuals.length).toBeGreaterThanOrEqual(7);
    expect(a.weeklyActuals.every((w) => w >= 18 && w <= 24)).toBe(true);          // what really sold, week by week
    expect(a.backtest.weeks).toBe(4);                                              // 60 days of history allows four 7-day tests, each needing 28 days before it
    expect(a.backtest.wape).toBeLessThan(0.15);
    expect(["medium", "high"]).toContain(a.confidence);
    expect(a.confidence).not.toBe("high");                                          // fewer than 90 days of history can't earn "high"
    expect(f.rows.find((r) => r.name.startsWith("Sparse Tab"))).toBeUndefined();   // two sales: no forecast, not a forecast of zero
    expect(f.insufficient).toBe(1);
    expect(f.portfolio.items).toBeGreaterThanOrEqual(2);
    expect(f.portfolio.wape).toBeLessThan(0.2);
  });

  it("predicts a stockout and recommends a reorder with its reasoning, counting stock on order", async () => {
    const own = await ctxFor("Manager");
    // 20 packs would last a week, but the 2-day lead time means it is not reorder time yet: only 8 packs is
    const b = await db.batch.findFirstOrThrow({ where: { medicineId: steady } });
    await db.batch.update({ where: { id: b.id }, data: { qtyAvailable: 20 } });
    let a = (await forecastIntel(own)).rows.find((r) => r.name.startsWith("Steady Tab"))!;
    expect(a.stockout.point).toBeGreaterThanOrEqual(6);
    expect(a.rec).toBeNull();                                                      // above the reorder point: the engine does not over-order
    await db.batch.update({ where: { id: b.id }, data: { qtyAvailable: 8 } });
    a = (await forecastIntel(own)).rows.find((r) => r.name.startsWith("Steady Tab"))!;
    expect(a.stock).toBe(8);
    expect(a.stockout.point).toBeGreaterThanOrEqual(2); expect(a.stockout.point).toBeLessThanOrEqual(4);
    expect(a.stockout.early!).toBeLessThanOrEqual(a.stockout.point!);
    expect(a.stockout.late!).toBeGreaterThanOrEqual(a.stockout.point!);
    expect(a.leadDays).toBe(2); expect(a.leadSource).toBe("supplier setting");    // too few past orders to call a lead time "observed"
    expect(a.rec).not.toBeNull();
    expect(a.rec!.qty).toBeGreaterThan(40);
    expect(a.rec!.reason).toMatch(/reorder point/);
    expect(a.rec!.reason).toMatch(/8 in stock/);
    expect(a.supplier).toBe("Fast Pharma");
    // an order already placed counts as stock on the way
    const po = await createPo(own, { supplierId: supplier, lines: [{ medicineId: steady, qty: 300, rate: 40 }] });
    await setPoStatus(own, po.id, "place");
    a = (await forecastIntel(own)).rows.find((r) => r.name.startsWith("Steady Tab"))!;
    expect(a.inbound).toBe(300);
    expect(a.rec).toBeNull();                                                      // 320 on hand and on order is plenty
    await setPoStatus(own, po.id, "cancel", "test reset");
  });

  it("estimates expiry loss from the forecast, first-expiry-first-out", async () => {
    const r = (await forecastIntel(await ctxFor())).rows.find((x) => x.name.startsWith("Slow Tab"))!;
    expect(r.expiry.unsoldPacks).toBeGreaterThan(65);                              // ~100 packs expiring in 20 days at about 1 a day
    expect(r.expiry.unsoldPacks).toBeLessThan(90);
    expect(r.expiry.valuePaise).toBeGreaterThan(65 * 4000);
    expect(r.expiry.batches[0]).toMatchObject({ batchNo: "E20" });
    expect(r.expiry.batches[0].days).toBe(20);
  });

  it("drafts purchase orders from the recommendations, never places them, and says they are estimates", async () => {
    const own = await ctxFor("Manager");
    const out = await draftForecastOrders(own, null, null);
    expect(out.orders).toHaveLength(1);
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { no: out.orders[0] }, include: { items: true } });
    expect(po.status).toBe("draft");
    expect(po.source).toBe("forecast");
    // The order itself has no note column; its source is shown as "from forecast" in the PO list and the audit trail keeps the warning.
    const created = await db.auditEvent.findFirstOrThrow({ where: { action: "Draft PO created", entityId: po.id } });
    expect(created.detail).toContain("Statistical estimate, review before placing");
    expect(po.items.find((i) => i.medicineId === steady)!.qty).toBeGreaterThan(40);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "Forecast draft orders created" } });
    expect(audit.detail).toContain(out.orders[0]);
    await expect(draftForecastOrders(await ctxFor("Pharmacist"), null, null)).rejects.toThrow();   // needs the purchase permission
  });

  it("tracks accuracy: snapshots are stored once a week, can't be edited, and are scored against what sold", async () => {
    const t = (await ctxFor()).tenantId, main = (await ctxFor()).branchId;
    const tenDaysAgo = new Date(Date.now() - 10 * 86400_000);
    const n = await snapshotForecasts(t, main, tenDaysAgo);
    expect(n).toBeGreaterThanOrEqual(2);                                           // steady and slow items
    expect(await snapshotForecasts(t, main, tenDaysAgo)).toBe(0);                  // not again within the week
    const snap = await db.forecastSnapshot.findFirstOrThrow();
    await expect(db.forecastSnapshot.update({ where: { id: snap.id }, data: { predicted: 1 } })).rejects.toThrow();
    const acc = await forecastAccuracy(await ctxFor());
    expect(acc.weeks).toHaveLength(1);
    expect(acc.overall.items).toBe(n);
    expect(acc.overall.wape).toBeLessThan(0.25);
    expect(acc.overall.coverage).not.toBeNull();
    // a snapshot made today has no verdict yet and is reported as pending, not as accurate
    await snapshotForecasts(t, main, new Date());
    expect((await forecastAccuracy(await ctxFor())).pendingWeeks).toBe(1);
  });

  it("is per branch, limited to the user's branches, and needs a permission", async () => {
    const own = await ctxFor();
    const second = own.branches.find((b) => b.name === "Second")!;
    expect((await forecastIntel(own, second.id)).rows).toHaveLength(0);
    await expect(forecastIntel({ ...own, branches: own.branches.filter((b) => b.name === "Main") }, second.id)).rejects.toThrow(/access/);
    await expect(forecastIntel(await ctxFor("Cashier"))).rejects.toThrow();
    await expect(forecastIntel(await ctxFor("Accountant"))).resolves.toBeDefined();   // reports permission may look
    await expect(forecastAccuracy(await ctxFor("Cashier"))).rejects.toThrow();
  });
});
