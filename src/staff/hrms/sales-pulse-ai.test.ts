import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/log", () => ({ log: { error: () => {} } }));

const reply = (content: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));

describe("Sales Pulse AI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AI_MODE", "remote"); vi.stubEnv("REMOTE_AI_URL", "https://ai.example.com/v1"); vi.stubEnv("REMOTE_AI_MODEL", "m"); vi.stubEnv("REMOTE_AI_KEY", "k"); vi.stubEnv("SALES_PULSE_REMOTE_AI", "1");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("rewrites a daily brief in the bot's voice and sends no tools", async () => {
    const f = reply("Bhai aaj 2 sale close 🔥 Pune wala Starter le gaya");
    vi.stubGlobal("fetch", f);
    const { humanize } = await import("./sales-pulse-ai");
    const out = await humanize([{ key: "a", senderId: "pulse:21", name: "Rahul Gupta", brief: "Aaj 2 sale close ho gayi 🎉", kind: "daily" }], [], null);
    expect(out.get("a")).toBe("Bhai aaj 2 sale close 🔥 Pune wala Starter le gaya");
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.tools).toBeUndefined();
    expect(body.temperature).toBeGreaterThan(0);
    expect(body.messages[0].content).toContain("Hinglish");
  });

  it("puts the new colleague's name back, and never sends it to the model", async () => {
    const f = reply("Welcome [new colleague]! Chai pe milte hai ☕");
    vi.stubGlobal("fetch", f);
    const { humanize } = await import("./sales-pulse-ai");
    const out = await humanize([{ key: "w", senderId: "pulse:02", name: "Neha Verma", brief: "Welcome to the team, [new colleague]! 🎉", kind: "welcome", newName: "Rohan" }], [], null);
    expect(out.get("w")).toBe("Welcome Rohan! Chai pe milte hai ☕");
    expect(JSON.stringify(f.mock.calls[0])).not.toContain("Rohan");
  });

  it("falls back to the template when the reply is unusable or the model fails", async () => {
    vi.stubGlobal("fetch", reply("As an AI language model, I cannot"));
    let m = await import("./sales-pulse-ai");
    expect((await m.humanize([{ key: "x", senderId: "pulse:03", name: "Ananya Iyer", brief: "2 demo calls booked ✅", kind: "daily" }], [], null)).has("x")).toBe(false);
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    m = await import("./sales-pulse-ai");
    expect((await m.humanize([{ key: "y", senderId: "pulse:03", name: "Ananya Iyer", brief: "2 demo calls booked ✅", kind: "daily" }], [], null)).size).toBe(0);
  });

  it("does nothing without a model, or when switched off", async () => {
    vi.stubEnv("SALES_PULSE_AI", "off");
    const f = reply("hi"); vi.stubGlobal("fetch", f);
    const { humanize } = await import("./sales-pulse-ai");
    expect((await humanize([{ key: "z", senderId: "pulse:04", name: "Pooja Patel", brief: "1 sale closed today", kind: "daily" }], [], null)).size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
