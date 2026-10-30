import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer, invoiceData } from "@/domain/sales/service";
import { processReturn } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { customerPoints, expirePoints, pointsBalance, saveLoyaltySettings } from "@/domain/sales/loyalty";
import { ACC } from "@/domain/accounting/accounts";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("Loyalty points", () => {
  let med = "", batch = "", cust = "";
  const sale = async (qty: number, extra: { redeemPoints?: number; pay?: "cash" | "split"; cashPaise?: number } = {}) => commitSale(await ctxFor(), {
    idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: batch, qty }], customerId: cust, discountPct: 0,
    pay: { mode: extra.pay ?? "cash", cashPaise: extra.cashPaise }, redeemPoints: extra.redeemPoints,
  });
  const bal = async () => pointsBalance(db, (await ctxFor()).tenantId, cust);

  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300).slice(0, 7), qty: 100, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow()).id;
    cust = await createCustomer(ctx, { name: "Ramesh", phone: "9822041736", waOptIn: false, creditLimit: "0" });
  });

  it("earns nothing while off, then 1 point per ₹100 paid", async () => {
    await sale(1);
    expect(await bal()).toBe(0);
    const ctx = await ctxFor();
    await expect(saveLoyaltySettings(await ctxFor("Cashier"), { enabled: true })).rejects.toThrow();
    await expect(saveLoyaltySettings(ctx, { earnPer100: 0 })).rejects.toThrow(/between/);
    await saveLoyaltySettings(ctx, { enabled: true, earnPer100: 1, pointValuePaise: 100, minRedeem: 10, expiryMonths: 12 });
    const s = await sale(10); // ₹1,550
    expect(await bal()).toBe(15);
    const row = await db.loyaltyLedger.findFirstOrThrow({ where: { saleId: s.saleId } });
    expect(row).toMatchObject({ kind: "earn", points: 15 });
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 300 * 86400_000);
  });

  it("redeems points as part payment under a balance check, booked to Loyalty points redeemed", async () => {
    await expect(sale(1, { redeemPoints: 5 })).rejects.toThrow(/at least 10/);
    await expect(sale(1, { redeemPoints: 20 })).rejects.toThrow(/Only 15 points/);
    await expect(sale(1, { redeemPoints: 12, pay: "split", cashPaise: 14300 })).rejects.toThrow(/cash part/); // ₹155 − ₹12 leaves ₹143 to pay
    const s = await sale(1, { redeemPoints: 12, pay: "split", cashPaise: 10000 });
    const pays = await db.payment.findMany({ where: { saleId: s.saleId } });
    expect(Object.fromEntries(pays.map((p) => [p.mode, Number(p.amountPaise)]))).toEqual({ cash: 10000, upi: 4300, loyalty: 1200 });
    const v = await db.voucher.findFirstOrThrow({ where: { refType: "sale", refId: s.saleId }, include: { lines: true } });
    expect(v.lines.find((l) => l.account === ACC.loyalty)).toMatchObject({ debitPaise: 1200n });
    expect(v.lines.reduce((a, l) => a + Number(l.debitPaise) - Number(l.creditPaise), 0)).toBe(0);
    expect(await bal()).toBe(15 - 12 + 1); // earned on ₹143 paid
    const inv = await invoiceData(await ctxFor(), s.saleId);
    expect(inv?.totals.total).toBe(15500); // the invoice and its GST are unchanged
    expect(inv?.points).toMatchObject({ earned: 1, redeemed: 12, balance: 4 });

    // Concurrent redemptions can't spend the same points twice.
    await sale(10); // +15 → 19
    const r = await Promise.allSettled([sale(1, { redeemPoints: 15 }), sale(1, { redeemPoints: 15 })]);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await bal()).toBe(19 - 15 + 1);
  });

  it("returns take back earned points and give back redeemed ones in proportion; voids reverse everything", async () => {
    const ctx = await ctxFor();
    await sale(10); // +15
    const start = await bal();
    const s = await sale(2, { redeemPoints: 20 }); // ₹310 − ₹20 = ₹290 paid → +2
    expect(await bal()).toBe(start - 20 + 2);
    const items = await db.saleItem.findMany({ where: { saleId: s.saleId } });
    const r1 = await processReturn(ctx, { saleId: s.saleId, lines: [{ itemId: items[0].id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Not needed" });
    expect(r1).toMatchObject({ amount: 15500, money: 15500 - 1000, pointsBack: 10, pointsTaken: 1 });
    const cn = await db.voucher.findFirstOrThrow({ where: { refType: "sales_return", refId: r1.id }, include: { lines: true } });
    expect(cn.lines.find((l) => l.account === ACC.cash)).toMatchObject({ creditPaise: 14500n });
    expect(cn.lines.find((l) => l.account === ACC.loyalty)).toMatchObject({ creditPaise: 1000n });
    expect(await bal()).toBe(start - 20 + 2 - 1 + 10);
    const r2 = await processReturn(ctx, { saleId: s.saleId, lines: [{ itemId: items[0].id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Not needed" });
    expect(r2).toMatchObject({ pointsBack: 10, pointsTaken: 1 });
    expect(await bal()).toBe(start);

    const v = await sale(1, { redeemPoints: 10 });
    expect(await bal()).toBe(start - 10 + 1);
    await voidSale(ctx, v.saleId, "Wrong customer");
    expect(await bal()).toBe(start);
    expect((await customerPoints(ctx, cust)).rows.slice(0, 2).map((x) => x.kind).sort()).toEqual(["restore", "reverse"]);
  });

  it("expires unused points oldest first, once a day", async () => {
    const ctx = await ctxFor();
    const c = await createCustomer(ctx, { name: "Old Points", phone: "9822041700", waOptIn: false, creditLimit: "0" });
    const past = new Date(Date.now() - 86400_000);
    await db.loyaltyLedger.createMany({ data: [
      { tenantId: ctx.tenantId, customerId: c, kind: "earn", points: 30, at: new Date(Date.now() - 400 * 86400_000), expiresAt: past },
      { tenantId: ctx.tenantId, customerId: c, kind: "redeem", points: -10, valuePaise: 1000n, at: new Date(Date.now() - 100 * 86400_000) },
      { tenantId: ctx.tenantId, customerId: c, kind: "earn", points: 7, at: new Date(), expiresAt: new Date(Date.now() + 300 * 86400_000) },
    ] });
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...((await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } })).settings as object), loyaltyExpiryDay: "" } } });
    expect(await expirePoints()).toBe(20);
    expect(await pointsBalance(db, ctx.tenantId, c)).toBe(7);
    expect(await expirePoints()).toBe(0);
    await expect(db.$executeRaw`UPDATE "LoyaltyLedger" SET points = 0`).rejects.toThrow(/append-only/);
  });
});
