import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock } from "./pharmacy";
import { createReturn } from "./trade";
import { addDoctor, doctorSales, listDoctors, normName, updateDoctor } from "./doctors";
import { todayISO } from "@/lib/dates";
import { TABLES } from "./schema";

const B = "b1", U = "u1";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

it("migration 11 matches the doctor table", () => {
  expect(db.engine.all<{ name: string }>("PRAGMA table_info(doctor)").map((r) => r.name).sort()).toEqual([...TABLES.doctor.columns].sort());
});

describe("doctor master", () => {
  it("adds, cleans, searches, refuses a duplicate registration and deactivates", () => {
    const a = addDoctor(db, { name: "Dr. A. Mehta", qualification: "MBBS", regNo: "mmc  2011/04", phone: "+91 98220 00001", clinic: "City Clinic" });
    expect(a).toMatchObject({ name: "A. Mehta", regNo: "MMC 2011/04", phone: "9822000001", active: true });
    expect(() => addDoctor(db, { name: "Other", regNo: "MMC 2011/04" })).toThrow(/already on file for Dr A. Mehta/);
    expect(() => addDoctor(db, { name: "X" })).toThrow(/doctor’s name/);
    const b = addDoctor(db, { name: "Sen" });
    expect(listDoctors(db, { q: "city" }).map((d) => d.id)).toEqual([a.id]);
    expect(listDoctors(db, { q: "Dr mehta" }).map((d) => d.id)).toEqual([a.id]);
    updateDoctor(db, b.id, { name: "Sen", active: false });
    expect(listDoctors(db).map((d) => d.id)).toEqual([a.id]);
    expect(listDoctors(db, { all: true }).map((d) => d.active)).toEqual([true, false]);
    expect(() => updateDoctor(db, b.id, { name: "Sen", regNo: "MMC 2011/04" })).toThrow(/already on file/);
    expect(updateDoctor(db, a.id, { name: "A. Mehta", regNo: "MMC 2011/04", clinic: "New Clinic" }).clinic).toBe("New Clinic");
    expect(() => updateDoctor(db, "nope", { name: "Who" })).toThrow(/not found/);
  });

  it("normalises typed names for matching", () => {
    expect(normName("Dr.  A  Mehta, MBBS")).toBe("a mehta");
    expect(normName("dr sen · Reg 1")).toBe("sen");
  });
});

describe("sales by doctor", () => {
  const sell = (m: { id: string }, extra: { prescriber?: string; prescriberReg?: string; patientName?: string }, qty = 1, branchId = B) =>
    createSale(db, { branchId, series: branchId === B ? "C1" : "C2", userId: U, lines: [{ medicineId: m.id, qty }], pay: { mode: "cash" }, ...extra });

  it("links bills by registration no., else by a unique name; others show as typed; returns come off", () => {
    const rx = addMedicine(db, { name: "Azithral 500", gstRate: 12, mrpPaise: 10000, schedule: "H" });
    const otc = addMedicine(db, { name: "Vicks", gstRate: 18, mrpPaise: 5000 });
    for (const [m, br] of [[rx, B], [otc, B], [otc, "b2"]] as const) receiveStock(db, { branchId: br, medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", qty: 50, costPaise: 3000, mrpPaise: m.mrpPaise, userId: U });
    const mehta = addDoctor(db, { name: "A Mehta", regNo: "MMC 1" });
    addDoctor(db, { name: "Rao" }); addDoctor(db, { name: "Rao", clinic: "Second" }); // two doctors called Rao: name alone can't link

    const s1 = sell(rx, { prescriber: "Someone", prescriberReg: "mmc 1" }); // reg wins over the typed name
    sell(otc, { prescriber: "Dr A Mehta, MBBS" }); // no reg: unique name links
    sell(otc, { prescriber: "Rao" }); // ambiguous name: typed
    sell(otc, { prescriber: "Dr Unknown", prescriberReg: "KMC 9" }); // reg not on file: typed, grouped by reg
    sell(otc, {}); // no prescriber: not in the report
    sell(otc, { prescriber: "A Mehta" }, 1, "b2"); // other branch

    const item = String(db.from("saleItem").eq("saleId", s1.saleId).first()!.id);
    const ret = createReturn(db, { saleId: s1.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] });

    const today = todayISO();
    const r = doctorSales(db, today, today, B);
    const m = r.rows.find((x) => x.doctorId === mehta.id)!;
    expect(m).toMatchObject({ linked: true, bills: 2, rxBills: 1, regNo: "MMC 1", returns: ret.amountPaise });
    expect(m.net).toBe(m.gross - ret.amountPaise);
    expect(r.rows.find((x) => x.name === "Rao")).toMatchObject({ linked: false, bills: 1 });
    expect(r.rows.find((x) => x.key === "reg:KMC 9")).toMatchObject({ linked: false, name: "Unknown", regNo: "KMC 9" });
    expect(r.total.bills).toBe(4);
    expect(r.total.net).toBe(r.rows.reduce((a, x) => a + x.net, 0));

    expect(doctorSales(db, today, today, "all").rows.find((x) => x.doctorId === mehta.id)!.bills).toBe(3);
    expect(doctorSales(db, "2020-01-01", "2020-01-31", B).rows).toEqual([]);
    expect(() => doctorSales(db, today, "2020-01-01", B)).toThrow(/valid period/);
  });
});
