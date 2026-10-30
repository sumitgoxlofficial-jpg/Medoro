import { Client } from "pg";
import { compareMigrations, isMissingTable, MIGRATIONS_SQL, shippedMigrations, type MigrationRow } from "./migrations";
import { log } from "./log";

/** Throws when the database is behind (or ahead of a failed) migration set, so production never runs on a mismatched schema. */
export async function assertMigrationsApplied() {
  if (process.env.SKIP_MIGRATION_CHECK === "1") { log.warn("Migration check skipped (SKIP_MIGRATION_CHECK=1)."); return; }
  const shipped = await shippedMigrations();
  if (!shipped) { log.warn("Migration check skipped: prisma/migrations isn't deployed with this build.", { dir: process.env.MIGRATIONS_DIR ?? "prisma/migrations" }); return; }
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  let rows: MigrationRow[] | null = null;
  try {
    await c.connect();
    rows = (await c.query<MigrationRow>(MIGRATIONS_SQL)).rows;
  } catch (e) {
    if (!isMissingTable(e)) { log.error("Migration check couldn't reach the database; /api/ready will report it.", { err: e }); return; }
  } finally {
    await c.end().catch(() => {});
  }
  const s = compareMigrations(shipped, rows);
  if (s.pending.length || s.failed.length) {
    log.error("Database migrations are not applied. Run `prisma migrate deploy` (docker compose runs the migrate service), then start Medoro again. Set SKIP_MIGRATION_CHECK=1 only to override knowingly.", { pending: s.pending, failed: s.failed });
    throw new Error(`Medoro refused to start: ${s.pending.length} pending and ${s.failed.length} failed database migration(s).`);
  }
  log.info("Database migrations up to date.", { applied: s.applied });
}
