import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { directInvoice as serverInvoice, invoiceOrder as serverInvoiceOrder } from "@/domain/distribution/billing";
import { approveOrder as serverApprove, confirmPickLine as serverPick, packOrder as serverPack, placeOrder as serverPlace } from "@/domain/distribution/orders";
import { saveChemist as serverChemist, saveScheme as serverScheme, setSpecialRate as serverSpecial } from "@/domain/distribution/masters";
import { memoryDb } from "@/drivedb/node";
import type { DriveDB } from "@/drivedb/client";
import { directInvoice as deviceInvoice, invoiceView, saveChemist, saveCompany, saveProduct, saveScheme, setSpecialRate } from "@/drivedb/dist";
import { approveOrder, confirmPickLine, invoiceOrder, packOrder, pickList, placeOrder } from "@/drivedb/dist-orders";
import { createReturn } from "@/drivedb/dist-trade";
import { createReturn as serverReturn } from "@/domain/distribution/returns";
import { big } from "@/lib/money";
import { addDays, isoOf, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";
import { distCtx, key, makeDistributor, seedBasics } from "./dist-helpers";

/**
 * A distributor's bill must come out the same on its own device (Drive mode) as on Medoro's server: same rate, scheme,
 * batches (FEFO), GST split, round-off and total. The device here is loaded from the server's own records.
 */
describe("Distribution on the device gives the same invoices as the server", () => {
  let dev: DriveDB;
  let s: Awaited<ReturnType<typeof seedBasics>>, other: string;
  const today = todayISO();

  beforeAll(async () => {
    await resetDb(); await makeDistributor();
    const ctx = await distCtx();
    s = await seedBasics(ctx, { batches: [{ no: "LATE", expiryDays: 500, qty: 300 }, { no: "EARLY", expiryDays: 200, qty: 40 }], creditLimit: 1_000_000 });
    // A second chemist in Karnataka (IGST), a special rate, and a 10+1 scheme on the product.
    other = await serverChemist(ctx, null, { name: "Karnataka Medicals", phone: "9845012345", gstin: "", stateCode: "29", address: "Belagavi", pincode: "590001",
      dl20b: "KA-BG-20B-10042", dl21b: "KA-BG-21B-10042", dlExpiry: addDays(today, 365), creditLimit: "1000000", creditDays: 21 });
    await serverScheme(ctx, null, { code: "AMOX10", name: "10 + 1", kind: "free", medicineId: s.medicineId, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    await serverSpecial(ctx, other, s.medicineId, "48", addDays(today, 10));

    // The device: the same catalogue, stock, chemists and terms (as a move to Drive would bring them).
    dev = await memoryDb("DISTDEV");
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    dev.setMeta("pharmacy", JSON.stringify({ gstin: t.gstin }));
    const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId } });
    dev.from("medicine").insert(meds.map((m) => ({ id: m.id, name: m.name, generic: "", strength: "", form: "", manufacturer: "", barcode: null, hsn: m.hsn ?? "3004", gstRate: m.gstRate,
      mrpPaise: big(m.mrpPaise), schedule: null, packSize: m.packSize, packUnit: "pack", looseUnit: "unit", allowLoose: false, reorderLevel: 0, rack: null, composition: null, active: true })));
    const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId } });
    dev.from("batch").insert(batches.map((b) => ({ id: b.id, branchId: b.branchId, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: isoOf(b.expiryDate), costPaise: big(b.costPaise), mrpPaise: big(b.mrpPaise), supplierId: null, status: b.status })));
    dev.from("stockMovement").insert(batches.map((b) => ({ branchId: b.branchId, batchId: b.id, qty: b.qtyAvailable, type: "opening", refType: "opening", refId: b.id, userId: ctx.userId, at: new Date().toISOString(), note: "Opening" })));
    for (const c of await db.customer.findMany({ where: { tenantId: ctx.tenantId } })) {
      dev.from("customer").insert({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, creditLimitPaise: big(c.creditLimitPaise), address: c.address, pincode: c.pincode });
      const ch = await db.distChemist.findUniqueOrThrow({ where: { customerId: c.id } });
      saveChemist(dev, { customerId: c.id, stateCode: c.stateCode, dl20b: ch.dl20b ?? undefined, dlExpiry: ch.dlExpiry ? isoOf(ch.dlExpiry) : null, creditDays: ch.creditDays, graceDays: ch.graceDays, priceTier: ch.priceTier as "ptr" });
    }
    const co = await db.distCompany.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
    const coId = saveCompany(dev, null, { name: co.name });
    for (const p of await db.distProduct.findMany({ where: { tenantId: ctx.tenantId } })) saveProduct(dev, { medicineId: p.medicineId, companyId: coId, ptrPaise: big(p.ptrPaise), ptsPaise: big(p.ptsPaise) });
    saveScheme(dev, { code: "AMOX10", name: "10 + 1", kind: "free", medicineId: s.medicineId, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    setSpecialRate(dev, other, s.medicineId, 4800, addDays(today, 10));
  });

  const compare = async (customerId: string, lines: { medicineId: string; qty: number; discPct?: number }[]) => {
    const ctx = await distCtx();
    const sv = await serverInvoice(ctx, { customerId, idempotencyKey: key(), lines });
    const inv = await db.distInvoice.findUniqueOrThrow({ where: { id: sv.invoiceId }, include: { lines: true } });
    const dv = deviceInvoice(dev, { branchId: ctx.branchId, customerId, userId: ctx.userId, idempotencyKey: key(), canOverride: true, lines }, today);
    const d = invoiceView(dev, dv.invoiceId)!;
    const head = (x: Record<string, unknown>) => ["grossPaise", "discPaise", "taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "roundOffPaise", "totalPaise", "costPaise"].map((k) => Number(x[k] as never));
    expect(head(d as Record<string, unknown>)).toEqual(head(inv as unknown as Record<string, unknown>));
    expect(!!Number(d.igst)).toBe(inv.igst);
    const lineOf = (l: { batchId: unknown; qty: unknown; freeQty: unknown; ratePaise: unknown; discPaise: unknown; taxablePaise: unknown; taxPaise: unknown }) =>
      [String(l.batchId), Number(l.qty), Number(l.freeQty), Number(l.ratePaise), Number(l.discPaise), Number(l.taxablePaise), Number(l.taxPaise)];
    expect(d.lines.map((l) => lineOf(l as never)).sort()).toEqual(inv.lines.map((l) => lineOf(l)).sort());
    return { server: inv, device: d };
  };

  it("a plain bill: PTR, FEFO across two batches, CGST + SGST", async () => {
    const r = await compare(s.customerId, [{ medicineId: s.medicineId, qty: 7 }]);
    expect(Number(r.device.cgstPaise)).toBeGreaterThan(0);
  });

  it("a scheme bill: free goods at zero value, and a trade discount", async () => {
    const r = await compare(s.customerId, [{ medicineId: s.medicineId, qty: 20, discPct: 2.5 }]);
    expect(r.server.lines.reduce((a, l) => a + l.freeQty, 0)).toBe(2);
  });

  it("an inter-state chemist with a special rate: IGST", async () => {
    const r = await compare(other, [{ medicineId: s.medicineId, qty: 3 }]);
    expect(r.server.igst).toBe(true);
    expect(Number(r.device.lines[0].ratePaise)).toBe(4800);
  });

  it("an order: placed, approved (FEFO reservation, scheme), picked with one short line, packed and invoiced the same way", async () => {
    const ctx = await distCtx();
    const lines = [{ medicineId: s.medicineId, qty: 22 }];
    // Server
    const so = await serverPlace({ kind: "user", ctx }, { customerId: s.customerId, idempotencyKey: key(), lines });
    await serverApprove(ctx, so.orderId);
    const pick = await db.distPickList.findUniqueOrThrow({ where: { orderId: so.orderId }, include: { lines: { orderBy: { units: "asc" } } } });
    for (const [k, l] of pick.lines.entries()) await serverPick(ctx, l.id, k === 0 ? l.units - (await db.medicine.findUniqueOrThrow({ where: { id: l.medicineId } })).packSize : l.units);
    await serverPack(ctx, pick.id, 1);
    const sInv = await db.distInvoice.findUniqueOrThrow({ where: { id: (await serverInvoiceOrder(ctx, so.orderId)).invoiceId }, include: { lines: true } });
    // Device
    const dor = placeOrder(dev, { branchId: ctx.branchId, customerId: s.customerId, userId: ctx.userId, idempotencyKey: key(), lines }, today);
    approveOrder(dev, { orderId: dor.orderId, userId: ctx.userId }, today);
    const picks = pickList(dev, dor.orderId).sort((a, b) => a.units - b.units);
    const pack = (await db.medicine.findUniqueOrThrow({ where: { id: s.medicineId } })).packSize;
    for (const [k, p] of picks.entries()) confirmPickLine(dev, { pickLineId: p.id, pickedUnits: k === 0 ? p.units - pack : p.units, userId: ctx.userId });
    packOrder(dev, { orderId: dor.orderId, boxes: 1, userId: ctx.userId });
    const d = invoiceView(dev, invoiceOrder(dev, { orderId: dor.orderId, userId: ctx.userId }, today).invoiceId)!;
    const head = (x: Record<string, unknown>) => ["grossPaise", "discPaise", "taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "roundOffPaise", "totalPaise", "costPaise"].map((k) => Number(x[k] as never));
    expect(head(d as unknown as Record<string, unknown>)).toEqual(head(sInv as unknown as Record<string, unknown>));
    const lineOf = (l: { batchId: unknown; qty: unknown; freeQty: unknown; taxablePaise: unknown; taxPaise: unknown }) => [String(l.batchId), Number(l.qty), Number(l.freeQty), Number(l.taxablePaise), Number(l.taxPaise)];
    expect(d.lines.map((l) => lineOf(l as never)).sort()).toEqual(sInv.lines.map((l) => lineOf(l)).sort());
    expect(pick.lines.map((l) => [l.batchId, l.units]).sort()).toEqual(picks.map((p) => [p.batchId, p.units]).sort());
  });

  it("a credit note (part return, expired, 80% credit) credits the same taxable value and GST", async () => {
    const ctx = await distCtx();
    const r = await compare(s.customerId, [{ medicineId: s.medicineId, qty: 9 }]);
    const sl = [...r.server.lines].sort((a, b) => b.qty - a.qty)[0];
    const dl = r.device.lines.find((l) => String(l.batchId) === sl.batchId)!;
    const sv = await serverReturn(ctx, { invoiceId: r.server.id, reason: "Expired on arrival", lines: [{ invoiceLineId: sl.id, qty: 3, condition: "expired", creditPct: 80 }] });
    const dv = createReturn(dev, { invoiceId: String(r.device.id), userId: ctx.userId, reason: "Expired on arrival", lines: [{ invoiceLineId: String(dl.id), qty: 3, condition: "expired", creditPct: 80 }] }, today);
    const so = await db.distReturn.findUniqueOrThrow({ where: { id: sv.returnId } });
    const d = dev.engine.all<{ taxablePaise: number; taxPaise: number; totalPaise: number }>("SELECT taxablePaise, taxPaise, totalPaise FROM distReturn WHERE id = ?", [dv.returnId])[0];
    expect([Number(d.taxablePaise), Number(d.taxPaise), Number(d.totalPaise)]).toEqual([Number(so.taxablePaise), Number(so.taxPaise), Number(so.totalPaise)]);
  });
});
