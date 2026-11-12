import { describe, expect, it } from "vitest";
import { expiryDigest } from "./expiry-digest";

const HEAD = ["Medicine", "Batch", "Expiry", "Days left", "Qty", "Exposure at cost", "Projected unsold", "Projected loss at cost"];
const row = (med: string, batch: string, days: number, qty: string, cost: string) => [med, batch, "2026-12-01", days, qty, cost, qty, cost];

describe("the expiry part of the daily email", () => {
  it("bands the stock, adds up the money and says what to look at first", () => {
    const d = expiryDigest([HEAD, row("Dolo 650", "D1", 12, "40 packs", "800.00"), row("Pan 40", "P1", 5, "10 packs", "1100.50"), row("Okacet", "O1", -3, "20 packs", "270.00"),
      row("Shelcal", "S1", 45, "8 packs", "640.00"), row("Azee", "A1", 75, "6 packs", "500.00"), row("Telma", "T1", 150, "30 packs", "3000.00")]);
    expect(d.batches).toBe(6); expect(d.within30).toBe(2); expect(d.atRisk30).toBeCloseTo(1900.5);
    const text = d.lines.join("\n");
    expect(text).toContain("Already expired, still on the shelf: 1 batch, ₹270");
    expect(text).toContain("Expiring within 30 days: 2 batches, ₹1,901");
    expect(text).toContain("Expiring in 31 to 60 days: 1 batch, ₹640");
    expect(text).toContain("Expiring in 61 to 90 days: 1 batch, ₹500");
    expect(text).toContain("Expiring in 91 to 180 days: 1 batch, ₹3,000");
    // Most urgent first (expired, then fewest days), and only the first five within 90 days.
    const first = d.lines.slice(d.lines.indexOf("Look at these first:") + 1, d.lines.indexOf("Look at these first:") + 6);
    expect(first[0]).toContain("Okacet · batch O1 · expired"); expect(first[1]).toContain("Pan 40 · batch P1 · 5 days left");
    expect(text).toContain("What to do: Take it off sale now"); // the most urgent band decides the advice
    expect(text).not.toContain("Telma · batch"); // 150 days is not urgent
  });
  it("is calm when there's nothing, and ignores a report it doesn't understand", () => {
    expect(expiryDigest([HEAD]).lines).toEqual(["Expiring stock: nothing within 180 days. Well done."]);
    expect(expiryDigest([["Foo"], ["bar"]]).lines).toEqual([]);
  });
  it("speaks plainly about one batch", () => {
    expect(expiryDigest([HEAD, row("Dolo 650", "D1", 1, "4 packs", "80")]).lines.join("\n")).toContain("D1 · 1 day left");
  });
});
