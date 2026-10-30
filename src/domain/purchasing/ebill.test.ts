import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { xlsx } from "../../../tests/xlsx";
import { applyMapping, autoMapping, missingFields, nameKey, nameScore, parseBillDate, readEbillTable, resolveMapping, type EbillMapping } from "./ebill";

const fixture = (f: string) => new Uint8Array(readFileSync(path.join(__dirname, "../../../tests/fixtures/ebill", f)));

describe("distributor e-bills", () => {
  it("detects the header row of a CSV export below the letterhead and reads lines", () => {
    const t = readEbillTable("marg-retailer.csv", fixture("marg-retailer.csv"));
    const m = autoMapping(t)!;
    expect(m.headerRow).toBe(2);
    expect(missingFields(m)).toEqual([]);
    const d = applyMapping(t, m);
    expect(d.invoiceNo).toBe("MMA/2627/0412");
    expect(d.invoiceDate).toBe("2026-10-12");
    expect(d.lines).toHaveLength(3); // the totals row is skipped
    expect(d.lines[0]).toMatchObject({ code: "DOL650", name: "DOLO 650 TAB", pack: "15'S", batch: "DL2611", expiry: "2028-11", qty: 100, free: 20, mrp: 3360, ptr: 2400, gst: 12, discPct: 5, problems: [] });
    expect(d.lines[1].expiry).toBe("2028-08");
    expect(d.lines[2]).toMatchObject({ expiry: "2028-03", mrp: 22350 });
  });

  it("reads a headerless pipe-delimited bill with a record-type filter", () => {
    const t = readEbillTable("pipe-distributor.txt", fixture("pipe-distributor.txt"));
    expect(t[1].length).toBe(14);
    const m: EbillMapping = { headerRow: -1, rowFilter: { col: 0, value: "d" }, cols: { code: 1, name: 2, pack: 3, batch: 4, expiry: 5, qty: 6, free: 7, scheme: 8, mrp: 9, ptr: 10, gst: 11, schemePct: 12, cdPct: 13 } };
    const d = applyMapping(t, m);
    expect(d.skipped).toBe(2);
    expect(d.lines.map((l) => [l.code, l.batch, l.expiry, l.qty, l.free, l.scheme, l.ptr, l.cdPct])).toEqual([
      ["10021", "CR6612", "2027-12-31", 50, 5, "10+1", 3010, 2],
      ["10022", "ZV0091", "2027-06", 30, 0, "", 8000, 0],
    ]);
  });

  it("flags unreadable lines and reads Excel bills", () => {
    const t = readEbillTable("bill.xlsx", xlsx([["Product", "Batch", "Expiry", "Qty", "Rate", "MRP"], ["Pan 40", "", "13/2028", 5, 110, 155], ["Pan 40", "P1", "08/28", 2.5, 110, 155]]));
    const d = applyMapping(t, autoMapping(t)!);
    expect(d.lines[0].problems).toEqual(["Batch missing", "Expiry not readable"]);
    expect(d.lines[1].problems).toEqual(["Quantity isn’t a whole number"]);
  });

  it("re-anchors a saved mapping by header names when columns move", () => {
    const saved: EbillMapping = { headerRow: 0, cols: { name: 0, batch: 1, expiry: 2, qty: 3, ptr: 4 }, names: { name: "Item", batch: "Batch", expiry: "Exp", qty: "Qty", ptr: "Rate" } };
    const t = [["Note"], ["Batch", "Item", "Rate", "Exp", "Qty"], ["B1", "Dolo", "24", "11/28", "10"]];
    const m = resolveMapping(t, saved);
    expect(m.headerRow).toBe(1);
    expect(applyMapping(t, m).lines[0]).toMatchObject({ name: "Dolo", batch: "B1", ptr: 2400, qty: 10 });
  });

  it("parses bill dates and scores names", () => {
    expect(parseBillDate("05/10/2026")).toBe("2026-10-05");
    expect(parseBillDate("5-Oct-26")).toBe("2026-10-05");
    expect(parseBillDate("2026-10-05")).toBe("2026-10-05");
    expect(parseBillDate("Oct 2026")).toBe("");
    expect(nameKey("DOLO 650 TAB", "15'S")).toBe("N:dolo 650 tab 15 s");
    expect(nameScore("DOLO 650 TAB", "15'S", "Dolo 650 650 mg", "15")).toBeGreaterThan(0.6);
    expect(nameScore("PAN 40 TAB", "", "Dolo 650 650 mg", "15")).toBe(0);
  });
});
