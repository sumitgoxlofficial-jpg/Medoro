/**
 * True when the pharmacy's records live in its Google Drive, not on Medoro's server: it signed up that way
 * ("driveOnly") or moved there (phase 7). Medoro's copy is then read-only (or gone) and isn't backed up.
 */
export const dataInDrive = (settings: unknown) => {
  const s = (settings ?? {}) as { driveOnly?: boolean; driveMove?: unknown };
  return s.driveOnly === true || !!s.driveMove;
};

/**
 * On Medoro's own hosted server (self sign-up open), every pharmacy must keep its records in its own Google Drive:
 * Medoro stores no bills, stock or customers. A pharmacy still on Medoro's copy must move it (read-only until then).
 * A pharmacy's own self-hosted server is its own database, so this doesn't apply there. Server-side only.
 */
export const driveRequired = () => process.env.PUBLIC_SIGNUP === "1";
export const mustMove = (settings: unknown) => driveRequired() && !dataInDrive(settings);

/** Warn when the pharmacy's Google Drive is this full: counters can't save copies to a full Drive. */
export const QUOTA_WARN = 0.9;
export type Quota = { usage: number; limit: number | null; at: string };

/** The Drive-full warning for the bell, from the last daily check (tenant.settings.driveHealth.quota). */
export function quotaProblem(q: Quota | undefined) {
  if (!q?.limit || q.usage / q.limit < QUOTA_WARN) return null;
  const gb = (b: number) => (b / 1024 ** 3).toFixed(1);
  return `Your Google Drive is ${Math.round((q.usage / q.limit) * 100)}% full (${gb(q.usage)} of ${gb(q.limit)} GB). When it is full, counters can’t save to it. Free up space or buy more Google storage.`;
}
