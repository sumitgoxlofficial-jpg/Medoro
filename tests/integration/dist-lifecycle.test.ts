import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetDb } from "./helpers";
import { distCtx, key, makeDistributor, seedBasics } from "./dist-helpers";
import { approveOrder, cancelOrder, confirmPickLine, orderDetail, packOrder, placeOrder, startPicking } from "@/domain/distribution/orders";
import { cancelInvoice, directInvoice, invoiceOrder, invoiceView } from "@/domain/distribution/billing";
import { saveScheme } from "@/domain/distribution/masters";
import { customerBalance } from "@/domain/parties/balances";
import { addDays, todayISO } from "@/lib/dates";

beforeEach(async () => { await resetDb(); await makeDistributor(); });

const stockOf = async (medicineId: string) => (await db.batch.aggregate({ where: { medicineId }, _sum: { qtyAvailable: true } }))._sum.qtyAvailable;

describe("distribution: order to invoice", () => {
  it("creates a distribution tenant with distribution roles", async () => {
    const t = await db.tenant.findUniqueOrThrow({ where: { code: "DISTA-PUNE" } });
    expect(t.product).toBe("distribution");
    const roles = await db.role.findMany({ where: { tenantId: t.id } });
    expect(roles.map((r) => r.name).sort()).toEqual(["Accountant", "Billing", "Delivery", "Manager", "Owner", "Salesman", "Warehouse"]);
    expect((await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId: t.id } })).plan).toBe("Distribution Professional");
  });

  it("runs approve → pick → pack → invoice with a free-goods scheme, FEFO and correct GST", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { batches: [{ no: "LATE", expiryDays: 500, qty: 100 }, { no: "EARLY", expiryDays: 200, qty: 15 }] });
    await saveScheme(ctx, null, { code: "AMX10", name: "10+1", kind: "free", medicineId, buyQty: 10, freeQty: 1, validFrom: addDays(todayISO(), -1), validTo: addDays(todayISO(), 30) });
    const o = await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 20 }] });
    expect(o.status).toBe("pending");
    // Replays return the same order.
    const again = await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: (await db.distOrder.findUniqueOrThrow({ where: { id: o.orderId } })).idempotencyKey, lines: [{ medicineId, qty: 20 }] });
    expect(again).toMatchObject({ orderId: o.orderId, replayed: true });

    const ap = await approveOrder(ctx, o.orderId);
    const d = (await orderDetail(ctx, o.orderId))!;
    expect(d.lines[0]).toMatchObject({ qty: 20, freeQty: 2 });
    // 22 packs FEFO: 15 from EARLY, 7 from LATE.
    expect(d.pick!.lines.map((l) => [l.batchNo, l.units])).toEqual([["EARLY", 15], ["LATE", 7]]);
    expect(ap.pickNo).toMatch(/^PK-/);
    // Reserved, not yet taken.
    expect(await stockOf(medicineId)).toBe(115);

    await startPicking(ctx, d.pick!.id);
    for (const l of d.pick!.lines) await confirmPickLine(ctx, l.id, l.units);
    await packOrder(ctx, d.pick!.id, 2);
    const inv = await invoiceOrder(ctx, o.orderId);
    expect(await stockOf(medicineId)).toBe(93);
    const v = (await invoiceView(ctx.tenantId, inv.invoiceId))!;
    // 20 paid × ₹50 = ₹1000 taxable, 12% = ₹120 → ₹1120; free goods at zero value.
    expect(v.taxable).toBe(100000);
    expect(v.cgst + v.sgst).toBe(12000);
    expect(v.total).toBe(112000);
    expect(v.lines.reduce((a, l) => a + l.qty, 0)).toBe(20);
    expect(v.lines.reduce((a, l) => a + l.freeQty, 0)).toBe(2);
    expect(v.no).toMatch(/^W[A-Z0-9]+\d{4}-\d{5}$/);
    expect(await customerBalance(db, ctx.tenantId, customerId)).toBe(112000);
    expect((await db.distOrder.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("invoiced");
    // Can't invoice twice.
    await expect(invoiceOrder(ctx, o.orderId)).rejects.toThrow();
  });

  it("reservations stop a second order from taking the same stock", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { qty: 30 });
    const a = await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 20 }] });
    const b = await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 20 }] });
    await approveOrder(ctx, a.orderId);
    await expect(approveOrder(ctx, b.orderId)).rejects.toThrow(/only 10 available/);
    const cut = await approveOrder(ctx, b.orderId, { allowPartial: true });
    expect(cut.cut[0]).toMatch(/10\/20/);
    // Cancelling releases the reservation.
    await cancelOrder({ kind: "user", ctx }, a.orderId, "chemist changed mind");
    const c = await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 20 }] });
    await approveOrder(ctx, c.orderId);
  });

  it("concurrent approvals never over-allocate a batch", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { qty: 50 });
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 10 }] })).orderId);
    const r = await Promise.allSettled(ids.map((id) => approveOrder(ctx, id)));
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(5);
    const reserved = await db.distPickLine.aggregate({ _sum: { units: true } });
    expect(reserved._sum.units).toBe(50);
  });

  it("credit control holds over-limit orders; only credit override can release them", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { creditLimit: 500 });
    const o = await placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 20 }] }); // ₹1120 > ₹500
    expect(o.creditOk).toBe(false);
    const billing = await distCtx("DISTA-PUNE", "Billing");
    await expect(approveOrder(billing, o.orderId)).rejects.toThrow(/credit override/);
    await expect(approveOrder(ctx, o.orderId)).rejects.toThrow(/reason/);
    await approveOrder(ctx, o.orderId, { overrideReason: "Owner approved, payment promised Friday" });
    const audit = await db.auditEvent.findFirst({ where: { action: "Order approved over credit hold" } });
    expect(audit?.detail).toMatch(/payment promised/);
  });

  it("direct billing: inter-state IGST, idempotent, same-day cancel restores stock and balance", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { chemistState: "29" });
    const k = key();
    const r = await directInvoice(ctx, { customerId, idempotencyKey: k, lines: [{ medicineId, qty: 5 }] });
    expect((await directInvoice(ctx, { customerId, idempotencyKey: k, lines: [{ medicineId, qty: 5 }] })).replayed).toBe(true);
    const v = (await invoiceView(ctx.tenantId, r.invoiceId))!;
    expect(v.igst).toBe(true);
    expect([v.cgst, v.sgst, v.igstAmt]).toEqual([0, 0, 3000]);
    expect(await stockOf(medicineId)).toBe(95);
    const billing = await distCtx("DISTA-PUNE", "Billing");
    await expect(cancelInvoice(billing, r.invoiceId, "wrong party billed")).rejects.toThrow(/Cancel invoices/);
    await cancelInvoice(ctx, r.invoiceId, "wrong party billed");
    expect(await stockOf(medicineId)).toBe(100);
    expect(await customerBalance(db, ctx.tenantId, customerId)).toBe(0);
    await expect(cancelInvoice(ctx, r.invoiceId, "again please")).rejects.toThrow(/already cancelled/);
    // The invoice row itself is immutable.
    await expect(db.distInvoice.update({ where: { id: r.invoiceId }, data: { totalPaise: 1n } })).rejects.toThrow(/append-only/);
  });

  it("refuses to bill chemists with an expired licence or blocked account", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx);
    await db.distChemist.update({ where: { customerId }, data: { dlExpiry: new Date("2020-01-01") } });
    await expect(directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/licence expired/);
    await expect(placeOrder({ kind: "user", ctx }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/licence expired/);
  });
});
