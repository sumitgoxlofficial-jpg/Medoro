import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { listCustomers, listSuppliers, paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("parties", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("supplier opening balance, payment limits and bill allocation", async () => {
    const ctx = await ctxFor();
    const id = await saveSupplier(ctx, null, { name: "Pune Pharma", gstin: "27AAECP2210L1ZQ", creditDays: "21", leadDays: "2", opening: "5000" });
    await expect(saveSupplier(ctx, null, { name: "pune pharma" })).rejects.toThrow(/already exists/);
    await expect(saveSupplier(ctx, null, { name: "Bad GST", gstin: "27ABC" })).rejects.toThrow(/GSTIN/);
    let s = (await listSuppliers(ctx)).find((x) => x.id === id)!;
    expect(s.balance).toBe(500000);
    expect(s.nextDue?.days).toBe(21);
    await expect(paySupplier(ctx, { partyId: id, amount: "6000", method: "Cash" })).rejects.toThrow(/exceeds/);
    await expect(paySupplier(await ctxFor("Cashier"), { partyId: id, amount: "1", method: "Cash" })).rejects.toThrow(/role/);
    const no = await paySupplier(ctx, { partyId: id, amount: "2000", method: "Bank transfer (NEFT)", ref: "UTR1" });
    expect(no).toMatch(/^PV-\d{4}-0001$/);
    s = (await listSuppliers(ctx)).find((x) => x.id === id)!;
    expect(s.balance).toBe(300000);
    expect(s.nextDue?.amount).toBe(300000);
    await paySupplier(ctx, { partyId: id, amount: "3000", method: "Cash" });
    expect((await listSuppliers(ctx)).find((x) => x.id === id)!.nextDue).toBeNull();
  });

  it("customer receipts and credit-limit permissions", async () => {
    const ctx = await ctxFor();
    const id = await saveCustomer(ctx, null, { name: "Pawar Clinic", phone: "98230 77015", waOptIn: true, creditLimit: "20000", opening: "1500" });
    expect((await listCustomers(ctx)).find((c) => c.id === id)).toMatchObject({ due: 150000, limit: 2000000, optIn: true });
    await expect(saveCustomer(await ctxFor("Cashier"), id, { name: "Pawar Clinic", phone: "9823077015", waOptIn: true, creditLimit: "50000" })).rejects.toThrow(/credit limits/);
    await saveCustomer(await ctxFor("Cashier"), id, { name: "Pawar Clinic", phone: "9823077015", waOptIn: false, creditLimit: "20000" });
    const c = await db.customer.findUniqueOrThrow({ where: { id } });
    expect(c.waOptIn).toBe(false);
    expect(c.optInMethod).toMatch(/Opted out/);
    await expect(receiveFromCustomer(ctx, { partyId: id, amount: "2000", method: "UPI" })).rejects.toThrow(/exceeds/);
    await receiveFromCustomer(ctx, { partyId: id, amount: "1500", method: "UPI" });
    expect((await listCustomers(ctx)).find((x) => x.id === id)!.due).toBe(0);
  });

  it("rejects stale supplier and customer edits (optimistic concurrency)", async () => {
    const ctx = await ctxFor();
    const sid = await saveSupplier(ctx, null, { name: "Stale Distributors", creditDays: "15" });
    const seen = (await listSuppliers(ctx)).find((s) => s.id === sid)!.version;
    await saveSupplier(ctx, sid, { name: "Stale Distributors", creditDays: "20" }, seen);
    await expect(saveSupplier(ctx, sid, { name: "Stale Distributors", creditDays: "30" }, seen)).rejects.toThrow(/Someone else changed this supplier/);
    expect((await db.supplier.findUniqueOrThrow({ where: { id: sid } })).creditDays).toBe(20);

    const cid = await saveCustomer(ctx, null, { name: "Stale Customer", phone: "9822099999", waOptIn: false, creditLimit: "0" });
    const cv = (await listCustomers(ctx)).find((c) => c.id === cid)!.version;
    await saveCustomer(ctx, cid, { name: "Stale Customer A", phone: "9822099999", waOptIn: false, creditLimit: "0" }, cv);
    await expect(saveCustomer(ctx, cid, { name: "Stale Customer B", phone: "9822099999", waOptIn: false, creditLimit: "0" }, cv)).rejects.toThrow(/Someone else changed this customer/);
    expect((await db.customer.findUniqueOrThrow({ where: { id: cid } })).name).toBe("Stale Customer A");
  });
});
