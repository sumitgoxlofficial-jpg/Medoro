import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { postGrnTx } from "@/domain/purchasing/service";
import { listSuppliers, paySupplier, saveSupplier } from "@/domain/parties/service";
import { accountsOverview, dayBook, periodOf, recordExpense, reverseVoucher } from "@/domain/accounting/service";
import { REPORTS, reportRows, reportScopeTag } from "@/domain/accounting/reports";
import { processReturn } from "@/domain/sales/returns";
import { dashboard } from "@/domain/reports/dashboard";
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

  it("nets credit notes out of the GST summary, by slab", async () => {
    const ctx = await ctxFor();
    const sale = await db.sale.findFirstOrThrow();
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    await processReturn(ctx, { saleId: sale.id, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "UPI refund", reason: "Not needed" });
    const ov = await accountsOverview(ctx, periodOf("month"));
    // 1 of 2 returned: taxable 414.29 − 207.15, tax 49.71 − 24.85
    expect(ov.gst[0]).toMatchObject({ rate: 12, outTaxable: 20714, outTax: 2486 });
    expect(ov.gst[0].outTax).toBe(ov.gstTotals.out); // agrees with the ledger
    const rows = await reportRows(ctx, "gst-summary", periodOf("month"));
    expect(rows[0].slice(0, 6)).toEqual(["Slab %", "Sales taxable", "Credit notes taxable", "Output taxable (net)", "Output CGST", "Output SGST"]);
    expect(rows[1].slice(0, 6)).toEqual([12, "414.29", "207.15", "207.14", "12.43", "12.43"]);
  });

  it("scopes branch reports to the current branch or all branches, and names files accordingly", async () => {
    const main = await ctxFor(), second = await ctxFor("Owner", "Second");
    expect((await reportRows(second, "sales-register", periodOf("month"))).length).toBe(1);
    const all = await reportRows(second, "sales-register", periodOf("month"), "all");
    expect(all[0][0]).toBe("Branch");
    expect(all.slice(1).map((r) => r[0])).toEqual(["Main"]);
    expect((await reportRows(second, "gst-summary", periodOf("month"))).length).toBe(1);
    expect((await reportRows(second, "gst-summary", periodOf("month"), "all")).length).toBe(2);
    expect(reportScopeTag(main, "sales-register", "branch")).toBe(main.branchCode.toLowerCase());
    expect(reportScopeTag(main, "sales-register", "all")).toBe("all");
    expect(reportScopeTag(main, "day-book", "branch")).toBe("all");
    // A user limited to one branch: "all" still means only that branch.
    const limited = { ...main, branches: main.branches.filter((b) => b.id === main.branchId) };
    expect(reportScopeTag(limited, "stock-valuation", "all")).toBe(main.branchCode.toLowerCase());
  });

  it("pages the day book with a cursor", async () => {
    const ctx = await ctxFor(), p = periodOf("month");
    const full = await dayBook(ctx, p);
    expect(full.length).toBeGreaterThan(3);
    const seen: string[] = [];
    let page = await dayBook(ctx, p, undefined, 2);
    while (page.length) { seen.push(...page.map((v) => v.id)); page = await dayBook(ctx, p, seen[seen.length - 1], 2); }
    expect(seen).toEqual(full.map((v) => v.id));
  });

  it("nets reversed expenses out of the dashboard KPI", async () => {
    const ctx = await ctxFor();
    const before = (await dashboard(ctx.tenantId, ctx.branchId, "today", [ctx.branchId])).kpi;
    await recordExpense(ctx, { account: "Electricity", amount: "50", method: "Cash", note: "" });
    const v = (await dayBook(ctx, periodOf("month"))).find((x) => x.narration.startsWith("Electricity") && x.amount === 5000)!;
    expect((await dashboard(ctx.tenantId, ctx.branchId, "today", [ctx.branchId])).kpi.expenses).toBe(before.expenses + 5000);
    await reverseVoucher(ctx, v.id, "Entered twice");
    const after = (await dashboard(ctx.tenantId, ctx.branchId, "today", [ctx.branchId])).kpi;
    expect(after.expenses).toBe(before.expenses);
    expect(after.expenseCount).toBe(before.expenseCount);
  });
});
