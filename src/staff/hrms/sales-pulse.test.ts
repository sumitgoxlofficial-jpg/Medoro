import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/vault", () => ({ seal: (x: string) => Buffer.from(x) }));
vi.mock("@/server/log", () => ({ log: { error: () => {} } }));
import { PERSONAS, daySchedule, isStatusAsk, istDay, namedBots, replyMode, replyPlan, welcomePlan } from "./sales-pulse";

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
  it("welcomes a new member from every bot, each at a different minute with a different message", () => {
    const from = new Date(ist("2026-11-26", 11, 5));
    const w = welcomePlan("staff-1", "Rohan Verma", from);
    expect(w).toHaveLength(45);
    expect(new Set(w.map((x) => x.senderId)).size).toBe(45);
    expect(new Set(w.map((x) => x.body)).size).toBe(45);
    expect(new Set(w.map((x) => Math.floor(Date.parse(x.at) / 60_000))).size).toBe(45);
    for (const x of w) {
      expect(x.body).toContain("Rohan");
      expect(Date.parse(x.at)).toBeGreaterThan(from.getTime());
      expect(Date.parse(x.at)).toBeLessThan(from.getTime() + 150 * 60_000);
    }
  });
  it("moves welcomes after 18:30 to the next morning", () => {
    const w = welcomePlan("staff-2", "Pooja", new Date(ist("2026-11-26", 18, 0)));
    for (const x of w) {
      const t = Date.parse(x.at);
      const ok = (t >= ist("2026-11-26", 18, 0) && t <= ist("2026-11-26", 18, 31)) || (t >= ist("2026-11-27", 10) && t <= ist("2026-11-27", 18, 30));
      expect(ok).toBe(true);
    }
  });
  it("spots a request for an update in English, Hindi and Hinglish, and nothing else", () => {
    for (const q of ["What's the update?", "Team, how much work done today?", "Any sales so far?", "status pls", "Kitna kaam hua aaj?", "kya scene hai guys", "Kahan tak pahuncha?", "आज कितने डेमो हुए?", "सबका अपडेट दो"]) expect(isStatusAsk(q)).toBe(true);
    for (const q of ["Good morning team", "Please welcome Rohan, our new employee", "Lunch at 2?", "Thanks everyone 🙏"]) expect(isStatusAsk(q)).toBe(false);
  });
  it("finds bots named in a question, unless a real member has that first name", () => {
    expect(namedBots("Neha, Rahul what's the update?").map((p) => p.name)).toEqual(["Neha Verma", "Rahul Gupta"]);
    expect(namedBots("@neha update?").map((p) => p.name.split(" ")[0])).toEqual(["Neha"]);
    expect(namedBots("Neha update?", ["Neha"])).toEqual([]);
    expect(namedBots("Nehal update?")).toEqual([]);
  });
  it("answers a question with 2 to 4 bots, a few minutes apart, in the question's language", () => {
    const from = new Date(ist("2026-11-26", 12, 0));
    let split = 0;
    for (const key of ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]) {
      const r = replyPlan(key, "Amit Kumar", "Kitna kaam hua aaj?", from);
      const who = [...new Set(r.map((x) => x.senderId))];
      expect(who.length).toBeGreaterThanOrEqual(2);
      expect(who.length).toBeLessThanOrEqual(4);
      if (r.length > who.length) split++;
      expect(new Set(r.map((x) => x.body)).size).toBe(r.length);
      expect(Date.parse(r[0].at) - from.getTime()).toBeGreaterThanOrEqual(60_000);
      expect(Date.parse(r[0].at) - from.getTime()).toBeLessThanOrEqual(180_000);
      for (let i = 1; i < r.length; i++) expect(Date.parse(r[i].at)).toBeGreaterThan(Date.parse(r[i - 1].at));
      for (const id of who) expect(r.filter((x) => x.senderId === id).some((x) => /\d/.test(x.body))).toBe(true); // each gives numbers
      expect(replyPlan(key, "Amit Kumar", "Kitna kaam hua aaj?", from)).toEqual(r);
    }
    expect(split).toBeGreaterThan(0); // some updates come in two messages
    const hi = Array.from({ length: 10 }, (_, i) => replyPlan(`h${i}`, "Amit", "आज कितना काम हुआ?", from)).flat();
    expect(hi.filter((x) => /[ऀ-ॿ]/.test(x.body)).length).toBeGreaterThan(hi.length / 2);
  });
  it("only the named bots answer, and nobody answers outside 09:00-20:00", () => {
    const neha = PERSONAS.find((p) => p.name.startsWith("Neha "))!;
    const r = replyPlan("n1", "Amit", "Neha update?", new Date(ist("2026-11-26", 15, 0)), [neha]);
    expect(new Set(r.map((x) => x.senderId))).toEqual(new Set([neha.id]));
    expect(replyPlan("n2", "Amit", "update?", new Date(ist("2026-11-26", 21, 0)))).toEqual([]);
    expect(replyPlan("n3", "Amit", "update?", new Date(ist("2026-11-26", 8, 30)))).toEqual([]);
  });
  it("tells greetings, thanks, instructions and updates apart", () => {
    expect(replyMode("Good morning team")).toBe("greet");
    expect(replyMode("gm all ☀️")).toBe("greet");
    expect(replyMode("नमस्ते सबको")).toBe("greet");
    expect(replyMode("Well done team, great work today!")).toBe("thanks");
    expect(replyMode("शाबाश टीम")).toBe("thanks");
    expect(replyMode("Please submit your report by 6 pm", "hr")).toBe("ack");
    expect(replyMode("Please join the call at 4", "staff")).toBe(null); // only HR and the super admin give instructions
    expect(replyMode("Good morning, what's the update?")).toBe("status");
    expect(replyMode("Please welcome Rohan, our new employee", "hr")).toBe(null);
    expect(replyMode("Lunch at 2?")).toBe(null);
  });
  it("answers plainly when asked whether they are bots", () => {
    for (const q of ["Neha are you a bot?", "Are you all real people?", "kya aap bot ho?", "क्या आप बॉट हैं?"]) expect(replyMode(q)).toBe("honest");
    expect(replyMode("Is the real report ready?")).not.toBe("honest");
    const r = replyPlan("b1", "Amit", "Are you a bot?", new Date(ist("2026-11-26", 12, 0)), [], "honest");
    expect(r).toHaveLength(1);
    expect(r[0].body).toMatch(/bot/i);
  });
  it("greets, thanks, acknowledges and congratulates in a natural way", () => {
    const at = new Date(ist("2026-11-26", 9, 40));
    const g = replyPlan("g1", "Amit", "Good morning team", at, [], "greet");
    expect(g.length).toBeGreaterThanOrEqual(2);
    expect(Date.parse(g[0].at) - at.getTime()).toBeLessThanOrEqual(90_000); // people answer a greeting quickly
    for (const x of g) expect(x.body).toMatch(/Good morning|सुप्रभात/);
    for (const x of replyPlan("g2", "Amit", "Hello", new Date(ist("2026-11-26", 18, 0)), [], "greet")) expect(x.body).not.toMatch(/morning|सुप्रभात/i);
    for (const x of replyPlan("t1", "Amit", "Great work team", at, [], "thanks")) expect(x.body).toMatch(/thank|धन्यवाद|शुक्रिया|थैंक/i);
    for (const x of replyPlan("a1", "Priya", "Please submit reports by 6", at, [], "ack")) expect(x.body.length).toBeLessThan(60);
    const c = replyPlan("c1", "Rohan Verma", "Closed a Starter deal", at, [], "congrats");
    expect(c.length).toBeGreaterThanOrEqual(1);
    for (const x of c) expect(x.body).toContain("Rohan");
    const neha = PERSONAS.find((p) => p.name.startsWith("Neha "))!;
    const chat = replyPlan("x1", "Amit", "Neha are you free at 4?", at, [neha], "chat");
    expect(chat.map((x) => x.senderId)).toEqual([neha.id]);
  });
  it("never names an anonymous asker (the super admin)", () => {
    const r = Array.from({ length: 20 }, (_, i) => replyPlan(`a${i}`, "", "What's the update?", new Date(ist("2026-11-26", 12, 0)))).flat();
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) { expect(x.body).not.toMatch(/^(Hi\b|,|\s)|जी|Going good|Sab badhiya|Chal raha hai|abhi tak/); expect(x.body).not.toContain("  "); }
  });
});
