import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validGstin } from "@/domain/accounting/gst";
import { allocateHalves, saleTaxSplit } from "./tax";
import { hsnCsv, hsnRows, hsnSplitFrom, uqcFor } from "./common";
import { buildGstr1, docIssue, gstr1Csv, gstr1Summary } from "./gstr1";
import { buildGstr3b, gstr3bRows } from "./gstr3b";
import { A01, A04, DOCS, SELLER } from "./fixtures/docs";

const golden = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", f), "utf8"));

describe("GSTIN and tax split", () => {
  it("checks the GSTN check character and the state code", () => {
    expect(validGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(validGstin("29AAGCB7383J1Z4")).toBe(true);
    expect(validGstin("27AAPFU0939F1ZX")).toBe(false);
    expect(validGstin("99AAPFU0939F1ZV")).toBe(false);
    expect(validGstin("27AAPFU0939F1Z")).toBe(false);
  });

  it("books IGST when the buyer's state differs from the seller's, CGST+SGST otherwise", () => {
    expect(saleTaxSplit(SELLER, { gstin: "29AAGCB7383J1Z4" }, 1201)).toEqual({ pos: "29", inter: true, igst: 1201, cgst: 0, sgst: 0, gstin: "29AAGCB7383J1Z4" });
    expect(saleTaxSplit(SELLER, { gstin: "27AABCS1429B1ZU" }, 1201)).toMatchObject({ pos: "27", inter: false, igst: 0, cgst: 600, sgst: 601 });
    expect(saleTaxSplit(SELLER, { stateCode: "24" }, 100)).toMatchObject({ pos: "24", inter: true, gstin: null });
    expect(saleTaxSplit(SELLER, null, 100)).toMatchObject({ pos: "27", inter: false, cgst: 50 });
    expect(saleTaxSplit(null, { gstin: "29AAGCB7383J1Z4" }, 100)).toMatchObject({ inter: false });
  });

  it("splits line taxes so the CGST halves add up to the booked document CGST", () => {
    const taxes = [1071, 1071, 1071];
    const h = allocateHalves(taxes, Math.floor(3213 / 2));
    expect(h.reduce((a, x) => a + x, 0)).toBe(1606);
    h.forEach((x, i) => expect(Math.abs(taxes[i] - 2 * x)).toBeLessThanOrEqual(1));
    expect(allocateHalves([0, 5], 2)).toEqual([0, 2]);
  });

  it("picks a unit quantity code from the dosage form", () => {
    expect(uqcFor("Tablet")).toBe("PAC");
    expect(uqcFor("Syrup")).toBe("BTL");
    expect(uqcFor("Ointment")).toBe("TUB");
    expect(uqcFor("Injection")).toBe("NOS");
  });
});

describe("GSTR-1", () => {
  const g = buildGstr1({ gstin: SELLER, fp: "102026", docs: DOCS });

  it("matches the golden offline-tool JSON", () => {
    expect(JSON.parse(JSON.stringify(g))).toEqual(golden("gstr1.json"));
  });

  it("puts each document in the right table", () => {
    expect(g.b2b!.map((b) => b.ctin)).toEqual(["27AABCS1429B1ZU", "29AAGCB7383J1Z4"]);
    expect(g.b2b![1].inv[0].itms[0].itm_det).toEqual({ txval: 500, rt: 12, iamt: 60, csamt: 0 });
    expect(g.b2cl).toEqual([{ pos: "33", inv: [expect.objectContaining({ inum: "A/04", val: 112000 })] }]);
    // B2CS nets the credit note against A/07; 0% lines go to the nil table only.
    expect(g.b2cs!.find((r) => r.sply_ty === "INTRA")).toEqual({ sply_ty: "INTRA", rt: 12, typ: "OE", pos: "27", txval: 189.29, camt: 11.35, samt: 11.36, csamt: 0 });
    expect(g.nil!.inv).toEqual([{ sply_ty: "INTRAB2C", expt_amt: 0, nil_amt: 50, ngsup_amt: 0 }]);
    expect(g.cdnr![0].nt[0]).toMatchObject({ ntty: "C", nt_num: "CN-2627-0001", nt_dt: "12-10-2026", val: 112, inv_typ: "R" });
    expect(g.cdnur).toEqual([expect.objectContaining({ typ: "B2CL", nt_num: "CN-2627-0002", pos: "33" })]);
  });

  it("uses a configurable B2CL threshold", () => {
    const low = buildGstr1({ gstin: SELLER, fp: "102026", docs: DOCS, threshold: 10000 });
    expect(low.b2cl!.flatMap((b) => b.inv.map((i) => i.inum))).toEqual(["A/05", "A/04"]);
    expect(low.b2cl!.map((b) => b.pos)).toEqual(["24", "33"]);
    expect(low.b2cs!.some((r) => r.sply_ty === "INTER")).toBe(false);
  });

  it("reports HSN in one list before May 2025 and split by B2B/B2C after", () => {
    expect(hsnSplitFrom("042025")).toBe(false);
    expect(hsnSplitFrom("052025")).toBe(true);
    const old = buildGstr1({ gstin: SELLER, fp: "042025", docs: [A01] });
    expect(Object.keys(old.hsn!)).toEqual(["data"]);
    expect(old.hsn!.data!.map((r) => r.rt)).toEqual([5, 12]);
  });

  it("counts gaps and withdrawn numbers in an invoice series as cancelled", () => {
    expect(docIssue([A01, A04], ["A/03"])!.doc_det[0].docs[0]).toEqual({ num: 1, from: "A/01", to: "A/04", totnum: 4, cancel: 2, net_issue: 2 });
  });

  it("summarises the JSON for the screen and the CSV", () => {
    const s = gstr1Summary(g);
    expect(s.sections.map((x) => [x.section, x.count])).toEqual([["B2B (4A)", 2], ["B2CL (5)", 1], ["B2CS (7)", 2], ["Nil rated (8)", 1], ["CDNR (9B)", 1], ["CDNUR (9B)", 1]]);
    expect(s.sections[0]).toMatchObject({ taxable: 1700, igst: 60, cgst: 65, sgst: 65 });
    expect(s.hsnRows).toBe(4);
    const csv = gstr1Csv(g);
    expect(csv.some((r) => r[0] === "B2B (4A)" && r[2] === "A/01" && r[4] === "1330.00")).toBe(true);
  });
});

describe("GSTR-3B", () => {
  const itc = { igst: 50000, cgst: 120000, sgst: 120000, revIgst: 0, revCgst: 1500, revSgst: 1500 };
  const g = buildGstr3b({ gstin: SELLER, fp: "102026", docs: DOCS, itc });

  it("matches the golden JSON", () => {
    expect(JSON.parse(JSON.stringify(g))).toEqual(golden("gstr3b.json"));
  });

  it("nets credit notes, separates nil-rated and lists inter-state B2C by state", () => {
    expect(g.sup_details.osup_det).toEqual({ txval: 91889.29, iamt: 10872, camt: 70.35, samt: 70.36, csamt: 0 });
    expect(g.sup_details.osup_nil_exmp.txval).toBe(50);
    expect(g.inter_sup.unreg_details).toEqual([{ pos: "24", txval: 100, iamt: 12 }, { pos: "33", txval: 90000, iamt: 10800 }]);
    expect(g.itc_elg.itc_net).toEqual({ iamt: 500, camt: 1185, samt: 1185, csamt: 0 });
    const rows = gstr3bRows(g);
    expect(rows.find((r) => r[0] === "4(A)(5)")).toEqual(["4(A)(5)", "All other ITC", "", "500.00", "1200.00", "1200.00", "0.00"]);
  });
});

describe("HSN summary", () => {
  it("nets credit notes and totals the CSV", () => {
    const rows = hsnRows([A04, { ...A04, kind: "cn", no: "CN1", value: 11200, lines: [{ ...A04.lines[0], qty: 4, taxable: 1000000, igst: 120000 }], orig: { no: "A/04", date: A04.date, value: A04.value, inter: true, ctin: null } }]);
    expect(rows).toEqual([{ b2b: false, hsn: "3004", desc: "MEDICAMENTS IN MEASURED DOSES", uqc: "PAC", rate: 12, qty: 36, taxable: 9000000, igst: 1080000, cgst: 0, sgst: 0 }]);
    const csv = hsnCsv(rows);
    expect(csv[0][0]).toBe("Supply type");
    expect(csv[csv.length - 1]).toEqual(["Total", "", "", "", "", "", "100800.00", "90000.00", "10800.00", "0.00", "0.00", "0.00"]);
  });
});
