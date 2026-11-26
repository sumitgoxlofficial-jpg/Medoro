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
  it("every bot posts once a day between 10:00 and 18:30 India time, the same on every call", () => {
    for (const day of ["2026-11-26", "2026-11-27", "2027-01-01"]) {
      const s = daySchedule(day);
      expect(s).toHaveLength(45);
      expect(new Set(s.map((x) => x.senderId)).size).toBe(45);
      for (const x of s) {
        expect(x.at.getTime()).toBeGreaterThanOrEqual(ist(day, 10));
        expect(x.at.getTime()).toBeLessThan(ist(day, 18, 31));
        expect(istDay(x.at)).toBe(day);
      }
      expect(s.map((x) => x.at.getTime())).toEqual([...s.map((x) => x.at.getTime())].sort((a, b) => a - b));
      expect(daySchedule(day)).toEqual(s);
      expect(new Set(s.map((x) => x.body)).size).toBe(45); // nobody sends the same message on a day
    }
  });
  it("gives every bot a different message from the day before, all about sales or demos", () => {
    const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 11, 1) + i * 86400_000).toISOString().slice(0, 10));
    let prev = new Map<string, string>();
    for (const d of days) {
      const today = new Map(daySchedule(d).map((x) => [x.senderId, x.body]));
      for (const [id, body] of today) {
        expect(body).not.toBe(prev.get(id));
        expect(body).toMatch(/sale|demo|deal|closed|close|sign|bought|sold|सेल|डेमो|डील|पेड|पक्का|साइन|ले लिया|लिया|बेचा|Medoro|convert|liya|bech|paid/i);
      }
      prev = today;
    }
  });
  it("mixes English, Hindi and Hinglish over a month", () => {
    const all = Array.from({ length: 30 }, (_, i) => daySchedule(`2026-12-${String(i + 1).padStart(2, "0")}`)).flat().map((x) => x.body);
    expect(all.some((b) => /[ऀ-ॿ]/.test(b))).toBe(true);
    expect(all.some((b) => /\b(Aaj|kar liye|ho gaya|wale)\b/.test(b))).toBe(true);
    expect(all.some((b) => /\b(closed|booked)\b/.test(b))).toBe(true);
  });
});
