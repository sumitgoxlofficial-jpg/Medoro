import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { createEstimate, estimateData, listEstimates, setEstimateStatus } from "@/domain/sales/estimate";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let dolo = "", plain = "";

describe("estimates (quotations)", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", schedule: "" as const };
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60" });
    plain = await createMedicine(ctx, { ...base, name: "Cetzine", generic: "Cetirizine", strength: "10 mg", mrp: "20" });
    await receiveBatch(ctx, { medicineId: dolo, batchNo: "D1", expiry: addDays(todayISO(), 300), qty: 50, cost: "20", mrp: "35", supplierId: null, invoiceNo: "" });
  });

  it("prices at the batch MRP (else the catalogue MRP), numbers itself, and touches no stock or books", async () => {
    const ctx = await ctxFor("Cashier");
    const stockBefore = await db.batch.findMany({ select: { id: true, qtyAvailable: true } });
    const salesBefore = await db.sale.count(), vouchersBefore = await db.voucher.count();
    const a = await createEstimate(ctx, { customerName: "Ravi", phone: "+91 98220 41736", validDays: 5, notes: "Monthly", lines: [{ medicineId: dolo, qty: 3 }, { medicineId: plain, qty: 2 }] });
    const b = await createEstimate(ctx, { lines: [{ medicineId: plain, qty: 1 }] });
    expect([a.no, b.no]).toEqual(["EST-0001", "EST-0002"]);
    const d = (await estimateData(ctx, a.id))!;
    expect(d.lines.map((l) => [l.name, l.mrpPaise, l.amountPaise])).toEqual([["Dolo 650", 3500, 10500], ["Cetzine", 2000, 4000]]); // batch MRP 35, catalogue MRP 20
    expect(d).toMatchObject({ total: 14500, phone: "9822041736", status: "open", customerName: "Ravi" });
    expect(d.validUntil).toBe(addDays(todayISO(), 5));
    expect(await db.batch.findMany({ select: { id: true, qtyAvailable: true } })).toEqual(stockBefore);
    expect(await db.sale.count()).toBe(salesBefore);
    expect(await db.voucher.count()).toBe(vouchersBefore);
  });

  it("validates input, searches, closes and reopens, expires by date, and stays inside the pharmacy", async () => {
    const ctx = await ctxFor("Cashier");
    await expect(createEstimate(ctx, { lines: [] })).rejects.toThrow(/at least one/i);
    await expect(createEstimate(ctx, { phone: "123", lines: [{ medicineId: dolo, qty: 1 }] })).rejects.toThrow(/10-digit/);
    await expect(createEstimate(ctx, { lines: [{ medicineId: randomUUID(), qty: 1 }] })).rejects.toThrow(/catalogue/);
    expect((await listEstimates(ctx, { q: "ravi" })).map((e) => e.no)).toEqual(["EST-0001"]);
    expect((await listEstimates(ctx)).map((e) => e.no)).toEqual(["EST-0002", "EST-0001"]);
    const [first] = await listEstimates(ctx, { q: "EST-0001" });
    await setEstimateStatus(ctx, first.id, "billed");
    expect((await listEstimates(ctx, { q: "EST-0001" }))[0].status).toBe("billed");
    await setEstimateStatus(ctx, first.id, "open");
    await db.estimate.update({ where: { id: first.id }, data: { validUntil: new Date(addDays(todayISO(), -1) + "T00:00:00Z") } });
    expect((await listEstimates(ctx, { q: "EST-0001" }))[0].status).toBe("expired");
    // Another pharmacy sees nothing and can't change it.
    expect(await estimateData({ ...ctx, tenantId: randomUUID() }, first.id)).toBeNull();
    await expect(setEstimateStatus({ ...ctx, tenantId: randomUUID() }, first.id, "cancelled")).rejects.toThrow(/not found/);
  });
});
