import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { approveSupplierInvoice, createPo, listOrders, postGrnTx } from "@/domain/purchasing/service";
import { parseEbill } from "@/domain/purchasing/ebill-service";
import { priceComparison } from "@/domain/intelligence/service";
import { inputGstByRate, periodOf } from "@/domain/accounting/service";
import { acknowledgeClaim, creditClaim, listClaims, nearExpiryClaims, raiseClaim } from "@/domain/inventory/claims";
import { returnToSupplier } from "@/domain/inventory/adjust";
import { saveSupplier } from "@/domain/parties/service";
import { commitSale } from "@/domain/sales/service";
import { salesMargins, stockMargins } from "@/domain/reports/margins";
import { ACC } from "@/domain/accounting/accounts";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const fx = (f: string) => new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/ebill", f)));
const exp = addDays(todayISO(), 500).slice(0, 7);
let sup = "", sup2 = "", dolo = "", pan = "";

/** Balance (debit − credit) of an account, optionally for one voucher's lines only. */
async function bal(account: string, refType?: string) {
  const r = await db.ledgerLine.aggregate({ where: { account, ...(refType ? { voucher: { refType } } : {}) }, _sum: { debitPaise: true, creditPaise: true } });
  return Number((r._sum.debitPaise ?? 0n) - (r._sum.creditPaise ?? 0n));
}
const setRules = async (purchasing: object) => { const t = await db.tenant.findFirstOrThrow(); await db.tenant.update({ where: { id: t.id }, data: { settings: { ...(t.settings as object), purchasing } } }); };

describe("purchase pricing, e-bills and claims", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    sup = await saveSupplier(ctx, null, { name: "Mahavir Medical Agencies", creditDays: "30", returnWindowDays: "90" });
    sup2 = await saveSupplier(ctx, null, { name: "Kalyan Distributors", creditDays: "15" });
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "" };
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", gstRate: 12 });
    pan = await createMedicine(ctx, { ...base, name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", mrp: "155", gstRate: 12, barcode: "8901234567890" });
  });

  it("GRN with scheme and discounts: landed cost, free stock, purchase value and input GST", async () => {
    const ctx = await ctxFor("Manager");
    // 100 × ₹24 PTR on a 10+2 scheme (20 free), 5% trade, 2% cash, 12% GST on the net value.
    const r = await postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/10", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: dolo, batchNo: "SCH1", expiry: exp, qty: 100, freeQty: "", scheme: "10+2", rate: "24", pts: "21.50", mrp: "33.60", tradePct: "5", cashPct: "2", poItemId: null }] });
    expect(r.total).toBe(250300); // 2234.40 + 268.13 = 2502.53 → rounded
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "SCH1" } });
    expect([b.qtyAvailable, b.costPaise]).toEqual([120, 1862n]); // 223440 / 120
    const gi = await db.grnItem.findFirstOrThrow({ where: { batchId: b.id } });
    expect([gi.freeQty, gi.discPaise, gi.basePaise, gi.gstPaise, gi.costPaise, gi.ptsPaise, gi.scheme]).toEqual([20, 16560n, 223440n, 26813n, 1862n, 2150n, "10+2"]);
    expect(await bal(ACC.purchases, "grn")).toBe(223440);
    expect((await bal(ACC.inCgst, "grn")) + (await bal(ACC.inSgst, "grn"))).toBe(26813);
    expect(await bal(ACC.creditors, "grn")).toBe(-250300);
    const gst = await inputGstByRate(ctx.tenantId, periodOf("fy"), null);
    expect(gst.find((g) => g.rate === 12)).toMatchObject({ taxable: 223440, tax: 26813 });
  });

  it("GST base and input-credit rules are configurable per pharmacy and stored on each GRN", async () => {
    const ctx = await ctxFor("Manager");
    await setRules({ gstBase: "before_cd", itc: true });
    const line = { medicineId: pan, batchNo: "BCD1", expiry: exp, qty: 10, freeQty: 0, rate: "100", mrp: "155", cashPct: "10", poItemId: null };
    await postGrnTx(ctx, { supplierId: sup2, invoiceNo: "KD/1", invoiceDate: todayISO(), statedTotal: "1020", poId: null, scanDocId: null, lines: [line] }); // 900 + 12% of 1000
    const g1 = await db.grn.findFirstOrThrow({ where: { supplierInvoiceNo: "KD/1" }, include: { items: true } });
    expect([g1.gstBase, g1.items[0].basePaise, g1.items[0].gstPaise, g1.items[0].costPaise]).toEqual(["before_cd", 100000n, 12000n, 9000n]);
    await setRules({ gstBase: "net", itc: false }); // composition dealer: GST is cost
    const before = await bal(ACC.inCgst);
    await postGrnTx(ctx, { supplierId: sup2, invoiceNo: "KD/2", invoiceDate: todayISO(), statedTotal: "1008", poId: null, scanDocId: null, lines: [{ ...line, batchNo: "NOITC" }] });
    const g2 = await db.grn.findFirstOrThrow({ where: { supplierInvoiceNo: "KD/2" } });
    const v = await db.voucher.findFirstOrThrow({ where: { refId: g2.id }, include: { lines: true } });
    expect(v.lines.find((l) => l.account === ACC.purchases)?.debitPaise).toBe(100800n);
    expect(await bal(ACC.inCgst)).toBe(before);
    expect((await db.batch.findFirstOrThrow({ where: { batchNo: "NOITC" } })).costPaise).toBe(10080n);
    // A debit note on a no-ITC batch returns its full cost to Purchases without reversing GST that was never claimed.
    const nb = await db.batch.findFirstOrThrow({ where: { batchNo: "NOITC" } });
    await returnToSupplier(ctx, nb.id, 1, "Damaged in transit");
    const dn = await db.voucher.findFirstOrThrow({ where: { refType: "supplier_return" }, include: { lines: true }, orderBy: { postedAt: "desc" } });
    expect(dn.lines.map((l) => [l.account, Number(l.debitPaise), Number(l.creditPaise)]).sort()).toEqual([[ACC.purchases, 0, 10080], [ACC.creditors, 10080, 0]].sort());
    await setRules({ gstBase: "net", itc: true });
  });

  it("POs carry PTR, free quantity and discounts; supplier price comparison uses landed cost", async () => {
    const ctx = await ctxFor("Manager");
    await createPo(ctx, { supplierId: sup, lines: [{ medicineId: dolo, qty: "50", rate: "24", scheme: "10+2", tradePct: "5", mrp: "33.60" }] });
    const po = (await listOrders(ctx))[0];
    expect(po.items[0]).toMatchObject({ freeQty: 10, scheme: "10+2", tradePct: 5, mrp: 3360, net: 114000 });
    expect(po.total).toBe(114000);
    // Kalyan: ₹23 flat, no scheme → landed 23.00, dearer than Mahavir's 18.62 even though its PTR is lower.
    await postGrnTx(ctx, { supplierId: sup2, invoiceNo: "KD/3", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: dolo, batchNo: "KD3", expiry: exp, qty: 10, freeQty: 0, rate: "23", mrp: "33.60", poItemId: null }] });
    const p = (await priceComparison(ctx)).find((x) => x.name === "Dolo 650")!;
    expect(p.best).toBe("Mahavir Medical Agencies");
    expect(p.quotes.find((q) => q.supplier === "Mahavir Medical Agencies")).toMatchObject({ rate: 1862, ptr: 2400, deal: "10+2" });
    expect(p.quotes.find((q) => q.supplier === "Kalyan Distributors")).toMatchObject({ rate: 2300, ptr: 2300 });
  });

  it("e-bill import: header detection, matching by barcode / code / learned name, saved mappings", async () => {
    const ctx = await ctxFor("Manager");
    const r = await parseEbill(ctx, sup, "marg-retailer.csv", fx("marg-retailer.csv"));
    if (r.needsMapping) throw new Error("expected a parsed draft");
    expect(r.draft.invoiceNo).toBe("MMA/2627/0412");
    const [d, p, a] = r.draft.lines;
    expect([d.medicineId, d.matchedBy, d.confidence]).toEqual([dolo, "name", 0.79]);
    expect([p.medicineId, p.matchedBy]).toEqual([pan, "name"]);
    expect(a.medicineId).toBeNull();
    // Posting the GRN remembers the supplier's code and name for these medicines.
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: r.draft.invoiceNo, invoiceDate: r.draft.invoiceDate, statedTotal: null, poId: null, scanDocId: null,
      lines: [d, p].map((l) => ({ medicineId: l.medicineId!, batchNo: l.batch, expiry: l.expiry!, qty: l.qty, freeQty: l.free, rate: l.ptr! / 100, mrp: l.mrp! / 100, tradePct: l.discPct, poItemId: null, supplierCode: l.code, sourceName: `${l.name} ${l.pack}` })) });
    const again = await parseEbill(ctx, sup, "marg-retailer.csv", fx("marg-retailer.csv"));
    if (again.needsMapping) throw new Error("expected a parsed draft");
    expect(again.draft.lines.slice(0, 2).map((l) => [l.matchedBy, l.confidence])).toEqual([["code", 1], ["code", 1]]);
    // A headerless pipe file needs a mapping once; it is then saved for the supplier.
    const pipe = await parseEbill(ctx, sup2, "pipe-distributor.txt", fx("pipe-distributor.txt"));
    expect(pipe.needsMapping).toBe(true);
    const mapping = { headerRow: -1, rowFilter: { col: 0, value: "D" }, cols: { code: 1, name: 2, pack: 3, batch: 4, expiry: 5, qty: 6, free: 7, scheme: 8, mrp: 9, ptr: 10, gst: 11, schemePct: 12, cdPct: 13 } };
    const mapped = await parseEbill(ctx, sup2, "pipe-distributor.txt", fx("pipe-distributor.txt"), mapping, true);
    expect(mapped.needsMapping).toBe(false);
    const saved = await parseEbill(ctx, sup2, "pipe-distributor.txt", fx("pipe-distributor.txt"));
    if (saved.needsMapping) throw new Error("expected the saved mapping to apply");
    expect(saved.draft.lines.map((l) => [l.batch, l.qty, l.free, l.scheme, l.cdPct])).toEqual([["CR6612", 50, 5, "10+1", 2], ["ZV0091", 30, 0, "", 0]]);
    await expect(parseEbill(await ctxFor("Cashier"), sup, "x.csv", fx("marg-retailer.csv"))).rejects.toThrow(/role/);
  });

  it("expiry and breakage claims: raise, partial credit, write-off, rejection, aging", async () => {
    const ctx = await ctxFor("Manager");
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "SCH1" } });
    const payable = await bal(ACC.creditors);
    const no = await raiseClaim(ctx, { batchId: b.id, qty: 10, reason: "expiry", note: "handed to salesman" });
    expect(no).toMatch(/^CLM-\d{4}-0001$/);
    expect((await db.batch.findUniqueOrThrow({ where: { id: b.id } })).qtyAvailable).toBe(110);
    expect(await bal(ACC.claims)).toBe(20854); // 10 × 18.62 = 186.20 + 12% GST 22.34
    expect(await bal(ACC.creditors)).toBe(payable); // nothing off the payable until the credit note
    const c = await db.supplierClaim.findFirstOrThrow({ where: { no } });
    await acknowledgeClaim(ctx, c.id);
    await expect(acknowledgeClaim(ctx, c.id)).rejects.toThrow(/already acknowledged/);
    await expect(creditClaim(ctx, c.id, { ref: "", amount: "100" })).rejects.toThrow(/credit note number/);
    expect(await creditClaim(ctx, c.id, { ref: "CN/77", amount: "150" })).toEqual({ status: "acknowledged", open: 5854 });
    expect(await bal(ACC.creditors)).toBe(payable + 15000);
    await expect(creditClaim(ctx, c.id, { ref: "", amount: 0, close: true })).rejects.toThrow(/why/);
    expect((await creditClaim(ctx, c.id, { ref: "", amount: 0, close: true, reason: "Supplier credits 80% of value" })).status).toBe("credited");
    expect([await bal(ACC.claims), await bal(ACC.claimLoss)]).toEqual([0, 5854]);
    const c2 = await raiseClaim(ctx, { batchId: b.id, qty: 2, reason: "breakage" });
    let list = await listClaims(ctx);
    expect(list.aging).toEqual([expect.objectContaining({ supplier: "Mahavir Medical Agencies", count: 1, open: 4171 })]);
    const id2 = list.rows.find((r) => r.no === c2)!.id;
    expect((await creditClaim(ctx, id2, { amount: 0, close: true, reason: "Breakage not covered" })).status).toBe("rejected");
    list = await listClaims(ctx);
    expect(list.aging).toEqual([]);
    expect(await bal(ACC.claimLoss)).toBe(5854 + 4171);
    await expect(raiseClaim(ctx, { batchId: b.id, qty: 999, reason: "expiry" })).rejects.toThrow(/Only 108/);
    const gst = await inputGstByRate(ctx.tenantId, periodOf("fy"), null);
    expect(gst.find((g) => g.rate === 12)!.retTaxable).toBeGreaterThanOrEqual(18620 + 3724);
  });

  it("suggests near-expiry claims inside each supplier's return window", async () => {
    const ctx = await ctxFor("Manager");
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/NE", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: pan, batchNo: "NEAR1", expiry: addDays(todayISO(), 60), qty: 4, freeQty: 0, rate: "110", mrp: "155", poItemId: null }] });
    let s = await nearExpiryClaims(ctx);
    expect(s.find((g) => g.supplierId === sup)?.items.map((i) => i.batchNo)).toEqual(["NEAR1"]);
    await saveSupplier(ctx, sup, { name: "Mahavir Medical Agencies", creditDays: "30", returnWindowDays: "30" });
    s = await nearExpiryClaims(ctx);
    expect(s.find((g) => g.supplierId === sup)).toBeUndefined();
  });

  it("margins use landed cost: by supplier and on stock in hand", async () => {
    const ctx = await ctxFor();
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "SCH1" } });
    await commitSale(ctx, { idempotencyKey: randomUUID().replace(/-/g, ""), lines: [{ medicineId: dolo, batchId: b.id, qty: 10 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const by = await salesMargins(ctx, new Date(Date.now() - 86400_000), new Date(Date.now() + 60_000), "supplier");
    expect(by.find((r) => r.name === "Mahavir Medical Agencies")).toMatchObject({ qty: 10, sales: 30000, cost: 18620, margin: 11380, pct: 37.93 });
    expect((await salesMargins(ctx, new Date(Date.now() - 86400_000), new Date(Date.now() + 60_000), "category"))[0]).toMatchObject({ name: "Tablet" });
    const st = (await stockMargins(ctx)).find((r) => r.id === dolo)!;
    expect(st.pct).toBeGreaterThan(20);
  });

  it("GRN in packs with a scheme from an uploaded invoice: printed total, verified lines, stock units and per-pack cost", async () => {
    const ctx = await ctxFor("Manager");
    const strip = await createMedicine(ctx, { name: "Cetzine 10", generic: "Cetirizine", strength: "10 mg", form: "Tablet", manufacturer: "Dr Reddy's", pack: "10", mrp: "20", gstRate: 12, schedule: "", reorderLevel: 0, barcode: "", hsn: "3004", rack: "",
      packSize: 10, packUnit: "strip", looseUnit: "tab", allowLoose: true });
    const doc = await db.scanDocument.create({ data: { tenantId: ctx.tenantId, fileName: "kd77.pdf", storagePath: "scans/kd77.pdf", mime: "application/pdf", sha256: "x", status: "review", extracted: { lines: [{ text: "CETZINE 10 TAB 10x10", qty: 10, confidence: 0.5 }] }, confidence: {}, createdBy: ctx.userId } });
    const line = { medicineId: strip, batchNo: "CZ1", expiry: exp, qty: 10, freeQty: "", scheme: "10+2", rate: "12", mrp: "20", poItemId: null, ocrIndex: 0 };
    // 10 strips × ₹12 = ₹120 + 12% GST = ₹134.40; the invoice prints ₹134.
    const inv = { supplierId: sup2, invoiceNo: "KD/77", invoiceDate: todayISO(), poId: null, scanDocId: doc.id, lines: [line] };
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: null })).rejects.toThrow(/total printed/);
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: "134" })).rejects.toThrow(/low confidence/);
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: "150", lines: [{ ...line, verified: true }] })).rejects.toThrow(/Totals don’t match/);
    expect((await approveSupplierInvoice(ctx, { ...inv, statedTotal: "134", lines: [{ ...line, verified: true }] })).total).toBe(13400);
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "CZ1" } });
    // 12 strips (2 free) of 10 tabs held as 120 tabs; landed cost per strip spreads the free goods: 12000 / 12.
    expect([b.qtyAvailable, b.costPaise]).toEqual([120, 1000n]);
    expect((await db.stockMovement.findFirstOrThrow({ where: { batchId: b.id, type: "grn" } })).qty).toBe(120);
    expect((await db.grnItem.findFirstOrThrow({ where: { batchId: b.id } })).freeQty).toBe(2);
    // Top-up: 5 strips at ₹13, blended per strip and weighted by tabs: (120 × 1000 + 6500 × 10) / 170.
    await postGrnTx(ctx, { supplierId: sup2, invoiceNo: "KD/78", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null, lines: [{ ...line, qty: 5, scheme: "", rate: "13", ocrIndex: undefined }] });
    expect(await db.batch.findFirstOrThrow({ where: { id: b.id } })).toMatchObject({ qtyAvailable: 170, costPaise: 1088n });
    // Stock in hand is valued per strip: 17 strips at ₹17.86 ex-GST and ₹10.88 cost.
    expect((await stockMargins(ctx)).find((r) => r.id === strip)).toMatchObject({ qty: 170, sell: 30362, cost: 18496 });
    // A debit note for 5 tabs reverses half a strip at cost.
    await returnToSupplier(ctx, b.id, 5, "Damaged strip");
    const dn = await db.voucher.findFirstOrThrow({ where: { refType: "supplier_return" }, include: { lines: true }, orderBy: { postedAt: "desc" } });
    expect(dn.lines.find((l) => l.account === ACC.purchases)?.creditPaise).toBe(544n);
  });
});
