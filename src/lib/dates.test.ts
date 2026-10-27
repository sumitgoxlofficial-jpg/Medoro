import { describe, expect, it } from "vitest";
import { addDays, daysTo, fiscalYear, monthYear, todayISO } from "./dates";

describe("dates", () => {
  it("uses India time for today", () => {
    expect(todayISO(new Date("2026-10-26T19:00:00Z"))).toBe("2026-10-27");
    expect(todayISO(new Date("2026-10-26T18:00:00Z"))).toBe("2026-10-26");
  });
  it("counts days and fiscal years", () => {
    expect(daysTo("2026-11-26", "2026-10-27")).toBe(30);
    expect(daysTo(new Date("2026-10-20T00:00:00Z"), "2026-10-27")).toBe(-7);
    expect(addDays("2026-10-27", 5)).toBe("2026-11-01");
    expect(fiscalYear("2026-10-27")).toBe("2627");
    expect(fiscalYear("2027-03-31")).toBe("2627");
    expect(fiscalYear("2027-04-01")).toBe("2728");
    expect(monthYear("2026-11-20")).toBe("Nov 2026");
  });
});
