import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";
import { distCtx, makeDistributor, seedBasics } from "./dist-helpers";
import { payables, supplierStatement } from "@/domain/distribution/payables";
import { paySupplier } from "@/domain/parties/service";

beforeEach(async () => { await resetDb(); await makeDistributor(); });

describe("supplier ledger and payments (distribution)", () => {
  it("shows what we owe from the GRN, pays it oldest-first and keeps the statement in step", async () => {
    const ctx = await distCtx();
    const { supplierId } = await seedBasics(ctx); // GRN: 100 packs × ₹40 + 12% GST = ₹4,480
    const before = (await payables(ctx)).find((s) => s.id === supplierId)!;
    expect(before.balance).toBe(448000);
    expect(before.lastPurchase).not.toBeNull();
    expect(before.lastPayment).toBeNull();

    await paySupplier(ctx, { partyId: supplierId, amount: "1000", method: "Bank transfer (NEFT)", ref: "UTR1" } as never);
    await expect(paySupplier(ctx, { partyId: supplierId, amount: "99999", method: "Cash" } as never)).rejects.toThrow(/exceeds the outstanding balance/);

    const after = (await payables(ctx)).find((s) => s.id === supplierId)!;
    expect(after.balance).toBe(348000);
    expect(after.lastPayment).not.toBeNull();
    const st = await supplierStatement(ctx, supplierId);
    expect(st.rows.map((r) => [r.cr, r.dr])).toEqual([[448000, 0], [0, 100000]]);
    expect(st.closing).toBe(348000);
  });

  it("is limited to the distributor's own suppliers and to people who may see purchases", async () => {
    const ctx = await distCtx();
    const { supplierId } = await seedBasics(ctx);
    await makeDistributor("DISTB-PUNE", "owner@dist-b.in", "9822000102");
    const other = await distCtx("DISTB-PUNE");
    expect((await payables(other)).some((s) => s.id === supplierId)).toBe(false);
    expect((await supplierStatement(other, supplierId)).rows).toHaveLength(0);
    await expect(payables(await distCtx("DISTA-PUNE", "Delivery"))).rejects.toThrow();
  });
});
