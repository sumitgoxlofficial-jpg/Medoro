import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { subscribe, type Change } from "@/server/live";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", schedule: "" as const };

describe("live change feed", () => {
  const unsubs: (() => void)[] = [];
  beforeAll(async () => { await resetDb(); await makePharmacy(); });
  afterAll(() => unsubs.forEach((u) => u()));

  it("delivers committed changes to the right pharmacy only, once per table per transaction", async () => {
    const ctx = await ctxFor();
    const mine: Change[] = [], other: Change[] = [];
    unsubs.push(await subscribe(ctx.tenantId, (c) => mine.push(c)));
    unsubs.push(await subscribe(randomUUID(), (c) => other.push(c)));

    const med = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60" });
    const { batchId } = await receiveBatch(ctx, { medicineId: med, batchNo: "DL1", expiry: addDays(todayISO(), 300), qty: 10, cost: "20", mrp: "33.60", supplierId: null, invoiceNo: "" });
    await wait(300);
    expect(mine.map((c) => c.t)).toEqual(expect.arrayContaining(["Medicine", "Batch"]));
    mine.length = 0;

    await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    await wait(300);
    const tables = mine.map((c) => c.t);
    expect(tables).toEqual(expect.arrayContaining(["Sale", "Batch", "Voucher"]));
    expect(tables.filter((t) => t === "Sale")).toHaveLength(1); // deduplicated within the transaction
    expect(mine.find((c) => c.t === "Sale")?.branch).toBe(ctx.branchId);
    expect(other).toEqual([]);

    // Rolled-back work is never announced.
    mine.length = 0;
    await db.$transaction(async (tx) => { await tx.medicine.update({ where: { id: med }, data: { rack: "A1" } }); throw new Error("rollback"); }).catch(() => {});
    await wait(300);
    expect(mine).toEqual([]);
  });
});
