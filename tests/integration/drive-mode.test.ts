import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { deviceSeed, driveModeOn, setDriveMode } from "@/domain/system/drive-mode";
import { memoryDb } from "@/drivedb/node";
import { importSeed, counterConfig, recentSales, seriesFor } from "@/drivedb/seed";
import { createSale, searchMedicines, stockOf } from "@/drivedb/pharmacy";
import { findCustomers } from "@/drivedb/trade";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("Drive mode pilot", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("only the owner switches it on, and it's audited", async () => {
    const ctx = await ctxFor();
    expect(await driveModeOn(ctx.tenantId)).toBe(false);
    await expect(setDriveMode(await ctxFor("Manager"), true)).rejects.toThrow();
    await expect(deviceSeed(ctx)).rejects.toThrow(/Turn on Drive mode/);
    await setDriveMode(ctx, true);
    expect(await driveModeOn(ctx.tenantId)).toBe(true);
    expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "Drive mode turned on" } })).toBe(1);
  });

  it("copies this branch's catalogue, stock and customers into a device that then bills on its own", async () => {
    const ctx = await ctxFor();
    const t = ctx.tenantId;
    const m = await db.medicine.create({ data: { tenantId: t, name: "Dolo 650", generic: "Paracetamol", strength: "650mg", form: "Tab", manufacturer: "Micro", pack: "15 tabs", hsn: "3004", gstRate: 12, mrpPaise: 3200n, packSize: 15, packUnit: "strip", looseUnit: "tab", allowLoose: true } });
    await db.batch.create({ data: { tenantId: t, branchId: ctx.branchId, medicineId: m.id, batchNo: "D1", expiryDate: new Date("2028-03-31"), qtyAvailable: 150, costPaise: 2200n, mrpPaise: 3200n } });
    await db.batch.create({ data: { tenantId: t, branchId: ctx.branchId, medicineId: m.id, batchNo: "EMPTY", expiryDate: new Date("2028-03-31"), qtyAvailable: 0, costPaise: 2200n, mrpPaise: 3200n } });
    const other = ctx.branches.find((b) => b.id !== ctx.branchId)!;
    await db.batch.create({ data: { tenantId: t, branchId: other.id, medicineId: m.id, batchNo: "OTHER", expiryDate: new Date("2028-03-31"), qtyAvailable: 99, costPaise: 2200n, mrpPaise: 3200n } });
    await db.customer.create({ data: { tenantId: t, name: "Asha", phone: "9822000009", creditLimitPaise: 100000n } });

    const seed = await deviceSeed(ctx);
    expect(seed.batches.map((b) => b.batchNo)).toEqual(["D1"]); // only this branch, only batches with stock
    expect(await db.auditEvent.count({ where: { tenantId: t, action: "Catalogue copied to a device" } })).toBe(1);

    const dev = await memoryDb("DABC123");
    const cfg = importSeed(dev, seed, ctx.userId);
    expect(cfg).toMatchObject({ branchId: ctx.branchId, series: seriesFor("DABC123"), maxDiscountPct: seed.maxDiscountPct });
    expect(counterConfig(dev)).toEqual(cfg);
    expect(searchMedicines(dev, "dolo")[0].id).toBe(m.id); // same ids as the server
    expect(stockOf(dev, m.id, ctx.branchId)).toBe(150);
    expect(findCustomers(dev, "98220")[0].name).toBe("Asha");
    expect(() => importSeed(dev, seed, ctx.userId)).toThrow(/already has a catalogue/);

    const sale = createSale(dev, { branchId: cfg.branchId, series: cfg.series, userId: ctx.userId, lines: [{ medicineId: m.id, qty: 2 }, { medicineId: m.id, qty: 3, unit: "loose" }], pay: { mode: "upi" } });
    expect(sale.invoiceNo).toMatch(/^D\w{4}\d{4}-000001$/);
    expect(stockOf(dev, m.id, ctx.branchId)).toBe(150 - 30 - 3);
    expect(recentSales(dev)[0]).toMatchObject({ invoiceNo: sale.invoiceNo, items: 2 });
    // The server's stock is untouched in the pilot.
    expect((await db.batch.findFirstOrThrow({ where: { batchNo: "D1" } })).qtyAvailable).toBe(150);
  });
});

it("device series fit the GST invoice number rules", () => {
  for (const d of ["D1", "DABCDEF1234", "x"]) expect(seriesFor(d)).toMatch(/^D[A-Z0-9]{4}$/);
});
