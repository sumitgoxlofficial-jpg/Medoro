import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readEbillTable } from "@/domain/purchasing/ebill";
import { bankAmount, bankAutoMapping, bankRows } from "./bank";

describe("bank statement parsing", () => {
  it("finds the header under the account line and signs withdrawals negative", () => {
    const t = readEbillTable("statement.csv", new Uint8Array(readFileSync(path.join(__dirname, "../../../tests/fixtures/bank/statement.csv"))));
    const m = bankAutoMapping(t)!;
    expect(m.headerRow).toBe(1);
    expect(m.cols).toMatchObject({ date: 0, description: 2, ref: 3, debit: 4, credit: 5, balance: 6 });
    const { rows } = bankRows(t, m);
    expect(rows.map((r) => [r.date, r.amount, r.ref, r.balance])).toEqual([
      ["2026-11-02", 500000, "123456", 5500000], ["2026-11-03", -200000, "UTR8812345678", 5300000], ["2026-11-04", -35000, "654321", 5265000],
    ]);
  });

  it("reads Dr/Cr suffixes and bracketed amounts", () => {
    expect(bankAmount("1,234.50 Cr")).toBe(123450);
    expect(bankAmount("1,234.50 Dr")).toBe(-123450);
    expect(bankAmount("(500.00)")).toBe(-50000);
    expect(bankAmount("")).toBeNull();
  });
});
