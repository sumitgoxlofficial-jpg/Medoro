import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareMigrations, isMissingTable, shippedMigrations } from "./migrations";

const row = (migration_name: string, done = true, rolled = false) => ({ migration_name, finished_at: done ? new Date() : null, rolled_back_at: rolled ? new Date() : null });

describe("migration check", () => {
  it("finds pending and failed migrations", () => {
    const shipped = ["20260101000000_a", "20260102000000_b", "20260103000000_c"];
    expect(compareMigrations(shipped, [row("20260101000000_a"), row("20260102000000_b")])).toEqual({ known: true, applied: 2, pending: ["20260103000000_c"], failed: [] });
    expect(compareMigrations(shipped, [row("20260101000000_a"), row("20260102000000_b", false)]).failed).toEqual(["20260102000000_b"]);
    expect(compareMigrations(shipped, [row("20260101000000_a"), row("20260102000000_b", false, true), row("20260102000000_b"), row("20260103000000_c")]).pending).toEqual([]);
    expect(compareMigrations(shipped, null).pending).toHaveLength(3);
    expect(compareMigrations(null, [row("x")]).known).toBe(false);
  });

  it("reads migration folders and recognises a missing table", async () => {
    const dir = await mkdtemp(path.join(process.cwd(), ".medoro-mig-"));
    try {
      await mkdir(path.join(dir, "20260102000000_b"));
      await mkdir(path.join(dir, "20260101000000_a"));
      await mkdir(path.join(dir, "not_a_migration"));
      expect(await shippedMigrations(dir)).toEqual(["20260101000000_a", "20260102000000_b"]);
      expect(await shippedMigrations(path.join(dir, "missing"))).toBeNull();
    } finally { await rm(dir, { recursive: true, force: true }); }
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable(new Error('relation "_prisma_migrations" does not exist'))).toBe(true);
    expect(isMissingTable(new Error("connection refused"))).toBe(false);
  });

  it("covers every migration folder in this repository", async () => {
    const mine = await shippedMigrations(path.join(process.cwd(), "prisma", "migrations"));
    expect(mine?.length).toBeGreaterThan(10);
  });
});
