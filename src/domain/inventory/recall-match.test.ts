import { describe, expect, it } from "vitest";
import { recallMatches, type BatchRef } from "./recall-match";

const b = (o: Partial<BatchRef> = {}): BatchRef => ({ medicineId: "m1", batchNo: "AB12", medicine: { manufacturer: "Micro Labs Ltd", name: "Dolo 650", generic: "Paracetamol" }, ...o });

describe("recall matching", () => {
  it("never matches a batch number that is not on the notice", () => {
    expect(recallMatches({ medicineId: "m1", batchNos: ["ZZ9"] }, b())).toBe(false);
  });
  it("a catalogue medicine notice needs that medicine and the batch number, case-insensitively", () => {
    expect(recallMatches({ medicineId: "m1", batchNos: ["ab12"] }, b())).toBe(true);
    expect(recallMatches({ medicineId: "m2", batchNos: ["AB12"] }, b())).toBe(false);   // same batch number on another medicine
  });
  it("a manufacturer notice needs manufacturer, product text and batch number", () => {
    const n = { medicineId: null, manufacturer: "micro labs", product: "dolo", batchNos: ["AB12"] };
    expect(recallMatches(n, b())).toBe(true);
    expect(recallMatches({ ...n, product: "paracetamol" }, b())).toBe(true);              // matches the generic too
    expect(recallMatches({ ...n, manufacturer: "Cipla" }, b())).toBe(false);
    expect(recallMatches({ ...n, product: "crocin" }, b())).toBe(false);
    expect(recallMatches({ ...n, product: "d" }, b())).toBe(false);                         // too short to be a product
    expect(recallMatches({ ...n, batchNos: ["OTHER"] }, b())).toBe(false);
  });
  it("an old notice with no medicine or manufacturer still matches by batch number", () => {
    expect(recallMatches({ medicineId: null, batchNos: [" ab12 "] }, b())).toBe(true);
  });
});
