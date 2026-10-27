import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { postGrnTx } from "@/domain/purchasing/service";
import { listSuppliers, paySupplier, saveSupplier } from "@/domain/parties/service";
import { accountsOverview, dayBook, periodOf, recordExpense, reverseVoucher } from "@/domain/accounting/service";
import { REPORTS, reportRows } from "@/domain/accounting/reports";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("accounting", () => {
  let sup = "";
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    sup = await saveSupplier(ctx, null, { name: "Sai Healthcare" });
    const med = await createMedicine(ctx, { name: "Telma 40", generic: "Telmisartan", strength: "40 mg", form: "Tablet", manufacturer: "Glenmark", pack: "15", mrp: "232", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    // 10 × 150 = 1500 + 180 GST = 1680
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "SHD/1", invoiceDate: todayISO(), statedTotal: "1680", poId: null, scanDocId: null, lines: [{ medicineId: med, batchNo: "TL1", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 10, freeQty: 0, rate: "150", mrp: "232", poItemId: null }] });
    const b = await db.batch.findFirstOrThrow();
    // 2 × 232 = 464 incl. GST → taxable 414.29
    await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: b.id, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
  });

  it("builds P&L, cash and GST from postings", async () => {
    const ctx = await ctxFor();
    await recordExpense(ctx, { account: "Electricity", amount: "120", method: "Cash", note: "Oct bill" });
    const ov = await accountsOverview(ctx, periodOf("month"));
    expect(ov.pl.sales).toBe(41429);
    expect(ov.pl.cogs).toBe(30000);
    expect(ov.pl.expenseLines.find((e) => e.account === "Electricity")!.amount).toBe(12000);
    expect(ov.cash.cash).toBe(46400 - 12000);
    expect(ov.cash.payable).toBe(168000);
    expect(ov.gst[0]).toMatchObject({ rate: 12, outTaxable: 41429, outTax: 4971, inTax: 18000 });
    await expect(accountsOverview(await ctxFor("Cashier"), periodOf("month"))).rejects.toThrow(/role/);
  });

  it("reverses a supplier payment and restores the open bill", async () => {
    const ctx = await ctxFor();
    await paySupplier(ctx, { partyId: sup, amount: "1680", method: "Cash" });
    expect((await listSuppliers(ctx))[0].nextDue).toBeNull();
    const pv = (await dayBook(ctx, periodOf("month"))).find((v) => v.no.startsWith("PV") && v.narration.startsWith("Payment to"))!;
    expect(pv.canReverse).toBe(true);
    await reverseVoucher(ctx, pv.id, "Paid to wrong party");
    await expect(reverseVoucher(ctx, pv.id, "again")).rejects.toThrow(/already reversed/);
    const s = (await listSuppliers(ctx))[0];
    expect(s.balance).toBe(168000);
    expect(s.nextDue?.amount).toBe(168000);
    const sale = (await dayBook(ctx, periodOf("month"))).find((v) => v.type === "sales")!;
    await expect(reverseVoucher(ctx, sale.id, "nope")).rejects.toThrow(/returns or debit notes/);
  });

  it("generates every report", async () => {
    const ctx = await ctxFor();
    for (const [id] of REPORTS) {
      const rows = await reportRows(ctx, id, periodOf("fy"));
      expect(rows.length).toBeGreaterThan(0);
    }
    expect((await reportRows(ctx, "sales-register", periodOf("month"))).length).toBe(2);
  });
});
