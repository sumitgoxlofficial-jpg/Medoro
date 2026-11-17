import { describe, expect, it } from "vitest";
import { driveModeMessage } from "./drive-mode-note";

describe("Drive-mode note on server analysis screens", () => {
  it("says the screen has nothing to analyse when records live on the devices and in Drive", () => {
    const m = driveModeMessage(true)!;
    expect(m).toMatch(/not on Medoro’s server/);
    expect(m).toMatch(/will look empty/);
    expect(m).toMatch(/Billing \(device\)/);
  });
  it("shows nothing for a pharmacy whose records are on the server", () => {
    expect(driveModeMessage(false)).toBeNull();
    expect(driveModeMessage(undefined)).toBeNull();
  });
});
