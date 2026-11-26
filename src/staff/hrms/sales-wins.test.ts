import { describe, expect, it } from "vitest";
import { DEMO_MILESTONES, SALE_MILESTONES, crossed, demoBody, istDayStart, istWeekStart, milestoneBody, ordinal, rankBoard, saleBody } from "./sales-wins";

describe("Sales wins", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
  it("adds the rep's real streak to a sale", () => {
    expect(saleBody("Professional", { today: 1, week: 1, total: 1 })).toBe("Just closed a sale 🎉 Medoro Professional\n🥳 First sale ever! Welcome to the board.");
    expect(saleBody("", { today: 1, week: 1, total: 9 })).toBe("Just closed a sale 🎉");
    expect(saleBody("Starter", { today: 2, week: 2, total: 9 })).toBe("Just closed a sale 🎉 Medoro Starter\n2nd sale today");
    expect(saleBody("Starter", { today: 3, week: 7, total: 30 })).toBe("Just closed a sale 🎉 Medoro Starter\n3rd sale today 🔥 · 7 this week");
    expect(saleBody("Starter", { today: 1, week: 4, total: 30 })).toBe("Just closed a sale 🎉 Medoro Starter\n4 this week");
  });
  it("counts demos booked today", () => {
    expect(demoBody("a video demo", 1)).toBe("Just booked a video demo call 📅");
    expect(demoBody("", 3)).toBe("Just booked a demo call 📅\n3rd demo booked today");
  });
  it("finds the milestones a real total passes", () => {
    expect(crossed(SALE_MILESTONES, 0, 4)).toEqual([]);
    expect(crossed(SALE_MILESTONES, 4, 5)).toEqual([5]);
    expect(crossed(SALE_MILESTONES, 5, 5)).toEqual([]);
    expect(crossed(SALE_MILESTONES, 3, 16)).toEqual([5, 10, 15]);
    expect(crossed(DEMO_MILESTONES, 9, 10)).toEqual([10]);
    expect(milestoneBody("sale", 10)).toContain("10 sales closed today");
  });
  it("ranks by sales, then demos, then name, and leaves out people with nothing", () => {
    const row = (staffId: string, sales: number, demos: number) => ({ staffId, name: staffId, photo: null, sales, demos });
    const out = rankBoard([row("c", 1, 5), row("a", 2, 0), row("b", 1, 5), row("z", 0, 0), row("d", 0, 2), row("e", 0, 1), row("f", 0, 1)]);
    expect(out.map((r) => r.staffId)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("works out India day and week starts", () => {
    // 2026-11-26 is a Thursday. 02:00 IST on it is 20:30 UTC the day before.
    const t = new Date("2026-11-25T20:30:00Z");
    expect(istDayStart(t).toISOString()).toBe("2026-11-25T18:30:00.000Z");
    expect(istWeekStart(t).toISOString()).toBe("2026-11-22T18:30:00.000Z"); // Monday 23 Nov, 00:00 IST
    const mon = new Date("2026-11-22T18:30:00Z");
    expect(istWeekStart(mon).toISOString()).toBe("2026-11-22T18:30:00.000Z");
    const sun = new Date("2026-11-29T18:00:00Z"); // Sunday 23:30 IST
    expect(istWeekStart(sun).toISOString()).toBe("2026-11-22T18:30:00.000Z");
  });
});
