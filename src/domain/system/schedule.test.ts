import { describe, expect, it } from "vitest";
import { backupDecision, istClock } from "./schedule";

// 2026-10-30 03:00 IST = 2026-10-29 21:30 UTC
const at = (ist: string) => new Date(Date.parse(`2026-10-30T${ist}:00Z`) - 330 * 60_000);

describe("istClock", () => {
  it("gives India time and local midnight", () => {
    const c = istClock(at("03:00"));
    expect(c.hhmm).toBe("03:00");
    expect(c.dayStart.toISOString()).toBe("2026-10-29T18:30:00.000Z");
  });
});

describe("backupDecision", () => {
  it("waits for the chosen time", () => {
    expect(backupDecision(at("02:29"), "02:30", [])).toEqual({ run: false, reason: "before-time" });
    expect(backupDecision(at("02:30"), "02:30", [])).toEqual({ run: true, kind: "scheduled" });
  });

  it("skips when today's backup succeeded or is still running", () => {
    expect(backupDecision(at("04:00"), "02:30", [{ status: "verified", startedAt: at("02:30") }])).toMatchObject({ run: false, reason: "done" });
    expect(backupDecision(at("02:40"), "02:30", [{ status: "running", startedAt: at("02:30") }])).toMatchObject({ run: false, reason: "running" });
  });

  it("treats a backup stuck in running for 30 minutes as failed and retries it", () => {
    expect(backupDecision(at("03:00"), "02:30", [{ status: "running", startedAt: at("02:30") }])).toEqual({ run: true, kind: "retry" });
  });

  it("waits 30 minutes between retries", () => {
    const failed = [{ status: "failed", startedAt: at("02:30"), finishedAt: at("02:35") }];
    expect(backupDecision(at("03:04"), "02:30", failed)).toMatchObject({ reason: "backoff" });
    expect(backupDecision(at("03:05"), "02:30", failed)).toEqual({ run: true, kind: "retry" });
  });

  it("gives up after 3 attempts a day", () => {
    const f = (t: string) => ({ status: "failed", startedAt: at(t) });
    expect(backupDecision(at("05:00"), "02:30", [f("02:30"), f("03:01"), f("03:32")])).toMatchObject({ reason: "gave-up" });
  });

  it("ignores the chosen time and retry gap when the host cron fires once a day", () => {
    expect(backupDecision(at("03:00"), "23:00", [], true)).toEqual({ run: true, kind: "scheduled" });
    expect(backupDecision(at("03:00"), "23:00", [{ status: "failed", startedAt: at("02:59") }], true)).toEqual({ run: true, kind: "retry" });
  });
});
