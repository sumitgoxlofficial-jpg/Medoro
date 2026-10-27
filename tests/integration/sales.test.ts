import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer, invoiceData } from "@/domain/sales/service";
import { addDays, todayISO, dateOnly } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
let dolo = "", azi = "", early = "", late = "", expired = "", aziB = "";

async function batchId(no: string) { return (await db.batch.findFirstOrThrow({ where: { batchNo: no } })).id; }

describe("sale commit", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 5, barcode: "", hsn: "3004", rack: "" };
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", schedule: "" });
    azi = await createMedicine(ctx, { ...base, name: "Azithral 500", generic: "Azithromycin", strength: "500 mg", mrp: "119.50", schedule: "H1" });
    const r = (medicineId: string, batchNo: string, days: number, qty: number, mrp: string) =>
      receiveBatch(ctx, { medicineId, batchNo, expiry: addDays(todayISO(), days), qty, cost: "10", mrp, supplierId: null, invoiceNo: "" });
    await r(dolo, "EARLY", 40, 3, "33.60"); await r(dolo, "LATE", 400, 10, "33.60"); await r(azi, "AZ1", 300, 5, "119.50");
    await r(dolo, "EXP", 5, 4, "33.60");
    // Make EXP expired: backdate (test-only, bypasses the receive rule).
    await db.batch.update({ where: { id: await batchId("EXP") }, data: { expiryDate: dateOnly(addDays(todayISO(), -2)) } });
    early = await batchId("EARLY"); late = await batchId("LATE"); expired = await batchId("EXP"); aziB = await batchId("AZ1");
  });

  const sale = (lines: { medicineId: string; batchId: string; qty: number }[], extra: Partial<Parameters<typeof commitSale>[1]> = {}) =>
    ({ idempotencyKey: key(), lines, customerId: null, discountPct: 0, pay: { mode: "cash" as const }, ...extra });

  it("commits, decrements stock, posts a balanced voucher, numbers invoices without gaps", async () => {
    const ctx = await ctxFor("Cashier");
    const a = await commitSale(ctx, sale([{ medicineId: dolo, batchId: early, qty: 2 }]));
    const b = await commitSale(ctx, sale([{ medicineId: dolo, batchId: early, qty: 1 }]));
    expect(a.invoiceNo).toMatch(/^TMS\/MAI\/\d{4}\/000001$/);
    expect(b.invoiceNo.slice(-6)).toBe("000002");
    expect(a.total).toBe(6700); // 67.20 → 67
    expect((await db.batch.findUniqueOrThrow({ where: { id: early } })).qtyAvailable).toBe(0);
    const v = await db.voucher.findFirstOrThrow({ where: { refId: a.saleId }, include: { lines: true } });
    const dr = v.lines.reduce((s, l) => s + Number(l.debitPaise), 0), cr = v.lines.reduce((s, l) => s + Number(l.creditPaise), 0);
    expect(dr).toBe(cr); expect(dr).toBe(6720);
    const inv = await invoiceData(ctx, a.saleId);
    expect(inv!.totals.cgst + inv!.totals.sgst + inv!.totals.taxable).toBe(6720);
  });

  it("blocks expired, quarantined and over-quantity lines even if the client sends them", async () => {
    const ctx = await ctxFor("Cashier");
    await expect(commitSale(ctx, sale([{ medicineId: dolo, batchId: expired, qty: 1 }]))).rejects.toThrow(/expired/);
    await expect(commitSale(ctx, sale([{ medicineId: dolo, batchId: early, qty: 1 }]))).rejects.toThrow(/only 0/);
    await db.batch.update({ where: { id: late }, data: { status: "quarantine" } });
    await expect(commitSale(ctx, sale([{ medicineId: dolo, batchId: late, qty: 1 }]))).rejects.toThrow(/quarantined/);
    await db.batch.update({ where: { id: late }, data: { status: "ok" } });
    await expect(commitSale(ctx, sale([{ medicineId: azi, batchId: late, qty: 1 }]))).rejects.toThrow(/doesn’t match/);
    await expect(commitSale(await ctxFor("Cashier", "Second"), sale([{ medicineId: dolo, batchId: late, qty: 1 }]))).rejects.toThrow(/doesn’t match/);
  });

  it("the same idempotency key gives one sale", async () => {
    const ctx = await ctxFor("Cashier");
    const s = sale([{ medicineId: dolo, batchId: late, qty: 1 }]);
    const [x, y] = await Promise.all([commitSale(ctx, s), commitSale(ctx, s)]);
    expect(x.saleId).toBe(y.saleId);
    expect(await db.sale.count({ where: { idempotencyKey: s.idempotencyKey } })).toBe(1);
    expect((await db.batch.findUniqueOrThrow({ where: { id: late } })).qtyAvailable).toBe(9);
  });

  it("two counters racing for the last units: exactly one succeeds", async () => {
    const ctx = await ctxFor("Cashier");
    await db.batch.update({ where: { id: late }, data: { qtyAvailable: 1 } });
    const r = await Promise.allSettled([1, 2, 3, 4].map(() => commitSale(ctx, sale([{ medicineId: dolo, batchId: late, qty: 1 }]))));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await db.batch.findUniqueOrThrow({ where: { id: late } })).qtyAvailable).toBe(0);
    const nos = (await db.sale.findMany({ select: { invoiceNo: true } })).map((s) => Number(s.invoiceNo.slice(-6))).sort((a, b) => a - b);
    expect(nos).toEqual(nos.map((_, i) => i + 1)); // no gaps from rolled-back transactions
  });

  it("enforces discount caps, prescriptions and credit limits", async () => {
    await db.batch.update({ where: { id: late }, data: { qtyAvailable: 10 } });
    const cashier = await ctxFor("Cashier"), manager = await ctxFor("Manager");
    await expect(commitSale(cashier, sale([{ medicineId: dolo, batchId: late, qty: 1 }], { discountPct: 6 }))).rejects.toThrow(/above 5%/);
    await commitSale(manager, sale([{ medicineId: dolo, batchId: late, qty: 1 }], { discountPct: 10 }));
    await expect(commitSale(cashier, sale([{ medicineId: azi, batchId: aziB, qty: 1 }]))).rejects.toThrow(/prescriber/);
    await commitSale(cashier, sale([{ medicineId: azi, batchId: aziB, qty: 1 }], { prescriber: "Dr. A. Mehta" }));
    const cust = await createCustomer(manager, { name: "Ramesh", phone: "9822041736", waOptIn: true, creditLimit: "200" });
    await expect(commitSale(cashier, sale([{ medicineId: dolo, batchId: late, qty: 1 }], { customerId: cust, pay: { mode: "credit" } }))).rejects.toThrow(/cannot make credit/);
    await commitSale(manager, sale([{ medicineId: azi, batchId: aziB, qty: 1 }], { customerId: cust, pay: { mode: "credit" }, prescriber: "Dr. X" }));
    await expect(commitSale(manager, sale([{ medicineId: azi, batchId: aziB, qty: 1 }], { customerId: cust, pay: { mode: "credit" }, prescriber: "Dr. X" }))).rejects.toThrow(/credit limit/);
    await expect(commitSale(cashier, sale([{ medicineId: dolo, batchId: late, qty: 1 }], { pay: { mode: "split", cashPaise: 99999 } }))).rejects.toThrow(/cash part/);
    const sp = await commitSale(cashier, sale([{ medicineId: dolo, batchId: late, qty: 3 }], { pay: { mode: "split", cashPaise: 5000 } }));
    const pays = await db.payment.findMany({ where: { saleId: sp.saleId } });
    expect(pays.map((p) => [p.mode, Number(p.amountPaise)]).sort()).toEqual([["cash", 5000], ["upi", sp.total - 5000]]);
  });

  it("posted sales can't be edited", async () => {
    const s = await db.sale.findFirstOrThrow();
    await expect(db.sale.update({ where: { id: s.id }, data: { totalPaise: 1n } })).rejects.toThrow(/append-only/);
    const it = await db.saleItem.findFirstOrThrow({ where: { saleId: s.id } });
    await expect(db.saleItem.update({ where: { id: it.id }, data: { qty: 99 } })).rejects.toThrow(/returnedQty/);
  });
});
