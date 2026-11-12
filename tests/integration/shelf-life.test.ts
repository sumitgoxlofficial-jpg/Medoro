import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { postGrnTx } from "@/domain/purchasing/service";
import { DEFAULT_MIN_SHELF_DAYS, rulesOf } from "@/domain/purchasing/pricing";
import { saveSupplier } from "@/domain/parties/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let sup = "", med = "", tenantId = "";
const line = (batchNo: string, days: number) => ({ medicineId: med, batchNo, expiry: addDays(todayISO(), days), qty: 10, freeQty: 0, rate: "20", mrp: "33", poItemId: null });
const bill = (no: string, lines: ReturnType<typeof line>[], acceptShortExpiry = false) => ({ supplierId: sup, invoiceNo: no, invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null, acceptShortExpiry, lines });

describe("short-dated stock on purchases", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor(); tenantId = ctx.tenantId;
    sup = await saveSupplier(ctx, null, { name: "Mahavir", creditDays: "30" });
    med = await createMedicine(ctx, { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", gstRate: 12 });
  });

  it("reads the minimum from the pharmacy's settings, 180 days unless set", () => {
    expect(DEFAULT_MIN_SHELF_DAYS).toBe(180);
    expect(rulesOf(null).minShelfDays).toBe(180);
    expect(rulesOf({ purchasing: { minShelfDays: 90 } }).minShelfDays).toBe(90);
    expect(rulesOf({ purchasing: { minShelfDays: 0 } }).minShelfDays).toBe(0); // off
    expect(rulesOf({ purchasing: { minShelfDays: -5 } }).minShelfDays).toBe(180);
    expect(rulesOf({ purchasing: { minShelfDays: 9999 } }).minShelfDays).toBe(180);
  });

  it("refuses a bill with a short-dated line unless the person accepts it", async () => {
    const ctx = await ctxFor("Manager");
    await expect(postGrnTx(ctx, bill("SD/1", [line("S1", 60), line("L1", 400)]))).rejects.toThrow(/1 line has less than 180 days of shelf life: Dolo 650 \(60 days left\)/);
    expect(await db.batch.count({ where: { tenantId, batchNo: { in: ["S1", "L1"] } } })).toBe(0); // nothing was received
    await postGrnTx(ctx, bill("SD/2", [line("L2", 400)])); // long-dated is fine
    const r = await postGrnTx(ctx, bill("SD/3", [line("S3", 60)], true)); // knowingly
    expect(r.grnNo).toMatch(/^GRN/);
    const audit = await db.auditEvent.findFirst({ where: { tenantId, action: "Short-dated stock accepted" } });
    expect(audit?.detail).toContain("S3");
  });

  it("applies to Inventory's receive form when a supplier bill is used, but not to opening stock", async () => {
    const ctx = await ctxFor("Manager");
    const base = { medicineId: med, qty: 5, cost: "20", mrp: "33" };
    await expect(receiveBatch(ctx, { ...base, batchNo: "R1", expiry: addDays(todayISO(), 45), supplierId: sup, invoiceNo: "SD/4" })).rejects.toThrow(/short-dated/);
    await receiveBatch(ctx, { ...base, batchNo: "R1", expiry: addDays(todayISO(), 45), supplierId: sup, invoiceNo: "SD/4", acceptShortExpiry: true });
    await receiveBatch(ctx, { ...base, batchNo: "R2", expiry: addDays(todayISO(), 45), supplierId: null, invoiceNo: "" }); // opening stock already on the shelf
    expect(await db.batch.count({ where: { tenantId, batchNo: { in: ["R1", "R2"] } } })).toBe(2);
  });

  it("can be turned off or changed in the settings", async () => {
    const ctx = await ctxFor("Manager");
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await db.tenant.update({ where: { id: tenantId }, data: { settings: { ...(t.settings as object), purchasing: { gstBase: "net", itc: true, minShelfDays: 0 } } } });
    await postGrnTx(ctx, bill("SD/5", [line("S5", 20)])); // off: nothing to accept
    await db.tenant.update({ where: { id: tenantId }, data: { settings: { ...(t.settings as object), purchasing: { gstBase: "net", itc: true, minShelfDays: 30 } } } });
    await expect(postGrnTx(ctx, bill("SD/6", [line("S6", 20)]))).rejects.toThrow(/less than 30 days/);
    await postGrnTx(ctx, bill("SD/7", [line("S7", 45)])); // above the lower minimum
  });
});
