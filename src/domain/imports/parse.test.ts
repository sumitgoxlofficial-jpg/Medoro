import { describe, expect, it } from "vitest";
import { xlsx } from "../../../tests/xlsx";
import { colIndex, headerKey, parseCsv, parseExpiry, parseXlsx, readTable } from "./parse";

describe("import parsing", () => {
  it("reads CSV with quotes, BOM, CRLF and semicolons", () => {
    expect(parseCsv('﻿Name,Pack\r\n"Dolo, 650","15"\r\n"Say ""hi""",\r\n\r\n')).toEqual([["Name", "Pack"], ["Dolo, 650", "15"], ['Say "hi"', ""]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads the first sheet of an .xlsx, with gaps and shared strings", () => {
    const t = parseXlsx(xlsx([["Brand name", "MRP"], ["Pan 40 & co", 155], ["", ""], ["Dolo 650", 33.6]]));
    expect(t).toEqual([["Brand name", "MRP"], ["Pan 40 & co", "155"], ["Dolo 650", "33.6"]]);
    expect(colIndex("AA12")).toBe(26);
    expect(() => readTable("old.xls", new Uint8Array())).toThrow(/xlsx/);
    expect(() => parseXlsx(new Uint8Array([1, 2, 3]))).toThrow(/Excel/);
  });

  it("normalises headers and expiry formats", () => {
    expect(headerKey("GST Rate (%)")).toBe("gstrate");
    expect(parseExpiry("11/2027")).toBe("2027-11");
    expect(parseExpiry("11/27")).toBe("2027-11");
    expect(parseExpiry("2027-03")).toBe("2027-03");
    expect(parseExpiry("15/03/2027")).toBe("2027-03-15");
    expect(parseExpiry("Nov-27")).toBe("2027-11");
    expect(parseExpiry("46327")).toBe("2026-11-01"); // Excel serial
    expect(parseExpiry("13/2027")).toBeNull();
    expect(parseExpiry("soon")).toBeNull();
  });
});
