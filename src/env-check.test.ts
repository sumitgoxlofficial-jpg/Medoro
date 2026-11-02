import { describe, expect, it } from "vitest";
import { checkEnv, previewDefaults } from "./env-check";

const base = { NODE_ENV: "production" as const, DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(40), HOST_KEY: "h".repeat(40), DIRECT_URL: "postgres://y", CRON_SECRET: "c".repeat(20), VERCEL: "1" };

describe("Vercel preview deployments", () => {
  it("use the preview's own address when APP_URL isn't set for previews", () => {
    const env: NodeJS.ProcessEnv = { ...base, VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "medoro-git-feature-s-fafe.vercel.app", VERCEL_URL: "medoro-abc123.vercel.app" };
    expect(checkEnv(env)).toEqual([]);
    expect(env.APP_URL).toBe("https://medoro-git-feature-s-fafe.vercel.app");
  });
  it("never change production's address, or an APP_URL set for previews", () => {
    const prod: NodeJS.ProcessEnv = { ...base, VERCEL_ENV: "production", VERCEL_URL: "medoro-abc.vercel.app" };
    previewDefaults(prod);
    expect(prod.APP_URL).toBeUndefined();
    expect(checkEnv(prod)).toContain("APP_URL is not set (public address used in links and webhooks).");
    const set: NodeJS.ProcessEnv = { ...base, VERCEL_ENV: "preview", APP_URL: "https://preview.medoro.in", VERCEL_URL: "x.vercel.app" };
    previewDefaults(set);
    expect(set.APP_URL).toBe("https://preview.medoro.in");
  });
});
