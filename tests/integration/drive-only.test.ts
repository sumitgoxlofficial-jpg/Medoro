import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { applyRetention, retentionPreview, DRIVE_MESSAGE_DAYS } from "@/domain/system/retention";
import { dailyJobs } from "@/domain/system/daily";
import { resetDb, makePharmacy } from "./helpers";

const ago = (d: number) => new Date(Date.now() - d * 86400_000);

describe("pharmacies whose records live in Google Drive keep no extra customer data on the server", () => {
  let T = "";
  beforeAll(async () => { await resetDb(); await makePharmacy(); T = (await db.tenant.findFirstOrThrow()).id; });

  const msg = (key: string, status: "queued" | "sent" | "failed", days: number) =>
    db.waMessage.create({ data: { tenantId: T, invoiceId: "inv-" + key, invoiceNo: key, recipient: "9822000111", idempotencyKey: "drive:" + key, status, attempts: 1, payload: { ch: "wa", text: "hello Asha" }, createdAt: ago(days) } });

  it("a server-hosted pharmacy keeps the 1-year window", async () => {
    await msg("a", "sent", 10);
    expect((await retentionPreview(T)).counts.whatsapp).toBe(0);
  });

  it("a Drive pharmacy has finished messages redacted after 7 days, and queued ones untouched", async () => {
    await db.tenant.update({ where: { id: T }, data: { settings: { driveOnly: true } } });
    await msg("old-sent", "sent", DRIVE_MESSAGE_DAYS + 1);
    await msg("old-queued", "queued", DRIVE_MESSAGE_DAYS + 1);
    await msg("fresh", "sent", 1);
    const pre = await retentionPreview(T);
    expect(pre.counts.whatsapp).toBe(2); // "a" (10 days, sent) and "old-sent"
    await applyRetention(T);
    const by = async (k: string) => db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: "drive:" + k } });
    expect(await by("old-sent")).toMatchObject({ recipient: "redacted", payload: null });
    expect(await by("a")).toMatchObject({ recipient: "redacted", payload: null });
    expect(await by("old-queued")).toMatchObject({ recipient: "9822000111" });
    expect(await by("fresh")).toMatchObject({ recipient: "9822000111" });
  });

  it("the daily server-side analysis jobs write nothing for a Drive pharmacy", async () => {
    await db.integrationHealth.deleteMany({ where: { tenantId: T } });
    await db.complianceReminder.deleteMany({ where: { tenantId: T } });
    await db.forecastSnapshot.deleteMany({ where: { tenantId: T } });
    await db.tenant.update({ where: { id: T }, data: { settings: { driveOnly: true, jobs: { daily: "1999-01-01" } } } });
    const out = await dailyJobs();
    expect(out).toHaveLength(1);
    expect(out[0].compliance).toBeUndefined();
    expect(out[0].audit).toBeUndefined();
    expect(await db.integrationHealth.count({ where: { tenantId: T } })).toBe(0);
    expect(await db.forecastSnapshot.count({ where: { tenantId: T } })).toBe(0);
  });

  it("a server-hosted pharmacy still gets them", async () => {
    await db.tenant.update({ where: { id: T }, data: { settings: { jobs: { daily: "1999-01-01" } } } });
    const out = await dailyJobs();
    expect(out[0].audit).toBeDefined();
  });
});
