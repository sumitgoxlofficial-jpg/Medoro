import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { postGrnTx } from "@/domain/purchasing/service";
import { writeOff } from "@/domain/inventory/adjust";
import { openShift, processReturn } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { saveSupplier } from "@/domain/parties/service";
import { recordExpense } from "@/domain/accounting/service";
import { profitIntel, profitPeriod } from "@/domain/reports/profit";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const exp = addDays(todayISO(), 400).slice(0, 7);
let sup = "", med = "", dear = "";
const P = () => profitPeriod(undefined, undefined);
const sale = async (m: string, qty = 1, discountPct = 0) => commitSale(await ctxFor("Manager"), { idempotencyKey: key(), lines: [{ medicineId: m, batchId: (await db.batch.findFirstOrThrow({ where: { medicineId: m } })).id, qty }], customerId: null, discountPct, pay: { mode: "cash" } });

describe("profit intelligence", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor("Manager");
    sup = await saveSupplier(ctx, null, { name: "Free Goods Pharma", creditDays: "30" });
    const base = { form: "Tablet" as const, manufacturer: "Alkem", pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", gstRate: 12 };
    med = await createMedicine(ctx, { ...base, name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", mrp: "155" });
    dear = await createMedicine(ctx, { ...base, name: "Costly Tab", generic: "Costlyne", strength: "10 mg", mrp: "155" });
    // Real GRN with free goods: 10 paid + 2 free at ₹100 → landed cost per pack 100×10/12 = 83.33
    const line = (qty: number, free: number, rate: string, batchNo: string) => ({ medicineId: med, batchNo, expiry: exp, qty, freeQty: free, rate, mrp: "155", poItemId: null });
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "FG/1", invoiceDate: todayISO(), poId: null, scanDocId: null, statedTotal: null, lines: [line(10, 2, "100", "A1")] });
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "FG/2", invoiceDate: todayISO(), poId: null, scanDocId: null, statedTotal: null, lines: [line(10, 0, "120", "A2")] });
    await receiveBatch(ctx, { medicineId: dear, batchNo: "C1", expiry: exp, qty: 50, cost: "130", mrp: "155", supplierId: null, invoiceNo: "" });
  });

  it("states profit on the ledger's net sales and landed cost, reconciled to the sale lines", async () => {
    await sale(med, 3);
    const r = await profitIntel(await ctxFor(), null, P());
    expect(r.total.recon.status).toBe("reconciled");
    expect(r.total.ledgerSales).toBeGreaterThan(0);
    expect(Math.abs(r.total.itemSales - r.total.ledgerSales)).toBeLessThanOrEqual(100);
    // Landed cost of the first batch (A1) is the GRN's documented per-pack cost, not the MRP and not the list rate
    const a1 = await db.batch.findFirstOrThrow({ where: { batchNo: "A1" } });
    expect(Number(a1.costPaise)).toBe(8333);
    expect(r.total.cogs).toBe(3 * 8333);
    expect(r.total.grossProfit).toBe(r.total.ledgerSales - r.total.cogs);
    expect(r.total.grossPct).toBeGreaterThan(30);
    expect(r.byItem[0].name).toMatch(/Pan 40/);
  });

  it("shows free goods by supplier at list value", async () => {
    const r = await profitIntel(await ctxFor(), null, P());
    expect(r.freeGoods).toHaveLength(1);
    expect(r.freeGoods[0]).toMatchObject({ supplier: "Free Goods Pharma", freeUnits: 2, paidUnits: 20, freeValuePaise: 2 * 10000, paidValuePaise: 10 * 10000 + 10 * 12000 });
    expect(r.freeGoods[0].freeSharePct).toBe(9.1);
  });

  it("flags purchase-cost variation from landed costs", async () => {
    const r = await profitIntel(await ctxFor(), null, P());
    const v = r.costVariation.find((x) => x.name.startsWith("Pan 40"))!;
    expect(v).toBeDefined();
    expect(v.v.min).toBe(8333);
    expect(v.v.max).toBe(12000);
    expect(v.v.flagged).toBe(true);
  });

  it("detects sales below landed cost as profit leakage", async () => {
    await sale(dear, 2, 20); // ₹155 less 20%, ex GST ≈ ₹110.7 against a landed cost of ₹130
    const r = await profitIntel(await ctxFor(), null, P());
    const l = r.leakage.belowCost.find((x) => x.name.startsWith("Costly Tab"))!;
    expect(l.qty).toBe(2);
    expect(l.lossPaise).toBeGreaterThan(3000); // about ₹19.3 × 2
    expect(r.leakage.belowCost.find((x) => x.name.startsWith("Pan 40"))).toBeUndefined(); // profitable sales are not leakage
    expect(r.discounts.overallPct).toBeGreaterThan(0);
    expect(r.total.discountPaise).toBeGreaterThan(0);
  });

  it("removes voided bills from both sides so the books still reconcile", async () => {
    const before = await profitIntel(await ctxFor(), null, P());
    const s = await sale(med, 5);
    await voidSale(await ctxFor(), s.saleId, "Wrong bill");
    const after = await profitIntel(await ctxFor(), null, P());
    expect(after.total.ledgerSales).toBe(before.total.ledgerSales);
    expect(after.total.cogs).toBe(before.total.cogs);
    expect(after.total.recon.status).toBe("reconciled");
  });

  it("counts write-offs, damaged returns and expired stock, and nets expenses into net profit", async () => {
    const ctx = await ctxFor("Manager");
    const before = await profitIntel(await ctxFor(), null, P());
    await writeOff(ctx, (await db.batch.findFirstOrThrow({ where: { batchNo: "A2" } })).id, 4, "Expired on shelf");
    await openShift(ctx, "500");
    const s = await sale(dear, 3);
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    await processReturn(ctx, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "damaged", refundMode: "Cash", reason: "Broken strip" });
    await recordExpense(ctx, { account: "Electricity", amount: "120", method: "Cash", note: "Oct bill" });
    const after = await profitIntel(await ctxFor(), null, P());
    expect(after.leakage.writeOffs).toMatchObject({ count: 1 });
    expect(after.leakage.writeOffs.totalPaise).toBe(4 * 12000);
    expect(after.leakage.writeOffs.byReason[0].reason).toBe("expired on shelf");
    expect(after.leakage.damagedReturns).toMatchObject({ count: 1 });
    expect(after.leakage.damagedReturns.refundPaise).toBeGreaterThan(0);
    // the write-off posts Stock loss and the expense posts Electricity: both are indirect costs in the ledger
    expect(after.total.indirect - before.total.indirect).toBeGreaterThanOrEqual(4 * 12000 + 12000);
    expect(after.total.netProfit).toBe(after.total.grossProfit - after.total.indirect);
  });

  it("is scoped to the branches the user can access", async () => {
    const owner = await ctxFor();
    const main = owner.branches.find((b) => b.name === "Main")!, second = owner.branches.find((b) => b.name === "Second")!;
    const s2 = await profitIntel(owner, second.id, P());
    expect(s2.total.ledgerSales).toBe(0);
    expect(s2.byItem).toHaveLength(0);
    expect((await profitIntel(owner, main.id, P())).total.ledgerSales).toBeGreaterThan(0);
    await expect(profitIntel({ ...owner, branches: [main] }, second.id, P())).rejects.toThrow(/access/);
    expect((await profitIntel({ ...owner, branches: [main] }, null, P())).branches.map((b) => b.branch)).toEqual(["Main"]);
  });

  it("validates the period and requires the reports permission", async () => {
    expect(() => profitPeriod("2026-11-10", "2026-11-01")).toThrow(/after the end/);
    expect(() => profitPeriod("2024-01-01", "2026-11-01")).toThrow(/one year/);
    expect(profitPeriod("garbage", undefined).fromDay).toBe(addDays(todayISO(), -29));
    await expect(profitIntel(await ctxFor("Cashier"), null, P())).rejects.toThrow();
  });
});
