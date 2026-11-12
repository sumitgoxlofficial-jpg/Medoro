import { describe, expect, it } from "vitest";
import { DRIVE_TAB, NAV, READY, driveNav } from "./nav";
import { HIDDEN_TABS, TABS } from "@/components/device/tabs";

describe("the Accounts tab is hidden from every menu", () => {
  it("is not in the side menu, for either kind of pharmacy", () => {
    const acc = NAV.find((n) => n.id === "acc")!;
    expect(acc.href).toBe("/app/accounts"); // the page itself is untouched
    expect(READY.has("acc")).toBe(false); // so no menu lists it
    expect(NAV.filter((n) => READY.has(n.id)).map((n) => n.id)).not.toContain("acc");
    expect(DRIVE_TAB.acc).toBeUndefined();
    expect(driveNav(acc)).toBeNull();
  });
  it("is left out of the counter tab bar but still opens by address", () => {
    expect(HIDDEN_TABS).toContain("accounts");
    expect(TABS.map(([k]) => k)).toContain("accounts"); // ?tab=accounts keeps working
    expect(TABS.filter(([k]) => !HIDDEN_TABS.includes(k)).map(([, n]) => n)).not.toContain("Accounts");
  });
});
