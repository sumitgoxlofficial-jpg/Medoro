import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { clean, invoicePdf, pageRows } from "./pdf";
import type { Invoice } from "./service";

describe("pageRows", () => {
  it("keeps everything on one page when rows and totals fit", () => {
    expect(pageRows(0, 40, 50, 10)).toEqual([0]);
    expect(pageRows(30, 40, 50, 10)).toEqual([30]);
  });
  it("moves the totals to a new page when the last rows fill the page", () => {
    expect(pageRows(35, 40, 50, 10)).toEqual([35, 0]);
    expect(pageRows(40, 40, 50, 10)).toEqual([40, 0]);
  });
  it("splits long bills and covers every row once", () => {
    const p = pageRows(130, 40, 50, 10);
    expect(p).toEqual([40, 50, 40]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(130);
  });
});

describe("clean", () => {
  it("keeps ASCII, maps common punctuation, and uses the placeholder when nothing readable is left", () => {
    expect(clean("Dolo 650")).toBe("Dolo 650");
    expect(clean("Ramesh’s ₹ 10 – ok")).toBe("Ramesh's Rs. 10 - ok");
    expect(clean("Dolo 650 डोलो")).toBe("Dolo 650");
    expect(clean("रमेश कुमार", "Customer")).toBe("Customer");
  });
});

const inv = (n: number): Invoice => ({
  id: "s1", invoiceNo: "INV/MAI/2627/000001", at: new Date().toISOString(), payMode: "cash", prescriber: null, rxNo: null, cashier: "A",
  pharmacy: { name: "Test", legalName: null, gstin: null, address: "Pune", dl: null, phone: null, pharmacist: "" },
  customer: { name: "रमेश", phone: null, optIn: false },
  lines: Array.from({ length: n }, (_, i) => ({ name: `Item ${i}`, pack: "10", hsn: "3004", schedule: null, batchNo: "B1", expiry: "2027-01-01", qty: 1, mrp: 100, amount: 100, discount: 0, taxable: 89, gstRate: 12 })),
  totals: { mrp: n * 100, discount: 0, taxable: n * 89, cgst: 0, sgst: 0, roundOff: 0, total: n * 100 },
  payments: [{ mode: "cash", amount: n * 100, ref: null }], idempotencyKey: "k",
} as unknown as Invoice);

describe("invoicePdf", () => {
  it("adds pages for long bills", async () => {
    expect((await PDFDocument.load(await invoicePdf(inv(3)))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await invoicePdf(inv(120)))).getPageCount()).toBeGreaterThanOrEqual(3);
  });
});
