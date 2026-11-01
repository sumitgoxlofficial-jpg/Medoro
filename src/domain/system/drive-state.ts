/**
 * True when the pharmacy's records live in its Google Drive, not on Medoro's server: it signed up that way
 * ("driveOnly") or moved there (phase 7). Medoro's copy is then read-only (or gone) and isn't backed up.
 */
export const dataInDrive = (settings: unknown) => {
  const s = (settings ?? {}) as { driveOnly?: boolean; driveMove?: unknown };
  return s.driveOnly === true || !!s.driveMove;
};
