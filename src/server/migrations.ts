import { readdir } from "node:fs/promises";
import path from "node:path";

export type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };
export type MigrationStatus = { known: boolean; applied: number; pending: string[]; failed: string[] };

export const migrationsDir = () => process.env.MIGRATIONS_DIR || path.join(process.cwd(), "prisma", "migrations");

/** Migration folder names shipped with this build, or null when the folder isn't deployed with the app. */
export async function shippedMigrations(dir = migrationsDir()): Promise<string[] | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name)).map((e) => e.name).sort();
  } catch {
    return null;
  }
}

/** Compares shipped migrations with the database's `_prisma_migrations` rows (null when the table doesn't exist yet). */
export function compareMigrations(shipped: string[] | null, rows: MigrationRow[] | null): MigrationStatus {
  const live = (rows ?? []).filter((r) => !r.rolled_back_at);
  const applied = new Set(live.filter((r) => r.finished_at).map((r) => r.migration_name));
  const failed = live.filter((r) => !r.finished_at).map((r) => r.migration_name);
  if (!shipped) return { known: false, applied: applied.size, pending: [], failed };
  return { known: true, applied: applied.size, pending: shipped.filter((m) => !applied.has(m)), failed };
}

export const MIGRATIONS_SQL = `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;

export const isMissingTable = (e: unknown) => !!e && typeof e === "object" && (("code" in e && e.code === "42P01") || /_prisma_migrations.*does not exist|relation .* does not exist/i.test(String((e as Error).message ?? "")));
