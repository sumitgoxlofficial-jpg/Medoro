import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer } from "@/domain/sales/service";
import { openShift, processReturn } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { customerIntel, campaignPerformance } from "@/domain/sales/customer-intel";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let med = "", batch = "";
const key = () => "k_" + randomUUID().replace(/-/g, "");

/** A real bill through the sales service, then moved back in time (sales are append-only, so the trigger is bypassed for the date only). */
async function sell(customerId: string, daysAgo: number, qty = 1, branch = "Main") {
  const ctx = await ctxFor("Manager", branch);
  const s = await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty }], customerId, discountPct: 0, pay: { mode: "cash" } });
  if (daysAgo) await db.$transaction([db.$executeRaw`SET LOCAL session_replication_role = replica`, db.$executeRaw`UPDATE "Sale" SET at = ${new Date(Date.now() - daysAgo * 86400_000)} WHERE id = ${s.saleId}`]);
  return s;
}

describe("customer intelligence", () => {
  let loyal = "", lapsed = "", fresh = "", opted = "", voidOnly = "", erased = "";
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300).slice(0, 7), qty: 500, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow()).id;
    const mk = (name: string, phone: string, extra = {}) => createCustomer(ctx, { name, phone, creditLimit: "0", ...extra });
    loyal = await mk("Loyal Lata", "9822000401"); lapsed = await mk("Lapsed Lalit", "9822000402"); fresh = await mk("Fresh Farid", "9822000403");
    opted = await mk("Opted Om", "9822000404", { waOptIn: true }); voidOnly = await mk("Void Vimal", "9822000405"); erased = await mk("Erased Esha", "9822000406");
    for (const d of [210, 180, 150, 120, 90, 60, 30]) await sell(loyal, d);
    for (const d of [300, 270, 240]) await sell(lapsed, d);
    await sell(fresh, 3);
    for (const d of [20, 10]) await sell(opted, d);
    const v = await sell(voidOnly, 0); await voidSale(await ctxFor(), v.saleId, "Wrong customer billed"); // voids are same-day only
    await db.$transaction([db.$executeRaw`SET LOCAL session_replication_role = replica`, db.$executeRaw`UPDATE "Sale" SET at = ${new Date(Date.now() - 5 * 86400_000)} WHERE id = ${v.saleId}`]);
    await sell(erased, 4); await db.customer.update({ where: { id: erased }, data: { erasedAt: new Date() } });
  });

  it("segments real customers from their bills and leaves out voided bills and erased customers", async () => {
    const r = await customerIntel(await ctxFor());
    const seg = (id: string) => [...r.lapsed, ...r.top].find((x) => x.id === id)?.segment;
    expect(seg(loyal)).toBe("loyal");
    expect(seg(lapsed)).toBe("lapsed");
    expect(r.lapsed.map((x) => x.name)).toEqual(["Lapsed Lalit"]);
    const names = r.top.map((x) => x.name);
    expect(names).not.toContain("Void Vimal");   // her only bill was voided
    expect(names).not.toContain("Erased Esha");  // erased: not analysed
    expect(r.totals.customers).toBe(4);
    expect(r.segments.find((s) => s.segment === "new")!.count).toBe(2); // Farid (3 days) and Om (first bill 20 days ago)
    expect(r.segments.reduce((a, s) => a + s.count, 0)).toBe(4);
  });

  it("computes average basket, repeat rate and an honest 12-month value", async () => {
    const r = await customerIntel(await ctxFor());
    const lata = r.top.find((x) => x.id === loyal)!;
    expect(lata.avgBasketPaise).toBe(15500);
    expect(lata.usualGapDays).toBe(30);
    expect(lata.value12mPaise).not.toBeNull();
    expect(r.top.find((x) => x.id === fresh)!.value12mPaise).toBeNull(); // one bill: no projection
    expect(r.totals.repeatPct).toBe(75);                                  // Lata, Lalit, Om bought again; Farid once
    expect(r.monthly).toHaveLength(12);
    expect(r.monthly.reduce((a, m) => a + m.spendPaise, 0)).toBeGreaterThan(0);
  });

  it("nets sales returns off the bill", async () => {
    const mgr = await ctxFor("Manager");
    await openShift(mgr, "500");
    const s = await sell(fresh, 2, 2);
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    const before = (await customerIntel(await ctxFor())).top.find((x) => x.id === fresh)!.netPaise;
    await processReturn(mgr, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Wrong item" });
    const after = (await customerIntel(await ctxFor())).top.find((x) => x.id === fresh)!.netPaise;
    expect(before - after).toBe(15500);
  });

  it("suggests refills for the owner's follow-up but allows messaging only with consent", async () => {
    const r = await customerIntel(await ctxFor());
    const byName = Object.fromEntries(r.refills.map((x) => [x.customer, x]));
    expect(byName["Loyal Lata"]).toBeDefined();
    expect(byName["Loyal Lata"].canMessage).toBe(false); // no consent on file
    expect(byName["Opted Om"].canMessage).toBe(true);
    expect(byName["Opted Om"].medicine).toBe("Pan 40");
  });

  it("keeps the existing opted-in-only behaviour of refill reminders", async () => {
    const { refillReminders } = await import("@/domain/comms/crm");
    const names = (await refillReminders(await ctxFor())).map((x) => x.customer);
    expect(names).toContain("Opted Om");
    expect(names).not.toContain("Loyal Lata");
  });

  it("limits the bills that count to the chosen branch, and refuses a branch the user cannot access", async () => {
    const owner = await ctxFor();
    const second = owner.branches.find((b) => b.name === "Second")!, main = owner.branches.find((b) => b.name === "Main")!;
    expect((await customerIntel(owner, second.id)).totals.customers).toBe(0);
    expect((await customerIntel(owner, main.id)).totals.customers).toBe(4);
    await expect(customerIntel({ ...owner, branches: [main] }, second.id)).rejects.toThrow(/access/);
  });

  it("reports campaign performance from the delivery log, with purchases only after the message", async () => {
    const owner = await ctxFor();
    const camp = await db.campaign.create({ data: { tenantId: owner.tenantId, name: "Diwali", template: "store_update", audience: 2, status: "sent" } });
    const sent = new Date(Date.now() - 6 * 86400_000);
    const row = (phone: string, status: "delivered" | "read" | "failed", k: string) => db.waMessage.create({ data: { tenantId: owner.tenantId, invoiceId: "campaign:" + camp.id, invoiceNo: "Diwali", recipient: phone, idempotencyKey: `camp:${camp.id}:${k}`, status, attempts: 1, createdAt: sent } });
    await row("9822000403", "read", "a");       // Fresh Farid: bought 3 and 2 days ago, i.e. after the message
    await row("9822000401", "delivered", "b");  // Loyal Lata: last bought 30 days ago, before the message
    await row("9822000402", "failed", "c");
    const [p] = await campaignPerformance(owner);
    expect(p).toMatchObject({ name: "Diwali", sent: 3, delivered: 2, read: 1, failed: 1, buyers: 1 });
    expect(p.revenuePaise).toBeGreaterThan(0);
  });

  it("requires the reports permission", async () => {
    await expect(customerIntel(await ctxFor("Cashier"))).rejects.toThrow();
    await expect(campaignPerformance(await ctxFor("Cashier"))).rejects.toThrow();
  });

  it("masks phone numbers in strict mode for roles other than owner and manager", async () => {
    const r = await customerIntel(await ctxFor("Owner"));
    expect(r.top.every((x) => x.phone === null || /\d/.test(x.phone))).toBe(true);
  });
});
