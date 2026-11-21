import { describe, expect, it } from "vitest";
import { DIST_TABS, distTabsFor } from "./tabs";

describe("distribution device screens by role", () => {
  it("an owner with every permission sees them all", () => {
    expect(distTabsFor(["bill", "order", "approve", "warehouse", "dispatch", "delivery", "payments", "reports", "masters", "portal", "purchase", "adjust", "users"])).toEqual(DIST_TABS.map(([k]) => k));
  });
  it("a delivery boy sees dispatch and this device's lock, nothing else", () => {
    expect(distTabsFor(["delivery"])).toEqual(["dispatch", "settings"]);
  });
  it("a picker sees orders and stock, not money", () => {
    expect(distTabsFor(["warehouse"])).toEqual(["dorders", "stock", "settings"]);
  });
});
