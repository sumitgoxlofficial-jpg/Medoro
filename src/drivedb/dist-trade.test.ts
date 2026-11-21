import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, receiveStock } from "./pharmacy";
import { addCustomer, addSupplier, customerBalance } from "./trade";
import { gstReturns } from "./books";
import { listCheques } from "./cheques";
import { cancelInvoice, directInvoice, invoiceView, saveChemist, saveCompany, saveProduct } from "./dist";
import { approveOrder, confirmPickLine, invoiceOrder, packOrder, pickList, placeOrder, statusOf } from "./dist-orders";
import { chemistStatement, collectPayment, collectionsOn, createDispatch, createReturn, deliveryOf, dispatchBoard, expiryWorkbench, raiseDistClaim, receivables, recordDelivery, returnedPool, savePrincipal, startDispatch } from "./dist-trade";
import { addDays, todayISO } from "@/lib/dates";

const G = "godown-1", U = "u1", today = todayISO(), GSTIN = "27AAKFS3192P1Z6";
let db: DriveDB, med = "", chem = "", co = "", sup = "", n = 0;
const key = () => `k-${++n}-${Date.now()}`;
const batchId = (no: string) => db.engine.all<{ id: string }>("SELECT id FROM batch WHERE batchNo = ?", [no])[0].id;
const stockUnits = (no: string) => Number(db.engine.all<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId = ?", [batchId(no)])[0].q);
const bill = (qty: number, customerId = chem) => directInvoice(db, { branchId: G, customerId, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty }] }, today);

beforeEach(async () => {
  db = await memoryDb("DIST3");
  db.setMeta("pharmacy", JSON.stringify({ gstin: GSTIN }));
  // Strips of 10, PTR ₹50, cost ₹40, GST 12%. One batch close to expiry (60 days), one later.
  med = addMedicine(db, { name: "Amoxyclav 625", gstRate: 12, mrpPaise: 8000, packSize: 10, hsn: "30042019" }).id;
  sup = addSupplier(db, { name: "Acme Depot" }).id;
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "SOON", expiryDate: addDays(today, 60), qty: 10 * 30, costPaise: 4000, mrpPaise: 8000, userId: U });
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "LATE", expiryDate: addDays(today, 500), qty: 10 * 100, costPaise: 4000, mrpPaise: 8000, userId: U });
  co = saveCompany(db, null, { name: "Acme Pharma" });
  saveProduct(db, { medicineId: med, companyId: co, ptrPaise: 5000 });
  chem = addCustomer(db, { name: "Sai Medical", phone: "9822000333", gstin: "27AAPFU0939F1ZV", creditLimitPaise: 1_000_000_00 }).id;
  saveChemist(db, { customerId: chem, stateCode: "27", dl20b: "MH-PZ-20B-123", dlExpiry: addDays(today, 300), creditDays: 21 });
});

describe("credit notes", () => {
  it("saleable goods go back to stock, expired / damaged ones wait to be claimed; credit and GST follow the share and credit %", () => {
    const inv = bill(10); // all from SOON (FEFO), ₹500 + ₹60 GST = ₹560
    const line = invoiceView(db, inv.invoiceId)!.lines[0];
    const r = createReturn(db, { invoiceId: inv.invoiceId, userId: U, reason: "Short-dated and broken strips", lines: [{ invoiceLineId: String(line.id), qty: 4, condition: "expired", creditPct: 80 }] }, today);
    // 4 of 10 packs: taxable ₹200 → 80% = ₹160, GST ₹24 → ₹19.20; credit ₹179.20.
    expect(r.total).toBe(17920);
    expect(r.no).toMatch(/^C/);
    expect(customerBalance(db, chem)).toBe(56000 - 17920);
    expect(stockUnits("SOON")).toBe(200); // not back on the shelf
    expect(returnedPool(db, batchId("SOON"))).toBe(40);
    createReturn(db, { invoiceId: inv.invoiceId, userId: U, reason: "Not needed", lines: [{ invoiceLineId: String(line.id), qty: 2, condition: "saleable" }] }, today);
    expect(stockUnits("SOON")).toBe(220);
    expect(() => createReturn(db, { invoiceId: inv.invoiceId, userId: U, reason: "Again", lines: [{ invoiceLineId: String(line.id), qty: 5, condition: "saleable" }] }, today)).toThrow(/4 can still be returned/);
    // An invoice with a credit note can't be cancelled.
    expect(() => cancelInvoice(db, { invoiceId: inv.invoiceId, reason: "Mistake made", userId: U }, today)).toThrow(/credit note/);
  });
});

describe("expiry claims on the company", () => {
  it("claims returned goods first, then shelf stock, inside the principal's window", () => {
    savePrincipal(db, { companyId: co, supplierId: sup, claimBeforeDays: 90, claimCreditPct: 80 });
    const inv = bill(10);
    createReturn(db, { invoiceId: inv.invoiceId, userId: U, reason: "Near expiry", lines: [{ invoiceLineId: String(invoiceView(db, inv.invoiceId)!.lines[0].id), qty: 3, condition: "expired" }] }, today);
    const wb = expiryWorkbench(db, G, 180, today);
    expect(wb).toHaveLength(1); // only SOON expires within 180 days
    expect(wb[0]).toMatchObject({ batchNo: "SOON", onShelf: 20, returned: 3, eligible: true, creditPct: 80, band: "60" });
    const c = raiseDistClaim(db, { branchId: G, batchId: batchId("SOON"), userId: U, qty: 5, reason: "near_expiry" }, today);
    expect(c).toMatchObject({ fromReturns: 3, value: 5 * 4000 + 2400 });
    expect(returnedPool(db, batchId("SOON"))).toBe(0);
    expect(stockUnits("SOON")).toBe(200 - 20); // 2 packs from the shelf
    expect(db.engine.all("SELECT 1 FROM supplierClaim").length).toBe(1);
    // LATE is far from expiry: outside the window (breakage is always claimable).
    expect(() => raiseDistClaim(db, { branchId: G, batchId: batchId("LATE"), userId: U, qty: 1, reason: "expiry" }, today)).toThrow();
    expect(raiseDistClaim(db, { branchId: G, batchId: batchId("LATE"), userId: U, qty: 1, reason: "breakage" }, today).fromReturns).toBe(0);
  });
});

describe("dispatch and delivery", () => {
  it("plan → out → delivered with cash collected; a failed drop goes back to the desk; the order follows", () => {
    const o = placeOrder(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 5 }] }, today);
    approveOrder(db, { orderId: o.orderId, userId: U }, today);
    for (const p of pickList(db, o.orderId)) confirmPickLine(db, { pickLineId: p.id, pickedUnits: p.units, userId: U });
    packOrder(db, { orderId: o.orderId, boxes: 1, userId: U });
    const inv = invoiceOrder(db, { orderId: o.orderId, userId: U }, today); // ₹280
    const other = bill(1);
    expect(dispatchBoard(db, G).pending.map((x) => x.id).sort()).toEqual([inv.invoiceId, other.invoiceId].sort());

    const d = createDispatch(db, { branchId: G, userId: U, vehicleNo: "mh12 ab 1234", invoiceIds: [inv.invoiceId, other.invoiceId] }, today);
    expect(() => createDispatch(db, { branchId: G, userId: U, invoiceIds: [inv.invoiceId] }, today)).toThrow(/already on another dispatch/);
    expect(deliveryOf(db, inv.invoiceId).status).toBe("planned");
    expect(startDispatch(db, { dispatchId: d.dispatchId, userId: U })).toBe(2);
    expect(() => startDispatch(db, { dispatchId: d.dispatchId, userId: U })).toThrow(/already left/);
    expect(statusOf(db, o.orderId)).toBe("dispatched");

    expect(() => recordDelivery(db, { invoiceId: inv.invoiceId, userId: U, outcome: "delivered" }, today)).toThrow(/who received/);
    recordDelivery(db, { invoiceId: inv.invoiceId, userId: U, outcome: "delivered", receiverName: "Ramesh (owner)", collectedPaise: 20000, mode: "cash" }, today);
    expect(statusOf(db, o.orderId)).toBe("delivered");
    expect(customerBalance(db, chem)).toBe(28000 + other.total - 20000);
    expect(collectionsOn(db, today)).toMatchObject([{ customer: "Sai Medical", amountPaise: 20000, mode: "cash" }]);
    expect(() => cancelInvoice(db, { invoiceId: inv.invoiceId, reason: "Mistake made", userId: U }, today)).toThrow(/Delivered invoices/);

    recordDelivery(db, { invoiceId: other.invoiceId, userId: U, outcome: "failed", note: "Shop closed" }, today);
    expect(deliveryOf(db, other.invoiceId)).toMatchObject({ status: "pending", failReason: "Shop closed" });
    const board = dispatchBoard(db, G);
    expect(board.pending.map((x) => x.id)).toEqual([other.invoiceId]);
    expect(board.trips[0]).toMatchObject({ no: d.no, status: "closed" });
    // It can go out again on the next trip.
    createDispatch(db, { branchId: G, userId: U, invoiceIds: [other.invoiceId] }, today);
    expect(deliveryOf(db, other.invoiceId).status).toBe("planned");
  });

  it("a cheque collected at the door is tracked as a cheque", () => {
    const inv = bill(10);
    const d = createDispatch(db, { branchId: G, userId: U, invoiceIds: [inv.invoiceId] }, today);
    startDispatch(db, { dispatchId: d.dispatchId, userId: U });
    recordDelivery(db, { invoiceId: inv.invoiceId, userId: U, outcome: "delivered", receiverName: "Sai", collectedPaise: 56000, mode: "cheque", chequeNo: "445566", bank: "HDFC" }, today);
    expect(listCheques(db, {}, today)).toMatchObject([{ chequeNo: "445566", amountPaise: 56000, status: "pending" }]);
    expect(customerBalance(db, chem)).toBe(0);
  });
});

describe("collections, receivables and statements", () => {
  it("salesmen collect only from their chemists; ageing and the statement follow the bills", () => {
    saveChemist(db, { customerId: chem, stateCode: "27", dl20b: "MH-PZ-20B-123", dlExpiry: addDays(today, 300), creditDays: 21, salesmanId: "sm-1" });
    const a = bill(20); // ₹1,120
    expect(() => collectPayment(db, { customerId: chem, userId: U, amountPaise: 10000, mode: "cash", salesmanId: "sm-2", canApprove: false }, today)).toThrow(/isn’t assigned to you/);
    expect(collectPayment(db, { customerId: chem, userId: U, amountPaise: 12000, mode: "upi", salesmanId: "sm-1", canApprove: false }, today).balancePaise).toBe(a.total - 12000);
    expect(() => collectPayment(db, { customerId: chem, userId: U, amountPaise: 999_999_00, mode: "cash" }, today)).toThrow(/owes only/);
    const [r] = receivables(db, addDays(today, 40));
    expect(r).toMatchObject({ name: "Sai Medical", balance: a.total - 12000, overdue: a.total - 12000, oldestDays: 40 });
    expect(r.buckets["31-60"]).toBe(a.total - 12000);
    const st = chemistStatement(db, chem);
    expect(st.rows.map((x) => [x.dr, x.cr])).toEqual([[a.total, 0], [0, 12000]]);
    expect(st.closing).toBe(a.total - 12000);
  });
});

describe("GST returns include wholesale invoices and credit notes", () => {
  it("B2B invoices, credit notes, cancelled documents and the HSN summary", () => {
    const a = bill(10), b = bill(1);
    createReturn(db, { invoiceId: a.invoiceId, userId: U, reason: "Damaged", lines: [{ invoiceLineId: String(invoiceView(db, a.invoiceId)!.lines[0].id), qty: 1, condition: "damaged" }] }, today);
    cancelInvoice(db, { invoiceId: b.invoiceId, reason: "Wrong chemist", userId: U }, today);
    const g = gstReturns(db, today.slice(0, 7), GSTIN);
    expect(g.invoices).toBe(1);
    expect(g.creditNotes).toBe(1);
    const gs = g.gstr1 as unknown as { b2b?: { ctin: string; inv: { inum: string }[] }[]; cdnr?: unknown[]; doc_issue?: unknown };
    expect(gs.b2b?.[0]).toMatchObject({ ctin: "27AAPFU0939F1ZV", inv: [{ inum: invoiceView(db, a.invoiceId)!.no }] });
    expect(gs.cdnr?.length).toBe(1);
    expect(JSON.stringify(gs)).toContain(invoiceView(db, b.invoiceId)!.no); // listed as cancelled
    expect(g.hsnCsv.map((r) => r[1])).toContain("30042019");
  });
});
