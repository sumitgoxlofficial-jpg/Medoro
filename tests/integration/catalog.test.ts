import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, listInventory, medicineDetail, receiveBatch, updateMedicine } from "@/domain/inventory/service";
import { assignInternalBarcodes, importSampleSalts, labelRows, rebuildSaltKeys, setBranchRack, substitutesFor } from "@/domain/inventory/catalog";
import { adjustStock, postCount, writeOff } from "@/domain/inventory/adjust";
import { commitSale, invoiceData, searchForSale, substitutesForSale } from "@/domain/sales/service";
import { processReturn, returnableLines } from "@/domain/sales/returns";
import { createDoctor, doctorSales, listDoctors, updateDoctor } from "@/domain/doctors/service";
import { doctorSalesCsv } from "@/domain/doctors/contracts";
import { enableDevice, snapshot, syncOps } from "@/domain/sales/offline";
import { sellableByMedicine, velocity } from "@/domain/inventory/queries";
import { previewImport, runImport } from "@/domain/imports/service";
import { addDays, todayISO } from "@/lib/dates";
import { asEan13 } from "@/lib/barcode";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const exp = addDays(todayISO(), 400);
const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15 tabs", gstRate: 12, reorderLevel: 2, barcode: "", hsn: "3004", rack: "", schedule: "" as const };
const sale = (lines: { medicineId: string; batchId: string; qty: number; unit?: "pack" | "loose" }[], extra: Record<string, unknown> = {}) =>
  ({ idempotencyKey: key(), lines, customerId: null, discountPct: 0, pay: { mode: "cash" as const }, ...extra });
const batchOf = async (medicineId: string, no: string) => db.batch.findFirstOrThrow({ where: { medicineId, batchNo: no } });
const ledgerSum = async (batchId: string) => (await db.stockMovement.findMany({ where: { batchId } })).reduce((a, m) => a + m.qty, 0);

describe("loose sale, pack sizes and units", () => {
  let dolo = "", calpol = "", azi = "";
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "32.50", packSize: 15, packUnit: "strip", looseUnit: "tab", allowLoose: true, caseSize: 10, caseUnit: "box" });
    calpol = await createMedicine(ctx, { ...base, name: "Calpol 650", generic: "Paracetamol", strength: "650mg", manufacturer: "GSK", mrp: "30.90" });
    azi = await createMedicine(ctx, { ...base, name: "Azithral 500", generic: "Azithromycin", strength: "500 mg", mrp: "119.50", schedule: "H1" });
    await receiveBatch(ctx, { medicineId: dolo, batchNo: "D1", expiry: exp, qty: 2, cost: "24.50", mrp: "32.50", supplierId: null, invoiceNo: "" });
    await receiveBatch(ctx, { medicineId: calpol, batchNo: "C1", expiry: exp, qty: 4, cost: "20", mrp: "30.90", supplierId: null, invoiceNo: "" });
    await receiveBatch(ctx, { medicineId: azi, batchNo: "A1", expiry: exp, qty: 5, cost: "80", mrp: "119.50", supplierId: null, invoiceNo: "" });
  });

  it("receives packs and cases into stock units", async () => {
    const ctx = await ctxFor();
    expect((await batchOf(dolo, "D1")).qtyAvailable).toBe(30);
    const r = await receiveBatch(ctx, { medicineId: dolo, batchNo: "D2", expiry: addDays(exp, 30), qty: 1, unit: "case", cost: "24.50", mrp: "32.50", supplierId: null, invoiceNo: "" });
    expect(r.units).toBe(150);
    expect(r.unitsText).toBe("10 strips");
    const v = await db.voucher.findFirstOrThrow({ where: { refType: "opening_stock", refId: r.batchId }, include: { lines: true } });
    expect(v.lines.reduce((a, l) => a + Number(l.debitPaise), 0)).toBe(10 * 2450); // valued per pack
  });

  it("sells loose tabs and whole strips from the same batch, rounding the tab price down", async () => {
    const ctx = await ctxFor("Cashier");
    const d1 = await batchOf(dolo, "D1");
    const r = await commitSale(ctx, sale([{ medicineId: dolo, batchId: d1.id, qty: 5, unit: "loose" }, { medicineId: dolo, batchId: d1.id, qty: 1 }]));
    expect((await batchOf(dolo, "D1")).qtyAvailable).toBe(10);
    expect(await ledgerSum(d1.id)).toBe(10);
    const items = await db.saleItem.findMany({ where: { saleId: r.saleId }, orderBy: { qty: "desc" } });
    expect(items.map((i) => [i.qty, Number(i.mrpPaise), i.loose, i.packSize, Number(i.costPaise)])).toEqual([[5, 216, true, 15, 163], [1, 3250, false, 15, 2450]]);
    expect(r.total).toBe(Math.round((5 * 216 + 3250) / 100) * 100);
    const v = await db.voucher.findFirstOrThrow({ where: { refId: r.saleId }, include: { lines: true } });
    expect(v.lines.reduce((a, l) => a + Number(l.debitPaise), 0)).toBe(v.lines.reduce((a, l) => a + Number(l.creditPaise), 0));
    const inv = await invoiceData(ctx, r.saleId);
    expect(inv!.lines.map((l) => l.qtyText).sort()).toEqual(["1 strip", "5 tabs"]);
    expect(inv!.totals.taxable + inv!.totals.cgst + inv!.totals.sgst).toBe(5 * 216 + 3250);
  });

  it("refuses loose sale where it isn't allowed and never oversells stock units", async () => {
    const ctx = await ctxFor("Cashier");
    const c1 = await batchOf(calpol, "C1"), d1 = await batchOf(dolo, "D1");
    await expect(commitSale(ctx, sale([{ medicineId: calpol, batchId: c1.id, qty: 1, unit: "loose" }]))).rejects.toThrow(/isn’t sold loose/);
    await expect(commitSale(ctx, sale([{ medicineId: dolo, batchId: d1.id, qty: 1 }]))).rejects.toThrow(/only 10 tabs/);
  });

  it("returns lines in the unit sold and puts the right stock back", async () => {
    const ctx = await ctxFor("Owner");
    const s = await db.sale.findFirstOrThrow({ where: { items: { some: { loose: true } } } });
    const lines = (await returnableLines(ctx, s.id))!.lines;
    const loose = lines.find((l) => l.soldText === "5 tabs")!, strip = lines.find((l) => l.soldText === "1 strip")!;
    expect(loose.unit).toBe("tab");
    await processReturn(ctx, { saleId: s.id, lines: [{ itemId: loose.itemId, qty: 2 }, { itemId: strip.itemId, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Not needed" });
    expect((await batchOf(dolo, "D1")).qtyAvailable).toBe(10 + 2 + 15);
    const cn = await db.salesReturn.findFirstOrThrow({ where: { saleId: s.id } });
    expect(Number(cn.amountPaise)).toBe(2 * 216 + 3250);
  });

  it("values adjustments, write-offs and counts per pack", async () => {
    const ctx = await ctxFor("Owner");
    const d1 = await batchOf(dolo, "D1");
    await adjustStock(ctx, d1.id, -3, "Torn strip");
    await writeOff(ctx, d1.id, 15, "Damaged: water");
    const wo = await db.stockOut.findFirstOrThrow({ where: { batchId: d1.id, kind: "write_off" } });
    expect(Number(wo.valuePaise)).toBe(2450);
    const c = await postCount(ctx, { lines: [{ batchId: d1.id, counted: 7 }] });
    expect(c.value).toBe(Math.round((2450 * -2) / 15));
    expect((await batchOf(dolo, "D1")).qtyAvailable).toBe(7);
    expect(await ledgerSum(d1.id)).toBe(7);
  });

  it("rescales stock when a pack size is set, keeping the ledger in step", async () => {
    const ctx = await ctxFor("Owner");
    const m = (await medicineDetail(ctx, calpol))!.medicine;
    const input = { ...base, name: m.name, generic: m.generic, strength: m.strength, manufacturer: m.manufacturer, mrp: "30.90", pack: m.pack };
    await updateMedicine(ctx, calpol, m.version, { ...input, packSize: 10, packUnit: "strip", looseUnit: "tab", allowLoose: true });
    const c1 = await batchOf(calpol, "C1");
    expect(c1.qtyAvailable).toBe(40);
    expect(await ledgerSum(c1.id)).toBe(40);
    expect((await db.stockMovement.findFirstOrThrow({ where: { batchId: c1.id, type: "unit" } })).qty).toBe(36);
    const v2 = (await medicineDetail(ctx, calpol))!.medicine.version;
    await expect(updateMedicine(ctx, calpol, v2, { ...input, packSize: 15, packUnit: "strip", looseUnit: "tab" })).rejects.toThrow(/multiple of 10/);
    // Old pack-size-1 sales of this medicine still return whole strips.
    expect((await medicineDetail(ctx, calpol))!.sellableText).toBe("4 strips");
  });

  it("reports sellable whole packs and velocity in packs", async () => {
    const ctx = await ctxFor();
    const s = await sellableByMedicine(ctx.tenantId, ctx.branchId);
    expect(s.get(dolo)).toBe(Math.floor((7 + 150) / 15));
    const v = await velocity(ctx.tenantId, ctx.branchId, 28);
    expect(v.get(dolo)! * 28).toBeCloseTo(3 / 15, 5); // 5 tabs + 1 strip sold, 2 tabs + 1 strip returned
    const low = await listInventory(ctx, "dolo", "all");
    expect(low.rows[0].sellableText).toBe("10 strips + 7 tabs");
  });

  it("posts offline loose bills from the snapshot", async () => {
    const mgr = await ctxFor("Manager");
    const dev = await enableDevice(mgr, "Counter 1");
    const snap = await snapshot(await ctxFor("Cashier"), dev.deviceId);
    const m = snap.medicines.find((x) => x.id === dolo)!;
    expect(m).toMatchObject({ packSize: 15, allowLoose: true, looseUnit: "tab" });
    const b = snap.batches.find((x) => x.medicineId === dolo)!;
    const op = { id: "off_" + randomUUID().replace(/-/g, ""), createdAt: new Date().toISOString(), baseVersion: b.version, receipt: "OFF-1", cashierId: (await ctxFor("Cashier")).userId,
      sale: { lines: [{ medicineId: dolo, batchId: b.id, qty: 3, unit: "loose" as const }], discountPct: 0, pay: { mode: "cash" as const }, totalPaise: 600 } };
    const [res] = await syncOps(await ctxFor("Cashier"), dev.deviceId, [op]);
    expect(res.status).toBe("posted");
    const item = await db.saleItem.findFirstOrThrow({ where: { sale: { idempotencyKey: op.id } } });
    expect([item.qty, item.loose, Number(item.mrpPaise)]).toEqual([3, true, 216]);
  });
});

describe("salts, substitutes, search, racks and labels", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("imports the sample salts once and finds substitutes by composition", async () => {
    const ctx = await ctxFor();
    const r = await importSampleSalts(ctx);
    expect(r.created).toBeGreaterThanOrEqual(50);
    expect((await importSampleSalts(ctx)).created).toBe(0);
    const dolo = await db.medicine.findFirstOrThrow({ where: { name: "Dolo 650" } });
    expect(dolo).toMatchObject({ composition: "Paracetamol 650mg", saltKey: "paracetamol 650mg", packSize: 15, allowLoose: true });
    const pacimol = await db.medicine.findFirstOrThrow({ where: { name: "Pacimol 650" } });
    await receiveBatch(ctx, { medicineId: pacimol.id, batchNo: "P1", expiry: exp, qty: 3, cost: "20", mrp: "30.50", supplierId: null, invoiceNo: "" });
    const subs = await substitutesFor(ctx, dolo.id);
    expect(subs.map((s) => s.name)).toEqual(expect.arrayContaining(["Calpol 650", "Pacimol 650"]));
    expect(subs[0]).toMatchObject({ name: "Pacimol 650", inStock: true, stockText: "3 strips" });
    const sale = await substitutesForSale(await ctxFor("Cashier"), dolo.id, "price");
    expect(sale.rows[0].med.batches[0].qtyAvailable).toBe(45);
    // Combination order doesn't matter.
    const panD = await db.medicine.findFirstOrThrow({ where: { name: "Pan-D" } });
    expect((await substitutesFor(ctx, panD.id)).map((s) => s.name)).toEqual(["Pantocid DSR"]);
  });

  it("searches by brand, salt, squashed brand and typo", async () => {
    const ctx = await ctxFor("Cashier");
    const names = async (q: string) => (await searchForSale(ctx, q)).map((m) => m.name);
    expect(await names("para 650")).toEqual(expect.arrayContaining(["Dolo 650", "Calpol 650", "Pacimol 650"]));
    expect((await names("dolo650"))[0]).toBe("Dolo 650");
    expect(await names("clavulanic")).toEqual(expect.arrayContaining(["Augmentin 625 Duo", "Clavam 625"]));
    expect(await names("azithromicin")).toEqual(expect.arrayContaining(["Azithral 500", "Azee 500"]));
  });

  it("rebuilds keys after edits and fills combination keys", async () => {
    const ctx = await ctxFor();
    const id = await createMedicine(ctx, { ...base, name: "Crocin Pain Relief", generic: "Paracetamol + Caffeine", strength: "650 mg + 50 mg", mrp: "45" });
    await db.medicine.update({ where: { id }, data: { saltKey: null, composition: null } });
    const r = await rebuildSaltKeys(ctx);
    expect(r.changed).toBeGreaterThanOrEqual(1);
    expect((await db.medicine.findUniqueOrThrow({ where: { id } })).saltKey).toBe("caffeine 50mg + paracetamol 650mg");
  });

  it("keeps a branch rack, filters by it and shows it at the counter", async () => {
    const ctx = await ctxFor();
    const pacimol = await db.medicine.findFirstOrThrow({ where: { name: "Pacimol 650" } });
    await setBranchRack(ctx, pacimol.id, "B2");
    expect((await listInventory(ctx, "", "all", "b2")).rows.map((r) => r.name)).toEqual(["Pacimol 650"]);
    expect((await searchForSale(ctx, "pacimol"))[0].rack).toBe("B2");
    expect((await listInventory(await ctxFor("Owner", "Second"), "", "all", "B2")).rows).toHaveLength(0);
    await setBranchRack(ctx, pacimol.id, "");
    expect((await listInventory(ctx, "", "all", "b2")).rows).toHaveLength(0);
  });

  it("assigns internal EAN-13 codes that scan at the counter and print on labels", async () => {
    const ctx = await ctxFor();
    const pacimol = await db.medicine.findFirstOrThrow({ where: { name: "Pacimol 650" } });
    expect(await assignInternalBarcodes(ctx, [pacimol.id])).toBe(1);
    expect(await assignInternalBarcodes(ctx, [pacimol.id])).toBe(0);
    const code = (await db.medicine.findUniqueOrThrow({ where: { id: pacimol.id } })).barcode!;
    expect(code).toMatch(/^29\d{11}$/);
    expect(asEan13(code)).toBe(code);
    const hit = await searchForSale(await ctxFor("Cashier"), code);
    expect(hit[0]).toMatchObject({ name: "Pacimol 650", barcodeHit: true });
    const labels = await labelRows(ctx, { medicineIds: [pacimol.id] }, 2);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({ batchNo: "P1", code, mrp: 3050 });
  });

  it("imports a Composition column and a salt column with strengths", async () => {
    const ctx = await ctxFor();
    const file = new TextEncoder().encode([
      "Brand name,Composition,Form,Manufacturer,MRP,GST %,Units per pack,Pack unit,Loose unit,Sell loose",
      "Sumo,Nimesulide 100mg + Paracetamol 325mg,Tablet,Alkem,52,12,10,strip,tab,yes",
    ].join("\n"));
    const p = await previewImport(ctx, "medicines", "c.csv", file);
    expect(p.bad).toBe(0);
    await runImport(ctx, "medicines", "c.csv", file);
    expect(await db.medicine.findFirstOrThrow({ where: { name: "Sumo" } })).toMatchObject({ generic: "Nimesulide + Paracetamol", strength: "100mg + 325mg", saltKey: "nimesulide 100mg + paracetamol 325mg", packSize: 10, allowLoose: true });
    const salt = new TextEncoder().encode(["Medicine,Salt,Form,Company,MRP,GST", "Nise,Nimesulide 100 mg,Tablet,Dr Reddys,40,12"].join("\n"));
    expect((await previewImport(ctx, "medicines", "s.csv", salt)).bad).toBe(0);
    await runImport(ctx, "medicines", "s.csv", salt);
    expect((await db.medicine.findFirstOrThrow({ where: { name: "Nise" } })).saltKey).toBe("nimesulide 100mg");
  });
});

describe("doctor master and referrals", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("links Rx sales to a doctor, keeps the typed prescriber filled, and reports by doctor", async () => {
    const owner = await ctxFor(), cashier = await ctxFor("Cashier");
    const azi = await createMedicine(owner, { ...base, name: "Azithral 500", generic: "Azithromycin", strength: "500 mg", mrp: "119.50", schedule: "H1" });
    const dolo = await createMedicine(owner, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60" });
    await receiveBatch(owner, { medicineId: azi, batchNo: "A1", expiry: exp, qty: 10, cost: "80", mrp: "119.50", supplierId: null, invoiceNo: "" });
    await receiveBatch(owner, { medicineId: dolo, batchNo: "D1", expiry: exp, qty: 10, cost: "20", mrp: "33.60", supplierId: null, invoiceNo: "" });
    const a1 = (await batchOf(azi, "A1")).id, d1 = (await batchOf(dolo, "D1")).id;

    const doc = await createDoctor(cashier, { name: "Dr. Asha Mehta", qualification: "MBBS, MD", regNo: "mmc 2011/04/1234", clinic: "Mehta Clinic", phone: "+91 98220 11111" });
    expect(doc).toMatchObject({ name: "Asha Mehta", regNo: "MMC 2011/04/1234", phone: "9822011111" });
    await expect(createDoctor(cashier, { name: "Someone", regNo: "MMC 2011/04/1234" })).rejects.toThrow(/already on file/);

    const s1 = await commitSale(cashier, sale([{ medicineId: azi, batchId: a1, qty: 1 }], { doctorId: doc.id, patientName: "Ravi Joshi" }));
    const row = await db.sale.findUniqueOrThrow({ where: { id: s1.saleId } });
    expect(row).toMatchObject({ doctorId: doc.id, prescriber: "Dr Asha Mehta (Reg MMC 2011/04/1234)" });
    expect((await invoiceData(cashier, s1.saleId))!.doctor).toMatchObject({ regNo: "MMC 2011/04/1234" });
    await commitSale(cashier, sale([{ medicineId: dolo, batchId: d1, qty: 2 }], { doctorId: doc.id }));
    await commitSale(cashier, sale([{ medicineId: azi, batchId: a1, qty: 1 }], { prescriber: "Dr. R. Kale", prescriberReg: "MMC-7781", patientName: "Ravi Joshi" }));
    await expect(commitSale(cashier, sale([{ medicineId: azi, batchId: a1, qty: 1 }], { doctorId: randomUUID() }))).rejects.toThrow(/Doctor not found/);
    await processReturn(owner, { saleId: s1.saleId, lines: [{ itemId: (await db.saleItem.findFirstOrThrow({ where: { saleId: s1.saleId } })).id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Changed prescription" });

    await expect(doctorSales(cashier, todayISO(), todayISO(), cashier.branchId)).rejects.toThrow();
    const rep = await doctorSales(owner, todayISO(), todayISO(), "all");
    const mehta = rep.rows.find((r) => r.doctorId === doc.id)!, kale = rep.rows.find((r) => !r.linked)!;
    expect(mehta).toMatchObject({ bills: 2, rxBills: 1, gross: 12000 + 6700, returns: 11950, regNo: "MMC 2011/04/1234" });
    expect(mehta.net).toBe(12000 + 6700 - 11950);
    expect(kale).toMatchObject({ name: "R. Kale", bills: 1, rxBills: 1 });
    expect(rep.total.bills).toBe(3);
    const csv = doctorSalesCsv(rep, "All branches");
    expect(csv[1][0]).toBe("Doctor");
    expect(csv.at(-1)![4]).toBe(3);

    await updateDoctor(owner, doc.id, doc.version, { name: "Asha Mehta", regNo: "MMC 2011/04/1234", active: false });
    expect((await listDoctors(owner)).map((d) => d.id)).not.toContain(doc.id);
    expect((await listDoctors(owner, { all: true })).find((d) => d.id === doc.id)?.active).toBe(false);
  });
});
