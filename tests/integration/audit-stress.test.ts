import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, invoiceData } from "@/domain/sales/service";
import { processReturn } from "@/domain/sales/returns";
import { trialBalance } from "@/domain/accounting/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

/**
 * Audit stress tests: many counters at once, opposite lock orders, double returns, and GST checked against an
 * independent calculation (not the app's own helpers).
 */
const key = () => "k_" + randomUUID().replace(/-/g, "");
const sale = (lines: { medicineId: string; batchId: string; qty: number }[], extra: Record<string, unknown> = {}) =>
  ({ idempotencyKey: key(), lines, customerId: null, discountPct: 0, pay: { mode: "cash" as const }, ...extra });

/** Independent GST maths for an MRP-inclusive line: taxable = round(net × 100 / (100 + rate)). */
function expectedLine(mrpPaise: number, qty: number, rate: number, discPct = 0) {
  const gross = mrpPaise * qty;
  const net = gross - Math.round((gross * discPct) / 100);
  const taxable = Math.round((net * 100) / (100 + rate));
  const tax = net - taxable;
  return { net, taxable, tax };
}

let paraId = "", azId = "", p1 = "", p2 = "", a1 = "";

describe("audit: concurrency, conservation and GST", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "10", reorderLevel: 5, barcode: "", hsn: "3004", rack: "", schedule: "" as const };
    paraId = await createMedicine(ctx, { ...base, name: "Para 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", gstRate: 12 });
    azId = await createMedicine(ctx, { ...base, name: "Vita C", generic: "Ascorbic acid", strength: "500 mg", mrp: "27.35", gstRate: 5 });
    await receiveBatch(ctx, { medicineId: paraId, batchNo: "P1", expiry: addDays(todayISO(), 300), qty: 10, cost: "10", mrp: "33.60", supplierId: null, invoiceNo: "" });
    await receiveBatch(ctx, { medicineId: paraId, batchNo: "P2", expiry: addDays(todayISO(), 400), qty: 10, cost: "10", mrp: "33.60", supplierId: null, invoiceNo: "" });
    await receiveBatch(ctx, { medicineId: azId, batchNo: "A1", expiry: addDays(todayISO(), 300), qty: 200, cost: "10", mrp: "27.35", supplierId: null, invoiceNo: "" });
    p1 = (await db.batch.findFirstOrThrow({ where: { batchNo: "P1" } })).id;
    p2 = (await db.batch.findFirstOrThrow({ where: { batchNo: "P2" } })).id;
    a1 = (await db.batch.findFirstOrThrow({ where: { batchNo: "A1" } })).id;
  }, 60_000);

  it("25 concurrent sales on 10 units across 2 counters: exactly 10 succeed, no oversell, gapless numbers", async () => {
    const c1 = await ctxFor("Cashier"), c2 = await ctxFor("Manager");
    const r = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => commitSale(i % 2 ? c1 : c2, sale([{ medicineId: paraId, batchId: p1, qty: 1 }]))));
    const ok = r.filter((x) => x.status === "fulfilled");
    const errs = r.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => String(x.reason?.message ?? x.reason));
    expect(ok).toHaveLength(10);
    // Losers get a clear stock message, never a raw database error (deadlock / serialization / unique violation).
    for (const e of errs) expect(e).toMatch(/only 0|left|stock/i);
    const b = await db.batch.findUniqueOrThrow({ where: { id: p1 } });
    expect(b.qtyAvailable).toBe(0);
    const nos = (await db.sale.findMany({ select: { invoiceNo: true } })).map((s) => Number(s.invoiceNo.slice(-6))).sort((x, y) => x - y);
    expect(nos).toEqual(nos.map((_, i) => i + 1));
    expect(new Set(nos).size).toBe(nos.length);
  }, 60_000);

  it("opposite lock orders on two batches never deadlock into a raw error", async () => {
    await db.batch.update({ where: { id: p1 }, data: { qtyAvailable: 50 } });
    await db.batch.update({ where: { id: p2 }, data: { qtyAvailable: 50 } });
    const c = await ctxFor("Cashier");
    const jobs = Array.from({ length: 16 }, (_, i) => commitSale(c, sale(i % 2
      ? [{ medicineId: paraId, batchId: p1, qty: 1 }, { medicineId: azId, batchId: a1, qty: 1 }, { medicineId: paraId, batchId: p2, qty: 1 }]
      : [{ medicineId: paraId, batchId: p2, qty: 1 }, { medicineId: azId, batchId: a1, qty: 1 }, { medicineId: paraId, batchId: p1, qty: 1 }])));
    const r = await Promise.allSettled(jobs);
    const errs = r.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => String(x.reason?.message ?? x.reason));
    expect(errs, errs.join("\n")).toEqual([]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: p1 } })).qtyAvailable).toBe(34);
    expect((await db.batch.findUniqueOrThrow({ where: { id: p2 } })).qtyAvailable).toBe(34);
  }, 60_000);

  it("stock is conserved: every batch's quantity equals the sum of its movements", async () => {
    const rows = await db.$queryRaw<{ id: string; batchNo: string; qty: number; moved: bigint }[]>`
      SELECT b.id, b."batchNo", b."qtyAvailable" AS qty, COALESCE(SUM(m.qty), 0)::bigint AS moved
      FROM "Batch" b LEFT JOIN "StockMovement" m ON m."batchId" = b.id GROUP BY b.id`;
    const drift = rows.filter((r) => Number(r.moved) !== r.qty && !["P1", "P2"].includes(r.batchNo));
    // P1/P2 were topped up directly in the test above (no movement), so only A1 is a pure ledger check here.
    expect(drift.map((r) => `${r.batchNo}: qty ${r.qty} vs movements ${r.moved}`)).toEqual([]);
    const a = rows.find((r) => r.batchNo === "A1")!;
    expect(a.qty).toBe(200 - 16); // 16 three-line carts above each took one unit of A1
  });

  it("concurrent returns of the same line never refund more than was sold", async () => {
    const c = await ctxFor("Manager");
    const s = await commitSale(c, sale([{ medicineId: azId, batchId: a1, qty: 3 }]));
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    const before = (await db.batch.findUniqueOrThrow({ where: { id: a1 } })).qtyAvailable;
    const r = await Promise.allSettled(Array.from({ length: 4 }, () =>
      processReturn(c, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 2 }], condition: "sealed", refundMode: "Cash", reason: "Customer returned" })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await db.batch.findUniqueOrThrow({ where: { id: a1 } })).qtyAvailable).toBe(before + 2);
  }, 60_000);

  it("GST and totals match an independent calculation (12% and 5%, with discount)", async () => {
    const c = await ctxFor("Manager");
    const cases: [number, number, number][] = [[1, 1, 0], [3, 7, 0], [2, 5, 4.5], [7, 1, 10], [1, 13, 2]];
    for (const [qp, qa, disc] of cases) {
      const s = await commitSale(c, sale([{ medicineId: paraId, batchId: p2, qty: qp }, { medicineId: azId, batchId: a1, qty: qa }], { discountPct: disc }));
      const inv = await invoiceData(c, s.saleId);
      const L = [expectedLine(3360, qp, 12, disc), expectedLine(2735, qa, 5, disc)];
      // Taxable is per line; the CGST/SGST split is made once on the bill's total tax (keeps the halves within 1 paisa).
      const sum = L.reduce((t, l) => ({ net: t.net + l.net, taxable: t.taxable + l.taxable }), { net: 0, taxable: 0 });
      const tax = sum.net - sum.taxable;
      const exp = { ...sum, cgst: Math.floor(tax / 2), sgst: tax - Math.floor(tax / 2) };
      const got = inv!.totals as unknown as { taxable: number; cgst: number; sgst: number };
      expect({ taxable: got.taxable, cgst: got.cgst, sgst: got.sgst }, `case ${qp}/${qa}/${disc}%`).toEqual({ taxable: exp.taxable, cgst: exp.cgst, sgst: exp.sgst });
      // Bill total is the net rounded to the nearest rupee (round-off line).
      expect(s.total, `total ${qp}/${qa}/${disc}%`).toBe(Math.round(exp.net / 100) * 100);
    }
  }, 60_000);

  it("the books balance after all of the above (trial balance debits = credits)", async () => {
    const tb = await trialBalance(await ctxFor());
    const json = JSON.stringify(tb, (_, v) => (typeof v === "bigint" ? Number(v) : v));
    const t = JSON.parse(json) as { totals?: { debit: number; credit: number }; rows?: { debit: number; credit: number }[] };
    const rows = t.rows ?? (Array.isArray(t) ? (t as unknown as { debit: number; credit: number }[]) : []);
    const dr = rows.reduce((s, r) => s + Number(r.debit ?? 0), 0), cr = rows.reduce((s, r) => s + Number(r.credit ?? 0), 0);
    expect(rows.length).toBeGreaterThan(3);
    expect(dr).toBe(cr);
    const lines = await db.$queryRaw<{ d: bigint; c: bigint }[]>`SELECT SUM("debitPaise")::bigint d, SUM("creditPaise")::bigint c FROM "LedgerLine"`;
    expect(lines[0].d).toBe(lines[0].c);
  });
});
