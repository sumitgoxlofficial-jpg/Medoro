import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetDb } from "./helpers";
import { distCtx, key, makeDistributor, seedBasics } from "./dist-helpers";
import { approveOrder, placeOrder } from "@/domain/distribution/orders";
import { directInvoice } from "@/domain/distribution/billing";
import { createReturn } from "@/domain/distribution/returns";
import { collectPayment } from "@/domain/distribution/dispatch";
import { receivables } from "@/domain/distribution/receivables";
import { trialBalance } from "@/domain/accounting/service";
import { approveTransfer, receiveTransfer, requestTransfer } from "@/domain/inventory/adjust";
import { purgeTenant } from "@/domain/system/deletion";
import { dumpForBackup } from "@/domain/system/restore";
import { customerBalances } from "@/domain/parties/balances";

beforeEach(async () => { await resetDb(); await makeDistributor(); });

describe("multiple godowns", () => {
  it("allocates only from the order's godown and moves stock between godowns by transfer", async () => {
    const main = await distCtx("DISTA-PUNE", "Owner", "Main"), second = await distCtx("DISTA-PUNE", "Owner", "Second");
    const { medicineId, customerId } = await seedBasics(main, { qty: 10 });
    // Second godown has no stock: an order booked there can't be approved, even though Main has 10.
    const o = await placeOrder({ kind: "user", ctx: second }, { customerId, branchId: second.branchId, idempotencyKey: key(), lines: [{ medicineId, qty: 5 }] });
    await expect(approveOrder(second, o.orderId)).rejects.toThrow(/only 0 available/);
    // Transfer 6 from Main to Second (request → approve/send → receive), then it can be approved there.
    const b = await db.batch.findFirstOrThrow({ where: { medicineId, branchId: main.branchId } });
    await requestTransfer(main, b.id, second.branchId, 6, "rebalance");
    const t = await db.transfer.findFirstOrThrow();
    await approveTransfer({ ...main, userId: (await db.user.findFirstOrThrow()).id, perms: [...main.perms, "users"] }, t.id);
    await receiveTransfer(second, t.id);
    expect((await db.batch.findFirstOrThrow({ where: { medicineId, branchId: second.branchId } })).qtyAvailable).toBe(6);
    expect((await db.batch.findFirstOrThrow({ where: { id: b.id } })).qtyAvailable).toBe(4);
    await approveOrder(second, o.orderId);
    const pick = await db.distPickLine.findFirstOrThrow();
    expect((await db.batch.findUniqueOrThrow({ where: { id: pick.batchId } })).branchId).toBe(second.branchId);
  });
});

describe("financial reconciliation", () => {
  it("books always balance, the debtors control equals the sum of chemist balances, and stock movements explain every batch", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { chemistState: "29" });
    const inv = await directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 7 }] });
    const line = await db.distInvoiceLine.findFirstOrThrow({ where: { invoiceId: inv.invoiceId } });
    await createReturn(ctx, { invoiceId: inv.invoiceId, reason: "Short expiry", lines: [{ invoiceLineId: line.id, qty: 2, condition: "expired", creditPct: 80 }] });
    await collectPayment(ctx, { customerId, amount: "100", method: "Cash" });
    const tb = await trialBalance(ctx);
    expect(tb.dr).toBe(tb.cr);
    const debtors = tb.rows.find((r) => r.account === "Sundry debtors")!;
    const parties = [...(await customerBalances(db, ctx.tenantId)).values()].reduce((a, b) => a + b, 0);
    expect(debtors.dr - debtors.cr).toBe(parties);
    expect((await receivables(ctx)).reduce((a, r) => a + r.balance, 0)).toBe(parties);
    // IGST invoice, IGST credit note: Output IGST equals invoice IGST minus the credit note's.
    const ret = await db.distReturn.findFirstOrThrow();
    const igst = tb.rows.find((r) => r.account === "Output IGST")!;
    expect(igst.cr - igst.dr).toBe(Number((await db.distInvoice.findUniqueOrThrow({ where: { id: inv.invoiceId } })).igstPaise) - Number(ret.taxPaise));
    for (const b of await db.batch.findMany()) {
      const mv = await db.stockMovement.aggregate({ where: { batchId: b.id }, _sum: { qty: true } });
      expect(mv._sum.qty).toBe(b.qtyAvailable + b.qtyQuarantined);
    }
  });
});

describe("backup, restore and account deletion cover distribution data", () => {
  it("backs up a distributor's rows and deletes only that distributor's rows", async () => {
    await makeDistributor("DISTB-PUNE", "owner@dist-b.in", "9822000202");
    const a = await distCtx("DISTA-PUNE"), b = await distCtx("DISTB-PUNE");
    const sa = await seedBasics(a), sb = await seedBasics(b);
    await directInvoice(a, { customerId: sa.customerId, idempotencyKey: key(), lines: [{ medicineId: sa.medicineId, qty: 1 }] });
    await directInvoice(b, { customerId: sb.customerId, idempotencyKey: key(), lines: [{ medicineId: sb.medicineId, qty: 1 }] });
    const { data } = await dumpForBackup(a.tenantId);
    expect((data.tables.DistInvoice as unknown[]).length).toBe(1);
    expect((data.tables.DistInvoiceLine as unknown[]).length).toBe(1);
    expect((data.tables.DistChemist as unknown[]).length).toBe(1);
    expect(data.tables.DistChemistAccount).toBeUndefined(); // platform data, never in one distributor's backup
    await purgeTenant(a.tenantId);
    expect(await db.distInvoice.count({ where: { tenantId: a.tenantId } })).toBe(0);
    expect(await db.distInvoiceLine.count({ where: { invoice: { tenantId: a.tenantId } } })).toBe(0);
    expect(await db.distInvoice.count({ where: { tenantId: b.tenantId } })).toBe(1);
  });
});
