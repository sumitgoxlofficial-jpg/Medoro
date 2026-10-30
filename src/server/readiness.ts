import "server-only";
import { db } from "./db";
import { checkEnv } from "@/env-check";
import { compareMigrations, isMissingTable, MIGRATIONS_SQL, shippedMigrations, type MigrationRow } from "./migrations";
import { log } from "./log";

export type Readiness = { ready: boolean; checks: { database: "ok" | "unreachable"; migrations: "ok" | "pending" | "failed" | "unknown"; env: "ok" | "invalid" }; pendingMigrations?: number };

/** Readiness for load balancers and compose healthchecks. Reports states and counts only, never values. */
export async function readiness(): Promise<Readiness> {
  let database: Readiness["checks"]["database"] = "ok";
  let rows: MigrationRow[] | null = null;
  try {
    await db.$queryRaw`SELECT 1`;
    try { rows = await db.$queryRawUnsafe<MigrationRow[]>(MIGRATIONS_SQL); } catch (e) { if (!isMissingTable(e)) throw e; }
  } catch (e) {
    database = "unreachable";
    log.warn("Readiness: database unreachable.", { err: e });
  }
  let migrations: Readiness["checks"]["migrations"] = "unknown";
  let pending: number | undefined;
  if (database === "ok") {
    const s = compareMigrations(await shippedMigrations(), rows);
    migrations = s.failed.length ? "failed" : !s.known ? "unknown" : s.pending.length ? "pending" : "ok";
    if (s.pending.length) pending = s.pending.length;
  }
  const problems = process.env.NODE_ENV === "production" ? checkEnv() : [];
  if (problems.length) log.warn("Readiness: configuration problems.", { problems });
  const env = problems.length ? "invalid" : "ok";
  return { ready: database === "ok" && (migrations === "ok" || migrations === "unknown") && env === "ok", checks: { database, migrations, env }, ...(pending ? { pendingMigrations: pending } : {}) };
}
