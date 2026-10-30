import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, searchForSale } from "@/domain/sales/service";
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
    // Counter 1 reconnects and refreshes, giving up its share of D1's last unit.
    await snapshot(ctx, (await db.device.findFirstOrThrow({ where: { name: "Counter 1" } })).id);
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

  it("a conflict older than the offline window can still be posted, dated today with the billed time kept", async () => {
    const ctx = await ctxFor("Cashier"), mgr = await ctxFor("Manager");
    const dev = (await db.device.findFirstOrThrow({ where: { name: "Counter 1" } })).id;
    const old = op([{ medicineId: dolo, batchId: d2, qty: 1 }], { createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString() });
    expect((await syncOps(ctx, dev, [old]))[0].message).toMatch(/last 7 days/);
    expect((await resolveOp(mgr, old.id, "repost")).status).toBe("posted");
    const sale = await db.sale.findFirstOrThrow({ where: { idempotencyKey: old.id } });
    expect(Date.now() - sale.at.getTime()).toBeLessThan(60_000);
    expect((await offlineOverview(mgr)).ops.find((x) => x.id === old.id)?.message).toMatch(/past the 7-day offline window/);
  });

  it("posts offline bills as the cashier who made them, rechecked against the device", async () => {
    const t = await db.tenant.findFirstOrThrow();
    const role = await db.role.findFirstOrThrow({ where: { tenantId: t.id, name: "Cashier" } });
    const sneha = await db.user.create({ data: { tenantId: t.id, name: "Sneha", phone: "9850021877", roleId: role.id, employeeNo: "E-102" } });
    const ravi = await db.user.create({ data: { tenantId: t.id, name: "Ravi", phone: "9850021878", roleId: role.id, employeeNo: "E-103" } });
    const syncer = await ctxFor("Manager");
    const dev = (await db.device.findFirstOrThrow({ where: { name: "Counter 1" } })).id;
    const s = await snapshot({ ...(await ctxFor("Cashier")), userId: sneha.id, userName: sneha.name }, dev);
    expect(s.cashierId).toBe(sneha.id);
    const line = [{ medicineId: dolo, batchId: d2, qty: 1 }];

    const mine = { ...op(line), cashierId: sneha.id };
    expect((await syncOps(syncer, dev, [mine]))[0].status).toBe("posted");
    expect((await db.sale.findFirstOrThrow({ where: { idempotencyKey: mine.id } })).userId).toBe(sneha.id);

    // The cashier's own discount cap applies, not the syncing manager's.
    const disc = { ...op(line), cashierId: sneha.id, sale: { ...op(line).sale, discountPct: 8 } };
    expect((await syncOps(syncer, dev, [disc]))[0].message).toMatch(/above 5%/);

    const stranger = { ...op(line), cashierId: ravi.id };
    expect((await syncOps(syncer, dev, [stranger]))[0].message).toMatch(/can’t bill on this device/);

    // A cashier can't borrow a manager's discount cap by putting the manager's id on the bill.
    const mgrRole = await db.role.findFirstOrThrow({ where: { tenantId: t.id, name: "Manager" } });
    const meera = await db.user.create({ data: { tenantId: t.id, name: "Meera", phone: "9850021879", roleId: mgrRole.id, employeeNo: "E-104" } });
    await snapshot({ ...(await ctxFor("Manager")), userId: meera.id, userName: meera.name }, dev);
    const asSneha = { ...(await ctxFor("Cashier")), userId: sneha.id, userName: sneha.name };
    const forged = { ...op(line), cashierId: meera.id, sale: { ...op(line).sale, discountPct: 15 } };
    expect((await syncOps(asSneha, dev, [forged]))[0]).toMatchObject({ status: "conflict", message: expect.stringMatching(/above 5%/) });
    expect(await db.sale.count({ where: { idempotencyKey: forged.id } })).toBe(0);
    expect((await resolveOp(syncer, forged.id, "repost")).status).toBe("posted");
    expect((await db.sale.findFirstOrThrow({ where: { idempotencyKey: forged.id } })).userId).toBe(meera.id);
    expect((await syncOps(syncer, dev, [{ ...op(line), cashierId: meera.id, sale: { ...op(line).sale, discountPct: 15 } }]))[0].status).toBe("posted");

    await db.user.update({ where: { id: sneha.id }, data: { active: false } });
    expect((await syncOps(syncer, dev, [{ ...op(line), cashierId: sneha.id }]))[0].status).toBe("conflict");

    const legacy = op(line);
    expect((await syncOps(syncer, dev, [legacy]))[0].status).toBe("posted");
    expect((await db.sale.findFirstOrThrow({ where: { idempotencyKey: legacy.id } })).userId).toBe(syncer.userId);
  });

  it("online sales leave offline counters' reserved stock alone; each device's own bills use its share", async () => {
    const ctx = await ctxFor("Cashier");
    const crocin = await createMedicine(await ctxFor(), { ...base, name: "Crocin Advance", generic: "Paracetamol", strength: "500 mg", mrp: "20" });
    const c1 = (await receiveBatch(await ctxFor(), { medicineId: crocin, batchNo: "C1", expiry: addDays(todayISO(), 200), qty: 9, cost: "10", mrp: "20", supplierId: null, invoiceNo: "" })).batchId;
    const [one, two] = await Promise.all(["Counter 1", "Counter 2"].map(async (n) => (await db.device.findFirstOrThrow({ where: { name: n } })).id));
    expect((await snapshot(ctx, one)).batches.find((b) => b.id === c1)?.allowance).toBe(3);
    await snapshot(ctx, two);
    const online = (qty: number) => commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: crocin, batchId: c1, qty }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    await expect(online(4)).rejects.toThrow(/only 3 of Crocin Advance \(C1\) left \(6 more kept for offline counters\)/);
    await online(3);
    expect((await syncOps(ctx, one, [op([{ medicineId: crocin, batchId: c1, qty: 3 }])]))[0].status).toBe("posted");
    const q = (await db.device.findUniqueOrThrow({ where: { id: one } })).quota as { batches: Record<string, number> };
    expect(q.batches[c1]).toBe(0);
    await expect(online(1)).rejects.toThrow(/only 0 of Crocin/);
    expect((await searchForSale(ctx, "Crocin"))[0].batches[0].qtyAvailable).toBe(0);
    expect((await syncOps(ctx, two, [op([{ medicineId: crocin, batchId: c1, qty: 3 }])]))[0].status).toBe("posted");
    expect((await db.batch.findUniqueOrThrow({ where: { id: c1 } })).qtyAvailable).toBe(0);

    // C1 is sold out: a manager posts the Dolo on this bill and refunds the customer for the Crocin.
    const mixed = op([{ medicineId: crocin, batchId: c1, qty: 2 }, { medicineId: dolo, batchId: d2, qty: 1 }], { totalPaise: 7400 });
    expect((await syncOps(ctx, one, [mixed]))[0].message).toMatch(/only 0 of Crocin/);
    const mgr = await ctxFor("Manager");
    await expect(resolveOp(mgr, mixed.id, "repost")).rejects.toThrow(/Not enough sellable stock/);
    const r = await resolveOp(mgr, mixed.id, "partial");
    expect(r).toMatchObject({ status: "posted", refund: 4000 });
    const items = await db.saleItem.findMany({ where: { sale: { idempotencyKey: mixed.id } } });
    expect(items.map((i) => [i.medicineId, i.qty])).toEqual([[dolo, 1]]);
    expect((await offlineOverview(mgr)).ops.find((x) => x.id === mixed.id)).toMatchObject({ status: "posted", resolution: expect.stringMatching(/Posted 1 of 3 units .* refund ₹40/) });
    expect((await syncOps(ctx, one, [mixed]))[0].status).toBe("posted");
  });

  it("refuses a device that was turned off or belongs to another pharmacy", async () => {
    const mgr = await ctxFor("Manager");
    const dev = (await db.device.findFirstOrThrow({ where: { name: "Counter 2" } })).id;
    await disableDevice(mgr, dev);
    await expect(snapshot(mgr, dev)).rejects.toThrow(/turned off/);
    await expect(syncOps(mgr, randomUUID(), [])).rejects.toThrow(/turned off/);
  });

  it("only shows and settles devices and bills in the user's branches", async () => {
    const main = await ctxFor("Manager");
    const second = await ctxFor("Manager", "Second");
    const onlySecond = { ...second, branches: second.branches.filter((b) => b.id === second.branchId) };
    const own = await enableDevice(second, "Second counter");
    expect((await offlineOverview(main)).devices.map((d) => d.name)).toContain("Second counter");
    const scoped = await offlineOverview(onlySecond);
    expect(scoped.devices.map((d) => d.name)).toEqual(["Second counter"]);
    expect(scoped.ops).toEqual([]);
    const cashier = await offlineOverview(await ctxFor("Cashier", "Second"));
    expect(cashier.devices.map((d) => d.id)).toEqual([own.deviceId]);
    const mainDev = (await db.device.findFirstOrThrow({ where: { name: "Counter 1" } })).id;
    await expect(disableDevice(onlySecond, mainDev)).rejects.toThrow(/not found/);
    const o = await db.offlineOp.findFirstOrThrow({ where: { deviceId: mainDev } });
    await expect(resolveOp(onlySecond, o.id, "close", "Customer refunded")).rejects.toThrow(/not found/);
  });
});
