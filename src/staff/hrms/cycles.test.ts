import { describe, expect, it } from "vitest";
import { addMonthsYm, cycleDayOf, cycleWindow, daysIn, firstSalary, payOnWorkingDay } from "./cycles";

describe("pay cycles", () => {
  it("joined 13 Nov: the first cycle is 13 Nov to 12 Dec, paid on 13 Dec, then every 13th", () => {
    expect(firstSalary("2026-11-13")).toEqual({ ym: "2026-12", from: "2026-11-13", to: "2026-12-12", payDate: "2026-12-13" });
    expect(cycleWindow(13, "2027-01")).toEqual({ from: "2026-12-13", to: "2027-01-12", payDate: "2027-01-13" });
    expect(cycleDayOf("2026-11-13")).toBe(13);
  });
  it("a day the month doesn't have becomes the month's last day, and cycles never overlap or leave a gap", () => {
    expect(daysIn("2027-02")).toBe(28);
    expect(cycleWindow(31, "2026-11")).toEqual({ from: "2026-10-31", to: "2026-11-29", payDate: "2026-11-30" });
    expect(cycleWindow(31, "2026-12")).toEqual({ from: "2026-11-30", to: "2026-12-30", payDate: "2026-12-31" });
    expect(cycleWindow(31, "2027-03")).toEqual({ from: "2027-02-28", to: "2027-03-30", payDate: "2027-03-31" });
    for (const anchor of [1, 13, 28, 29, 30, 31]) {
      let ym = "2026-01";
      for (let i = 0; i < 14; i++) {
        const next = cycleWindow(anchor, addMonthsYm(ym, 1));
        const w = cycleWindow(anchor, ym);
        expect(next.from).toBe(w.payDate); // the next cycle starts on the day this one is paid
        expect(w.to < w.payDate && w.from <= w.to).toBe(true);
        ym = addMonthsYm(ym, 1);
      }
    }
  });
  it("calendar-month people keep the whole month, due on its last day", () => {
    expect(cycleWindow(0, "2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30", payDate: "2026-11-30" });
    expect(cycleWindow(0, "2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29", payDate: "2028-02-29" });
  });
  it("joining on the 1st is paid on the 1st of the next month, for the month just worked", () => {
    expect(firstSalary("2026-11-01")).toEqual({ ym: "2026-12", from: "2026-11-01", to: "2026-11-30", payDate: "2026-12-01" });
  });

  it("a pay date on a day off moves back to the working day before it", () => {
    const off = (d: string) => ["2026-12-12", "2026-12-13"].includes(d); // a weekend
    expect(payOnWorkingDay("2026-12-13", off)).toBe("2026-12-11");
    expect(payOnWorkingDay("2026-12-14", off)).toBe("2026-12-14");
    expect(payOnWorkingDay("2026-12-13", (d) => d === "2026-12-13" || d === "2026-12-12" || d === "2026-12-11")).toBe("2026-12-10");
  });
});
