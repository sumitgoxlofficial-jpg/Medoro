import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { distCtxFrom } from "@/domain/distribution/context";
import { resetDb } from "./helpers";
import { distCtx, makeDistributor } from "./dist-helpers";

/** On the hosted server without DIST_HOSTED, a distributor still on Medoro's copy must move; one already in Drive must not. */
describe("a distributor and the move to Google Drive", () => {
  beforeAll(async () => { await resetDb(); await makeDistributor(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const setSettings = async (extra: Record<string, unknown>) => {
    const c = await distCtx();
    await db.tenant.update({ where: { id: c.tenantId }, data: { settings: extra as object } });
    return c;
  };

  it("may stay on Medoro's server while DIST_HOSTED is set", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "1"); vi.stubEnv("DIST_HOSTED", "1");
    const d = await distCtxFrom(await setSettings({}));
    expect(d).toMatchObject({ moved: false, mustMove: false });
  });

  it("must move once DIST_HOSTED is removed", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "1"); vi.stubEnv("DIST_HOSTED", "");
    expect(await distCtxFrom(await setSettings({}))).toMatchObject({ moved: false, mustMove: true });
  });

  it("is not asked again after moving, or when it signed up into Drive", async () => {
    vi.stubEnv("PUBLIC_SIGNUP", "1"); vi.stubEnv("DIST_HOSTED", "");
    expect(await distCtxFrom(await setSettings({ driveMode: true, driveMove: { state: "moved" } }))).toMatchObject({ moved: true, mustMove: false });
    expect(await distCtxFrom(await setSettings({ driveMode: true, driveOnly: true }))).toMatchObject({ moved: true, mustMove: false });
  });
});
