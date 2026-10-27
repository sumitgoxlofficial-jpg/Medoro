import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine, medicineDetail, receiveBatch, setQuarantine, updateMedicine } from "@/domain/inventory/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const med = { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15 tabs", mrp: "33.60", gstRate: 12, schedule: "" as const, reorderLevel: 50, barcode: "8901234510011", hsn: "3004", rack: "" };
const future = addDays(todayISO(), 400).slice(0, 7);

describe("inventory", () => {
  let medId = "";
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("creates a medicine and rejects duplicates and bad input", async () => {
    const ctx = await ctxFor();
    medId = await createMedicine(ctx, med);
    await expect(createMedicine(ctx, med)).rejects.toThrow(/already/);
    await expect(createMedicine(ctx, { ...med, name: "X", mrp: "0" })).rejects.toThrow(/MRP/);
    await expect(createMedicine(await ctxFor("Cashier"), { ...med, name: "Other" })).rejects.toThrow(/role/);
  });

  it("receives opening stock and enforces batch rules", async () => {
    const ctx = await ctxFor();
    const base = { medicineId: medId, batchNo: "dl25012", expiry: future, qty: 20, cost: "24", mrp: "33.60", supplierId: null, invoiceNo: "" };
    await receiveBatch(ctx, base);
    await expect(receiveBatch(ctx, base)).rejects.toThrow(/already exists/);
    await expect(receiveBatch(ctx, { ...base, batchNo: "OLD1", expiry: addDays(todayISO(), -1) })).rejects.toThrow(/future/);
    await expect(receiveBatch(ctx, { ...base, batchNo: "B2", cost: "40" })).rejects.toThrow(/above MRP/);
    const d = await medicineDetail(ctx, medId);
    expect(d!.sellable).toBe(20);
    expect(d!.batches[0].batchNo).toBe("DL25012");
    expect(d!.batches[0].expiry.endsWith(String(new Date(Date.UTC(+future.slice(0, 4), +future.slice(5, 7), 0)).getUTCDate()))).toBe(true);
    expect(d!.moves[0]).toMatchObject({ type: "opening", qty: 20 });
    // Stock is per branch.
    expect((await medicineDetail(await ctxFor("Owner", "Second"), medId))!.sellable).toBe(0);
  });

  it("posts a GRN with a balanced purchase voucher and a supplier bill", async () => {
    const ctx = await ctxFor();
    const s = await db.supplier.create({ data: { tenantId: ctx.tenantId, name: "Mahavir Medical", creditDays: 30 } });
    const r = await receiveBatch(ctx, { medicineId: medId, batchNo: "DL9", expiry: future, qty: 10, cost: "22.40", mrp: "33.60", supplierId: s.id, invoiceNo: "MMA/1" });
    expect(r.grnNo).toMatch(/^GRN-\d{4}-0001$/);
    const v = await db.voucher.findFirstOrThrow({ where: { refId: (await db.grn.findFirstOrThrow()).id }, include: { lines: true } });
    const dr = v.lines.reduce((a, l) => a + Number(l.debitPaise), 0), cr = v.lines.reduce((a, l) => a + Number(l.creditPaise), 0);
    expect(dr).toBe(22400); expect(cr).toBe(22400);
    expect(v.lines.find((l) => l.account === "Purchases")!.debitPaise).toBe(20000n);
    const bill = await db.supplierBill.findFirstOrThrow({ where: { supplierId: s.id } });
    expect(bill.amountPaise).toBe(22400n);
    await expect(receiveBatch(ctx, { medicineId: medId, batchNo: "DL10", expiry: future, qty: 1, cost: "1", mrp: "33.60", supplierId: s.id, invoiceNo: "MMA/1" })).rejects.toThrow(/already posted/);
  });

  it("quarantine blocks sale and is logged; pharmacist can, cashier cannot", async () => {
    const ctx = await ctxFor("Pharmacist");
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "DL25012" } });
    await expect(setQuarantine(await ctxFor("Cashier"), b.id, true, "x")).rejects.toThrow(/role/);
    await setQuarantine(ctx, b.id, true, "Damaged carton");
    expect((await medicineDetail(ctx, medId))!.sellable).toBe(10);
    await expect(setQuarantine(ctx, b.id, true, "again")).rejects.toThrow(/already blocked/);
    await setQuarantine(ctx, b.id, false, "");
    expect((await medicineDetail(ctx, medId))!.sellable).toBe(30);
    const mv = await db.stockMovement.findMany({ where: { batchId: b.id }, orderBy: { at: "asc" } });
    expect(mv.map((m) => m.type)).toEqual(["opening", "quarantine", "release"]);
  });

  it("rejects stale edits", async () => {
    const ctx = await ctxFor();
    await updateMedicine(ctx, medId, 0, { ...med, reorderLevel: 60 });
    await expect(updateMedicine(ctx, medId, 0, { ...med, reorderLevel: 70 })).rejects.toThrow(/Someone else/);
  });

  it("never lets stock go negative or movements be edited", async () => {
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "DL25012" } });
    await expect(db.batch.update({ where: { id: b.id }, data: { qtyAvailable: -1 } })).rejects.toThrow();
    const mv = await db.stockMovement.findFirstOrThrow({ where: { batchId: b.id } });
    await expect(db.stockMovement.update({ where: { id: mv.id }, data: { qty: 999 } })).rejects.toThrow(/append-only/);
  });
});
