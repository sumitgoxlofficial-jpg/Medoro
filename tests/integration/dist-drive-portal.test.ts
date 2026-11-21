import { beforeAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { portalAccountSummary, portalCancelOrder, portalCatalogue, portalInvoice, portalOrders, portalPlaceOrder, requestConnection, type PortalAccount } from "@/domain/distribution/portal";
import { ackDistInbox, distInboxFor, linkConnection, publishPortal } from "@/domain/distribution/drive-portal";
import { memoryDb } from "@/drivedb/node";
import type { DriveDB } from "@/drivedb/client";
import { DIST_ORDER_AAD, openJson } from "@/drivedb/inbox";
import { addMedicine, receiveStock } from "@/drivedb/pharmacy";
import { saveCompany, saveProduct } from "@/drivedb/dist";
import { approveOrder, confirmPickLine, invoiceOrder, listOrders, packOrder, pickList } from "@/drivedb/dist-orders";
import { addPortalChemist, buildCatalogue, ingestPortal, portalStatuses, type PortalMessage } from "@/drivedb/dist-portal";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";
import { distCtx, makeDistributor } from "./dist-helpers";

/**
 * Chemist portal for a distributor whose records are in its own Drive (phase D5): the device publishes the catalogue;
 * a chemist's order reaches the device sealed (Medoro can't read it); the device reports the status back. Medoro's
 * database holds no medicines, stock, chemists' balances or bills for this distributor.
 */
describe("Chemist portal for a Drive-mode distributor", () => {
  const today = todayISO(), G = "godown-1";
  let tenantId = "", acc: PortalAccount, dev: DriveDB, med = "", priv: CryptoKey;

  beforeAll(async () => {
    await resetDb(); await makeDistributor();
    const ctx = await distCtx();
    tenantId = ctx.tenantId;
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await db.tenant.update({ where: { id: tenantId }, data: { settings: { ...(t.settings as object), driveMode: true, driveOnly: true } } });
    // The distributor's device: its own keys (Medoro gets only the public one).
    const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    priv = pair.privateKey as CryptoKey;
    await db.driveDevice.create({ data: { tenantId, deviceId: "DISTDEV1", userId: ctx.userId, name: "Office PC", role: "owner", status: "approved", publicKey: (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as object } });
    dev = await memoryDb("DISTDEV1");
    dev.setMeta("pharmacy", JSON.stringify({ gstin: t.gstin }));
    med = addMedicine(dev, { name: "Amoxyclav 625", gstRate: 12, mrpPaise: 8000, packSize: 10 }).id;
    receiveStock(dev, { branchId: G, medicineId: med, batchNo: "B1", expiryDate: addDays(today, 400), qty: 10 * 50, costPaise: 4000, mrpPaise: 8000, userId: ctx.userId });
    saveProduct(dev, { medicineId: med, companyId: saveCompany(dev, null, { name: "Acme Pharma" }), ptrPaise: 5000, ptsPaise: 4500 });
    acc = await db.distChemistAccount.create({ data: { firmName: "Sai Chemists", ownerName: "Sai", email: "sai@chem.in", phone: "9876500001", passwordHash: await hashPassword("long-enough-pw"), dl20b: "MH-PZ-20B-777", dl21b: "MH-PZ-21B-777", dlExpiry: dateOnly(addDays(today, 300)), address: "Kothrud", pincode: "411038", stateCode: "27", consentAt: new Date(), consentVersion: "2026-11" } }) as unknown as PortalAccount;
  });

  it("connect, approve on the device, browse the published catalogue, order, and follow it through to the invoice", async () => {
    const ctx = await distCtx();
    await requestConnection(acc, "DISTA-PUNE", true);
    const conn = await db.distConnection.findFirstOrThrow({ where: { accountId: acc.id } });
    // The owner approves on the device: the chemist is added there; Medoro keeps only the link.
    const customerId = addPortalChemist(dev, { accountId: acc.id, firmName: "Sai Chemists", phone: "9876500001", dl20b: "MH-PZ-20B-777", dl21b: "MH-PZ-21B-777", dlExpiry: addDays(today, 300), stateCode: "27", creditLimitPaise: 1_000_000_00 }, today);
    await linkConnection(tenantId, ctx.userId, conn.id, customerId);
    await expect(portalCatalogue(acc, "DISTA-PUNE")).rejects.toThrow(/hasn’t published/);
    await publishPortal(tenantId, "DISTDEV1", { catalogue: buildCatalogue(dev, G, today) });
    const cat = await portalCatalogue(acc, "DISTA-PUNE");
    expect(cat).toMatchObject([{ name: "Amoxyclav 625", rate: 5000, stock: { label: "In stock" } }]);

    const o = await portalPlaceOrder(acc, "DISTA-PUNE", [{ medicineId: med, qty: 6 }], "urgent", "portal-order-001");
    expect(o).toMatchObject({ orderId: "portal-order-001", status: "pending", replayed: false });
    expect((await portalPlaceOrder(acc, "DISTA-PUNE", [{ medicineId: med, qty: 6 }], "urgent", "portal-order-001")).replayed).toBe(true);
    // Medoro holds the order only sealed: the medicine id and quantity aren't readable in the inbox.
    const inbox = await distInboxFor(tenantId, "DISTDEV1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].sealed).not.toContain(med);
    // The device opens it, takes it in, and Medoro deletes it.
    const msg = await openJson<PortalMessage>(priv, inbox[0].sealed, DIST_ORDER_AAD);
    const r = ingestPortal(dev, G, ctx.userId, [msg], today);
    expect(r.done).toEqual(["portal-order-001"]);
    await ackDistInbox(tenantId, r.done);
    expect(await distInboxFor(tenantId, "DISTDEV1")).toEqual([]);
    const [order] = listOrders(dev);
    approveOrder(dev, { orderId: order.id, userId: ctx.userId }, today);
    for (const p of pickList(dev, order.id)) confirmPickLine(dev, { pickLineId: p.id, pickedUnits: p.units, userId: ctx.userId });
    packOrder(dev, { orderId: order.id, boxes: 1, userId: ctx.userId });
    const inv = invoiceOrder(dev, { orderId: order.id, userId: ctx.userId }, today);
    await publishPortal(tenantId, "DISTDEV1", { statuses: portalStatuses(dev) });
    const mine = await portalOrders(acc, "DISTA-PUNE");
    expect(mine[0]).toMatchObject({ id: "portal-order-001", status: "invoiced", no: order.no, invoice: { no: inv.no, total: inv.total }, lines: [{ medicineId: med, name: "Amoxyclav 625", qty: 6 }] });
    // Balances and invoices stay with the distributor.
    await expect(portalAccountSummary(acc, "DISTA-PUNE")).rejects.toThrow(/keeps your account and invoices on its own system/);
    await expect(portalInvoice(acc, "DISTA-PUNE", "portal-order-001")).rejects.toThrow(/its own system/);
    // Nothing of the distributor's books is on Medoro's server.
    for (const n of await Promise.all([db.medicine.count({ where: { tenantId } }), db.batch.count({ where: { tenantId } }), db.customer.count({ where: { tenantId } }), db.distOrder.count({ where: { tenantId } }), db.distInvoice.count({ where: { tenantId } })])) expect(n).toBe(0);
  });

  it("a chemist cancels an order the distributor hasn't approved; once approved it can't be cancelled from the portal", async () => {
    await portalPlaceOrder(acc, "DISTA-PUNE", [{ medicineId: med, qty: 2 }], "", "portal-order-002");
    await portalCancelOrder(acc, "DISTA-PUNE", "portal-order-002");
    const msgs = await Promise.all((await distInboxFor(tenantId, "DISTDEV1")).map((w) => openJson<PortalMessage>(priv, w.sealed, DIST_ORDER_AAD)));
    expect(msgs.map((m) => m.kind).sort()).toEqual(["cancel", "order"]);
    const r = ingestPortal(dev, G, "u", msgs.sort((a) => (a.kind === "order" ? -1 : 1)), today);
    await ackDistInbox(tenantId, r.done);
    await publishPortal(tenantId, "DISTDEV1", { statuses: portalStatuses(dev) });
    expect((await portalOrders(acc, "DISTA-PUNE")).find((o) => o.id === "portal-order-002")).toMatchObject({ status: "cancelled" });
    await expect(portalCancelOrder(acc, "DISTA-PUNE", "portal-order-001")).rejects.toThrow(/can no longer be cancelled/);
  });
});
