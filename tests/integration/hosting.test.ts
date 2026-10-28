import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { checkEnv } from "@/env-check";

describe("hosting safety", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

  it("every table has row level security on, so a hosted data API can't read it", async () => {
    const off = await db.$queryRaw<{ t: string }[]>`SELECT c.relname t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(off.map((x) => x.t)).toEqual([]);
  });

  it("stores files in a private Supabase bucket when configured", async () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co/");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const objects = new Map<string, Uint8Array>();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, headers: init.headers as Record<string, string> });
      if (url.endsWith("/storage/v1/bucket/medoro-private")) return new Response("{}", { status: 404 });
      if (url.endsWith("/storage/v1/bucket")) return new Response("{}", { status: 200 });
      const key = url.split("/medoro-private/")[1];
      if (method === "POST") { objects.set(key, init.body as Uint8Array); return new Response("{}"); }
      if (method === "GET") return objects.has(key) ? new Response(new Uint8Array(objects.get(key)!)) : new Response("{}", { status: 400 });
      return new Response("{}");
    });
    const s = await import("@/server/storage");
    expect(s.storageKind()).toBe("supabase");
    const { rel } = await s.saveDocument("t1", Buffer.from("%PDF-1.4 hello"), "application/pdf");
    expect(rel).toMatch(/^t1\/scans\/[0-9a-f]{64}\.pdf$/);
    expect((await s.readDocument(rel)).toString()).toBe("%PDF-1.4 hello");
    expect(await s.getObject("t1/scans/missing.pdf")).toBeNull();
    const create = calls.find((c) => c.url.endsWith("/storage/v1/bucket") && c.method === "POST");
    expect(create).toBeTruthy();
    expect(calls.every((c) => c.headers.apikey === "sb_secret_test" && !("Authorization" in c.headers))).toBe(true);
    await expect(s.putObject("../etc/passwd", Buffer.from("x"))).rejects.toThrow(/Bad storage key/);
  });

  it("locks first-run setup on Vercel unless a setup token is configured", async () => {
    vi.stubEnv("SETUP_TOKEN", "");
    vi.stubEnv("VERCEL", "1");
    let g = await import("@/server/setup-gate");
    expect(g.setupGate()).toBe("disabled");
    vi.resetModules();
    vi.stubEnv("SETUP_TOKEN", "correct-token-123");
    g = await import("@/server/setup-gate");
    expect(g.setupGate()).toBe("token");
    expect(g.tokenMatches("correct-token-123")).toBe(true);
    expect(g.tokenMatches("wrong")).toBe(false);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("SETUP_TOKEN", "");
    expect(g.setupGate()).toBe("open");
  });

  it("refuses to start on Vercel with missing or weak settings, and flags public secrets", () => {
    const base = { DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(40) } as unknown as NodeJS.ProcessEnv;
    expect(checkEnv(base)).toEqual([]);
    const v = checkEnv({ ...base, VERCEL: "1", NEXT_PUBLIC_SUPABASE_SECRET_KEY: "x" } as unknown as NodeJS.ProcessEnv);
    expect(v.join(" ")).toMatch(/HOST_KEY/);
    expect(v.join(" ")).toMatch(/DIRECT_URL/);
    expect(v.join(" ")).toMatch(/CRON_SECRET/);
    expect(v.join(" ")).toMatch(/NEXT_PUBLIC_SUPABASE_SECRET_KEY looks like a secret/);
    expect(v.join(" ")).not.toMatch(/x"/);
  });
});
