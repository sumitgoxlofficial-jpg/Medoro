import { describe, expect, it } from "vitest";
import { deriveState, explain, HEALTH_STATES, TEST_TTL_MS, type Evidence } from "./health-state";

const now = new Date("2026-11-17T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("integration health state", () => {
  it("is not_configured when nothing is set up, whatever else is claimed", () => {
    expect(deriveState({ configured: false, test: "pass", testedAt: ago(1), inUse: true }, now)).toBe("not_configured");
  });
  it("is connected until a test has been run", () => {
    expect(deriveState({ configured: true, test: "not_run", inUse: true }, now)).toBe("connected");
  });
  it("is error after a failed test or a failed real run", () => {
    expect(deriveState({ configured: true, test: "fail", testedAt: ago(1) }, now)).toBe("error");
    expect(deriveState({ configured: true, test: "pass", testedAt: ago(1), inUse: true, runFailed: true }, now)).toBe("error");
  });
  it("is tested when a test passed but nothing real has happened since", () => {
    expect(deriveState({ configured: true, test: "pass", testedAt: ago(1000), inUse: false }, now)).toBe("tested");
  });
  it("is active only with a fresh passing test and real use", () => {
    expect(deriveState({ configured: true, test: "pass", testedAt: ago(1000), inUse: true }, now)).toBe("active");
  });
  it("falls back to tested when the passing test is stale", () => {
    const e: Evidence = { configured: true, test: "pass", testedAt: ago(TEST_TTL_MS + 1), inUse: true };
    expect(deriveState(e, now)).toBe("tested");
    expect(explain("tested", e, now)).toMatch(/24 hours/);
  });
  it("never yields active without a passing test, over every combination of inputs", () => {
    for (const configured of [true, false]) for (const test of ["pass", "fail", "not_run"] as const) for (const testedAt of [null, ago(5)]) for (const inUse of [true, false, undefined]) for (const runFailed of [true, false, undefined]) {
      const s = deriveState({ configured, test, testedAt, inUse, runFailed }, now);
      expect(HEALTH_STATES).toContain(s);
      if (s === "active") { expect(configured && test === "pass" && !!testedAt && !runFailed).toBe(true); }
    }
  });
});
