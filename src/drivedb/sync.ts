/**
 * Keeps every counter's device database in step through the owner's Google Drive (Medoro/<pharmacy>/drivedb):
 *   encryption-meta.json        keys (see keyring.ts)
 *   manifest.json               the current full copy, and how far into each device's changes it reaches
 *   pharmacy.db.enc             the latest full copy (encrypted)
 *   log-<device>-<clock>.enc    small encrypted batches of one device's changes
 * Each device uploads its own changes and applies everyone else's, in clock order. Restoring = latest copy +
 * every change after what it already holds. Change files are kept 7 days so a counter that was off can catch up.
 */
import { DriveDB } from "./client";
import type { DriveStore } from "./drive";
import { WrongKeyError } from "./crypto";
import { addDevice, createKeys, newDeviceKeys, openKeys, openWith, removeDevice, sealWith, type DeviceKeys, type KeyMeta, type Keyring, type Role } from "./keyring";
import { parseHlc } from "./hlc";
import { SCHEMA_VERSION } from "./schema";
import { seriesFor } from "./seed";

export const META = "encryption-meta.json", MANIFEST = "manifest.json", SNAPSHOT = "pharmacy.db.enc", LOG = "log-";
/** How long a device keeps its change files after they are in a full copy. */
export const RETAIN_MS = 7 * 24 * 3600_000;

export type Manifest = {
  v: 2; schema: number; snapshotAt: string; device: string; bytes: number;
  /** Per device: the last clock stamp of its changes contained in the full copy. */
  cursors: Record<string, string>;
  /** Per device: change files up to this clock were deleted (a device behind this must restore). */
  pruned: Record<string, string>;
};

/** Where this device keeps its own key pair (IndexedDB in the browser; memory in tests). */
export interface KeyStore { get(): Promise<DeviceKeys | null>; set(keys: DeviceKeys): Promise<void>; }

export class VaultLockedError extends Error {}
/** This device fell too far behind (or was removed): rebuild it from Drive. */
export class NeedsRestoreError extends Error {}

type Change = Parameters<DriveDB["applyRemote"]>[0];
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const dec = <T,>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T;

async function readJson<T>(store: DriveStore, name: string): Promise<{ id: string; value: T } | null> {
  const f = await store.find(name);
  return f ? { id: f.id, value: dec<T>(await store.read(f.id)) } : null;
}

export async function deviceKeys(keys: KeyStore): Promise<DeviceKeys> {
  const k = await keys.get();
  if (k) return k;
  const nk = await newDeviceKeys();
  await keys.set(nk);
  return nk;
}

export const vaultExists = async (store: DriveStore) => !!(await store.find(META));
export const readKeyMeta = async (store: DriveStore) => (await readJson<KeyMeta>(store, META))?.value ?? null;

/** First-time setup from the owner's device. Returns the recovery code to show once (it is never stored). */
export async function createVault(store: DriveStore, keys: KeyStore, device: string) {
  if (await vaultExists(store)) throw new Error("Drive storage is already set up for this pharmacy. Unlock it with the recovery code instead.");
  const { meta, ring, recoveryCode } = await createKeys(device, await deviceKeys(keys));
  await store.write(META, enc(meta));
  return { ring, recoveryCode };
}

/**
 * Opens the keys on this device. With the recovery code, the device is also added as an owner device (the code
 * holder is the owner), so next time no code is needed.
 */
export async function unlock(store: DriveStore, keys: KeyStore, device: string, recoveryCode?: string): Promise<Keyring> {
  const m = await readJson<KeyMeta>(store, META);
  if (!m) throw new Error("Drive storage isn’t set up yet.");
  if (m.value.v !== 2) throw new Error("Drive storage was set up by an older test version. Set it up again.");
  const dk = await keys.get();
  let ring: Keyring | null = null;
  try { ring = await openKeys(m.value, device, dk); } catch (e) { if (!(e instanceof WrongKeyError) || !recoveryCode) throw e; }
  if (ring) return ring;
  if (!recoveryCode) throw new VaultLockedError("Enter the Drive recovery code to open the pharmacy on this device.");
  ring = (await openKeys(m.value, device, null, recoveryCode))!;
  const mine = await deviceKeys(keys);
  await store.write(META, enc(await addDevice(m.value, ring, device, mine.publicJwk, "owner", "Owner’s device")), m.id);
  return ring;
}

/** Owner's device approves another device (staff or owner) by giving it the keys. */
export async function approveDevice(store: DriveStore, ring: Keyring, device: string, publicJwk: JsonWebKey, role: Role, name: string) {
  const m = await readJson<KeyMeta>(store, META);
  if (!m) throw new Error("Drive storage isn’t set up yet.");
  await store.write(META, enc(await addDevice(m.value, ring, device, publicJwk, role, name)), m.id);
}

/** Owner's device removes a device; new changes use a new key that device never gets. Returns the new keyring. */
export async function revokeDevice(store: DriveStore, ring: Keyring, device: string): Promise<Keyring> {
  const m = await readJson<KeyMeta>(store, META);
  if (!m) throw new Error("Drive storage isn’t set up yet.");
  const r = await removeDevice(m.value, ring, device);
  await store.write(META, enc(r.meta), m.id);
  return r.ring;
}

/** Re-reads the keys (another owner device may have changed them). */
export async function refreshKeys(store: DriveStore, keys: KeyStore, device: string): Promise<Keyring | null> {
  const m = await readKeyMeta(store);
  const dk = await keys.get();
  if (!m || !dk) return null;
  return openKeys(m, device, dk).catch(() => null);
}

const logName = (device: string, lastClock: string) => `${LOG}${device}-${lastClock}.enc`;
const logClock = (name: string) => /-(\d{13}-\d{4}-[A-Za-z0-9_]+)\.enc$/.exec(name)?.[1] ?? "";
const logDevice = (name: string) => { const c = logClock(name); return c ? parseHlc(c).device : ""; };
const cursorKey = (device: string) => `pull:${device}`;

/** Uploads this device's pending changes as one encrypted log file. Returns how many were sent. */
export async function pushChanges(db: DriveDB, store: DriveStore, ring: Keyring, max = 5000): Promise<number> {
  const changes = db.pendingChanges(max);
  if (!changes.length) return 0;
  const last = changes[changes.length - 1];
  await store.write(logName(db.device, last.clock), await sealWith(ring, "log", enc(changes)));
  db.markPushed(last.seq);
  return changes.length;
}

/**
 * Downloads other devices' new change files and applies them in clock order. Returns how many changes were
 * applied. Throws NeedsRestoreError if files this device needed were already deleted.
 */
export async function pullChanges(db: DriveDB, store: DriveStore, ring: Keyring): Promise<number> {
  const manifest = (await readJson<Manifest>(store, MANIFEST))?.value;
  const files = (await store.list(LOG)).map((f) => ({ ...f, clock: logClock(f.name), device: logDevice(f.name) }))
    .filter((f) => f.clock && f.device && f.device !== db.device);
  const byDevice = new Map<string, typeof files>();
  for (const f of files) byDevice.set(f.device, [...(byDevice.get(f.device) ?? []), f]);
  // Another device deleted change files this device never read: only a restore can bring those back.
  for (const [device, pruned] of Object.entries(manifest?.pruned ?? {})) {
    if (device !== db.device && pruned && (db.getMeta(cursorKey(device)) ?? "") < pruned) {
      throw new NeedsRestoreError("This counter was offline too long and missed changes. Restore it from Google Drive.");
    }
  }
  const changes: (Change & { from: string })[] = [];
  const newCursor = new Map<string, string>();
  for (const [device, list] of byDevice) {
    const cursor = db.getMeta(cursorKey(device)) ?? "";
    for (const f of list.filter((x) => x.clock > cursor).sort((a, b) => (a.clock < b.clock ? -1 : 1))) {
      for (const c of dec<Change[]>(await openWith(ring, "log", await store.read(f.id)))) if (c.clock > cursor) changes.push({ ...c, from: device });
      newCursor.set(device, f.clock);
    }
  }
  changes.sort((a, b) => (a.clock < b.clock ? -1 : a.clock > b.clock ? 1 : 0));
  db.transaction(() => {
    for (const c of changes) db.applyRemote(c);
    for (const [d, c] of newCursor) db.setMeta(cursorKey(d), c);
  });
  return changes.length;
}

/**
 * Saves a full encrypted copy (owner devices), after catching up with everyone. Then deletes this device's own
 * change files that are in the copy and older than 7 days, and drops uploaded change records locally.
 */
export async function writeSnapshot(db: DriveDB, store: DriveStore, ring: Keyring, exportDb: () => Uint8Array, now = Date.now()): Promise<Manifest> {
  await pullChanges(db, store, ring);
  while (await pushChanges(db, store, ring)) { /* send everything first */ }
  const own = db.clock.current;
  db.pruneChanges(own);
  const bytes = exportDb();
  const sealed = await seal(ring, bytes);
  const existing = await store.find(SNAPSHOT);
  await store.write(SNAPSHOT, sealed, existing?.id);
  const old = (await readJson<Manifest>(store, MANIFEST));
  const cursors: Record<string, string> = { [db.device]: own };
  for (const f of await store.list(LOG)) { const d = logDevice(f.name); if (d && d !== db.device) cursors[d] = db.getMeta(cursorKey(d)) ?? ""; }
  const pruned: Record<string, string> = { ...(old?.value.pruned ?? {}) };
  for (const f of await store.list(`${LOG}${db.device}-`)) {
    const c = logClock(f.name);
    if (c && c <= own && now - parseHlc(c).ms > RETAIN_MS) { await store.remove(f.id); if (c > (pruned[db.device] ?? "")) pruned[db.device] = c; }
  }
  const manifest: Manifest = { v: 2, schema: SCHEMA_VERSION, snapshotAt: new Date(now).toISOString(), device: db.device, bytes: bytes.length, cursors, pruned };
  await store.write(MANIFEST, enc(manifest), old?.id);
  db.setMeta("lastSnapshot", manifest.snapshotAt);
  return manifest;
}
const seal = (ring: Keyring, bytes: Uint8Array) => sealWith(ring, "snapshot", bytes);

/**
 * Rebuilds the pharmacy on this device from Drive: latest full copy, then every change after what it holds.
 * `importDb` turns the copy's bytes into an open DriveDB for this device. The device gets its own invoice series.
 */
export async function restoreFromDrive(store: DriveStore, ring: Keyring, device: string, importDb: (bytes: Uint8Array) => DriveDB | Promise<DriveDB>) {
  const m = await readJson<Manifest>(store, MANIFEST);
  if (!m) throw new Error("No copy of the pharmacy has been saved to Drive yet.");
  if (m.value.schema > SCHEMA_VERSION) throw new Error("The copy in Drive was saved by a newer version of Medoro. Update the app first.");
  const snap = await store.find(SNAPSHOT);
  if (!snap) throw new Error("The saved copy is missing from Drive.");
  const db = await importDb(await openWith(ring, "snapshot", await store.read(snap.id)));
  const cursors = m.value.cursors ?? {};
  // The copy holds everyone's changes up to its cursors; carry on from there (including this device's old id).
  db.transaction(() => { for (const [d, c] of Object.entries(cursors)) db.setMeta(cursorKey(d), c); });
  const applied = await pullChangesFrom(db, store, ring, cursors);
  const series = seriesFor(device);
  db.setMeta("series", series);
  resumeNumbering(db, series);
  return { db, snapshotAt: m.value.snapshotAt, applied };
}

/** Like pullChanges, but also applies files from the snapshot's own device (a restore takes over from a copy). */
async function pullChangesFrom(db: DriveDB, store: DriveStore, ring: Keyring, cursors: Record<string, string>) {
  const files = (await store.list(LOG)).map((f) => ({ ...f, clock: logClock(f.name), device: logDevice(f.name) })).filter((f) => f.clock && f.clock > (cursors[f.device] ?? ""));
  const changes: Change[] = [];
  const last = new Map<string, string>();
  for (const f of files.sort((a, b) => (a.clock < b.clock ? -1 : 1))) {
    for (const c of dec<Change[]>(await openWith(ring, "log", await store.read(f.id)))) if (c.clock > (cursors[f.device] ?? "")) changes.push(c);
    if (f.clock > (last.get(f.device) ?? "")) last.set(f.device, f.clock);
  }
  changes.sort((a, b) => (a.clock < b.clock ? -1 : a.clock > b.clock ? 1 : 0));
  db.transaction(() => { for (const c of changes) db.applyRemote(c); for (const [d, c] of last) db.setMeta(cursorKey(d), c); });
  return changes.length;
}

/** Drive status for the screen. */
export async function driveStatus(store: DriveStore) {
  const m = await readJson<Manifest>(store, MANIFEST);
  return { vault: await vaultExists(store), snapshotAt: m?.value.snapshotAt ?? null, snapshotBytes: m?.value.bytes ?? 0 };
}

/**
 * Invoice and credit-note counters live on each device and aren't in a full copy, so after a restore this
 * device carries on after the highest number it already used (the same device id keeps the same series).
 */
export function resumeNumbering(db: DriveDB, series: string) {
  const rows = [
    ...db.engine.all<{ no: string }>("SELECT invoiceNo AS no FROM sale WHERE invoiceNo LIKE ?", [`${series}%`]).map((r) => ({ kind: "INV", prefix: series, no: String(r.no) })),
    ...db.engine.all<{ no: string }>("SELECT creditNoteNo AS no FROM salesReturn WHERE creditNoteNo LIKE ?", [`CN${series}%`]).map((r) => ({ kind: "CN", prefix: `CN${series}`, no: String(r.no) })),
  ];
  const top = new Map<string, number>();
  for (const r of rows) {
    const m = new RegExp(`^${r.prefix}(\\d{4})-(\\d+)$`).exec(r.no);
    if (!m) continue;
    const key = `${r.kind}:${series}:${m[1]}`, n = Number(m[2]);
    if (n > (top.get(key) ?? 0)) top.set(key, n);
  }
  db.transaction(() => { for (const [k, n] of top) db.engine.run("INSERT INTO sequence (name, next) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next = MAX(next, excluded.next)", [k, n + 1]); });
}
