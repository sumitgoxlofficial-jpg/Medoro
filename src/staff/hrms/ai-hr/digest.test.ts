import { describe, expect, it } from "vitest";
import { digestFacts, digestWeek } from "./digest";

describe("weekly summary", () => {
  it("names a week by its Monday in India time", () => {
    expect(digestWeek(new Date("2026-12-14T00:05:00+05:30"))).toBe("2026-12-14"); // Monday just after midnight IST (still Sunday in UTC)
    expect(digestWeek(new Date("2026-12-13T23:55:00+05:30"))).toBe("2026-12-07"); // Sunday night
    expect(digestWeek(new Date("2026-12-17T12:00:00+05:30"))).toBe("2026-12-14");
    expect(digestWeek(new Date("2027-01-01T10:00:00+05:30"))).toBe("2026-12-28"); // across the year end
  });
  it("lists every count, and urgent items with the open total", () => {
    const f = digestFacts({ conversations: 12, completed: 9, noAnswer: 2, byReason: { late: 6, absent: 3, missing_checkout: 2, overtime: 1, manual: 0 }, coming: 5, absent: 2, otAccepted: 1, otRejected: 0, escalations: 1, stops: 0, actionsRaised: 7, openActions: 4, urgentOpen: 1, unclear: 3 });
    expect(Object.fromEntries(f)).toMatchObject({ Conversations: "12 (9 completed, 2 no answer)", "Waiting for HR now": "4 (1 urgent)", "Answers not understood": "3" });
  });
});
