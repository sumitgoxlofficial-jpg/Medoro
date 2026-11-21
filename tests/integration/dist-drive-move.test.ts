import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cancelInvoice, directInvoice } from "@/domain/distribution/billing";
import { saveScheme, setSpecialRate } from "@/domain/distribution/masters";
import { placeOrder } from "@/domain/distribution/orders";
import { createReturn, raiseDistClaim } from "@/domain/distribution/returns";
import { collectPayment, createDispatch, recordDelivery, startDispatch } from "@/domain/distribution/dispatch";
import { customerBalances } from "@/domain/parties/balances";
import { MOVE_PARTS, moveExport, startMove, undoMove, type MoveBase } from "@/domain/system/drive-move";
import { memoryDb } from "@/drivedb/node";
import { beginMove, finishMove, importPart } from "@/drivedb/migrate-in";
import { customerBalance } from "@/drivedb/trade";
import { cancelInvoice as cancelOnDevice, directInvoice as billOnDevice, invoiceView, listInvoices } from "@/drivedb/dist";
import { createReturn as returnOnDevice, deliveryOf, receivables, returnedPool } from "@/drivedb/dist-trade";
import { addDays, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";
import { distCtx, key, makeDistributor, seedBasics } from "./dist-helpers";

/**
 * Phase D6: a distributor moves from Medoro's server to its own Drive. Everything a distributor keeps comes across in
 * the device's form, every check passes, balances and the returned-goods pool equal Medoro's, and the device carries on.
 */
describe("Moving a distributor's records to Google Drive", () => {
  const today = todayISO();
  let s: Awaited<ReturnType<typeof seedBasics>>, cancelled = "", delivered = "", kept = "";

  beforeAll(async () => {
    await resetDb(); await makeDistributor();
    const ctx = await distCtx();
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), driveMode: true } } });
    s = await seedBasics(ctx, { batches: [{ no: "SOON", expiryDays: 60, qty: 40 }, { no: "LATE", expiryDays: 500, qty: 200 }], creditLimit: 1_000_000 });
    await saveScheme(ctx, null, { code: "AMOX10", name: "10 + 1", kind: "free", medicineId: s.medicineId, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    await setSpecialRate(ctx, s.customerId, s.medicineId, "48", addDays(today, 10));
    const bill = (qty: number) => directInvoice(ctx, { customerId: s.customerId, idempotencyKey: key(), lines: [{ medicineId: s.medicineId, qty }] });
    kept = (await bill(20)).invoiceId; // 20 + 2 free, the short-dated batch first
    cancelled = (await bill(3)).invoiceId;
    await cancelInvoice(ctx, cancelled, "Wrong chemist entered");
    delivered = (await bill(5)).invoiceId;
    // Credit notes: expired goods wait to be claimed (quarantine); saleable goods go back to stock.
    const lines = await db.distInvoiceLine.findMany({ where: { invoiceId: kept }, orderBy: { qty: "desc" } });
    await createReturn(ctx, { invoiceId: kept, reason: "Short-dated", lines: [{ invoiceLineId: lines[0].id, qty: 4, condition: "expired", creditPct: 80 }] });
    await createReturn(ctx, { invoiceId: kept, reason: "Not needed", lines: [{ invoiceLineId: lines[0].id, qty: 2, condition: "saleable" }] });
    // Part of the returned goods is claimed on the company already.
    const soon = await db.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId, batchNo: "SOON" } });
    await raiseDistClaim(ctx, { batchId: soon.id, qty: 1, reason: "near_expiry" });
    // A delivered invoice with cash collected at the door, and a payment at the office.
    const d = await createDispatch(ctx, { invoiceIds: [delivered], vehicleNo: "MH12AB1234" });
    await startDispatch(ctx, d.dispatchId);
    const del = await db.distDelivery.findUniqueOrThrow({ where: { invoiceId: delivered } });
    await recordDelivery(ctx, del.id, { outcome: "delivered", receiverName: "Sai (owner)", collected: "100", mode: "Cash" });
    await collectPayment(ctx, { customerId: s.customerId, amount: "200", method: "UPI" });
  }, 60_000);

  it("refuses to start while orders are open", async () => {
    const ctx = await distCtx();
    const o = await placeOrder({ kind: "user", ctx }, { customerId: s.customerId, idempotencyKey: key(), lines: [{ medicineId: s.medicineId, qty: 1 }] });
    await expect(startMove(ctx)).rejects.toThrow(/1 order\(s\) are still open/);
    await db.distOrder.update({ where: { id: o.orderId }, data: { status: "cancelled" } });
  });

  it("the device loads everything, every check passes, and balances and returned goods equal Medoro's", async () => {
    const ctx = await distCtx();
    await startMove(ctx);
    const base = (await moveExport(ctx, "base")) as MoveBase;
    expect(base.dist).not.toBeNull();
    expect(base.summary.counts).toMatchObject({ distInvoice: 3, distInvoiceCancel: 1, distReturn: 2, distDeliveryEvent: 1, distCollection: 2, distScheme: 1, distSpecialRate: 1, distPrincipal: 1, distChemist: 1, distProduct: 1 });
    const dev = await memoryDb("DISTMOVE");
    beginMove(dev, base);
    for (const part of MOVE_PARTS) { let next: string | null = null; do { const page = (await moveExport(ctx, part, next)) as { rows: unknown[]; next: string | null }; importPart(dev, part, page.rows); next = page.next; } while (next); }
    const res = finishMove(dev, base, ctx.userId);
    expect(res.checks.filter((c) => !c.ok)).toEqual([]);
    expect(res.checks.map((c) => c.name)).toContain("Returned goods to claim");

    expect(customerBalance(dev, s.customerId)).toBe((await customerBalances(db, ctx.tenantId)).get(s.customerId));
    const soon = await db.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId, batchNo: "SOON" } });
    expect(returnedPool(dev, soon.id)).toBe(soon.qtyQuarantined);
    expect(listInvoices(dev).find((i) => i.id === cancelled)).toMatchObject({ cancelled: true });
    expect(deliveryOf(dev, delivered)).toMatchObject({ status: "delivered", receiverName: "Sai (owner)" });
    expect(receivables(dev, today)[0]).toMatchObject({ customerId: s.customerId, balance: customerBalance(dev, s.customerId) });

    // The device carries on: a new bill (with the chemist's special rate), a credit note on a moved invoice, and the
    // moved invoices keep their rules (a delivered one can't be cancelled).
    const n = billOnDevice(dev, { branchId: ctx.branchId, customerId: s.customerId, userId: ctx.userId, idempotencyKey: key(), lines: [{ medicineId: s.medicineId, qty: 2 }] }, today);
    expect(Number(invoiceView(dev, n.invoiceId)!.lines[0].ratePaise)).toBe(4800);
    const line = invoiceView(dev, kept)!.lines.sort((a, b) => Number(b.qty) - Number(a.qty))[0];
    expect(returnOnDevice(dev, { invoiceId: kept, userId: ctx.userId, reason: "Damaged in transit", lines: [{ invoiceLineId: String(line.id), qty: 1, condition: "damaged" }] }, today).total).toBeGreaterThan(0);
    expect(() => cancelOnDevice(dev, { invoiceId: delivered, reason: "Changed mind", userId: ctx.userId }, today)).toThrow(/Delivered invoices/);
    await undoMove(ctx);
  });
});
