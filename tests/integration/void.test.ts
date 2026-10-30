import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer, invoiceData } from "@/domain/sales/service";
import { currentShift, openShift, processReturn, returnableLines } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { customerBalance } from "@/domain/parties/balances";
import { outputGstByRate } from "@/domain/accounting/service";
import { addDays, startOfTodayIST, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let med = "", batch = "";
const key = () => "k_" + randomUUID().replace(/-/g, "");
const qty = async () => (await db.batch.findUniqueOrThrow({ where: { id: batch } })).qtyAvailable;

describe("voiding a sale", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    batch = (await receiveBatch(ctx, { medicineId: med, batchNo: "PN1", expiry: addDays(todayISO(), 300), qty: 30, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" })).batchId;
  });

  it("puts stock back, reverses the voucher, refunds cash from the shift and marks the invoice void", async () => {
    const mgr = await ctxFor("Manager");
    await openShift(mgr, "500");
    const s = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 3 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    expect(await qty()).toBe(27);
    await expect(voidSale(await ctxFor("Cashier"), s.saleId, "Wrong customer")).rejects.toThrow(/Refunds & voids/);
    await expect(voidSale(mgr, s.saleId, " ")).rejects.toThrow(/reason/);
    expect((await returnableLines(mgr, s.saleId))!.canVoid).toBe(true);

    const r = await voidSale(mgr, s.saleId, "Customer changed mind");
    expect(r.refunds).toEqual([{ mode: "cash", amountPaise: 46500 }]);
    expect(await qty()).toBe(30);
    const v = await db.saleVoid.findUniqueOrThrow({ where: { saleId: s.saleId } });
    expect(v).toMatchObject({ reason: "Customer changed mind", cashRefundPaise: 46500n });
    const orig = await db.voucher.findFirstOrThrow({ where: { refType: "sale", refId: s.saleId }, include: { lines: true } });
    const rev = await db.voucher.findFirstOrThrow({ where: { reversesId: orig.id }, include: { lines: true } });
    expect(rev).toMatchObject({ type: "reversal", refType: "sale_void", refId: v.id });
    for (const l of orig.lines) expect(rev.lines.find((x) => x.account === l.account)).toMatchObject({ debitPaise: l.creditPaise, creditPaise: l.debitPaise });
    expect(await db.stockMovement.count({ where: { refType: "sale_void", refId: s.saleId, qty: 3 } })).toBe(1);
    expect((await currentShift(mgr)).open).toMatchObject({ cash: 46500, refunds: 46500, expected: 50000 });
    expect((await invoiceData(mgr, s.saleId))!.voided).toMatchObject({ reason: "Customer changed mind" });
    expect(await db.auditEvent.count({ where: { action: "Sale voided", entityId: s.saleId } })).toBe(1);
    const gst = await outputGstByRate(mgr.tenantId, { from: startOfTodayIST(), to: new Date(Date.now() + 60_000), fromDay: todayISO(), toDay: addDays(todayISO(), 1) } as never, null);
    expect(gst).toEqual([]);

    await expect(voidSale(mgr, s.saleId, "Again")).rejects.toThrow(/already void/);
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    await expect(processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "late" })).rejects.toThrow(/voided/);
    await expect(db.saleVoid.update({ where: { id: v.id }, data: { reason: "x" } })).rejects.toThrow(/append-only/);
  });

  it("refunds a split bill per mode and takes a credit bill off the customer's balance", async () => {
    const mgr = await ctxFor("Manager");
    const split = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "split", cashPaise: 10000 } });
    expect((await voidSale(mgr, split.saleId, "Duplicate bill")).refunds).toEqual([{ mode: "cash", amountPaise: 10000 }, { mode: "upi", amountPaise: 21000 }]);

    const cust = await createCustomer(mgr, { name: "Ramesh", phone: "9822041736", waOptIn: false, creditLimit: "5000" });
    const credit = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: cust, discountPct: 0, pay: { mode: "credit" } });
    expect(await customerBalance(db, mgr.tenantId, cust)).toBe(15500);
    expect((await voidSale(mgr, credit.saleId, "Billed to wrong account")).refunds).toEqual([{ mode: "credit", amountPaise: 15500 }]);
    expect(await customerBalance(db, mgr.tenantId, cust)).toBe(0);
    expect(await qty()).toBe(30);
  });

  it("only today's untouched bills can be voided", async () => {
    const mgr = await ctxFor("Manager");
    const old = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } }, { at: new Date(startOfTodayIST().getTime() - 3600_000) });
    await expect(voidSale(mgr, old.saleId, "Too late")).rejects.toThrow(/Only today’s bills/);
    expect((await returnableLines(mgr, old.saleId))!.canVoid).toBe(false);
    const s = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    await processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "One strip back" });
    await expect(voidSale(mgr, s.saleId, "Rest of it")).rejects.toThrow(/already returned/);
    await expect(voidSale(await ctxFor("Manager", "Second"), s.saleId, "Wrong branch")).rejects.toThrow(/branch/);
  });
});
