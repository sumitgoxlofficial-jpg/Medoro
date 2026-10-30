import { describe, expect, it } from "vitest";
import { GST_DOC_RE, gstDocNo, invoiceNo } from "./docno";

describe("GST document numbers", () => {
  it("fit 16 characters for any valid branch series up to the 999999th document", () => {
    expect(invoiceNo("MAI", "2627", 1)).toBe("MAI2627-000001");
    const longest = invoiceNo("AB999", "2627", 999999);
    expect(longest).toBe("AB9992627-999999");
    expect(longest).toMatch(GST_DOC_RE);
    expect(gstDocNo("CN-", "2627", 12, 4)).toBe("CN-2627-0012");
  });

  it("refuse series that could overflow or break the GST character rules", () => {
    expect(() => invoiceNo("ABCDEF", "2627", 1)).toThrow(/Branch code/);
    expect(() => invoiceNo("TMS/MAI", "2627", 1)).toThrow(/Branch code/);
    expect(() => invoiceNo("1AB", "2627", 1)).toThrow(/Branch code/);
    expect(() => gstDocNo("ABCDE", "2627", 1_000_000)).toThrow(/16 characters/);
  });
});
