import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { writeOff } from "@/domain/inventory/adjust";
import { benchmark } from "@/domain/reports/benchmark";
import { profitPeriod } from "@/domain/reports/profit";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const exp = addDays(todayISO(), 400).slice(0, 7);
let med = "", med2 = "";
const P = () => profitPeriod(undefined, undefined);
async function sell(branch: string, qty: number, discountPct = 0) {
  const ctx = await ctxFor("Manager", branch);
  const batch = await db.batch.findFirstOrThrow({ where: { medicineId: med, branchId: ctx.branchId } });
  return commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch.id, qty }], customerId: null, discountPct, pay: { mode: "cash" } });
}

describe("chain benchmarking", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const owner = await ctxFor();
    const base = { form: "Tablet" as const, manufacturer: "Alkem", pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", gstRate: 12 };
    med = await createMedicine(owner, { ...base, name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", mrp: "155" });
    med2 = await createMedicine(owner, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33" });
    for (const br of ["Main", "Second"]) {
      const c = await ctxFor("Manager", br);
      await receiveBatch(c, { medicineId: med, batchNo: "B" + br, expiry: exp, qty: 100, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    }
    await receiveBatch(await ctxFor("Manager", "Main"), { medicineId: med2, batchNo: "D1", expiry: exp, qty: 50, cost: "20", mrp: "33", supplierId: null, invoiceNo: "" });
    await sell("Main", 4); await sell("Main", 2);
    await sell("Second", 1, 10);
    const sec = await ctxFor("Manager", "Second");
    await writeOff(sec, (await db.batch.findFirstOrThrow({ where: { branchId: sec.branchId, medicineId: med } })).id, 3, "Expired");
  });

  it("compares branches on real figures and ranks them", async () => {
    const r = await benchmark(await ctxFor(), P());
    expect(r.ranked).toBe(true);
    const main = r.branches.find((b) => b.branch === "Main")!, second = r.branches.find((b) => b.branch === "Second")!;
    expect(main.salesPaise).toBeGreaterThan(second.salesPaise);
    expect(main.growthPct).toBeNull();                      // nothing in the previous period: no invented growth
    expect(main.grossMarginPct).toBeGreaterThan(0);
    expect(main.stockTurnover).toBeGreaterThan(0);
    expect(second.writeOffPaise).toBe(3 * 10000);
    expect(second.expiryLossPct).toBeGreaterThan(0);
    expect(main.expiryLossPct).toBe(0);
    expect(main.ranks.expiryLoss).toBe(1);                  // lower loss is better
    expect(second.ranks.expiryLoss).toBe(2);
  });

  it("measures stockouts against items that have a reorder level", async () => {
    const r = await benchmark(await ctxFor(), P());
    const main = r.branches.find((b) => b.branch === "Main")!, second = r.branches.find((b) => b.branch === "Second")!;
    expect(main.tracked).toBe(2);
    expect(main.stockouts).toBe(0);
    expect(second.stockouts).toBe(1);                       // Dolo 650 was never stocked at Second
    expect(second.stockoutPct).toBe(50);
    expect(second.ranks.stockout).toBe(2);
  });

  it("lists employee activity per branch, with voids and returns counted", async () => {
    const r = await benchmark(await ctxFor(), P());
    const main = r.branches.find((b) => b.branch === "Main")!;
    expect(main.employees).toHaveLength(1);
    expect(main.employees[0]).toMatchObject({ bills: 2, voids: 0, returns: 0 });
    expect(main.employees[0].avgBasketPaise).toBeGreaterThan(0);
    const second = r.branches.find((b) => b.branch === "Second")!;
    expect(second.employees[0].discountPct).toBe(10);
  });

  it("shows only the branches the user is authorised for, with no ranking for one", async () => {
    const owner = await ctxFor();
    const main = owner.branches.find((b) => b.name === "Main")!;
    const r = await benchmark({ ...owner, branches: [main] }, P());
    expect(r.branches.map((b) => b.branch)).toEqual(["Main"]);
    expect(r.ranked).toBe(false);
    expect(Object.values(r.branches[0].ranks).every((x) => x === null)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Second");
  });

  it("requires the reports permission", async () => {
    await expect(benchmark(await ctxFor("Cashier"), P())).rejects.toThrow();
  });
});
