import { beforeEach, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock } from "./pharmacy";
import { addRecall, batchNos, blockRecall, listRecalls, setRecallStatus } from "./recalls";
import { setBatchStatus } from "./ops";
import { addDays, todayISO } from "@/lib/dates";
import { TABLES } from "./schema";

const U = "u1";
const BR = [{ id: "b1", name: "Main" }, { id: "b2", name: "Station Road" }];
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

const setup = () => {
  const dolo = addMedicine(db, { name: "Dolo", strength: "650 mg", gstRate: 12, mrpPaise: 3000 });
  const other = addMedicine(db, { name: "Crocin", gstRate: 12, mrpPaise: 3000 });
  const stock = (m: { id: string }, branchId: string, batchNo: string, qty: number, expiryDate = "2030-01-31") =>
    receiveStock(db, { branchId, medicineId: m.id, batchNo, expiryDate, qty, costPaise: 2000, mrpPaise: 3000, userId: U });
  return { dolo, other, a1: stock(dolo, "b1", "AB123", 10), a2: stock(dolo, "b2", "AB123", 4), c: stock(dolo, "b1", "CD9", 5), x: stock(other, "b1", "AB123", 7) };
};

it("migration 12 matches the recall table", () => {
  expect(db.engine.all<{ name: string }>("PRAGMA table_info(recall)").map((r) => r.name).sort()).toEqual([...TABLES.recall.columns].sort());
});

it("records a verified notice and checks its details", () => {
  const { dolo } = setup();
  const base = { medicineId: dolo.id, batches: "ab123, ab124 ab123", source: "CDSCO alert 12/2026", publishedAt: todayISO(), series: "C1", userId: U };
  const r = addRecall(db, base);
  expect(r.ref).toBe("C1-RC1");
  expect(addRecall(db, base).ref).toBe("C1-RC2");
  expect(listRecalls(db, BR)[0]).toMatchObject({ product: "Dolo 650 mg", batchNos: ["AB123", "AB124"], reason: "Not specified", status: "open" });
  expect(() => addRecall(db, { ...base, publishedAt: addDays(todayISO(), 2) })).toThrow(/future/);
  expect(() => addRecall(db, { ...base, medicineId: "nope" })).toThrow(/Medicine not found/);
  expect(() => addRecall(db, { ...base, source: "x" })).toThrow(/where the notice came from/);
  expect(() => addRecall(db, { ...base, batches: " , ; " })).toThrow(/batch numbers/);
  expect(batchNos("a1;b2  a1")).toEqual(["A1", "B2"]);
});

it("matches the medicine's batches in every branch, quarantines them, then recalls, and blocks billing", () => {
  const { dolo, a1, a2, x } = setup();
  const { id } = addRecall(db, { medicineId: dolo.id, batches: "AB123", source: "Manufacturer letter", publishedAt: todayISO(), reason: "Failed dissolution", series: "C1", userId: U });
  const r = listRecalls(db, BR)[0];
  // Crocin's AB123 isn't affected; CD9 isn't named.
  expect(r.matches.map((m) => [m.id, m.branch, m.qty, m.sellable])).toEqual([[a1, "Main", 10, true], [a2, "Station Road", 4, true]]);
  expect(r.matches.some((m) => m.id === x)).toBe(false);

  expect(blockRecall(db, { recallId: id, userId: U })).toBe(2);
  const after = listRecalls(db, BR)[0];
  expect(after.status).toBe("investigating");
  expect(after.matches.every((m) => m.status === "quarantine" && !m.sellable)).toBe(true);
  // Stock stays; the block is on record against the notice.
  expect(after.matches.map((m) => m.qty)).toEqual([10, 4]);
  expect(db.from("stockMovement").eq("refId", id).count()).toBe(2);
  expect(() => createSale(db, { branchId: "b1", series: "C1", userId: U, lines: [{ medicineId: dolo.id, qty: 6 }], pay: { mode: "cash" } })).toThrow(/Not enough/);

  expect(blockRecall(db, { recallId: id, userId: U })).toBe(0); // already quarantined
  expect(blockRecall(db, { recallId: id, userId: U, status: "recalled" })).toBe(2);
  expect(listRecalls(db, BR)[0].matches.map((m) => m.status)).toEqual(["recalled", "recalled"]);

  setBatchStatus(db, a1, "ok"); // released on Stock, e.g. a withdrawn notice
  expect(blockRecall(db, { recallId: id, userId: U })).toBe(1);
  expect(() => blockRecall(db, { recallId: "nope", userId: U })).toThrow(/Recall not found/);
});

it("changes status by hand, and a notice with no stock blocks nothing", () => {
  const { dolo } = setup();
  const { id } = addRecall(db, { medicineId: dolo.id, batches: "ZZ1", source: "State drug controller", publishedAt: "2026-01-05", series: "C1", userId: U });
  expect(listRecalls(db, BR)[0].matches).toEqual([]);
  expect(blockRecall(db, { recallId: id, userId: U })).toBe(0);
  expect(listRecalls(db, BR)[0].status).toBe("open");
  setRecallStatus(db, id, "resolved");
  expect(listRecalls(db, BR)[0].status).toBe("resolved");
  expect(() => setRecallStatus(db, id, "lost" as never)).toThrow(/Unknown status/);
  expect(() => setRecallStatus(db, "nope", "open")).toThrow(/not found/);
});

it("an expired matching batch shows but isn't sellable", () => {
  const { dolo } = setup();
  receiveStock(db, { branchId: "b1", medicineId: dolo.id, batchNo: "OLD1", expiryDate: "2030-01-31", qty: 3, costPaise: 2000, mrpPaise: 3000, userId: U });
  addRecall(db, { medicineId: dolo.id, batches: "OLD1", source: "CDSCO", publishedAt: todayISO(), series: "C1", userId: U });
  expect(listRecalls(db, BR, "2031-01-01")[0].matches[0]).toMatchObject({ sellable: false, status: "ok", qty: 3 });
});
