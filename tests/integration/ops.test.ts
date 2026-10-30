import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { enforce, hit, RateLimitError } from "@/server/ratelimit";
import { readiness } from "@/server/readiness";
import { renderMetrics, countRequest } from "@/server/metrics";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { POST as offlineSync } from "@/app/api/offline/sync/route";
import { makePharmacy, resetDb } from "./helpers";

describe("operations endpoints", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });
  afterEach(() => { delete process.env.METRICS_TOKEN; });

  it("health is static and ready checks the database and migrations", async () => {
    const h = await health();
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ status: "ok" });
    const r = await readiness();
    expect(r).toMatchObject({ ready: true, checks: { database: "ok", migrations: "ok", env: "ok" } });
    const res = await ready();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/postgres(ql)?:\/\//);
    expect(body).not.toContain(process.env.SESSION_SECRET!);
  });

  it("ready reports a pending migration", async () => {
    const last = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`;
    await db.$executeRaw`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = ${last[0].migration_name}`;
    try {
      expect(await readiness()).toMatchObject({ ready: false, checks: { migrations: "pending" }, pendingMigrations: 1 });
      expect((await ready()).status).toBe(503);
    } finally {
      await db.$executeRaw`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = ${last[0].migration_name}`;
    }
  });

  it("metrics need the bearer token and expose Prometheus text", async () => {
    const get = (auth?: string) => metrics(new Request("http://x/api/metrics", { headers: auth ? { authorization: auth } : {} }));
    expect((await get("Bearer whatever")).status).toBe(404);
    process.env.METRICS_TOKEN = "metrics-token-0123456789";
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong-token-0123456789")).status).toBe(401);
    countRequest("export", 200);
    const res = await get("Bearer metrics-token-0123456789");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toContain("# TYPE medoro_http_requests_total counter");
    expect(text).toMatch(/medoro_http_requests_total\{group="export",status="2xx"\} \d+/);
    expect(text).toContain('medoro_backup_last_success_timestamp_seconds{tenant="TEST-PUNE"} 0');
    expect(text).toContain('medoro_offline_queue_size{tenant="TEST-PUNE",status="pending"} 0');
    expect(text).toMatch(/medoro_live_listener_connected [01]/);
    expect(text).toContain("medoro_database_up 1");
    expect(await renderMetrics()).not.toMatch(/owner@test\.in|9822000001/);
  });

  it("route handlers refuse cross-site state changes", async () => {
    const res = await offlineSync(new Request("http://shop.local/api/offline/sync", { method: "POST", headers: { host: "shop.local", origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(403);
  });
});

describe("rate limiter", () => {
  beforeAll(async () => { await db.rateLimit.deleteMany(); });

  it("counts per subject in fixed windows and throws a readable error", async () => {
    for (let i = 0; i < 5; i++) await enforce("campaign", "t1:u1");
    const err = await enforce("campaign", "t1:u1").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.message).toMatch(/^Too many campaign starts\. Try again in/);
    await expect(enforce("campaign", "t1:u2")).resolves.toBeUndefined();
  });

  it("resets when the window rolls over and stays atomic under concurrency", async () => {
    const rule = { name: "test", limit: 10, windowSec: 60, what: "tests" };
    const t0 = new Date("2026-10-30T10:00:05Z");
    const results = await Promise.all(Array.from({ length: 15 }, () => hit(rule, "s", t0)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const next = await hit(rule, "s", new Date("2026-10-30T10:01:01Z"));
    expect(next).toMatchObject({ ok: true, count: 1 });
  });
});
