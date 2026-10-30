import type { GstDoc, GstLine } from "../common";

// A month of documents for one GSTIN (Maharashtra) covering every GSTR-1 table Medoro fills.
export const SELLER = "27AAPFU0939F1ZV";
const l = (rate: number, qty: number, taxable: number, tax: { igst?: number; cgst?: number; sgst?: number }, hsn = "3004"): GstLine =>
  ({ hsn, desc: "", uqc: "PAC", qty, rate, taxable, igst: tax.igst ?? 0, cgst: tax.cgst ?? 0, sgst: tax.sgst ?? 0 });
const inv = (no: string, date: string, value: number, pos: string, ctin: string | null, inter: boolean, lines: GstLine[]): GstDoc => ({ kind: "inv", no, date, value, pos, ctin, inter, branchId: "b1", lines });

export const A01 = inv("A/01", "2026-10-03", 133000, "27", "27AABCS1429B1ZU", false, [l(12, 10, 100000, { cgst: 6000, sgst: 6000 }), l(5, 2, 20000, { cgst: 500, sgst: 500 })]);
export const A02 = inv("A/02", "2026-10-05", 56000, "29", "29AAGCB7383J1Z4", true, [l(12, 5, 50000, { igst: 6000 })]);
export const A03 = inv("A/03", "2026-10-06", 15000, "27", null, false, [l(12, 1, 8929, { cgst: 535, sgst: 536 }), l(0, 1, 5000, {})]);
export const A04 = inv("A/04", "2026-10-07", 11200000, "33", null, true, [l(12, 40, 10000000, { igst: 1200000 })]);
export const A05 = inv("A/05", "2026-10-08", 11200, "24", null, true, [l(12, 1, 10000, { igst: 1200 })]);
export const A07 = inv("A/07", "2026-10-10", 22400, "27", null, false, [l(12, 2, 20000, { cgst: 1200, sgst: 1200 })]);

const cn = (no: string, date: string, value: number, of: GstDoc, lines: GstLine[]): GstDoc =>
  ({ kind: "cn", no, date, value, pos: of.pos, ctin: of.ctin, inter: of.inter, branchId: "b1", lines, orig: { no: of.no, date: of.date, value: of.value, inter: of.inter, ctin: of.ctin } });

export const CN1 = cn("CN-2627-0001", "2026-10-12", 11200, A01, [l(12, 1, 10000, { cgst: 600, sgst: 600 })]);
export const CN2 = cn("CN-2627-0002", "2026-10-13", 1120000, A04, [l(12, 4, 1000000, { igst: 120000 })]);
export const CN3 = cn("CN-2627-0003", "2026-10-14", 11200, A07, [l(12, 1, 10000, { cgst: 600, sgst: 600 })]);

export const DOCS = [A01, A02, A03, A04, A05, A07, CN1, CN2, CN3];
