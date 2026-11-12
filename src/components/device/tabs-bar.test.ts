import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the counter's tab row", () => {
  const src = readFileSync("src/components/device/device-app.tsx", "utf8");
  it("shows only when nobody is signed in, never beside the sidebar", () => {
    expect(src).toMatch(/\{!online && <div className="flex gap-1 flex-wrap border-b border-line" role="tablist">/);
    expect(src).not.toMatch(/online && \(tab === "dash"/);
  });
  it("leaves the tools the sidebar lacks on the dashboard", () => {
    const dash = readFileSync("src/components/device/dashboard.tsx", "utf8");
    for (const k of ["supplier", "ask", "activity", "settings"]) expect(dash).toContain(`["${k}",`);
    expect(dash).toContain('!ownerOnly || owner'); // Activity and Counter stay owner-only
  });
});
