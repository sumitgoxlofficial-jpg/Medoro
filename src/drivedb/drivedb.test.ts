import { describe, expect, it, beforeEach } from "vitest";
import { memoryDb } from "./node";
import { DriveDB, DriveDBError, migrate } from "./client";
import { Clock, parseHlc } from "./hlc";
import { TABLES, SCHEMA_VERSION } from "./schema";
import { addMedicine, batchesOf, createSale, dayTotals, receiveStock, searchMedicines, stockOf, CounterError } from "./pharmacy";
import { cartTotals } from "@/lib/money";

const B = "branch-main", U = "user-1", TODAY = "2026-11-01";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

describe("schema", () => {
  it("creates exactly the tables and columns the SDK allows", () => {
    for (const [t, spec] of Object.entries(TABLES)) {
      const cols = db.engine.all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name);
      expect(cols.sort()).toEqual([...spec.columns].sort());
    }
    expect(db.engine.all<{ user_version: number }>("PRAGMA user_version")[0].user_version).toBe(SCHEMA_VERSION);
  });

  it("re-opening is a no-op and a newer file is refused", () => {
    migrate(db.engine);
    db.engine.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db.engine)).toThrow(/newer version/);
  });

  it("bills and stock movements can't be edited or deleted even with raw SQL", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "D1", expiryDate: "2027-06-30", qty: 10, costPaise: 2000, mrpPaise: 3200, userId: U });
    expect(() => db.engine.run("DELETE FROM stockMovement")).toThrow(/cannot be deleted/);
    expect(() => db.engine.run("UPDATE stockMovement SET qty = 99")).toThrow(/cannot be changed/);
  });
});

describe("clock", () => {
  it("is monotonic within a millisecond and moves past stamps from other devices", () => {
    let t = 1000;
    const c = new Clock("A", null, () => t);
    const a = c.tick(), b = c.tick();
    expect(a < b).toBe(true);
    c.observe(new Clock("B", null, () => 5000).tick());
    t = 1001;
    const d = c.tick();
    expect(parseHlc(d).ms).toBe(5000);
    expect(d > b).toBe(true);
  });
});

describe("SDK", () => {
  it("filters, orders, pages and counts", () => {
    for (const [name, mrp] of [["Azithral 500", 11900], ["Dolo 650", 3200], ["dolonex", 5000], ["Pan 40", 15500]] as const) addMedicine(db, { name, gstRate: 12, mrpPaise: mrp });
    expect(db.from("medicine").ilike("name", "dolo%").order("name").all().map((r) => r.name)).toEqual(["Dolo 650", "dolonex"]);
    expect(db.from("medicine").like("name", "Dolo%").count()).toBe(1);
    expect(db.from("medicine").gte("mrpPaise", 5000).lt("mrpPaise", 15500).select("name").order("name").all()).toEqual([{ name: "Azithral 500" }, { name: "dolonex" }]);
    expect(db.from("medicine").in("name", ["Pan 40", "Nope"]).count()).toBe(1);
    expect(db.from("medicine").order("mrpPaise", { ascending: false }).range(1, 2).all().map((r) => r.name)).toEqual(["Azithral 500", "dolonex"]);
  });

  it("rejects unknown columns and tables instead of building SQL from them", () => {
    expect(() => db.from("medicine").eq("name; DROP TABLE medicine", "x")).toThrow(DriveDBError);
    expect(() => db.from("medicine").select("id, password")).toThrow(/no column password/);
    expect(() => db.from("medicine" as never).insert({ evil: 1 })).toThrow(/no column evil/);
    expect(() => db.from("nope" as never)).toThrow(/Unknown table/);
  });

  it("logs every write with a clock stamp, in the same transaction", () => {
    const m = db.from("medicine").insert({ name: "Pan 40", gstRate: 12, mrpPaise: 15500 })[0];
    db.from("medicine").eq("id", m.id).update({ mrpPaise: 16000 });
    db.from("medicine").eq("id", m.id).delete();
    const log = db.pendingChanges();
    expect(log.map((c) => [c.tbl, c.op])).toEqual([["medicine", "insert"], ["medicine", "update"], ["medicine", "delete"]]);
    expect(log[1].data).toEqual({ mrpPaise: 16000 });
    expect(log.every((c, i) => i === 0 || c.clock > log[i - 1].clock)).toBe(true);
    expect(log[0].data.updatedAt).toBe(log[0].clock);
    // Soft delete: hidden by default, kept for history and sync.
    expect(db.from("medicine").count()).toBe(0);
    expect(db.from("medicine").withDeleted().first()).toMatchObject({ mrpPaise: 16000, updatedAt: log[2].clock });
    db.markPushed(log[1].seq);
    expect(db.pendingChanges().map((c) => c.op)).toEqual(["delete"]);
  });

  it("rolls back data and change records together", () => {
    expect(() => db.transaction(() => { db.from("medicine").insert({ name: "X", gstRate: 12, mrpPaise: 100 }); throw new Error("boom"); })).toThrow("boom");
    expect(db.from("medicine").count()).toBe(0);
    expect(db.pendingChanges()).toEqual([]);
  });

  it("upserts, and refuses edits to append-only records", () => {
    const row = db.from("customer").upsert({ id: "c1", name: "Asha", creditLimitPaise: 0 });
    expect(row.name).toBe("Asha");
    expect(db.from("customer").upsert({ id: "c1", name: "Asha K" }).name).toBe("Asha K");
    expect(() => db.from("sale").update({ totalPaise: 1 })).toThrow(/can't be changed/);
    expect(() => db.from("stockMovement").delete()).toThrow(/can't be deleted/);
    expect(() => db.from("customer").insert({ name: "x", updatedAt: "z" })).toThrow(/set by DriveDB/);
  });

  it("keeps the clock across restarts", async () => {
    db.from("customer").insert({ name: "A" });
    const last = db.clock.current;
    const again = DriveDB.open(db.engine, { device: "C1" });
    expect(again.clock.tick() > last).toBe(true);
  });
});

describe("pharmacy on the device", () => {
  const stock = (medicineId: string, batchNo: string, expiryDate: string, qty: number, mrpPaise = 3200) =>
    receiveStock(db, { branchId: B, medicineId, batchNo, expiryDate, qty, costPaise: 2000, mrpPaise, userId: U });

  it("searches by barcode, name start, then name anywhere", () => {
    addMedicine(db, { name: "Paracetamol 500", gstRate: 12, mrpPaise: 2000 });
    addMedicine(db, { name: "Crocin (paracetamol)", gstRate: 12, mrpPaise: 3000, barcode: "8901234" });
    addMedicine(db, { name: "Dolo 650", generic: "Paracetamol", gstRate: 12, mrpPaise: 3200 });
    expect(searchMedicines(db, "para").map((m) => m.name)).toEqual(["Paracetamol 500", "Crocin (paracetamol)", "Dolo 650"]);
    expect(searchMedicines(db, "8901234")[0].name).toBe("Crocin (paracetamol)");
    expect(searchMedicines(db, "100%")).toEqual([]);
    expect(searchMedicines(db, "  ").map((m) => m.name)).toEqual(["Crocin (paracetamol)", "Dolo 650", "Paracetamol 500"]);
    expect(() => addMedicine(db, { name: "Dup", gstRate: 12, mrpPaise: 1, barcode: "8901234" })).toThrow(/already on another medicine/);
  });

  it("sells FEFO across batches, numbers the invoice per counter and takes stock out", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    stock(m.id, "LATE", "2027-12-31", 10);
    stock(m.id, "SOON", "2027-01-31", 3);
    stock(m.id, "OLD", "2026-10-01", 50); // expired: never sold
    const r = createSale(db, { branchId: B, series: "MAIN1", userId: U, lines: [{ medicineId: m.id, qty: 5 }], pay: { mode: "cash" } }, TODAY);
    expect(r.invoiceNo).toBe("MAIN12627-000001");
    expect(r.lines.map((l) => [l.batchNo, l.qty])).toEqual([["SOON", 3], ["LATE", 2]]);
    expect(r.totalPaise).toBe(cartTotals([{ mrpPaise: 3200, qty: 5, gstRate: 12 }], 0).total);
    expect(stockOf(db, m.id, B, TODAY)).toBe(8);
    expect(batchesOf(db, m.id, B).find((b) => b.batchNo === "OLD")!.qtyAvailable).toBe(50);
    const next = createSale(db, { branchId: B, series: "MAIN1", userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "upi", ref: "UTR1" } }, TODAY);
    expect(next.invoiceNo).toBe("MAIN12627-000002");
    expect(db.from("payment").eq("saleId", next.saleId).first()).toMatchObject({ mode: "upi", ref: "UTR1" });
    expect(dayTotals(db, B, TODAY)).toMatchObject({ bills: 2, totalPaise: r.totalPaise + next.totalPaise });
  });

  it("writes the bill, its lines, payments and stock movements as change records", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    stock(m.id, "A", "2027-12-31", 10);
    const before = db.pendingChanges().length;
    createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" } }, TODAY);
    expect(db.pendingChanges().slice(before).map((c) => c.tbl).sort()).toEqual(["payment", "sale", "saleItem", "stockMovement"]);
  });

  it("sells loose units at MRP ÷ pack size and refuses loose sale when not allowed", () => {
    const strip = addMedicine(db, { name: "Azee 500", gstRate: 12, mrpPaise: 11900, packSize: 3, packUnit: "strip", looseUnit: "tab", allowLoose: true });
    const bottle = addMedicine(db, { name: "Benadryl", gstRate: 12, mrpPaise: 12000 });
    stock(strip.id, "S1", "2027-12-31", 9, 11900);
    stock(bottle.id, "B1", "2027-12-31", 5, 12000);
    const r = createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: strip.id, qty: 2, unit: "loose" }, { medicineId: strip.id, qty: 1 }], pay: { mode: "cash" } }, TODAY);
    expect(stockOf(db, strip.id, B, TODAY)).toBe(9 - 2 - 3);
    expect(db.from("saleItem").eq("saleId", r.saleId).eq("loose", true).first()).toMatchObject({ mrpPaise: Math.floor(11900 / 3), qty: 2 });
    expect(() => createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: bottle.id, qty: 1, unit: "loose" }], pay: { mode: "cash" } }, TODAY)).toThrow(/isn’t sold loose/);
  });

  it("refuses short stock, quarantined batches, and keeps nothing from a failed bill", () => {
    const m = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500 });
    const q = stock(m.id, "Q", "2027-12-31", 100);
    db.from("batch").eq("id", q).update({ status: "quarantine" });
    stock(m.id, "OK", "2027-12-31", 2);
    const changes = db.pendingChanges().length;
    expect(() => createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 3 }], pay: { mode: "cash" } }, TODAY)).toThrow(CounterError);
    expect(db.from("sale").count()).toBe(0);
    expect(db.pendingChanges().length).toBe(changes);
    // The invoice number wasn't used up either.
    expect(createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" } }, TODAY).invoiceNo).toBe("C12627-000001");
  });

  it("enforces prescription, discount, split and credit rules", () => {
    const h = addMedicine(db, { name: "Azithro", gstRate: 12, mrpPaise: 10000, schedule: "H" });
    const h1 = addMedicine(db, { name: "Alprax", gstRate: 12, mrpPaise: 5000, schedule: "H1" });
    stock(h.id, "H", "2027-12-31", 10, 10000);
    stock(h1.id, "H1", "2027-12-31", 10, 5000);
    const base = { branchId: B, series: "C1", userId: U, pay: { mode: "cash" as const } };
    expect(() => createSale(db, { ...base, lines: [{ medicineId: h.id, qty: 1 }] }, TODAY)).toThrow(/prescriber’s name/);
    expect(() => createSale(db, { ...base, lines: [{ medicineId: h1.id, qty: 1 }], prescriber: "Dr A" }, TODAY)).toThrow(/patient’s name and prescriber’s registration/);
    expect(createSale(db, { ...base, lines: [{ medicineId: h1.id, qty: 1 }], prescriber: "Dr A", prescriberReg: "JH123", patientName: "Ravi" }, TODAY).invoiceNo).toBeTruthy();
    expect(() => createSale(db, { ...base, lines: [{ medicineId: h.id, qty: 1 }], prescriber: "Dr A", discountPct: 20, maxDiscountPct: 10 }, TODAY)).toThrow(/above 10%/);
    expect(() => createSale(db, { ...base, lines: [{ medicineId: h.id, qty: 1 }], prescriber: "Dr A", pay: { mode: "split", cashPaise: 20000 } }, TODAY)).toThrow(/cash part/);
    const c = db.from("customer").insert({ name: "Asha", creditLimitPaise: 15000 })[0];
    expect(() => createSale(db, { ...base, lines: [{ medicineId: h.id, qty: 1 }], prescriber: "Dr A", pay: { mode: "credit" } }, TODAY)).toThrow(/Select a customer/);
    createSale(db, { ...base, customerId: String(c.id), lines: [{ medicineId: h.id, qty: 1 }], prescriber: "Dr A", pay: { mode: "credit" } }, TODAY);
    expect(() => createSale(db, { ...base, customerId: String(c.id), lines: [{ medicineId: h.id, qty: 1 }], prescriber: "Dr A", pay: { mode: "credit" } }, TODAY)).toThrow(/credit limit/);
  });

  it("two counters number their own bills without clashing", async () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    stock(m.id, "A", "2027-12-31", 10);
    const a = createSale(db, { branchId: B, series: "MAIN1", userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" } }, TODAY);
    const b = createSale(db, { branchId: B, series: "MAIN2", userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" } }, TODAY);
    expect([a.invoiceNo, b.invoiceNo]).toEqual(["MAIN12627-000001", "MAIN22627-000001"]);
  });
});
