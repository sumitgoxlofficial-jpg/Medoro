import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { createPo, listOrders, postGrnTx, setPoStatus } from "@/domain/purchasing/service";
import { saveSupplier } from "@/domain/parties/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let sup = "", dolo = "", pan = "";
const exp = addDays(todayISO(), 500).slice(0, 7);

describe("purchasing", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    sup = await saveSupplier(ctx, null, { name: "Mahavir", creditDays: "30" });
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "" };
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", gstRate: 12 });
    pan = await createMedicine(ctx, { ...base, name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", mrp: "155", gstRate: 12 });
  });

  it("PO → partial GRN → full GRN, with totals check and duplicates blocked", async () => {
    const ctx = await ctxFor("Manager");
    const po = await createPo(ctx, { supplierId: sup, lines: [{ medicineId: dolo, qty: "100", rate: "24" }, { medicineId: pan, qty: "20", rate: "110" }] });
    expect(po.no).toMatch(/^PO-\d{4}-0001$/);
    const items = (await listOrders(ctx))[0].items;
    const line = (medicineId: string, batchNo: string, qty: number, rate: string, mrp: string, poItemId: string | null, freeQty = 0) => ({ medicineId, batchNo, expiry: exp, qty, freeQty, rate, mrp, poItemId });
    const grn = { supplierId: sup, invoiceNo: "MMA/1", invoiceDate: todayISO(), poId: po.id, scanDocId: null };
    await expect(postGrnTx(ctx, { ...grn, statedTotal: "2688", lines: [line(dolo, "DL1", 100, "24", "33.60", items[0].id)] })).rejects.toThrow(/draft/);
    await setPoStatus(ctx, po.id, "place");
    // 100 × 24 = 2400 + 12% = 2688
    await expect(postGrnTx(ctx, { ...grn, statedTotal: "2700", lines: [line(dolo, "DL1", 100, "24", "33.60", items[0].id)] })).rejects.toThrow(/don’t match/);
    await expect(postGrnTx(ctx, { ...grn, statedTotal: null, lines: [line(dolo, "DL1", 101, "24", "33.60", items[0].id)] })).rejects.toThrow(/ordered 100/);
    await expect(postGrnTx(ctx, { ...grn, statedTotal: null, lines: [line(pan, "PN1", 5, "110", "155", items[0].id)] })).rejects.toThrow(/doesn’t match an item/);
    await expect(postGrnTx(ctx, { ...grn, poId: null, statedTotal: null, lines: [line(dolo, "DL1", 5, "24", "33.60", items[0].id)] })).rejects.toThrow(/purchase order/);
    await expect(postGrnTx(await ctxFor("Manager", "Second"), { ...grn, statedTotal: null, lines: [line(dolo, "DL1", 5, "24", "33.60", items[0].id)] })).rejects.toThrow(/another branch/);
    await postGrnTx(ctx, { ...grn, statedTotal: "2688", lines: [line(dolo, "DL1", 100, "24", "33.60", items[0].id)] });
    expect((await listOrders(ctx))[0].status).toBe("partially_received");
    await expect(postGrnTx(ctx, { ...grn, statedTotal: "2688", lines: [line(dolo, "DL1", 100, "24", "33.60", items[0].id)] })).rejects.toThrow(/already posted/);
    await postGrnTx(ctx, { ...grn, invoiceNo: "MMA/2", statedTotal: "2464", lines: [line(pan, "PN1", 20, "110", "155", items[1].id)] });
    expect((await listOrders(ctx))[0].status).toBe("received");
    await expect(setPoStatus(ctx, po.id, "cancel")).rejects.toThrow(/can’t be cancelled/);
  });

  it("free goods lower unit cost; re-received batches add up; mismatched batches are refused", async () => {
    const ctx = await ctxFor("Manager");
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/3", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: dolo, batchNo: "DL1", expiry: exp, qty: 10, freeQty: 2, rate: "24", mrp: "33.60", poItemId: null }] });
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "DL1" } });
    expect(b.qtyAvailable).toBe(112);
    expect(b.costPaise).toBe(2357n); // (100 × 24.00 + 12 × 20.00) / 112
    const sup2 = await saveSupplier(ctx, null, { name: "Kalyan Distributors", creditDays: "15" });
    await postGrnTx(ctx, { supplierId: sup2, invoiceNo: "KD/1", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: dolo, batchNo: "DL1", expiry: exp, qty: 8, freeQty: 0, rate: "30", mrp: "33.60", poItemId: null }] });
    const b2 = await db.batch.findUniqueOrThrow({ where: { id: b.id } });
    expect([b2.qtyAvailable, b2.costPaise, b2.supplierId]).toEqual([120, 2400n, sup2]); // (112 × 23.57 + 8 × 30) / 120 = 23.999
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/4", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: pan, batchNo: "PNF", expiry: exp, qty: 10, freeQty: 2, rate: "120", mrp: "155", poItemId: null }] });
    expect((await db.batch.findFirstOrThrow({ where: { batchNo: "PNF" } })).costPaise).toBe(10000n); // 1200 / 12 units
    await expect(postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/5", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: dolo, batchNo: "DL1", expiry: exp, qty: 1, freeQty: 0, rate: "24", mrp: "35", poItemId: null }] })).rejects.toThrow(/different expiry or MRP/);
    await expect(postGrnTx(await ctxFor("Pharmacist"), { supplierId: sup, invoiceNo: "X", invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: dolo, batchNo: "Z", expiry: exp, qty: 1, freeQty: 0, rate: "24", mrp: "33.60", poItemId: null }] })).rejects.toThrow(/role/);
  });
});
