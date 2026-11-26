import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/vault", () => ({ seal: (x: string) => Buffer.from(x) }));
vi.mock("@/server/log", () => ({ log: { error: () => {} } }));
import { PERSONAS, daySchedule, istDay } from "./sales-pulse";

const ist = (day: string, h: number, m = 0) => Date.parse(`${day}T00:00:00Z`) - 5.5 * 3600_000 + (h * 60 + m) * 60_000;

describe("Sales Pulse", () => {
  it("has 45 bot personas: 20 women and 25 men, all unique", () => {
    expect(PERSONAS).toHaveLength(45);
    expect(PERSONAS.filter((p) => p.gender === "f")).toHaveLength(20);
    expect(new Set(PERSONAS.map((p) => p.name)).size).toBe(45);
    expect(PERSONAS.every((p) => p.id.startsWith("pulse:"))).toBe(true);
  });
  it("posts 10-16 messages a day between 10:00 and 18:30 India time, the same on every call", () => {
    for (const day of ["2026-11-26", "2026-11-27", "2027-01-01"]) {
      const s = daySchedule(day);
      expect(s.length).toBeGreaterThanOrEqual(10);
      expect(s.length).toBeLessThanOrEqual(16);
      for (const x of s) {
        expect(x.at.getTime()).toBeGreaterThanOrEqual(ist(day, 10));
        expect(x.at.getTime()).toBeLessThan(ist(day, 18, 31));
        expect(istDay(x.at)).toBe(day);
        expect(x.body.length).toBeGreaterThan(5);
      }
      expect(s.map((x) => x.at.getTime())).toEqual([...s.map((x) => x.at.getTime())].sort((a, b) => a - b));
      expect(daySchedule(day)).toEqual(s);
      for (let i = 1; i < s.length; i++) expect(s[i].senderId).not.toBe(s[i - 1].senderId);
    }
  });
  it("mixes English, Hindi and Hinglish over a month", () => {
    const all = Array.from({ length: 30 }, (_, i) => daySchedule(`2026-12-${String(i + 1).padStart(2, "0")}`)).flat().map((x) => x.body);
    expect(all.some((b) => /[ऀ-ॿ]/.test(b))).toBe(true);
    expect(all.some((b) => /\b(Aaj|kar liye|ho gaya|wale)\b/.test(b))).toBe(true);
    expect(all.some((b) => /\b(closed|booked)\b/.test(b))).toBe(true);
  });
});
