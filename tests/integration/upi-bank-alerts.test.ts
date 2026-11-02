import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { setDriveMode } from "@/domain/system/drive-mode";
import { registerDevice, relay } from "@/domain/system/drivedb-relay";
import { financeAlerts, financeCounts } from "@/domain/reports/alerts";
import { driveHealthTick } from "@/domain/system/drive-health";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = { kty: "RSA" as const, n: "n".repeat(342), e: "AQAB" };
const P = (o: Record<string, string>) => new URLSearchParams(o);

describe("UPI & Bank alerts from the counters (counts only)", () => {
  const prev = process.env.E2E_FAKE_DRIVE;
  let tenantId = "";
  beforeAll(async () => {
    process.env.E2E_FAKE_DRIVE = "1"; delete process.env.VERCEL;
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    tenantId = ctx.tenantId;
    await setDriveMode(ctx, true);
    await registerDevice(ctx, { deviceId: "OWN1", name: "Counter PC", publicKey: key });
  });
  afterAll(() => { if (prev === undefined) delete process.env.E2E_FAKE_DRIVE; else process.env.E2E_FAKE_DRIVE = prev; });

  it("keeps only whole numbers and a date from the health report", async () => {
    const owner = await ctxFor();
    await relay(owner, "OWN1", "health", P({ ok: "1" }), Buffer.alloc(0));
    expect(await financeCounts(tenantId)).toBeNull(); // no statement on the counter yet: nothing reported
    await relay(owner, "OWN1", "health", P({ ok: "1", finNotSeen: "2", finReview: "-5", finUnmatched: "1e9", finTo: "<b>x</b>", name: "Rahul" }), Buffer.alloc(0));
    const d = await db.driveDevice.findFirstOrThrow({ where: { tenantId } });
    expect(d.finAlerts).toEqual({ notSeen: 2, review: 0, unmatched: 0, statementTo: null });
    await relay(owner, "OWN1", "health", P({ ok: "1", finNotSeen: "1", finReview: "1", finUnmatched: "4", finTo: "2026-11-05" }), Buffer.alloc(0));
    expect(await financeAlerts(tenantId)).toEqual([
      expect.stringMatching(/^1 UPI payment\(s\) taken at the counter are not in your bank statement \(statements up to 2026-11-05\)/),
      expect.stringMatching(/^1 bank transaction\(s\) may be duplicates/),
      "4 payment(s) received in the bank aren’t matched to a bill yet.",
    ]);
  });

  it("unmatched credits alone don't trigger an email; old reports are ignored", async () => {
    const owner = await ctxFor();
    await relay(owner, "OWN1", "health", P({ ok: "1", finNotSeen: "0", finReview: "0", finUnmatched: "7" }), Buffer.alloc(0));
    expect(await financeAlerts(tenantId)).toEqual([]);
    await relay(owner, "OWN1", "health", P({ ok: "1", finNotSeen: "3", finReview: "0", finUnmatched: "0" }), Buffer.alloc(0));
    expect(await financeAlerts(tenantId, new Date(Date.now() + 4 * 86400_000))).toEqual([]);
  });

  it("the owner's daily email lists counter UPI missing from the bank, even when Drive is fine", async () => {
    vi.stubEnv("MAIL_PROVIDER", "console");
    const mails: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((m: unknown) => { mails.push(String(m)); });
    try {
      await driveHealthTick(new Date(), async () => ({ usage: 1, limit: 15 * 1024 ** 3 }));
      const owner = await db.user.findFirstOrThrow({ where: { tenantId, role: { name: "Owner" } } });
      const sent = mails.filter((m) => m.startsWith(`[mail] to ${owner.email}`));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatch(/payments to check/);
      expect(sent[0]).toMatch(/3 UPI payment\(s\) taken at the counter are not in your bank statement/);
      expect(sent[0]).not.toMatch(/Google Drive need a look/);
    } finally { spy.mockRestore(); vi.unstubAllEnvs(); }
  });
});
