/**
 * Pharmacy-wide settings every counter shares (table `setting`, migration 9). A change on one counter reaches the
 * others with the next sync; if two counters change the same setting, the later change wins.
 */
import type { DriveDB } from "./client";

/** A shared setting, or `legacy` (a value this counter kept for itself before settings were shared), or null. */
export function getSetting<T>(db: DriveDB, key: string, legacy?: () => T | null): T | null {
  const row = db.from<{ value: string }>("setting").eq("id", key).first();
  if (row) { try { return JSON.parse(row.value) as T; } catch { return null; } }
  return legacy ? legacy() : null;
}

export function setSetting(db: DriveDB, key: string, value: unknown) {
  const v = JSON.stringify(value);
  const cur = db.from<{ value: string }>("setting").eq("id", key).first();
  if (cur?.value === v) return; // no change: don't sync a no-op
  db.from("setting").upsert({ id: key, value: v });
}
