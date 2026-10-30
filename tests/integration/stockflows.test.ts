import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { adjustStock, approveTransfer, listBranchTransfers, receiveTransfer, rejectTransfer, requestTransfer, returnToSupplier, writeOff } from "@/domain/inventory/adjust";
import { addRecall, listRecalls, returnRecalled, setRecallStatus } from "@/domain/inventory/recalls";
import { createPo, discardScan, listOrders, pendingScans, postGrnTx, setPoStatus } from "@/domain/purchasing/service";
import { listSuppliers, paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { partyStatement, statementCsv } from "@/domain/parties/statement";
import { accountLedger, accountsOverview, inputGstByRate, periodOf, trialBalance } from "@/domain/accounting/service";
import { reportRows } from "@/domain/accounting/reports";
import { commitSale } from "@/domain/sales/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let med = "", local = "", far = "";
const exp = addDays(todayISO(), 400).slice(0, 7);
const key = () => "k_" + randomUUID().replace(/-/g, "");
const line = (batchNo: string, qty: number, rate = "100", poItemId: string | null = null) => ({ medicineId: med, batchNo, expiry: exp, qty, freeQty: 0, rate, mrp: "150", poItemId });
const grn = (supplierId: string, invoiceNo: string, lines: ReturnType<typeof line>[], poId: string | null = null) => ({ supplierId, invoiceNo, invoiceDate: todayISO(), statedTotal: null, poId, scanDocId: null, lines });
const vlines = async (refType: string, refId: string) => (await db.voucher.findFirstOrThrow({ where: { refType, refId }, include: { lines: true } })).lines.sort((a, b) => a.account.localeCompare(b.account));
const batch = (batchNo: string, branch?: string) => db.batch.findFirstOrThrow({ where: { batchNo, ...(branch ? { branchId: branch } : {}) } });

describe("stock actions, purchasing controls, statements and ledgers", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    local = await saveSupplier(ctx, null, { name: "Pune Pharma", creditDays: "30", leadDays: "2" });
    far = await saveSupplier(ctx, null, { name: "Ahmedabad Distributors", stateCode: "24", acceptsReturns: false });
    med = await createMedicine(ctx, { name: "Azee 500", generic: "Azithromycin", strength: "500 mg", form: "Tablet", manufacturer: "Cipla", pack: "3", mrp: "150", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
  });

  it("books opening stock against Opening balance equity and keeps Inventory non-negative through adjustments", async () => {
    const ctx = await ctxFor();
    const { batchId } = await receiveBatch(ctx, { medicineId: med, batchNo: "OP1", expiry: exp, qty: 10, cost: "80", mrp: "150", supplierId: null, invoiceNo: "" });
    const open = await vlines("opening_stock", batchId);
    expect(open.map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["Inventory", 80000n, 0n], ["Opening balance equity", 0n, 80000n]]);
    await expect(receiveBatch(ctx, { medicineId: med, batchNo: "OP1", expiry: exp, qty: 1, cost: "80", mrp: "150", supplierId: null, invoiceNo: "" })).rejects.toThrow(/Stock adjustment/);

    const gain = await adjustStock(await ctxFor("Pharmacist"), batchId, 2, "Found in back store");
    expect(gain).toMatch(/^SA-\d{4}-0001$/);
    expect((await batch("OP1")).qtyAvailable).toBe(12);
    expect((await vlines("stock_adjust", gain)).map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["Inventory", 16000n, 0n], ["Stock loss", 0n, 16000n]]);
    const mv = await db.stockMovement.findFirstOrThrow({ where: { refType: "stock_adjust", refId: gain } });
    expect([mv.type, mv.qty]).toEqual(["adjust", 2]);
    expect(await db.auditEvent.count({ where: { action: `Stock adjusted ${gain}` } })).toBe(1);

    await expect(adjustStock(ctx, batchId, -1, "x")).rejects.toThrow(/reason/);
    await expect(adjustStock(ctx, batchId, -13, "Miscount")).rejects.toThrow(/Only 12/);
    await expect(adjustStock(await ctxFor("Cashier"), batchId, -1, "Miscount")).rejects.toThrow(/role/);

    const loss = await adjustStock(ctx, batchId, -4, "Miscounted at entry");
    expect((await vlines("stock_adjust", loss)).map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["Inventory", 0n, 32000n], ["Stock loss", 32000n, 0n]]);
    await writeOff(ctx, batchId, 8, "Expired: past date");
    expect((await batch("OP1")).qtyAvailable).toBe(0);

    // Purchased stock: losses reduce Purchases, so Inventory never goes below what was booked into it.
    await postGrnTx(ctx, grn(local, "PP/1", [line("GR1", 20)]));
    const gr1 = await batch("GR1");
    const wo = await writeOff(ctx, gr1.id, 2, "Damaged: torn strip");
    const so = await db.stockOut.findFirstOrThrow({ where: { no: wo } });
    expect((await vlines("write_off", so.id)).map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["Purchases", 0n, 20000n], ["Stock loss", 20000n, 0n]]);
    const tb = await trialBalance(ctx);
    expect(tb.dr).toBe(tb.cr);
    expect(tb.rows.some((r) => r.account === "Inventory")).toBe(false); // 800 + 160 − 320 − 640 = 0
    expect((await accountLedger(ctx, "Inventory", todayISO(), todayISO())).rows.map((r) => r.balance)).toEqual([80000, 96000, 64000, 0]);
  });

  it("lists transfers for the user's branches with who may act, and approves from Inventory", async () => {
    const owner = await ctxFor(), pharm = await ctxFor("Pharmacist");
    const second = owner.branches.find((b) => b.name === "Second")!.id;
    const gr1 = await batch("GR1");
    const no = await requestTransfer(pharm, gr1.id, second, 3, "Short at Second");
    const mine = (await listBranchTransfers(pharm)).find((t) => t.no === no)!;
    expect(mine).toMatchObject({ status: "pending", canApprove: false, canReject: true, canReceive: false, by: "Owner Person", note: "Short at Second" });
    const theirs = (await listBranchTransfers(owner)).find((t) => t.no === no)!;
    expect(theirs.canApprove).toBe(true); // holds "users": may approve their own pharmacy's requests
    await approveTransfer(owner, theirs.id);
    const inTransit = (await listBranchTransfers(await ctxFor("Pharmacist", "Second"))).find((t) => t.no === no)!;
    expect(inTransit).toMatchObject({ status: "in_transit", canReceive: true, canCancel: true });
    await receiveTransfer(await ctxFor("Pharmacist", "Second"), inTransit.id);
    const dest = await batch("GR1", second);
    expect([dest.qtyAvailable, dest.grnId]).toEqual([3, gr1.grnId]);
    const no2 = await requestTransfer(pharm, gr1.id, second, 1);
    await rejectTransfer(pharm, (await listBranchTransfers(pharm)).find((t) => t.no === no2)!.id);
    expect((await listBranchTransfers(owner)).find((t) => t.no === no2)!).toMatchObject({ status: "rejected", canApprove: false, canReject: false });
  });

  it("books IGST for an out-of-state supplier on the GRN, its debit note and the GST summary", async () => {
    const ctx = await ctxFor();
    await expect(saveSupplier(ctx, null, { name: "Bad State", gstin: "27AAKFS3192P1Z6", stateCode: "24" })).rejects.toThrow(/doesn’t match the GSTIN/);
    const g = await postGrnTx(ctx, grn(far, "AD/1", [line("IG1", 10)])); // 1000 + 12% = 1120
    expect((await db.grn.findUniqueOrThrow({ where: { id: g.grnId } })).igst).toBe(true);
    const pv = await vlines("grn", g.grnId);
    expect(pv.find((l) => l.account === "Input IGST")!.debitPaise).toBe(12000n);
    expect(pv.some((l) => l.account === "Input CGST" || l.account === "Input SGST")).toBe(false);
    expect((await vlines("grn", (await db.grn.findFirstOrThrow({ where: { supplierInvoiceNo: "PP/1" } })).id)).find((l) => l.account === "Input CGST")!.debitPaise).toBe(12000n);

    await expect(returnToSupplier(ctx, (await batch("IG1")).id, 2, "Near expiry")).rejects.toThrow(/doesn’t accept returns/);
    await db.supplier.update({ where: { id: far }, data: { acceptsReturns: true } });
    const dn = await returnToSupplier(ctx, (await batch("IG1")).id, 2, "Wrong item");
    const so = await db.stockOut.findFirstOrThrow({ where: { no: dn } });
    expect((await vlines("supplier_return", so.id)).map((l) => [l.account, l.creditPaise])).toEqual([["Input IGST", 2400n], ["Purchases", 20000n], ["Sundry creditors", 0n]]);

    const p = periodOf("month");
    const slab = (await inputGstByRate(ctx.tenantId, p, null)).find((r) => r.rate === 12)!;
    expect(slab).toMatchObject({ igst: 12000 - 2400, retTaxable: 20000 });
    const ov = await accountsOverview(ctx, p);
    expect(ov.gstTotals.in).toBe(ov.gst.reduce((a, r) => a + r.inTax, 0)); // slabs agree with the posted input-tax ledgers
    expect(ov.gstTotals.inIgst).toBe(9600);
    const rows = await reportRows(ctx, "gst-summary", p);
    expect(rows[0]).toContain("Input IGST");
    expect(rows[1][rows[0].indexOf("Input IGST")]).toBe("96.00");
    expect(rows[1][rows[0].indexOf("Debit notes taxable")]).toBe("200.00");
  });

  it("closes a PO short or cancels it with a reason, and measures delivery accuracy from GRNs", async () => {
    const ctx = await ctxFor("Manager");
    const po = await createPo(ctx, { supplierId: local, lines: [{ medicineId: med, qty: "10", rate: "100" }] });
    await setPoStatus(ctx, po.id, "place");
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).placedAt).not.toBeNull();
    await expect(setPoStatus(ctx, po.id, "close", "Short")).rejects.toThrow(/Cancel it instead/);
    const item = (await listOrders(ctx)).find((o) => o.id === po.id)!.items[0];
    await postGrnTx(ctx, grn(local, "PP/2", [line("PO1", 5, "100", item.id)], po.id));
    await expect(setPoStatus(ctx, po.id, "cancel", "Not needed")).rejects.toThrow(/Close it short/);
    await expect(setPoStatus(ctx, po.id, "close", "")).rejects.toThrow(/closed short/);
    await setPoStatus(ctx, po.id, "close", "Supplier out of stock");
    const o = (await listOrders(ctx)).find((x) => x.id === po.id)!;
    expect([o.status, o.closedReason]).toEqual(["closed", "Supplier out of stock"]);
    await expect(postGrnTx(ctx, grn(local, "PP/3", [line("PO1", 5, "100", item.id)], po.id))).rejects.toThrow(/closed short/);

    const po2 = await createPo(ctx, { supplierId: local, lines: [{ medicineId: med, qty: "4", rate: "100" }] });
    await setPoStatus(ctx, po2.id, "place");
    await setPoStatus(ctx, po2.id, "cancel", "Ordered twice");
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po2.id } })).status).toBe("cancelled");

    const s = (await listSuppliers(ctx)).find((x) => x.id === local)!;
    expect([s.accuracy, s.onTime, s.orders]).toEqual([50, 50, 1]);
    expect((await listSuppliers(ctx)).find((x) => x.id === far)!.accuracy).toBeNull();
  });

  it("discards an uploaded invoice stuck in review", async () => {
    const ctx = await ctxFor("Manager");
    const doc = await db.scanDocument.create({ data: { tenantId: ctx.tenantId, fileName: "inv.pdf", sha256: "x", status: "review", extracted: { invoiceNo: "Z/1", lines: [] }, confidence: {}, createdBy: ctx.userId } });
    expect((await pendingScans(ctx)).map((d) => [d.id, d.extracted?.invoiceNo])).toEqual([[doc.id, "Z/1"]]);
    await expect(discardScan(ctx, doc.id, "")).rejects.toThrow(/why/);
    await discardScan(ctx, doc.id, "Duplicate upload");
    expect((await db.scanDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("rejected");
    expect(await pendingScans(ctx)).toEqual([]);
    await expect(discardScan(ctx, doc.id, "Again please")).rejects.toThrow(/already rejected/);
    await expect(postGrnTx(ctx, { ...grn(local, "PP/9", [line("ZZ1", 1)]), scanDocId: doc.id })).rejects.toThrow(/already posted or discarded/);
  });

  it("raises supplier returns for recalled batches in one step", async () => {
    const ctx = await ctxFor();
    await db.supplier.update({ where: { id: far }, data: { acceptsReturns: false } });
    await addRecall(ctx, { medicineId: med, batches: "IG1, OP1", source: "CDSCO alert 12/2026", publishedAt: todayISO(), reason: "Not of standard quality" });
    const r = (await listRecalls(ctx))[0];
    expect(r.matches.filter((m) => m.returnable).map((m) => m.batchNo)).toEqual(["IG1"]);
    await expect(returnRecalled(await ctxFor("Pharmacist"), r.id)).rejects.toThrow(/role/);
    await setRecallStatus(ctx, r.id, "supplier_return");
    expect((await batch("IG1")).qtyAvailable).toBe(0);
    expect((await db.recall.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("supplier_return");
    const so = await db.stockOut.findFirstOrThrow({ where: { reason: `Recall ${r.ref}` } });
    expect([so.kind, so.qty, so.supplierId]).toEqual(["supplier_return", 8, far]);
    await expect(returnRecalled(ctx, r.id)).rejects.toThrow(/No recalled stock/);
  });

  it("prints supplier and customer statements with opening, movements and closing", async () => {
    const ctx = await ctxFor();
    await paySupplier(ctx, { partyId: local, amount: "500", method: "Cash" });
    const s = await partyStatement(ctx, "supplier", local, todayISO(), todayISO());
    expect(s.opening).toBe(0);
    expect(s.rows.map((r) => r.kind)).toEqual(["Bill", "Bill", "Payment"]);
    expect(s.closing).toBe((await listSuppliers(ctx)).find((x) => x.id === local)!.balance);
    const tomorrow = await partyStatement(ctx, "supplier", local, addDays(todayISO(), 1), addDays(todayISO(), 2));
    expect([tomorrow.opening, tomorrow.rows.length, tomorrow.closing]).toEqual([s.closing, 0, s.closing]);
    const far1 = await partyStatement(ctx, "supplier", far, todayISO(), todayISO());
    expect(far1.rows.map((r) => r.kind)).toEqual(["Bill", "Debit note", "Debit note"]);
    expect(far1.closing).toBe(112000 - 22400 - 89600);

    const cust = await saveCustomer(ctx, null, { name: "Ravi Kulkarni", phone: "9822011111", creditLimit: "2000", waOptIn: false, opening: "300" });
    await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: (await batch("GR1")).id, qty: 1 }], customerId: cust, discountPct: 0, pay: { mode: "credit" } });
    await receiveFromCustomer(ctx, { partyId: cust, amount: "100", method: "Cash" });
    const c = await partyStatement(ctx, "customer", cust);
    expect(c.rows.map((r) => [r.kind, r.debit, r.credit])).toEqual([["Opening balance", 30000, 0], ["Credit sale", 15000, 0], ["Receipt", 0, 10000]]);
    expect(c.closing).toBe(35000);
    const csv = statementCsv(c);
    expect(csv[1]).toEqual([c.fromDay, "", "", "Opening balance", "", "", "0.00"]);
    expect(csv[csv.length - 1][6]).toBe("350.00");
    await expect(partyStatement(await ctxFor("Cashier"), "customer", cust)).rejects.toThrow(/role/);
    await expect(partyStatement(ctx, "customer", randomUUID())).rejects.toThrow(/not found/);
    await expect(partyStatement(ctx, "supplier", local, "2026-12-01", "2026-11-01")).rejects.toThrow(/after the end/);
  });

  it("shows an account ledger with running balance and a balanced trial balance", async () => {
    const ctx = await ctxFor();
    const cash = await accountLedger(ctx, "Cash in hand", todayISO(), todayISO());
    expect(cash.opening).toBe(0);
    expect(cash.rows.at(-1)!.balance).toBe(cash.closing);
    expect(cash.closing).toBe(cash.totalDr - cash.totalCr);
    expect(cash.closing).toBe((await accountsOverview(ctx, periodOf("month"))).cash.cash);
    const cred = await accountLedger(ctx, "Sundry creditors", todayISO(), todayISO());
    expect(cred.rows.find((r) => r.narration.startsWith("Payment to"))!.party).toBe("Pune Pharma");
    const tb = await trialBalance(ctx);
    expect(tb.dr).toBe(tb.cr);
    const c = tb.rows.find((r) => r.account === "Cash in hand")!;
    expect(c.dr - c.cr).toBe(cash.closing);
    const csv = await reportRows(ctx, "trial-balance", periodOf("month"));
    expect(csv.at(-1)).toEqual(["Total", (tb.dr / 100).toFixed(2), (tb.cr / 100).toFixed(2)]);
    await expect(trialBalance(await ctxFor("Cashier"))).rejects.toThrow(/role/);
  });
});
