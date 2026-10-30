import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, hostClass, Redactor, resolveProvider } from "./llm";

afterEach(() => vi.unstubAllGlobals());

describe("model providers", () => {
  it("classifies hosts: only loopback is local in strict mode", () => {
    expect(hostClass("http://127.0.0.1:11434")).toBe("loopback");
    expect(hostClass("http://localhost:11434")).toBe("loopback");
    expect(hostClass("http://[::1]:11434")).toBe("loopback");
    expect(hostClass("http://192.168.1.20:11434")).toBe("private");
    expect(hostClass("http://10.0.0.5")).toBe("private");
    expect(hostClass("http://172.20.1.1")).toBe("private");
    expect(hostClass("http://[fd12::1]")).toBe("private");
    expect(hostClass("http://172.32.1.1")).toBe("public");
    expect(hostClass("http://ollama.example.com")).toBe("public");
    expect(hostClass("http://localhost.evil.com")).toBe("public");
    expect(hostClass("not a url")).toBe("public");
  });

  it("resolves the provider from AI_MODE, strict mode and the owner's opt-in", () => {
    const strict = { strict: true, remoteAi: false }, open = { strict: false, remoteAi: true }, noOpt = { strict: false, remoteAi: false };
    expect(resolveProvider({}, strict).mode).toBe("rules");
    expect(resolveProvider({ LOCAL_LLM_URL: "http://127.0.0.1:11434", LOCAL_LLM_MODEL: "q" }, strict)).toMatchObject({ mode: "local", provider: { kind: "local", dialect: "ollama" } });
    expect(resolveProvider({ AI_MODE: "rule", LOCAL_LLM_URL: "http://127.0.0.1:11434", LOCAL_LLM_MODEL: "q" }, strict).mode).toBe("rules");
    expect(resolveProvider({ LOCAL_LLM_URL: "http://192.168.1.9:11434", LOCAL_LLM_MODEL: "q" }, strict)).toMatchObject({ mode: "rules", note: expect.stringMatching(/Strict/) });
    expect(resolveProvider({ LOCAL_LLM_URL: "http://192.168.1.9:11434", LOCAL_LLM_MODEL: "q" }, noOpt).mode).toBe("local");
    // A "local" model on a public host is remote: it needs the opt-in.
    expect(resolveProvider({ LOCAL_LLM_URL: "http://gpu.example.com", LOCAL_LLM_MODEL: "q" }, noOpt)).toMatchObject({ mode: "rules", note: expect.stringMatching(/allowed/) });
    expect(resolveProvider({ LOCAL_LLM_URL: "http://gpu.example.com", LOCAL_LLM_MODEL: "q" }, open)).toMatchObject({ mode: "remote", provider: { kind: "remote" } });
    const remote = { AI_MODE: "remote", REMOTE_AI_URL: "https://api.example.com/v1", REMOTE_AI_KEY: "k", REMOTE_AI_MODEL: "m" };
    expect(resolveProvider(remote, strict).mode).toBe("rules");
    expect(resolveProvider(remote, noOpt).mode).toBe("rules");
    expect(resolveProvider(remote, open)).toMatchObject({ mode: "remote", provider: { dialect: "openai", key: "k" } });
    expect(resolveProvider({ ...remote, REMOTE_AI_URL: "http://api.example.com/v1" }, open)).toMatchObject({ mode: "rules", note: expect.stringMatching(/https/) });
  });

  it("redacts phones, emails and known names, and restores them", () => {
    const r = new Redactor(["Ramesh Kumar"]);
    const out = r.redact("Ramesh Kumar (9822000003, ramesh@x.in) owes ₹500; call +91 98220 00004. Ramesh Kumar again.");
    expect(out).not.toMatch(/Ramesh|9822000003|ramesh@|98220 00004/);
    expect(out).toContain("[customer 1]");
    expect(out.match(/\[customer 1\]/g)).toHaveLength(2);
    expect(r.restore("[customer 1] owes the most; phone [phone 1]")).toBe("Ramesh Kumar owes the most; phone 9822000003");
    expect(r.redact("₹1,23,456 across 12 bills")).toBe("₹1,23,456 across 12 bills");
  });

  it("speaks the OpenAI chat-completions dialect with tool calls and a bearer key", async () => {
    const fetch = vi.fn(async (...args: [string, RequestInit]) => args && new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_sales_summary", arguments: "{\"period\":\"week\"}" } }] } }] })));
    vi.stubGlobal("fetch", fetch);
    const p = { kind: "remote" as const, dialect: "openai" as const, url: "https://api.example.com/v1/", model: "m", key: "secret" };
    const r = await chat(p, [{ role: "user", content: "sales this week" }, { role: "assistant", content: "", calls: [{ id: "c0", name: "x", args: {} }] }, { role: "tool", callId: "c0", name: "x", content: "{}" }], [{ name: "get_sales_summary", description: "d", params: { period: { type: "string" } } }], AbortSignal.timeout(1000));
    expect(r.calls).toEqual([{ id: "c1", name: "get_sales_summary", args: { period: "week" } }]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    const body = JSON.parse(String(init.body));
    expect(body.tools[0].function.name).toBe("get_sales_summary");
    expect(body.messages[1].tool_calls[0]).toMatchObject({ id: "c0", function: { arguments: "{}" } });
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "c0", content: "{}" });
  });

  it("speaks the Ollama dialect and throws on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { content: "", tool_calls: [{ function: { name: "get_low_stock_report", arguments: {} } }] } }))));
    const p = { kind: "local" as const, dialect: "ollama" as const, url: "http://127.0.0.1:11434", model: "q" };
    expect((await chat(p, [{ role: "user", content: "reorder?" }], [], AbortSignal.timeout(1000))).calls[0].name).toBe("get_low_stock_report");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(chat(p, [{ role: "user", content: "x" }], [], AbortSignal.timeout(1000))).rejects.toThrow(/500/);
  });
});
