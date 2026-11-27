import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, receiveStock } from "./pharmacy";
import { saveChemist, saveCompany, saveDistSettings, saveProduct, saveScheme } from "./dist";
import { approveOrder, confirmPickLine, invoiceOrder, listOrders, packOrder, pickList } from "./dist-orders";
import { addPortalChemist, buildCatalogue, ingestPortal, portalStatuses, type PortalMessage } from "./dist-portal";
import { addDays, todayISO } from "@/lib/dates";

const G = "godown-1", U = "u1", today = todayISO();
let db: DriveDB, med = "", hidden = "", chem = "";
const acct = { accountId: "acct-sai-0001", firmName: "Sai Chemists", ownerName: "Sai", phone: "9876500001", dl20b: "MH-PZ-20B-777", dl21b: "MH-PZ-21B-777", dlExpiry: addDays(today, 300), address: "Kothrud", pincode: "411038", stateCode: "27" };
const order = (key: string, qty = 5, accountId = acct.accountId, customerId = chem): PortalMessage => ({ kind: "order", key, accountId, customerId, lines: [{ medicineId: med, qty }], note: "urgent", at: new Date().toISOString() });

beforeEach(async () => {
  db = await memoryDb("DIST5");
  db.setMeta("pharmacy", JSON.stringify({ gstin: "27AAKFS3192P1Z6" }));
  med = addMedicine(db, { name: "Amoxyclav 625", gstRate: 12, mrpPaise: 8000, packSize: 10 }).id;
  hidden = addMedicine(db, { name: "Not on portal", gstRate: 12, mrpPaise: 1000 }).id;
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "B1", expiryDate: addDays(today, 400), qty: 10 * 40, costPaise: 4000, mrpPaise: 8000, userId: U });
  const co = saveCompany(db, null, { name: "Acme Pharma" });
  saveProduct(db, { medicineId: med, companyId: co, ptrPaise: 5000, ptsPaise: 4500, minOrderQty: 2 });
  saveProduct(db, { medicineId: hidden, ptrPaise: 800, portalVisible: false });
  saveScheme(db, { code: "ALL10", name: "10+1", kind: "free", medicineId: med, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
  saveScheme(db, { code: "VIP5", name: "VIP", kind: "discount", medicineId: med, discPct: 5, customerIds: ["someone"], validFrom: today, validTo: addDays(today, 30) });
  chem = addPortalChemist(db, { ...acct, creditLimitPaise: 1_000_000_00 }, today);
});

describe("portal catalogue the device publishes", () => {
  it("only portal products, the chosen stock view, schemes open to all, MRP if shown, and each portal chemist's tier", () => {
    const c = buildCatalogue(db, G, today);
    expect(c.items.map((i) => i.name)).toEqual(["Amoxyclav 625"]);
    expect(c.items[0]).toMatchObject({ ptr: 5000, pts: 4500, mrp: 8000, minOrderQty: 2, stock: { label: "In stock", packs: null }, schemes: ["10+1"] });
    expect(c.tiers).toEqual({ [acct.accountId]: "ptr" });
    // What's on order isn't free: 30 + 3 free of 40 packs promised → 7 left.
    ingestPortal(db, G, U, [order("portal-key-0001", 30)], today);
    approveOrder(db, { orderId: listOrders(db)[0].id, userId: U, allowPartial: true }, today);
    saveDistSettings(db, { portal: { enabled: true, discoverable: true, stock: "exact", showSchemes: false, showMrp: false, minOrderPaise: 0, serviceArea: "" } });
    expect(buildCatalogue(db, G, today).items[0]).toMatchObject({ mrp: null, schemes: [], stock: { packs: 7, label: "7 in stock" } });
    // Nothing of the books goes out.
    // (4000 is the batch cost in paise; match it as a JSON value, since ids are random UUIDs that can contain "4000".)
    expect(JSON.stringify(buildCatalogue(db, G, today))).not.toMatch(/costPaise|balance|[:,\[]4000[,}\]]/);
  });
});

describe("portal orders taken in on the device", () => {
  it("waits for approval like any order, is idempotent, and reports its status through to the invoice", () => {
    const r = ingestPortal(db, G, U, [order("portal-key-0002", 12)], today);
    expect(r).toEqual({ done: ["portal-key-0002"], statuses: [] });
    expect(ingestPortal(db, G, U, [order("portal-key-0002", 12)], today).done).toEqual(["portal-key-0002"]); // again: same order
    const [o] = listOrders(db);
    expect(o).toMatchObject({ source: "portal", status: "pending" });
    expect(portalStatuses(db)).toMatchObject([{ key: "portal-key-0002", status: "pending", orderNo: o.no, invoiceNo: null }]);
    approveOrder(db, { orderId: o.id, userId: U }, today);
    for (const p of pickList(db, o.id)) confirmPickLine(db, { pickLineId: p.id, pickedUnits: p.units, userId: U });
    packOrder(db, { orderId: o.id, boxes: 1, userId: U });
    const inv = invoiceOrder(db, { orderId: o.id, userId: U }, today);
    expect(portalStatuses(db)[0]).toMatchObject({ status: "invoiced", invoiceNo: inv.no, invoiceTotalPaise: inv.total });
  });

  it("a cancellation cancels a pending order; a refused order is reported; a message for a chemist not here yet waits", () => {
    ingestPortal(db, G, U, [order("portal-key-0003")], today);
    ingestPortal(db, G, U, [{ kind: "cancel", key: "portal-key-0003", accountId: acct.accountId, customerId: chem, at: today }], today);
    expect(portalStatuses(db)[0]).toMatchObject({ status: "cancelled", reason: "Cancelled by chemist" });
    saveChemist(db, { customerId: chem, stateCode: "27", dlExpiry: addDays(today, -1) });
    expect(ingestPortal(db, G, U, [order("portal-key-0004")], today).statuses).toMatchObject([{ key: "portal-key-0004", status: "rejected", reason: expect.stringMatching(/Drug licence expired/) }]);
    expect(ingestPortal(db, G, U, [order("portal-key-0005", 5, "acct-unknown", "cust-unknown")], today)).toEqual({ done: [], statuses: [] });
  });

  it("approving a portal chemist links once, or to a chemist already here", () => {
    expect(addPortalChemist(db, acct, today)).toBe(chem);
    expect(() => addPortalChemist(db, { ...acct, accountId: "acct-other-0001", customerId: chem }, today)).toThrow(/already linked/);
    expect(() => addPortalChemist(db, { ...acct, accountId: "acct-old-0001", phone: "9876500009", dlExpiry: addDays(today, -1) }, today)).toThrow(/expired/);
  });
});
