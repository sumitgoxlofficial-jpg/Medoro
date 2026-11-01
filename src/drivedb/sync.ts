/**
 * Keeps a device database safe in the owner's Google Drive (folder Medoro/<pharmacy>/drivedb):
 *   encryption-meta.json   the data key, wrapped for the recovery code and for each device
 *   manifest.json          which snapshot is current and up to which clock stamp it holds
 *   pharmacy.db.enc        the latest full copy of the database (encrypted)
 *   log-<device>-<clock>.enc  small encrypted batches of changes made since
 * Restoring = latest snapshot + every log written after it.
 */
import { DriveDB } from "./client";
import type { DriveStore } from "./drive";
import { newDataKey, newDeviceKey, newRecoveryCode, open, seal, unwrapForDevice, unwrapWithRecovery, wrapForDevice, wrapForRecovery, WrongKeyError, type Wrap } from "./crypto";
import { SCHEMA_VERSION } from "./schema";
import { seriesFor } from "./seed";

export const META = "encryption-meta.json", MANIFEST = "manifest.json", SNAPSHOT = "pharmacy.db.enc", LOG = "log-";

export type EncryptionMeta = { v: 1; createdAt: string; recovery: Wrap; devices: Record<string, Wrap & { addedAt: string }> };
export type Manifest = { v: 1; schema: number; snapshotClock: string; snapshotAt: string; device: string; bytes: number };

/** Where this device keeps its own key (IndexedDB in the browser; memory in tests). */
export interface KeyStore { get(): Promise<CryptoKey | null>; set(key: CryptoKey): Promise<void>; }

export class VaultLockedError extends Error {}

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const dec = <T,>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T;

async function readJson<T>(store: DriveStore, name: string): Promise<{ id: string; value: T } | null> {
  const f = await store.find(name);
  return f ? { id: f.id, value: dec<T>(await store.read(f.id)) } : null;
}

async function deviceKey(keys: KeyStore) {
  const k = await keys.get();
  if (k) return k;
  const nk = await newDeviceKey();
  await keys.set(nk);
  return nk;
}

/** Is DriveDB set up in this Drive folder yet? */
export const vaultExists = async (store: DriveStore) => !!(await store.find(META));

/**
 * First-time setup: makes the data key and a recovery code, and stores the key wrapped for both.
 * The recovery code is returned once for the owner to save; it is never stored anywhere.
 */
export async function createVault(store: DriveStore, keys: KeyStore, device: string) {
  if (await vaultExists(store)) throw new Error("Drive storage is already set up for this pharmacy. Unlock it with the recovery code instead.");
  const dataKey = newDataKey(), recoveryCode = newRecoveryCode(), now = new Date().toISOString();
  const meta: EncryptionMeta = { v: 1, createdAt: now, recovery: await wrapForRecovery(dataKey, recoveryCode), devices: { [device]: { ...(await wrapForDevice(await deviceKey(keys), dataKey, device)), addedAt: now } } };
  await store.write(META, enc(meta));
  return { dataKey, recoveryCode };
}

/**
 * Opens the data key on this device: with its own key if it was approved before, otherwise with the recovery
 * code (then this device is added, so next time no code is needed).
 */
export async function unlock(store: DriveStore, keys: KeyStore, device: string, recoveryCode?: string): Promise<Uint8Array> {
  const m = await readJson<EncryptionMeta>(store, META);
  if (!m) throw new Error("Drive storage isn’t set up yet.");
  const mine = m.value.devices[device], key = await keys.get();
  if (mine && key) {
    try { return await unwrapForDevice(key, mine, device); } catch (e) { if (!(e instanceof WrongKeyError) || !recoveryCode) throw e; }
  }
  if (!recoveryCode) throw new VaultLockedError("Enter the Drive recovery code to open the pharmacy on this device.");
  const dataKey = await unwrapWithRecovery(m.value.recovery, recoveryCode);
  const meta: EncryptionMeta = { ...m.value, devices: { ...m.value.devices, [device]: { ...(await wrapForDevice(await deviceKey(keys), dataKey, device)), addedAt: new Date().toISOString() } } };
  await store.write(META, enc(meta), m.id);
  return dataKey;
}

const logName = (device: string, lastClock: string) => `${LOG}${device}-${lastClock}.enc`;
const logClock = (name: string) => /-(\d{13}-\d{4}-[A-Za-z0-9_]+)\.enc$/.exec(name)?.[1] ?? "";

/** Uploads this device's pending changes as one encrypted log file. Returns how many were sent. */
export async function pushChanges(db: DriveDB, store: DriveStore, dataKey: Uint8Array, max = 5000): Promise<number> {
  const changes = db.pendingChanges(max);
  if (!changes.length) return 0;
  const last = changes[changes.length - 1];
  await store.write(logName(db.device, last.clock), await seal(dataKey, "log", enc(changes)));
  db.markPushed(last.seq);
  return changes.length;
}

/**
 * Saves a full encrypted copy of the database, then tidies up: logs it already contains are deleted from Drive
 * and uploaded change records are dropped locally. `exportDb` returns the database file bytes.
 */
export async function writeSnapshot(db: DriveDB, store: DriveStore, dataKey: Uint8Array, exportDb: () => Uint8Array): Promise<Manifest> {
  while (await pushChanges(db, store, dataKey)) { /* send everything first */ }
  const clock = db.clock.current;
  db.pruneChanges(clock);
  const bytes = exportDb();
  const sealed = await seal(dataKey, "snapshot", bytes);
  const existing = await store.find(SNAPSHOT);
  await store.write(SNAPSHOT, sealed, existing?.id);
  const manifest: Manifest = { v: 1, schema: SCHEMA_VERSION, snapshotClock: clock, snapshotAt: new Date().toISOString(), device: db.device, bytes: bytes.length };
  const m = await store.find(MANIFEST);
  await store.write(MANIFEST, enc(manifest), m?.id);
  db.setMeta("lastSnapshot", manifest.snapshotAt);
  // Only this device's logs: another device's changes aren't in this snapshot until sync applies them (phase 4).
  for (const f of await store.list(`${LOG}${db.device}-`)) if (logClock(f.name) && logClock(f.name) <= clock) await store.remove(f.id);
  return manifest;
}

/**
 * Rebuilds the pharmacy on this device from Drive: latest snapshot, then every change logged after it.
 * `importDb` turns snapshot bytes into an open DriveDB for this device. The device gets its own invoice series.
 */
export async function restoreFromDrive(store: DriveStore, dataKey: Uint8Array, device: string, importDb: (bytes: Uint8Array) => DriveDB | Promise<DriveDB>) {
  const m = await readJson<Manifest>(store, MANIFEST);
  if (!m) throw new Error("No copy of the pharmacy has been saved to Drive yet.");
  if (m.value.schema > SCHEMA_VERSION) throw new Error("The copy in Drive was saved by a newer version of Medoro. Update the app first.");
  const snap = await store.find(SNAPSHOT);
  if (!snap) throw new Error("The saved copy is missing from Drive.");
  const db = await importDb(await open(dataKey, "snapshot", await store.read(snap.id)));
  let applied = 0;
  const logs = (await store.list(LOG)).filter((f) => logClock(f.name) > m.value.snapshotClock).sort((a, b) => (logClock(a.name) < logClock(b.name) ? -1 : 1));
  for (const f of logs) {
    const changes = dec<Parameters<DriveDB["applyRemote"]>[0][]>(await open(dataKey, "log", await store.read(f.id)));
    for (const c of changes) if (c.clock > m.value.snapshotClock) { db.applyRemote(c); applied++; }
  }
  db.setMeta("series", seriesFor(device));
  return { db, snapshotAt: m.value.snapshotAt, applied };
}

/** Drive status for the screen. */
export async function driveStatus(store: DriveStore) {
  const m = await readJson<Manifest>(store, MANIFEST);
  return { vault: await vaultExists(store), snapshotAt: m?.value.snapshotAt ?? null, snapshotBytes: m?.value.bytes ?? 0 };
}
