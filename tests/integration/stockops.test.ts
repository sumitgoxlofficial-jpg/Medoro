import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { approveTransfer, postCount, receiveTransfer, requestTransfer, returnToSupplier, writeOff } from "@/domain/inventory/adjust";
import { addRecall, listRecalls, quarantineRecall } from "@/domain/inventory/recalls";
import { anomalies, expiryRows, forecast } from "@/domain/intelligence/service";
import { commitSale } from "@/domain/sales/service";
import { listSuppliers, saveSupplier } from "@/domain/parties/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let med = "", sup = "", b1 = "", b2 = "";
const key = () => "k_" + randomUUID().replace(/-/g, "");

describe("stock operations and intelligence", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    sup = await saveSupplier(ctx, null, { name: "Pune Pharma", creditDays: "21", leadDays: "2" });
    med = await createMedicine(ctx, { name: "Okacet", generic: "Cetirizine", strength: "10 mg", form: "Tablet", manufacturer: "Cipla", pack: "10", mrp: "21", gstRate: 12, schedule: "", reorderLevel: 30, barcode: "", hsn: "3004", rack: "A-1" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "OK1", expiry: addDays(todayISO(), 45).slice(0, 10), qty: 40, cost: "13.50", mrp: "21", supplierId: sup, invoiceNo: "PP/1" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "OK2", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 20, cost: "13.50", mrp: "21", supplierId: null, invoiceNo: "" });
    b1 = (await db.batch.findFirstOrThrow({ where: { batchNo: "OK1" } })).id;
    b2 = (await db.batch.findFirstOrThrow({ where: { batchNo: "OK2" } })).id;
  });

  it("count adjusts against the quantity at posting time, so re-posting the same count is a no-op", async () => {
    const ctx = await ctxFor("Pharmacist");
    await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: b1, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const r = await postCount(ctx, { lines: [{ batchId: b1, counted: 35 }] });
    expect(r.changed).toBe(1);
    expect((await db.batch.findUniqueOrThrow({ where: { id: b1 } })).qtyAvailable).toBe(35); // 38 after sale, −3 short
    expect((await postCount(ctx, { lines: [{ batchId: b1, counted: 35 }] })).changed).toBe(0);
    expect((await db.batch.findUniqueOrThrow({ where: { id: b1 } })).qtyAvailable).toBe(35);
    const j = await db.voucher.findFirstOrThrow({ where: { refType: "stock_count" }, include: { lines: true } });
    expect(j.lines.find((l) => l.account === "Stock loss")!.debitPaise).toBe(4050n);
    await expect(postCount(await ctxFor("Cashier"), { lines: [{ batchId: b1, counted: 1 }] })).rejects.toThrow(/role/);
  });

  it("supplier return reduces stock and payable; write-off posts stock loss; opening stock can't be returned", async () => {
    const ctx = await ctxFor();
    const before = (await listSuppliers(ctx))[0].balance;
    const no = await returnToSupplier(ctx, b1, 5, "Near expiry");
    expect(no).toMatch(/^DN-/);
    expect((await listSuppliers(ctx))[0].balance).toBe(before - 5 * 1350 - Math.round(5 * 1350 * 0.12));
    await expect(returnToSupplier(ctx, b2, 1, "x")).rejects.toThrow(/opening stock/);
    await writeOff(ctx, b2, 1, "Damaged strip");
    expect((await db.batch.findUniqueOrThrow({ where: { id: b2 } })).qtyAvailable).toBe(19);
  });

  it("transfers move stock between branches in two steps", async () => {
    const ctx = await ctxFor();
    const second = ctx.branches.find((b) => b.name === "Second")!.id;
    await requestTransfer(ctx, b2, second, 4);
    const t = await db.transfer.findFirstOrThrow();
    expect((await db.batch.findUniqueOrThrow({ where: { id: b2 } })).qtyAvailable).toBe(19);
    await approveTransfer(ctx, t.id);
    expect((await db.batch.findUniqueOrThrow({ where: { id: b2 } })).qtyAvailable).toBe(15);
    await expect(approveTransfer(ctx, t.id)).rejects.toThrow(/pending/);
    await receiveTransfer(ctx, t.id);
    const dest = await db.batch.findFirstOrThrow({ where: { branchId: second, batchNo: "OK2" } });
    expect(dest.qtyAvailable).toBe(4);
  });

  it("recalls match batches across branches and quarantine them", async () => {
    const ctx = await ctxFor();
    await addRecall(ctx, { product: "Okacet 10 mg", batches: "ok2, ZZ9", source: "Manufacturer notice 12/2026", publishedAt: todayISO(), reason: "Labelling" });
    let r = (await listRecalls(ctx))[0];
    expect(r.matches.filter((m) => m.sellable)).toHaveLength(2);
    expect(await quarantineRecall(ctx, r.id)).toBe(2);
    r = (await listRecalls(ctx))[0];
    expect(r.matches.every((m) => m.status === "quarantine")).toBe(true);
    expect(r.status).toBe("investigating");
  });

  it("forecasts reorders, projects expiry loss and flags big discounts", async () => {
    const ctx = await ctxFor();
    const f = (await forecast(ctx, { cover: 21, safety: 2 }))[0];
    expect(f.stock).toBe(30); // OK1 only; OK2 quarantined
    expect(f.suggestion).toBe(0); // exactly at the reorder level and above the reorder point
    const e = await expiryRows(ctx, 60);
    expect(e.rows[0]).toMatchObject({ batchNo: "OK1", qty: 30 });
    expect(e.rows[0].rec.kind).toBe("return");
    await commitSale(await ctxFor("Manager"), { idempotencyKey: key(), lines: [{ medicineId: med, batchId: b1, qty: 1 }], customerId: null, discountPct: 15, pay: { mode: "cash" } });
    expect((await forecast(ctx, { cover: 21, safety: 2 }))[0].suggestion).toBeGreaterThan(0); // 29 < 30
    const a = await anomalies(ctx, { disc: 5, refunds: 2, cash: 200 });
    expect(a.some((x) => x.rule.startsWith("Discount above"))).toBe(true);
  });
});
