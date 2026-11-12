import { describe, expect, it } from "vitest";
import { ALL_FEATURES, PLAN_RULES, entitlements, hasFeature, limitMessage, planFor, planIdOf, upgradeMessage } from "./plans";

describe("plans", () => {
  it("reads plan names and ids", () => {
    expect([planIdOf("Starter"), planIdOf("Professional"), planIdOf("pro"), planIdOf("Multi-branch"), planIdOf("multi"), planIdOf(""), planIdOf(null), planIdOf("Enterprise")]).toEqual(["starter", "pro", "pro", "multi", "multi", null, null, null]);
  });
  it("matches the pricing table", () => {
    expect(PLAN_RULES.starter.features).toEqual([]);
    expect(PLAN_RULES.starter.limits).toEqual({ branches: 1, counters: 2, users: 3 });
    expect(PLAN_RULES.pro.limits).toEqual({ branches: 1, counters: 5, users: 10 });
    expect(PLAN_RULES.multi.limits).toEqual({ branches: 5, counters: 15, users: 25 });
    expect(PLAN_RULES.pro.features).toEqual(["accounts", "credit", "scanner", "roles", "offline"]);
    expect(PLAN_RULES.multi.features).toEqual(expect.arrayContaining([...PLAN_RULES.pro.features, "transfers", "central", "consolidated", "anomaly"]));
    expect(planFor("accounts")).toBe("pro");
    expect(planFor("transfers")).toBe("multi");
  });
  it("opens everything for the free trial, an unlicensed copy and a not-yet-licensed install", () => {
    for (const e of [entitlements({ plan: "Starter", status: "trial", unlicensed: false }), entitlements({ plan: "Starter", status: "active", unlicensed: true }), entitlements({ plan: null, status: "active", unlicensed: false })]) {
      expect(ALL_FEATURES.every((f) => hasFeature(e, f))).toBe(true);
      expect(e.limits.branches).toBe(Infinity);
    }
    expect(entitlements({ plan: "Starter", status: "trial", unlicensed: false }).open).toBe("trial");
  });
  it("limits a paid plan to what it includes", () => {
    const s = entitlements({ plan: "Starter", status: "active", unlicensed: false });
    expect(ALL_FEATURES.some((f) => hasFeature(s, f))).toBe(false);
    expect(s.limits).toEqual({ branches: 1, counters: 2, users: 3 });
    const p = entitlements({ plan: "Professional", status: "active", unlicensed: false });
    expect(hasFeature(p, "accounts") && hasFeature(p, "offline")).toBe(true);
    expect(hasFeature(p, "transfers")).toBe(false);
    expect(entitlements({ plan: "Multi-branch", status: "grace", unlicensed: false }).features).toContain("anomaly");
    // A cancelled plan keeps its plan's features until it ends.
    expect(hasFeature(entitlements({ plan: "Professional", status: "cancelled", unlicensed: false }), "credit")).toBe(true);
  });
  it("extra branches raise only the Multi-branch limit", () => {
    expect(entitlements({ plan: "Multi-branch", status: "active", unlicensed: false, addons: ["branch", "branch", "ai"] }).limits.branches).toBe(7);
    expect(entitlements({ plan: "Professional", status: "active", unlicensed: false, addons: ["branch"] }).limits.branches).toBe(1);
  });
  it("explains what to upgrade to", () => {
    const s = entitlements({ plan: "Starter", status: "active", unlicensed: false });
    expect(upgradeMessage(s, "accounts")).toMatch(/not part of your Starter plan\. Upgrade to Professional/);
    expect(upgradeMessage(s, "transfers")).toMatch(/Upgrade to Multi-branch/);
    expect(limitMessage(s, "users", 3)).toBe("Your Starter plan allows 3 users. Upgrade under Subscription to add more.");
  });
});
