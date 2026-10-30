import { describe, expect, it } from "vitest";
import { classify, reasonFor, webhookKind } from "./graph";

describe("Graph error classification", () => {
  it("retries throughput limits, Meta outages and network errors only", () => {
    for (const code of [130429, 131056, 131000, 131016, 2]) expect(classify(code, 400)).toBe("retry");
    expect(classify(undefined, 503)).toBe("retry");
    expect(classify(undefined, undefined)).toBe("retry");
    expect(classify(undefined, 400)).toBe("permanent");
  });

  it("never retries template, re-engagement or recipient errors; flags numbers not on WhatsApp; disconnects on token errors", () => {
    for (const code of [132000, 132001, 132015, 131047, 131050, 131042, 100]) expect(classify(code, 400)).toBe("permanent");
    expect(classify(131026, 400)).toBe("invalid");
    expect(classify(190, 401)).toBe("auth");
    expect(classify(undefined, 401)).toBe("auth");
    expect(webhookKind(131026)).toBe("invalid");
    expect(webhookKind(undefined)).toBe("permanent");
    expect(reasonFor(131047)).toMatch(/24 hours/);
    expect(reasonFor(999, "Odd")).toBe("Odd (999)");
  });
});
