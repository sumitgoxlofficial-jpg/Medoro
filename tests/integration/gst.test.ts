import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { requestTransfer } from "@/domain/inventory/adjust";
import { commitSale, invoiceData, posCustomers } from "@/domain/sales/service";
import { processReturn } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { postGrnTx } from "@/domain/purchasing/service";
import { saveCustomer, saveSupplier } from "@/domain/parties/service";
import { accountsOverview, periodOf, trialBalance } from "@/domain/accounting/service";
import { reportRows } from "@/domain/accounting/reports";
import { EInvoiceClient } from "@/domain/gst/einvoice";
import { cancelIrn, einvoiceFor, einvoiceQueue, generateIrn, generateSaleEwb, generateTransferEwb, gstExport, gstr1For, gstr3bFor, gstRollup, registrations, saveGstSettings, setEinvClientFactory, tallyMapping, tallyVouchers } from "@/domain/gst/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const HOME = "27AAKFS3192P1Z6"; // test pharmacy's GSTIN (Maharashtra)
const INTRA = "27AABCS1429B1ZU", INTER = "29AAGCB7383J1Z4";
const ENV = { EINVOICE_PROVIDER: "gsp-http", EINVOICE_BASE_URL: "https://gsp.test", EINVOICE_CLIENT_ID: "cid", EINVOICE_CLIENT_SECRET: "sec", EINVOICE_USERNAME: "u", EINVOICE_PASSWORD: "p", EINVOICE_GSTIN: HOME };

describe("GST compliance", () => {
  let med = "", zero = "", intraCus = "", interCus = "", saleIntra = "", saleInter = "", saleWalkIn = "";
  const irpCalls: { url: string; body: Record<string, unknown> }[] = [];
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k as keyof typeof ENV]; }
    const t = await db.tenant.findFirstOrThrow();
    await db.branch.updateMany({ where: { tenantId: t.id }, data: { address: "Shop 4, FC Road, Pune 411005" } });
    const ctx = await ctxFor();
    const sup = await saveSupplier(ctx, null, { name: "Sai Healthcare", gstin: "27AABCS1429B1ZU" });
    med = await createMedicine(ctx, { name: "Telma 40", generic: "Telmisartan", strength: "40 mg", form: "Tablet", manufacturer: "Glenmark", pack: "15", mrp: "1120", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "30049099", rack: "" });
    zero = await createMedicine(ctx, { name: "Condom pack", generic: "Contraceptive", strength: "-", form: "Other", manufacturer: "HLL", pack: "3", mrp: "50", gstRate: 0, schedule: "", reorderLevel: 0, barcode: "", hsn: "4014", rack: "" });
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "SHD/9", invoiceDate: todayISO(), statedTotal: "448400", poId: null, scanDocId: null, lines: [
      { medicineId: med, batchNo: "TL1", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 500, freeQty: 0, rate: "800", mrp: "1120", poItemId: null },
      { medicineId: zero, batchNo: "Z1", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 10, freeQty: 0, rate: "40", mrp: "50", poItemId: null },
    ] });
    intraCus = await saveCustomer(ctx, null, { name: "Sanjeevani Clinic", phone: "", gstin: INTRA, address: "2 Law College Road, Pune", pincode: "411004" });
    interCus = await saveCustomer(ctx, null, { name: "City Care Hospital", phone: "", gstin: INTER, address: "12 Residency Road, Bengaluru", pincode: "560025" });
  });

  afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it("validates customer GSTINs with the check character and keeps the state consistent", async () => {
    const ctx = await ctxFor();
    await expect(saveCustomer(ctx, null, { name: "Bad GSTIN", phone: "", gstin: "27AABCS1429B1ZX" })).rejects.toThrow(/GSTIN isn’t valid/);
    await expect(saveCustomer(ctx, null, { name: "Wrong state", phone: "", gstin: INTRA, stateCode: "29" })).rejects.toThrow(/state doesn’t match/);
    const pos = await posCustomers(ctx);
    expect(pos.find((c) => c.id === interCus)).toMatchObject({ gstin: INTER, igst: true });
    expect(pos.find((c) => c.id === intraCus)).toMatchObject({ gstin: INTRA, igst: false });
  });

  it("books IGST for an inter-state B2B sale and CGST+SGST otherwise, including on credit notes", async () => {
    const ctx = await ctxFor();
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "TL1" } }), z = await db.batch.findFirstOrThrow({ where: { batchNo: "Z1" } });
    saleInter = (await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: b.id, qty: 60 }], customerId: interCus, discountPct: 0, pay: { mode: "upi" } })).saleId;
    saleIntra = (await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: b.id, qty: 3 }], customerId: intraCus, discountPct: 0, pay: { mode: "cash" } })).saleId;
    saleWalkIn = (await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: b.id, qty: 1 }, { medicineId: zero, batchId: z.id, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } })).saleId;

    const inter = await db.sale.findUniqueOrThrow({ where: { id: saleInter } });
    // 60 × ₹1,120 = ₹67,200 incl. 12% → taxable ₹60,000, IGST ₹7,200.
    expect(inter).toMatchObject({ igstPaise: 720000n, cgstPaise: 0n, sgstPaise: 0n, placeOfSupply: "29", customerGstin: INTER });
    const v = await db.voucher.findFirstOrThrow({ where: { refId: saleInter }, include: { lines: true } });
    expect(v.lines.find((l) => l.account === "Output IGST")?.creditPaise).toBe(720000n);
    expect(v.lines.some((l) => l.account === "Output CGST")).toBe(false);
    const intra = await db.sale.findUniqueOrThrow({ where: { id: saleIntra } });
    expect(intra).toMatchObject({ igstPaise: 0n, cgstPaise: 18000n, sgstPaise: 18000n, placeOfSupply: "27", customerGstin: INTRA });

    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: saleInter } });
    await processReturn(ctx, { saleId: saleInter, lines: [{ itemId: item.id, qty: 6 }], condition: "sealed", refundMode: "UPI refund", reason: "Excess supplied" });
    const cn = await db.voucher.findFirstOrThrow({ where: { type: "credit_note" }, include: { lines: true } });
    expect(cn.lines.find((l) => l.account === "Output IGST")?.debitPaise).toBe(72000n);
    expect(cn.lines.some((l) => l.account === "Output CGST")).toBe(false);

    const inv = (await invoiceData(ctx, saleInter))!;
    expect(inv.customer).toMatchObject({ gstin: INTER, address: "12 Residency Road, Bengaluru 560025" });
    expect(inv.placeOfSupply).toBe("29");
    expect(inv.totals.igst).toBe(720000);
    const tb = await trialBalance(ctx);
    expect(tb.dr).toBe(tb.cr);
    const ov = await accountsOverview(ctx, periodOf("month"));
    expect(ov.gstTotals.out).toBe(720000 + 36000 + 12000 - 72000 + 0);
  });

  it("builds GSTR-1 from the books: B2B, B2CS, nil, CDNR, HSN and documents", async () => {
    const ctx = await ctxFor();
    const r = await gstr1For(ctx, HOME);
    const g = r.json;
    expect(g.gstin).toBe(HOME);
    expect(g.fp).toBe(todayISO().slice(5, 7) + todayISO().slice(0, 4));
    expect(g.b2b!.map((x) => x.ctin)).toEqual([INTRA, INTER]);
    expect(g.b2b![1].inv[0]).toMatchObject({ pos: "29", val: 67200, itms: [{ num: 1, itm_det: { txval: 60000, rt: 12, iamt: 7200, csamt: 0 } }] });
    expect(g.b2b![0].inv[0].itms[0].itm_det).toEqual({ txval: 3000, rt: 12, camt: 180, samt: 180, csamt: 0 });
    expect(g.cdnr).toEqual([{ ctin: INTER, nt: [expect.objectContaining({ ntty: "C", val: 6720, pos: "29", itms: [{ num: 1, itm_det: { txval: 6000, rt: 12, iamt: 720, csamt: 0 } }] })] }]);
    expect(g.b2cs).toEqual([{ sply_ty: "INTRA", rt: 12, typ: "OE", pos: "27", txval: 1000, camt: 60, samt: 60, csamt: 0 }]);
    expect(g.nil!.inv).toEqual([{ sply_ty: "INTRAB2C", expt_amt: 0, nil_amt: 100, ngsup_amt: 0 }]);
    expect(g.hsn!.hsn_b2b).toEqual([expect.objectContaining({ hsn_sc: "30049099", uqc: "PAC", qty: 57, rt: 12, txval: 57000, iamt: 6480, camt: 180, samt: 180 })]);
    expect(g.hsn!.hsn_b2c).toEqual([expect.objectContaining({ hsn_sc: "30049099", qty: 1, txval: 1000 }), expect.objectContaining({ hsn_sc: "4014", uqc: "NOS", qty: 2, rt: 0, txval: 100 })]);
    expect(g.doc_issue!.doc_det.map((d) => [d.doc_num, d.docs[0].totnum, d.docs[0].cancel])).toEqual([[1, 3, 0], [5, 1, 0]]);

    const hsn = await reportRows(ctx, "hsn-summary", periodOf("month"));
    expect(hsn[0][0]).toBe("Supply type");
    expect(hsn.at(-1)!.slice(7, 11)).toEqual(["58100.00", "6480.00", "240.00", "240.00"]);
    const gs = await reportRows(ctx, "gst-summary", periodOf("month"));
    expect(gs.find((x) => x[0] === 12)!.slice(4, 7)).toEqual(["240.00", "240.00", "6480.00"]);
  });

  it("summarises GSTR-3B with ITC from the input tax ledgers and rolls up GSTINs and branches", async () => {
    const ctx = await ctxFor();
    const g = (await gstr3bFor(ctx, HOME)).json;
    expect(g.sup_details.osup_det).toEqual({ txval: 58000, iamt: 6480, camt: 240, samt: 240, csamt: 0 });
    expect(g.sup_details.osup_nil_exmp.txval).toBe(100);
    expect(g.inter_sup.unreg_details).toEqual([]);
    // Purchases: 500 × ₹800 at 12% = ₹48,000 input tax, intra-state; the 0% line has none.
    expect(g.itc_elg.itc_avl.find((x) => x.ty === "OTH")).toEqual({ ty: "OTH", iamt: 0, camt: 24000, samt: 24000, csamt: 0 });
    const roll = await gstRollup(ctx);
    expect(roll.groups).toHaveLength(1);
    expect(roll.groups[0].branches.map((b) => b.name)).toEqual(["Main", "Second"]);
    expect(roll.total).toMatchObject({ taxable: 5810000, igst: 648000, cgst: 24000, sgst: 24000, itcCgst: 2400000, invoices: 3, creditNotes: 1 });
    expect((await registrations(ctx)).list).toEqual([expect.objectContaining({ gstin: HOME, state: "Maharashtra" })]);
    const csv = await gstExport(ctx, "gstr3b-csv", { gstin: HOME });
    expect(csv.body).toContain("4(A)(5)");
    await expect(gstr1For(ctx, INTER)).rejects.toThrow(/None of your branches/);
  });

  it("exports balanced Tally vouchers with party ledgers and an editable ledger map", async () => {
    const ctx = await ctxFor();
    await saveGstSettings(ctx, { tallyCompany: "Test Medical Store", tallyMap: { "Cash in hand": { ledger: "Cash Counter", group: "Cash-in-Hand" } } });
    const m = await tallyMapping(ctx);
    expect(m.rows.find((r) => r.account === "Cash in hand")).toEqual({ account: "Cash in hand", ledger: "Cash Counter", group: "Cash-in-Hand" });
    const x = await tallyVouchers(ctx);
    expect(x.count).toBe(await db.voucher.count());
    expect(x.xml).toContain("<SVCURRENTCOMPANY>Test Medical Store</SVCURRENTCOMPANY>");
    expect(x.xml).toContain("<LEDGERNAME>Sai Healthcare</LEDGERNAME>");
    expect(x.xml).toContain("<LEDGERNAME>Cash Counter</LEDGERNAME>");
    for (const v of x.xml.match(/<VOUCHER [\s\S]*?<\/VOUCHER>/g)!) {
      const amts = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((a) => Math.round(Number(a[1]) * 100));
      expect(amts.reduce((a, b) => a + b, 0)).toBe(0);
    }
    const masters = await gstExport(ctx, "tally-masters", {});
    expect(masters.body).toContain(`<PARTYGSTIN>${INTER}</PARTYGSTIN>`);
    await expect(saveGstSettings(ctx, { tallyMap: { Sales: { ledger: "", group: "Sales Accounts" } } })).rejects.toThrow();
  });

  it("generates, prints and cancels an IRN, and raises e-way bills, through the configured provider", async () => {
    const ctx = await ctxFor();
    setEinvClientFactory((cfg) => new EInvoiceClient(cfg, (async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)); irpCalls.push({ url: String(url), body });
      const ok = (d: unknown) => new Response(JSON.stringify({ Status: 1, status: "1", Data: d, data: d }), { status: 200 });
      if (String(url).endsWith("/Invoice")) return ok({ AckNo: 112010000000001, AckDt: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " "), Irn: "a".repeat(64), SignedQRCode: "eyJhbGciOiJSUzI1NiJ9.qr.sig", SignedInvoice: "eyJ.inv" });
      if (String(url).endsWith("/Cancel")) return ok({ Irn: body.Irn, CancelDate: "now" });
      if (String(url).endsWith("/ewaybill")) return ok({ EwbNo: 331000000001, EwbDt: "now", EwbValidTill: "tomorrow" });
      return ok({ ewayBillNo: 341000000009, ewayBillDate: "now", validUpto: "tomorrow" });
    }) as typeof fetch));

    await expect(generateIrn(ctx, saleIntra)).rejects.toThrow(/E-invoicing applicable/);
    await saveGstSettings(ctx, { einvoicing: true });
    await expect(generateIrn(ctx, saleWalkIn)).rejects.toThrow(/no customer GSTIN/);
    const r = await generateIrn(ctx, saleIntra);
    expect(r.irn).toBe("a".repeat(64));
    const sent = irpCalls[0].body as { DocDtls: { No: string }; BuyerDtls: { Gstin: string; Pin: number; Pos: string }; ValDtls: { TotInvVal: number; CgstVal: number } };
    expect(sent.BuyerDtls).toMatchObject({ Gstin: INTRA, Pin: 411004, Pos: "27" });
    expect(sent.ValDtls).toMatchObject({ TotInvVal: 3360, CgstVal: 180 });
    await expect(generateIrn(ctx, saleIntra)).rejects.toThrow(/already has an IRN/);
    const printed = (await einvoiceFor(ctx, saleIntra))!;
    expect(printed).toMatchObject({ irn: "a".repeat(64), ackNo: "112010000000001", cancelled: false });
    expect(printed.qr).toMatch(/^data:image\/png;base64,/);

    await expect(generateSaleEwb(ctx, saleIntra, { distanceKm: "8", mode: "1", vehicleNo: "bad" })).rejects.toThrow(/Vehicle number/);
    expect(await generateSaleEwb(ctx, saleIntra, { distanceKm: "8", mode: "1", vehicleNo: "MH12 AB 1234" })).toBe("331000000001");
    expect((await einvoiceQueue(ctx)).sales.find((s) => s.id === saleIntra)).toMatchObject({ ewbNo: "331000000001", canCancel: true, fullyReturned: false });

    await expect(cancelIrn(ctx, saleIntra, "2", "Wrong customer")).rejects.toThrow(/Return the whole invoice first/);
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: saleIntra } });
    await processReturn(ctx, { saleId: saleIntra, lines: [{ itemId: item.id, qty: 3 }], condition: "sealed", refundMode: "Cash", reason: "Billed to wrong customer" });
    await cancelIrn(ctx, saleIntra, "2", "Wrong customer");
    expect((await einvoiceFor(ctx, saleIntra))!).toMatchObject({ irn: null, cancelled: true });
    const g = (await gstr1For(ctx, HOME)).json;
    expect(g.b2b!.map((b) => b.ctin)).toEqual([INTER]);
    expect(g.cdnr!.map((c) => c.ctin)).toEqual([INTER]);
    expect(g.doc_issue!.doc_det[0].docs[0]).toMatchObject({ totnum: 3, cancel: 1, net_issue: 2 });
    await expect(db.eInvoice.updateMany({ data: { irn: "x" } })).rejects.toThrow(/append-only/);

    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "TL1" } });
    const second = ctx.branches.find((x) => x.name === "Second")!.id;
    await requestTransfer(ctx, b.id, second, 100);
    const tr = await db.transfer.findFirstOrThrow();
    expect((await einvoiceQueue(ctx)).transfers[0]).toMatchObject({ no: tr.no, value: 8000000, ewbRequired: true, ewbNo: null });
    expect(await generateTransferEwb(ctx, tr.id, { distanceKm: "5", mode: "1", vehicleNo: "MH12AB1234" })).toBe("341000000009");
    const ewb = irpCalls.at(-1)!.body as { action: string; data: { subSupplyType: string; docType: string; totInvValue: number; fromPincode: number } };
    expect(ewb).toMatchObject({ action: "GENEWAYBILL", data: { subSupplyType: "5", docType: "CHL", totInvValue: 80000, fromPincode: 411005 } });
    expect((await db.auditEvent.findMany({ where: { action: { in: ["IRN generated", "IRN cancelled", "E-way bill generated"] } } })).length).toBe(4);
  });

  it("reports a voided bill as a cancelled document, not as a supply", async () => {
    const ctx = await ctxFor();
    const b = await db.batch.findFirstOrThrow({ where: { batchNo: "TL1" } });
    const before = (await gstr1For(ctx, HOME)).json;
    const id = (await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: b.id, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } })).saleId;
    await voidSale(ctx, id, "Wrong items billed");
    const g = (await gstr1For(ctx, HOME)).json;
    expect(g.b2cs).toEqual(before.b2cs);
    expect(g.hsn!.hsn_b2c).toEqual(before.hsn!.hsn_b2c);
    expect(g.doc_issue!.doc_det[0].docs[0]).toMatchObject({ totnum: 4, cancel: 2, net_issue: 2 });
  });
});
