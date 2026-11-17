import { describe, expect, it } from "vitest";
import { daysLeft, dueReminder, missingRequired, normalizeRemindDays, statusOf, type ItemLite } from "./compliance-rules";

const T = "2026-11-17";
const add = (n: number) => new Date(Date.parse(T) + n * 86400_000).toISOString().slice(0, 10);

describe("compliance rules", () => {
  it("status follows the item's own reminder window", () => {
    expect(statusOf(null, T, [60, 30, 7])).toBe("no_expiry");
    expect(statusOf(add(200), T, [60, 30, 7])).toBe("valid");
    expect(statusOf(add(45), T, [60, 30, 7])).toBe("expiring");
    expect(statusOf(add(0), T, [60, 30, 7])).toBe("expiring");   // expires today: still valid today
    expect(statusOf(add(-1), T, [60, 30, 7])).toBe("expired");
    expect(statusOf(add(45), T, [30, 7])).toBe("valid");          // a narrower window
    expect(daysLeft(add(10), T)).toBe(10);
  });
  it("sends one reminder at the tightest crossed threshold, and never repeats it", () => {
    expect(dueReminder(add(100), T, [60, 30, 7], [])).toBeNull();
    expect(dueReminder(add(59), T, [60, 30, 7], [])).toBe(60);
    expect(dueReminder(add(59), T, [60, 30, 7], [60])).toBeNull();
    expect(dueReminder(add(29), T, [60, 30, 7], [60])).toBe(30);
    expect(dueReminder(add(6), T, [60, 30, 7], [60, 30])).toBe(7);
    expect(dueReminder(add(6), T, [60, 30, 7], [60, 30, 7])).toBeNull();
    expect(dueReminder(add(20), T, [60, 30, 7], [])).toBe(30);   // entered late: one reminder, not three
    expect(dueReminder(add(20), T, [60, 30, 7], [30])).toBeNull();
  });
  it("an expired item is reminded once as expired", () => {
    expect(dueReminder(add(-3), T, [60, 30, 7], [60, 30, 7])).toBe(0);
    expect(dueReminder(add(-3), T, [60, 30, 7], [0])).toBeNull();
    expect(dueReminder(null, T, [60], [])).toBeNull();
  });
  it("finds missing required items per branch and pharmacy, and an expired item does not count", () => {
    const items: ItemLite[] = [
      { id: "1", branchId: "A", kind: "retail_licence", active: true, status: "valid" },
      { id: "2", branchId: "B", kind: "retail_licence", active: true, status: "expired" },
      { id: "3", branchId: null, kind: "gst_registration", active: true, status: "no_expiry" },
      { id: "4", branchId: "A", kind: "pharmacist_registration", active: false, status: "valid" },
    ];
    const req = [{ kind: "retail_licence", scope: "branch" as const }, { kind: "pharmacist_registration", scope: "branch" as const }, { kind: "gst_registration", scope: "pharmacy" as const }];
    expect(missingRequired("A", items, req)).toEqual(["pharmacist_registration"]);   // the pharmacist item is switched off
    expect(missingRequired("B", items, req)).toEqual(["retail_licence", "pharmacist_registration"]);
    expect(missingRequired("A", items, [])).toEqual([]);
  });
  it("normalises reminder days: unique, positive, descending, with a default", () => {
    expect(normalizeRemindDays([7, 30, 30, 0, -4, 400, 60.4])).toEqual([60, 30, 7]);
    expect(normalizeRemindDays([])).toEqual([60, 30, 7]);
    expect(normalizeRemindDays(undefined)).toEqual([60, 30, 7]);
  });
});
