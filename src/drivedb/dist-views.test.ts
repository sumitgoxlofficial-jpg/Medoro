import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, receiveStock } from "./pharmacy";
import { addCustomer } from "./trade";
import { directInvoice, saveChemist, saveCompany, saveProduct, saveScheme } from "./dist";
import { placeOrder, approveOrder } from "./dist-orders";
import { listChemists, listCompanies, listProducts, listSchemes, quote } from "./dist-views";
import { importSeed } from "./seed";
import { addDays, todayISO } from "@/lib/dates";

const G = "godown-1", U = "u1", today = todayISO();
let db: DriveDB, med = "", other = "", chem = "", walkIn = "", n = 0;
const key = () => `view-key-${++n}-${Date.now()}`;

beforeEach(async () => {
  db = await memoryDb("DIST4");
  db.setMeta("pharmacy", JSON.stringify({ gstin: "27AAKFS3192P1Z6" }));
  const co = saveCompany(db, null, { name: "Cipla" });
  med = addMedicine(db, { name: "Amoxyclav 625", gstRate: 12, mrpPaise: 8000, packSize: 10 }).id;
  other = addMedicine(db, { name: "Azithral 500", gstRate: 12, mrpPaise: 12000, packSize: 3 }).id;
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "B1", expiryDate: addDays(today, 300), qty: 10 * 50, costPaise: 4000, mrpPaise: 8000, userId: U });
  saveProduct(db, { medicineId: med, companyId: co, ptrPaise: 5000 });
  chem = addCustomer(db, { name: "Sai Medical", phone: "9822000222", creditLimitPaise: 100_000_00 }).id;
  walkIn = addCustomer(db, { name: "Walk-in Ravi", phone: "9822000333" }).id;
  saveChemist(db, { customerId: chem, stateCode: "27", dl20b: "MH-PZ-20B-123", dlExpiry: addDays(today, 300) });
});

describe("distribution lists on the device", () => {
  it("products show wholesale terms and free packs (reserved stock is not free)", () => {
    const rows = listProducts(db, G);
    const a = rows.find((r) => r.id === med)!, b = rows.find((r) => r.id === other)!;
    expect(a).toMatchObject({ wholesale: true, ptrPaise: 5000, company: "Cipla", freePacks: 50, discontinued: false });
    expect(b).toMatchObject({ wholesale: false, freePacks: 0 });
    expect(listProducts(db, G, "azi").map((r) => r.id)).toEqual([other]);
    const o = placeOrder(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 20 }] }, today);
    approveOrder(db, { orderId: o.orderId, userId: U }, today);
    expect(listProducts(db, G).find((r) => r.id === med)!.freePacks).toBe(30);
    expect(listCompanies(db).map((c) => c.name)).toEqual(["Cipla"]);
  });

  it("chemists carry their profile and what they owe", () => {
    directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 10 }] }, today);
    const rows = listChemists(db);
    expect(rows.find((c) => c.id === chem)).toMatchObject({ profile: true, balancePaise: 56000 });
    expect(rows.find((c) => c.id === walkIn)).toMatchObject({ profile: false, balancePaise: 0 });
    expect(listChemists(db, "98220003").map((c) => c.id)).toEqual([walkIn]);
  });

  it("a quote matches the invoice it becomes, scheme included", () => {
    saveScheme(db, { code: "AMX10", name: "10+1", kind: "free", medicineId: med, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    expect(listSchemes(db)).toMatchObject([{ code: "AMX10", target: "Amoxyclav 625", active: true }]);
    const q = quote(db, chem, [{ medicineId: med, qty: 20 }, { medicineId: other, qty: 2 }]);
    expect(q.lines[0]).toMatchObject({ rate: 5000, freeQty: 2, problem: null });
    expect(q.lines[1].problem).toBe("No wholesale rate");
    expect(q.inter).toBe(false);
    const inv = directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 20 }] }, today);
    expect(inv.total).toBe(q.total);
  });

  it("the device knows it runs MEDORO Distribution from its seed", async () => {
    const seed = (product?: "pharmacy" | "distribution") => ({ branch: { id: G, code: "G1", name: "Godown" }, product, maxDiscountPct: 100, medicines: [], batches: [], customers: [] });
    expect(importSeed(await memoryDb("DIST4B"), seed("distribution"), U).product).toBe("distribution");
    expect(importSeed(await memoryDb("DIST4C"), seed(), U).product).toBe("pharmacy");
  });
});
