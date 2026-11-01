import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { processReturn } from "@/domain/sales/returns";
import { saveLoyaltySettings, pointsBalance } from "@/domain/sales/loyalty";
import { postGrnTx } from "@/domain/purchasing/service";
import { paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import { setDriveMode } from "@/domain/system/drive-mode";
import { completeMove, MOVE_PARTS, moveExport, moveStatus, startMove, undoMove, type MoveBase } from "@/domain/system/drive-move";
import { memoryDb } from "@/drivedb/node";
import { beginMove, finishMove, importPart, verifyMove } from "@/drivedb/migrate-in";
import { counterConfig } from "@/drivedb/seed";
import { createSale, stockOf, pointsBalance as devicePoints } from "@/drivedb/pharmacy";
import { customerBalance } from "@/drivedb/trade";
import { supplierDues, gstReturns } from "@/drivedb/books";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");

describe("Moving a pharmacy's data to Google Drive (phase 7)", () => {
  let med = "", batch = "", cust = "", sup = "";

  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    await setDriveMode(ctx, true);
    await saveLoyaltySettings(ctx, { enabled: true, earnPer100: 1, pointValuePaise: 100, minRedeem: 10, expiryMonths: 12 });
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300), qty: 100, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow({ where: { batchNo: "P1" } })).id;
    cust = await saveCustomer(ctx, null, { name: "Pawar Clinic", phone: "9823077015", waOptIn: false, creditLimit: "50000", opening: "1500" });
    sup = await saveSupplier(ctx, null, { name: "Kalyan Distributors", creditDays: "15" });
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "KD/1", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: med, batchNo: "P2", expiry: addDays(todayISO(), 400), qty: 10, freeQty: "", scheme: "", rate: "100", pts: "", mrp: "155", tradePct: "", cashPct: "", poItemId: null }] });
    await paySupplier(ctx, { partyId: sup, amount: "500", method: "Cash" });

    const sale = (qty: number, pay: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty }], customerId: cust, discountPct: 0, pay, ...extra } as Parameters<typeof commitSale>[1]);
    const cashSale = await sale(10, { mode: "cash" }); // earns 15 points
    const credit = await sale(4, { mode: "credit" });
    await sale(1, { mode: "split", cashPaise: 10000 }, { redeemPoints: 12 });
    await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 2 }], customerId: null, discountPct: 10, pay: { mode: "upi" } });
    const ci = await db.saleItem.findFirstOrThrow({ where: { saleId: credit.saleId } });
    await processReturn(ctx, { saleId: credit.saleId, lines: [{ itemId: ci.id, qty: 1 }], condition: "sealed", refundMode: "Adjust customer credit", reason: "Not needed" });
    const ki = await db.saleItem.findFirstOrThrow({ where: { saleId: cashSale.saleId } });
    await processReturn(ctx, { saleId: cashSale.saleId, lines: [{ itemId: ki.id, qty: 3 }], condition: "damaged", refundMode: "Cash", reason: "Broken strip" });
    await processReturn(ctx, { saleId: cashSale.saleId, lines: [{ itemId: ki.id, qty: 2 }], condition: "sealed", refundMode: "Cash", reason: "Extra" });
    await receiveFromCustomer(ctx, { partyId: cust, amount: "200", method: "Cash" });
  });

  async function exportAll(ctx: Awaited<ReturnType<typeof ctxFor>>) {
    const base = (await moveExport(ctx, "base")) as MoveBase;
    const parts: Record<string, unknown[][]> = {};
    for (const part of MOVE_PARTS) {
      parts[part] = [];
      let next: string | null = null;
      do { const page = (await moveExport(ctx, part, next)) as { rows: unknown[]; next: string | null }; parts[part].push(page.rows); next = page.next; } while (next);
    }
    return { base, parts };
  }

  it("only the owner moves, only in Drive mode, and Medoro's copy is frozen first", async () => {
    await expect(startMove(await ctxFor("Manager"))).rejects.toThrow(/role|owner/);
    const ctx = await ctxFor();
    await expect(moveExport(ctx, "base")).rejects.toThrow(/Start the move/);
    const st = await startMove(ctx);
    expect(st).toMatchObject({ state: "moving", canUndo: true });
    // Every change to business records is refused while the data is moving (and after).
    await expect(commitSale({ ...ctx, moved: true }, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } })).rejects.toThrow(/Google Drive/);
  });

  it("the device loads everything and its counts, totals, stock, dues and points match Medoro's", async () => {
    const ctx = await ctxFor();
    const { base, parts } = await exportAll(ctx);
    expect(base.summary.counts).toMatchObject({ sale: 4, salesReturn: 3, purchase: 1, medicine: 1, batch: 2, customer: 1, supplier: 1 });
    const dev = await memoryDb("DMOVE01");
    beginMove(dev, base);
    expect(counterConfig(dev)).toBeNull(); // not a counter until checked
    for (const part of MOVE_PARTS) for (const rows of parts[part]) importPart(dev, part, rows);
    const res = finishMove(dev, base, ctx.userId);
    expect(res.checks.filter((c) => !c.ok)).toEqual([]);
    expect(res.ok).toBe(true);

    // Balances equal Medoro's books, not just the summary.
    const t = ctx.tenantId;
    expect(customerBalance(dev, cust)).toBe((await customerBalances(db, t)).get(cust));
    expect(customerBalance(dev, cust)).toBe(150000 + 4 * 15500 - 15500 - 20000);
    expect(supplierDues(dev).find((s) => s.id === sup)!.duePaise).toBe((await supplierBalances(db, t)).get(sup));
    expect(devicePoints(dev, cust)).toBe(await pointsBalance(db, t, cust));
    for (const b of await db.batch.findMany({ where: { tenantId: t } })) expect(stockOf(dev, b.medicineId, b.branchId)).toBeGreaterThanOrEqual(0);
    const onHand = (await db.batch.findMany({ where: { tenantId: t, medicineId: med, branchId: ctx.branchId } })).reduce((a, b) => a + b.qtyAvailable, 0);
    expect(stockOf(dev, med, ctx.branchId)).toBe(onHand);
    // GST returns are built from the moved bills and credit notes.
    const gstin = base.settings.pharmacy.gstin || "27AAPFU0939F1ZV";
    const g = gstReturns(dev, todayISO().slice(0, 7), gstin);
    expect(g.invoices).toBe(4);
    expect(g.creditNotes).toBe(3);
    // The history of the load isn't re-uploaded change by change: the first full copy to Drive carries it.
    expect(dev.pendingChanges(10).length).toBe(0);

    // It now bills as a counter, with its own invoice series.
    const cfg = counterConfig(dev)!;
    expect(cfg).toMatchObject({ branchId: ctx.branchId, userId: ctx.userId });
    const s = createSale(dev, { branchId: cfg.branchId, series: cfg.series, userId: ctx.userId, lines: [{ medicineId: med, qty: 1 }], pay: { mode: "cash" } });
    expect(s.invoiceNo.startsWith(cfg.series)).toBe(true);
    expect(dev.pendingChanges(100).length).toBeGreaterThan(0);
  });

  it("a copy that doesn't add up is refused, and an incomplete device isn't a counter", async () => {
    const ctx = await ctxFor();
    const { base, parts } = await exportAll(ctx);
    const dev = await memoryDb("DMOVE02");
    beginMove(dev, base);
    for (const part of MOVE_PARTS) if (part !== "returns") for (const rows of parts[part]) importPart(dev, part, rows);
    const res = finishMove(dev, base, ctx.userId);
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.name === "salesReturn records")).toMatchObject({ ok: false, expected: 3, got: 0 });
    expect(counterConfig(dev)).toBeNull();
    const tampered = { ...base.summary, totals: { ...base.summary.totals, salesPaise: base.summary.totals.salesPaise + 1 } };
    expect(verifyMove(dev, tampered).checks.find((c) => c.name === "Sales total")!.ok).toBe(false);
    expect(() => beginMove(dev, base)).toThrow(/already has pharmacy data/);
  });

  it("is recorded as moved, can be undone within 7 days, and Drive mode stays on meanwhile", async () => {
    const ctx = await ctxFor();
    const st = await completeMove(ctx, { device: "DMOVE01", checks: 24 });
    expect(st).toMatchObject({ state: "moved", device: "DMOVE01", checks: 24, canUndo: true });
    expect(Date.parse(st!.undoUntil!) - Date.parse(st!.movedAt!)).toBe(7 * 86400_000);
    await expect(startMove(ctx)).rejects.toThrow(/already moved/);
    expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "Data moved to Google Drive" } })).toBe(1);
    expect(await undoMove(ctx)).toBeNull();
    expect(await moveStatus(ctx)).toBeNull();
    expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "Move to Google Drive undone" } })).toBe(1);
  });

  it("can't be undone after 7 days", async () => {
    const ctx = await ctxFor();
    await startMove(ctx);
    await completeMove(ctx, { device: "DMOVE01", checks: 24 });
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const s = t.settings as { driveMove: { movedAt: string } };
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...s, driveMove: { ...s.driveMove, movedAt: new Date(Date.now() - 8 * 86400_000).toISOString() } } } });
    expect(await moveStatus(ctx)).toMatchObject({ canUndo: false });
    await expect(undoMove(ctx)).rejects.toThrow(/within 7 days/);
  });
});
