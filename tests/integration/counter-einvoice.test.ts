import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { EInvoiceClient } from "@/domain/gst/einvoice";
import { counterCancelIrn, counterIrn, saveGstSettings, setEinvClientFactory } from "@/domain/gst/service";
import { memoryDb } from "@/drivedb/node";
import { addMedicine, createSale } from "@/drivedb/pharmacy";
import { addCustomer, createReturn, recordPurchase, addSupplier } from "@/drivedb/trade";
import { cancelCheck, einvoiceDoc, einvoiceOf, recordIrn, recordIrnCancel, setBillingAddress } from "@/drivedb/einvoice";
import { saleDetail } from "@/drivedb/reports";
import type { Pharmacy } from "@/drivedb/seed";
import { todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const HOME = "27AAKFS3192P1Z6", BUYER = "27AABCS1429B1ZU";
const ENV = { EINVOICE_PROVIDER: "gsp-http", EINVOICE_BASE_URL: "https://gsp.test", EINVOICE_CLIENT_ID: "cid", EINVOICE_CLIENT_SECRET: "sec", EINVOICE_USERNAME: "u", EINVOICE_PASSWORD: "p", EINVOICE_GSTIN: HOME };
const pharmacy: Pharmacy = { name: "Test Medical Store Pvt Ltd", tradeName: "Test Medical Store", gstin: HOME, dl: "MH-1234", address: "Shop 1, FC Road, Pune 411004", phone: "9822000001" };

describe("e-invoices from a Drive mode counter (phase 6)", () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k as keyof typeof ENV]; }
    setEinvClientFactory((cfg) => new EInvoiceClient(cfg, (async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)); calls.push({ url: String(url), body });
      const ok = (d: unknown) => new Response(JSON.stringify({ Status: 1, Data: d }), { status: 200 });
      if (String(url).endsWith("/Cancel")) return ok({ Irn: body.Irn, CancelDate: "now" });
      return ok({ AckNo: 112010000000007, AckDt: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " "), Irn: "b".repeat(64), SignedQRCode: "eyJhbGciOiJSUzI1NiJ9.qr.sig" });
    }) as typeof fetch));
  });
  afterAll(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

  it("the counter builds the e-invoice, Medoro gets the IRN without keeping anything, and the counter cancels it after a full return", async () => {
    const ctx = { ...(await ctxFor("Cashier")), moved: true };
    await saveGstSettings(await ctxFor(), { einvoicing: true });
    const dev = await memoryDb("DEINV1");
    const m = addMedicine(dev, { name: "Dolo 650", gstRate: 12, mrpPaise: 3360, hsn: "30049099", form: "Tablet" });
    recordPurchase(dev, { branchId: "b1", supplierId: addSupplier(dev, { name: "Agency" }).id, billNo: "P1", billDate: todayISO(), userId: "u", lines: [{ medicineId: m.id, batchNo: "A1", expiryDate: "2030-01-31", packs: 10, costPaise: 2000, mrpPaise: 3360 }] });
    const c = addCustomer(dev, { name: "Shree Clinic", phone: "9822000002", gstin: BUYER, creditLimitPaise: 1000000 });
    const sale = createSale(dev, { branchId: "b1", series: "DEINV", userId: "u", customerId: c.id, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "credit" } });

    expect(() => einvoiceDoc(dev, sale.saleId, pharmacy)).toThrow(/billing address and PIN/);
    setBillingAddress(dev, c.id, "12, Karve Road, Pune", "411004");
    const doc = einvoiceDoc(dev, sale.saleId, pharmacy);
    expect(doc).toMatchObject({ type: "INV", no: sale.invoiceNo, seller: { gstin: HOME, pin: 411004 }, buyer: { gstin: BUYER, pin: 411004, pos: "27" } });

    await expect(counterIrn(ctx, { ...doc, seller: { ...doc.seller, gstin: "29AAGCB7383J1Z4" } })).rejects.toThrow(/isn’t this pharmacy’s/);
    const before = await db.eInvoice.count();
    const r = await counterIrn(ctx, doc);
    expect(r).toMatchObject({ irn: "b".repeat(64), ackNo: "112010000000007", signedQr: "eyJhbGciOiJSUzI1NiJ9.qr.sig" });
    const sent = calls.at(-1)!.body as { DocDtls: { No: string }; BuyerDtls: { Gstin: string }; ValDtls: { TotInvVal: number } };
    expect(sent).toMatchObject({ DocDtls: { No: sale.invoiceNo }, BuyerDtls: { Gstin: BUYER }, ValDtls: { TotInvVal: Number(dev.engine.all<{ t: number }>("SELECT totalPaise AS t FROM sale WHERE id = ?", [sale.saleId])[0].t) / 100 } });
    expect(await db.eInvoice.count()).toBe(before); // nothing kept on Medoro

    recordIrn(dev, sale.saleId, r, "u");
    expect(saleDetail(dev, sale.saleId).einvoice).toMatchObject({ irn: "b".repeat(64), cancelled: false });
    expect(() => einvoiceDoc(dev, sale.saleId, pharmacy)).toThrow(/already has an e-invoice/);

    // Cancelling: only once the whole bill is returned, within 24 hours.
    expect(() => cancelCheck(dev, sale.saleId)).toThrow(/Return the whole bill/);
    const item = String(dev.from("saleItem").eq("saleId", sale.saleId).first()!.id);
    createReturn(dev, { saleId: sale.saleId, series: "DEINV", userId: "u", reason: "Order cancelled", condition: "sealed", refundMode: "credit", lines: [{ saleItemId: item, qty: 1 }] });
    const irn = cancelCheck(dev, sale.saleId);
    await expect(counterCancelIrn(await ctxFor("Cashier"), { irn, reason: "3", remark: "Order cancelled" })).rejects.toThrow(/can’t cancel/);
    const done = await counterCancelIrn({ ...(await ctxFor("Manager")), moved: true }, { irn, reason: "3", remark: "Order cancelled" });
    recordIrnCancel(dev, sale.saleId, done.reason, "u");
    expect(einvoiceOf(dev, sale.saleId)).toMatchObject({ cancelled: true });
    expect(calls.at(-1)!.body).toMatchObject({ Irn: "b".repeat(64), CnlRsn: "3" });
  });
});
