import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ctxFor, makePharmacy, resetDb } from "./helpers";
import { healthOverview, recordHeartbeat, runHealthTest, TESTERS } from "@/domain/system/health";

const state = async (key: string, role: Parameters<typeof ctxFor>[0] = "Owner") => (await healthOverview(await ctxFor(role), new Date())).find((r) => r.key === key)!;
const jsonRes = (status: number) => (async () => new Response("", { status })) as unknown as typeof fetch;

describe("integration health centre", () => {
  const saved = { ...process.env };
  beforeAll(async () => { await resetDb(); await makePharmacy(); });
  afterAll(() => { process.env = saved; });

  it("is limited to people who may manage integrations", async () => {
    await expect(healthOverview(await ctxFor("Cashier"))).rejects.toThrow();
    await expect(runHealthTest(await ctxFor("Cashier"), "ocr")).rejects.toThrow();
  });

  it("reports unconfigured outside services as Not configured, never as working", async () => {
    for (const k of ["gdrive", "whatsapp", "ocr", "ai", "jobs", "offline_sync", "whatsapp_delivery"]) expect((await state(k)).state, k).toBe("not_configured");
  });

  it("reads the database for real", async () => {
    const r = await state("database");
    expect(r.state).toBe("active");
    expect(r.detail).toMatch(/migrations applied/);
  });

  it("live checks run only on facts: jobs follow the scheduler heartbeat", async () => {
    await recordHeartbeat(false, "deliveryTick exploded");
    const bad = await state("jobs");
    expect(bad.state).toBe("error");
    expect(bad.lastError).toMatch(/deliveryTick exploded/);
    await recordHeartbeat(true);
    expect((await state("jobs")).state).toBe("active");
    await db.systemHeartbeat.update({ where: { key: "scheduler" }, data: { lastOkAt: new Date(Date.now() - 3600_000), lastRunAt: new Date(Date.now() - 3600_000) } });
    expect((await state("jobs")).state).toBe("error"); // silent scheduler is a failure, not "fine"
  });

  it("backup state comes from verified manifests and failures", async () => {
    const t = (await ctxFor()).tenantId;
    expect((await state("backup")).state).toBe("connected"); // key saved, no backup has run
    const done = new Date();
    await db.backupManifest.create({ data: { tenantId: t, kind: "manual", schemaVersion: "x", status: "verified", startedAt: done, finishedAt: done, localPath: "p" } });
    expect((await state("backup")).state).toBe("active");
    await db.backupManifest.create({ data: { tenantId: t, kind: "scheduled", schemaVersion: "x", status: "failed", error: "disk full", startedAt: new Date(Date.now() + 1000), finishedAt: new Date(Date.now() + 1000) } });
    const r = await state("backup");
    expect(r.state).toBe("error");
    expect(r.lastError).toMatch(/disk full/);
  });

  it("WhatsApp delivery failures surface as an error with the last code", async () => {
    const t = (await ctxFor()).tenantId;
    for (let i = 0; i < 4; i++) await db.waMessage.create({ data: { tenantId: t, invoiceId: `i${i}`, invoiceNo: `N${i}`, recipient: "9822000999", idempotencyKey: `h:${i}`, status: "failed", errorCode: "131026", errorKind: "permanent", attempts: 3 } });
    const r = await state("whatsapp_delivery");
    expect(r.state).toBe("error");
    expect(r.lastError).toMatch(/131026/);
    await db.waMessage.create({ data: { tenantId: t, invoiceId: "ok", invoiceNo: "OK", recipient: "9822000998", idempotencyKey: "h:ok", status: "delivered", attempts: 1 } });
    expect((await state("whatsapp_delivery")).state).not.toBe("not_configured");
  });

  it("an explicit test is the only road to Tested/Active, and failures are stored, audited and retryable", async () => {
    process.env.OCR_ENGINE = "remote"; process.env.OCR_REMOTE_URL = "https://ocr.example.invalid/v1";
    const ctx = await ctxFor();
    expect((await state("ocr")).state).toBe("connected"); // configured but untested: not "working"

    const failed = await runHealthTest(ctx, "ocr", jsonRes(503));
    expect(failed.state).toBe("error");
    expect(failed.lastError).toMatch(/503/);
    const rec = await db.integrationHealth.findUniqueOrThrow({ where: { tenantId_key: { tenantId: ctx.tenantId, key: "ocr" } } });
    expect(rec.lastTestOk).toBe(false);
    expect(rec.lastSuccessAt).toBeNull();

    const throws = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
    expect((await runHealthTest(ctx, "ocr", throws)).lastError).toMatch(/ENOTFOUND/);

    const passed = await runHealthTest(ctx, "ocr", jsonRes(200)); // retry
    expect(passed.state).toBe("tested"); // reachable, but no document has been read yet: not Active
    expect(passed.lastSuccessAt).not.toBeNull();

    await db.scanDocument.create({ data: { tenantId: ctx.tenantId, fileName: "inv.pdf", sha256: "a", status: "review", extracted: {}, confidence: {}, createdBy: ctx.userId } });
    expect((await state("ocr")).state).toBe("active");

    await db.integrationHealth.update({ where: { id: rec.id }, data: { lastTestAt: new Date(Date.now() - 26 * 3600_000) } });
    expect((await state("ocr")).state).toBe("tested"); // stale test no longer supports Active

    const audits = await db.auditEvent.findMany({ where: { tenantId: ctx.tenantId, entity: "integration", action: { startsWith: "Integration test" } } });
    expect(audits.length).toBe(3); // 503, network error, pass
  });

  it("a tester that throws can never store a pass; unknown and live keys are refused", async () => {
    const ctx = await ctxFor();
    const bad = { ...TESTERS, gdrive: async () => { throw new Error("boom"); } };
    const r = await runHealthTest(ctx, "gdrive", fetch, bad);
    expect(r.state).toBe("not_configured"); // not connected: the failed test doesn't make it configured…
    const rec = await db.integrationHealth.findUniqueOrThrow({ where: { tenantId_key: { tenantId: ctx.tenantId, key: "gdrive" } } });
    expect(rec.lastTestOk).toBe(false);
    await expect(runHealthTest(ctx, "database")).rejects.toThrow(/automatically/);
    await expect(runHealthTest(ctx, "nonsense")).rejects.toThrow();
  });

  it("Google Drive and WhatsApp testers refuse when nothing is connected, with a clear reason", async () => {
    const ctx = await ctxFor();
    await expect(TESTERS.gdrive(ctx, fetch)).rejects.toThrow(/not connected/i);
    await expect(TESTERS.whatsapp(ctx, fetch)).rejects.toThrow(/not connected/i);
  });
});
