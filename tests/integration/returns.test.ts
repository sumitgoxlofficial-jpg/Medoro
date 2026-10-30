import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { closeShift, creditNoteData, currentShift, openShift, processReturn } from "@/domain/sales/returns";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let med = "", batch = "";
const key = () => "k_" + randomUUID().replace(/-/g, "");

describe("returns and shifts", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "PN1", expiry: addDays(todayISO(), 300), qty: 20, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow()).id;
  });

  it("shift tracks cash sales and refunds, sealed returns restock, damaged don't", async () => {
    const mgr = await ctxFor("Manager");
    await openShift(mgr, "500");
    await expect(openShift(mgr, "100")).rejects.toThrow(/already open/);
    const s = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 4 }], customerId: null, discountPct: 10, pay: { mode: "cash" } });
    // 4 × 155 = 620, −10% = 558
    expect(s.total).toBe(55800);
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    await expect(processReturn(await ctxFor("Cashier"), { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Wrong item" })).rejects.toThrow(/role/);
    const r1 = await processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Wrong item" });
    expect(r1.amount).toBe(13950); // net per unit after discount
    expect(r1.creditNote).toMatch(/^CN-\d{4}-0001$/);
    const cn = await creditNoteData(mgr, r1.id);
    expect(cn).toMatchObject({ no: r1.creditNote, invoiceNo: s.invoiceNo, refundMode: "Cash", lines: [{ name: "Pan 40", qty: 1, amount: 13950, gstRate: 12, restocked: true }] });
    expect(cn!.totals.taxable + cn!.totals.cgst + cn!.totals.sgst).toBe(cn!.totals.total);
    expect(cn!.totals.total).toBe(13950);
    expect(await creditNoteData(await ctxFor("Manager", "Second"), "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch } })).qtyAvailable).toBe(17);
    await processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "damaged", refundMode: "Cash", reason: "Opened strip" });
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch } })).qtyAvailable).toBe(17);
    await expect(processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 3 }], condition: "sealed", refundMode: "Cash", reason: "More" })).rejects.toThrow(/Only 2/);
    const v = await db.voucher.findFirstOrThrow({ where: { type: "credit_note" }, include: { lines: true } });
    expect(v.lines.reduce((a, l) => a + Number(l.debitPaise), 0)).toBe(v.lines.reduce((a, l) => a + Number(l.creditPaise), 0));

    const sh = await currentShift(mgr);
    expect(sh.open).toMatchObject({ open: 50000, cash: 55800, refunds: 27900, expected: 50000 + 55800 - 27900 });
    const c = await closeShift(mgr, "778.00");
    expect(c.diff).toBe(77800 - 77900);
    const j = await db.voucher.findFirstOrThrow({ where: { refType: "shift" }, include: { lines: true } });
    expect(j.lines.find((l) => l.account === "Cash short/excess")!.debitPaise).toBe(100n);
    expect((await currentShift(mgr)).open).toBeNull();
  });

  it("walk-in sales can't be refunded to credit", async () => {
    const mgr = await ctxFor("Manager");
    const s = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "upi" } });
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    await expect(processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Adjust customer credit", reason: "x x x" })).rejects.toThrow(/Walk-in/);
  });

  it("partial returns never refund more than the line's net, and the voucher carries the credit note number", async () => {
    const mgr = await ctxFor("Manager");
    const s = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 3 }], customerId: null, discountPct: 3.3, pay: { mode: "upi" } });
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    const net = Number(item.mrpPaise) * 3 - Number(item.discountPaise);
    expect(net % 3).not.toBe(0);
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "UPI refund", reason: "Not needed" }));
    expect(rs.reduce((a, r) => a + r.amount, 0)).toBe(net);
    for (const r of rs) {
      const ret = await db.salesReturn.findFirstOrThrow({ where: { creditNoteNo: r.creditNote } });
      expect((await db.voucher.findFirstOrThrow({ where: { refId: ret.id, type: "credit_note" } })).no).toBe(r.creditNote);
    }
  });

  it("closing a shift counts cash from sales committed on it", async () => {
    const mgr = await ctxFor("Manager");
    await openShift(mgr, "100");
    const s = await commitSale(mgr, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const c = await closeShift(mgr, "255");
    expect(c).toEqual({ expected: 10000 + s.total, counted: 25500, diff: 0 });
    expect((await db.shift.findFirstOrThrow({ where: { closedAt: { not: null } }, orderBy: { closedAt: "desc" } })).expectedPaise).toBe(BigInt(10000 + s.total));
    expect((await db.sale.findUniqueOrThrow({ where: { id: s.saleId } })).shiftId).not.toBeNull();
  });
});
