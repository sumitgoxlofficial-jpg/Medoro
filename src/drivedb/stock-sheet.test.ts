import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine } from "./pharmacy";
import { stockList } from "./reports";
import { importStockSheet, previewStockSheet } from "./stock-sheet";
import { readTable } from "@/domain/imports/parse";

const B = "b1", U = "u1", TODAY = "2026-11-12";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });
const csv = (s: string) => readTable("s.csv", new TextEncoder().encode(s));
const OLD = "Item Name,Batch,Expiry,Qty,MRP,Rate\nDOLO 650 TAB,A1,11/2028,10,33.60,24.5\nAZEE SYP,Z9,03/2028,4,95,70\n";

describe("stock list import on the counter", () => {
  it("reads a plain stock list from another billing program and fills the gaps, shown in the preview", () => {
    const p = previewStockSheet(db, B, csv(OLD), TODAY);
    expect(p).toMatchObject({ ok: 2, bad: 0, skip: 0 });
    expect(p.rows[0].note).toMatch(/form Tablet.*GST 12%/);
  });
  it("creates medicines and batches in one go; stock is in units (packs x pack size)", () => {
    const r = importStockSheet(db, { branchId: B, userId: U, table: csv("Brand name,Units per pack,Batch,Expiry,Qty,MRP,GST,Cost,Form,Manufacturer\nDolo 650,15,A1,11/2028,10,33.60,12,24.5,Tablet,Micro\n") }, TODAY);
    expect(r).toEqual({ created: 1, stocked: 1, skipped: 0 });
    const row = stockList(db, B)[0];
    expect(row).toMatchObject({ name: "Dolo 650", stock: 150, nextExpiry: "2028-11-30", mrpPaise: 3360 });
  });
  it("running the same file twice adds nothing the second time", () => {
    importStockSheet(db, { branchId: B, userId: U, table: csv(OLD) }, TODAY);
    const p = previewStockSheet(db, B, csv(OLD), TODAY);
    expect(p.ok).toBe(0);
    expect(p.skip).toBe(2);
    expect(stockList(db, B).map((r) => r.stock).sort()).toEqual([10, 4]);
  });
  it("adds a batch to a medicine already in the catalogue", () => {
    addMedicine(db, { name: "DOLO 650 TAB", gstRate: 12, mrpPaise: 3360 });
    const r = importStockSheet(db, { branchId: B, userId: U, table: csv(OLD) }, TODAY);
    expect(r.created).toBe(1);
    expect(r.stocked).toBe(2);
  });
  it("writes nothing when any row has a problem", () => {
    const bad = csv("Item Name,Batch,Expiry,Qty,MRP,Rate\nDOLO 650 TAB,A1,11/2028,10,33.60,24.5\nOLD TAB,B1,01/2020,5,10,5\nNO COST,C1,11/2028,5,10,\n");
    const p = previewStockSheet(db, B, bad, TODAY);
    expect(p.bad).toBe(2);
    expect(() => importStockSheet(db, { branchId: B, userId: U, table: bad }, TODAY)).toThrow(/2 rows have problems/);
    expect(stockList(db, B)).toHaveLength(0);
  });
  it("refuses a file without a name column", () => {
    expect(() => previewStockSheet(db, B, csv("Foo,Bar\n1,2\n"), TODAY)).toThrow(/Missing column/);
  });
});
