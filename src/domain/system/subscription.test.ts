import { describe, expect, it } from "vitest";
import { subscriptionAccess, subscriptionBanner } from "./subscription";

const now = new Date("2026-11-10T06:30:00Z"); // 12:00 IST
const d = (iso: string) => new Date(iso + "T00:00:00Z");
const base = { status: "trial", endsAt: d("2026-11-12"), graceDays: 7, signed: true, serverConfigured: true };

describe("subscriptionAccess", () => {
  it("self-hosted without a licence server or signed licence is never limited", () => {
    const a = subscriptionAccess({ ...base, endsAt: d("2020-01-01"), signed: false, serverConfigured: false }, now);
    expect(a).toMatchObject({ phase: "unlicensed", readOnly: false });
    expect(subscriptionBanner(a)).toBeNull();
  });

  it("a local trial counts when the licence server is configured but unreachable", () => {
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-01"), signed: false }, now)).toMatchObject({ phase: "expired", readOnly: true });
  });

  it("trial → grace → read-only, by IST calendar day", () => {
    expect(subscriptionAccess(base, now)).toMatchObject({ phase: "trial", daysLeft: 2, readOnly: false, graceEndsOn: "2026-11-19" });
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-10") }, now)).toMatchObject({ phase: "trial", daysLeft: 0 });
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-09") }, now)).toMatchObject({ phase: "grace", daysLeft: 6, readOnly: false });
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-03") }, now)).toMatchObject({ phase: "grace", daysLeft: 0 });
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-02") }, now)).toMatchObject({ phase: "expired", readOnly: true });
    // 22:30 IST on 9 Nov is the last trial day; 01:00 IST on 10 Nov (still the 9th in UTC) is grace.
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-09") }, new Date("2026-11-09T17:00:00Z"))).toMatchObject({ phase: "trial", daysLeft: 0 });
    expect(subscriptionAccess({ ...base, endsAt: d("2026-11-09") }, new Date("2026-11-09T19:30:00Z"))).toMatchObject({ phase: "grace", daysLeft: 6 });
  });

  it("paid plans use the issued grace days; cancelled plans stop at the paid date", () => {
    const paid = { ...base, status: "active", endsAt: d("2026-11-08"), graceDays: 3 };
    expect(subscriptionAccess(paid, now)).toMatchObject({ phase: "grace", daysLeft: 1 });
    expect(subscriptionAccess({ ...paid, graceDays: 1 }, now)).toMatchObject({ phase: "expired", readOnly: true });
    expect(subscriptionAccess({ ...paid, status: "cancelled", endsAt: d("2026-11-20") }, now)).toMatchObject({ phase: "active", cancelled: true, readOnly: false, graceEndsOn: null });
    expect(subscriptionAccess({ ...paid, status: "cancelled", endsAt: d("2026-11-09") }, now)).toMatchObject({ phase: "expired", readOnly: true });
    expect(subscriptionAccess({ ...paid, endsAt: null }, now)).toMatchObject({ phase: "active", readOnly: false });
  });

  it("banners", () => {
    expect(subscriptionBanner(subscriptionAccess(base, now))?.text).toMatch(/trial ends in 2 days/);
    expect(subscriptionBanner(subscriptionAccess({ ...base, endsAt: d("2026-11-30") }, now))).toBeNull();
    expect(subscriptionBanner(subscriptionAccess({ ...base, endsAt: d("2026-11-09") }, now))).toMatchObject({ tone: "amber" });
    expect(subscriptionBanner(subscriptionAccess({ ...base, endsAt: d("2026-10-01") }, now))).toMatchObject({ tone: "red", text: expect.stringMatching(/^Subscription expired — renew/) });
  });
});
