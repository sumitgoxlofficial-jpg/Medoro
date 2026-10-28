import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { enableDevice, disableDevice, resolveOp, snapshot, syncOps, offlineOverview } from "@/domain/sales/offline";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", schedule: "" as const };
const opId = () => "off_" + randomUUID().replace(/-/g, "");
let dolo = "", d1 = "", d2 = "";

const op = (lines: { medicineId: string; batchId: string; qty: number }[], over: { createdAt?: string; totalPaise?: number; mode?: "cash" | "upi" | "card" } = {}) => ({
  id: opId(), createdAt: over.createdAt ?? new Date(Date.now() - 3600_000).toISOString(), baseVersion: 1, receipt: "OFF-TEST-0001",
  sale: { lines, discountPct: 0, pay: { mode: over.mode ?? "cash" }, totalPaise: over.totalPaise ?? 0 },
});

describe("offline billing", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60" });
    d1 = (await receiveBatch(ctx, { medicineId: dolo, batchNo: "D1", expiry: addDays(todayISO(), 60), qty: 9, cost: "20", mrp: "33.60", supplierId: null, invoiceNo: "" })).batchId;
    d2 = (await receiveBatch(ctx, { medicineId: dolo, batchNo: "D2", expiry: addDays(todayISO(), 300), qty: 20, cost: "20", mrp: "33.60", supplierId: null, invoiceNo: "" })).batchId;
  });

  it("only managers turn it on; each offline device gets an equal share of stock", async () => {
    await expect(enableDevice(await ctxFor("Cashier"), "Counter 1")).rejects.toThrow();
    const mgr = await ctxFor("Manager");
    const a = await enableDevice(mgr, "Counter 1");
    let s = await snapshot(await ctxFor("Cashier"), a.deviceId);
    expect(s.batches.find((b) => b.id === d1)?.allowance).toBe(4); // 9 split between this device and the online counters
    await enableDevice(mgr, "Counter 2");
    s = await snapshot(await ctxFor("Cashier"), a.deviceId);
    expect(s.batches.find((b) => b.id === d1)?.allowance).toBe(3);
    expect(s.medicines.map((m) => m.name)).toEqual(["Dolo 650"]);
    expect(s.batches[0].mrpPaise).toBe(3360);
  });

  it("posts queued bills with their original time, once, however often they're resent", async () => {
    const ctx = await ctxFor("Cashier");
    const dev = (await db.device.findFirstOrThrow({ where: { name: "Counter 1" } })).id;
    const billedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const o = op([{ medicineId: dolo, batchId: d1, qty: 2 }], { createdAt: billedAt, totalPaise: 6700 });
    const [r] = await syncOps(ctx, dev, [o]);
    expect(r.status).toBe("posted");
    expect(r.invoiceNo).toMatch(/\/000001$/);
    const sale = await db.sale.findFirstOrThrow({ where: { invoiceNo: r.invoiceNo } });
    expect(sale.at.toISOString()).toBe(billedAt);
    expect(sale.idempotencyKey).toBe(o.id);
    const again = await syncOps(ctx, dev, [o, o]);
    expect(again.map((x) => x.invoiceNo)).toEqual([r.invoiceNo, r.invoiceNo]);
    expect(await db.sale.count()).toBe(1);
    expect((await db.batch.findUniqueOrThrow({ where: { id: d1 } })).qtyAvailable).toBe(7);
  });

  it("turns bills that no longer fit into conflicts, which a manager settles", async () => {
    const ctx = await ctxFor("Cashier");
    const dev = (await db.device.findFirstOrThrow({ where: { name: "Counter 2" } })).id;
    // An online counter sells D1 down to 1 while Counter 2 is offline.
    await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: dolo, batchId: d1, qty: 6 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const short = op([{ medicineId: dolo, batchId: d1, qty: 3 }]);
    const tooOld = op([{ medicineId: dolo, batchId: d2, qty: 1 }], { createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString() });
    const junk = { id: "nope" };
    const res = await syncOps(ctx, dev, [short, tooOld, junk]);
    expect(res.map((r) => r.status)).toEqual(["conflict", "conflict", "conflict"]);
    expect(res[0].message).toMatch(/only 1 of Dolo 650/);
    expect(res[1].message).toMatch(/last 7 days/);

    await expect(resolveOp(ctx, short.id, "repost")).rejects.toThrow(); // cashiers can't settle
    const mgr = await ctxFor("Manager");
    const r = await resolveOp(mgr, short.id, "repost"); // D1 has 1 left, D2 covers the rest (FEFO)
    expect(r.status).toBe("posted");
    const items = await db.saleItem.findMany({ where: { sale: { idempotencyKey: short.id } } });
    expect(items.map((i) => [i.batchId, i.qty]).sort()).toEqual([[d1, 1], [d2, 2]].sort());
    await expect(resolveOp(mgr, tooOld.id, "close", "")).rejects.toThrow(/how it was settled/);
    await resolveOp(mgr, tooOld.id, "close", "Customer refunded");
    const ov = await offlineOverview(mgr);
    expect(ov.ops.find((x) => x.id === tooOld.id)?.status).toBe("resolved");
    expect(ov.ops.find((x) => x.id === short.id)?.invoiceNo).toMatch(/INV|TMS/);
    // Resending a settled bill reports its outcome and doesn't post twice.
    expect((await syncOps(ctx, dev, [short]))[0].status).toBe("posted");
    expect(await db.sale.count({ where: { idempotencyKey: short.id } })).toBe(1);
  });

  it("refuses a device that was turned off or belongs to another pharmacy", async () => {
    const mgr = await ctxFor("Manager");
    const dev = (await db.device.findFirstOrThrow({ where: { name: "Counter 2" } })).id;
    await disableDevice(mgr, dev);
    await expect(snapshot(mgr, dev)).rejects.toThrow(/turned off/);
    await expect(syncOps(mgr, randomUUID(), [])).rejects.toThrow(/turned off/);
  });
});
