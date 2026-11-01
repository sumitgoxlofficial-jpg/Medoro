import { describe, expect, it } from "vitest";
import { xlsxBytes } from "./xlsx";
import { parseXlsx } from "@/domain/imports/parse";

describe("xlsx writer", () => {
  it("writes a workbook Medoro's own reader (and Excel) can open; formulas stay text", () => {
    const bytes = xlsxBytes([{ name: "Credits/Day", rows: [["Date", "Amount"], ["2026-11-01", 850.5], ["=1+1", null], ["<A & B>", 2]] }]);
    expect(parseXlsx(bytes)).toEqual([["Date", "Amount"], ["2026-11-01", "850.5"], ["=1+1"], ["<A & B>", "2"]]);
  });
});
