/**
 * DriveDB keys (encryption-meta.json, version 2).
 *
 *   recovery code ──► pharmacy key (RK) ──► data key v1, v2, …   (every file says which version sealed it)
 *   owner device  ──► RK                    (an owner device can approve devices and change keys)
 *   staff device  ──────────────────────► data keys it was given  (never RK)
 *
 * Each device has an RSA-OAEP key pair made in the browser; the private half can't be exported, the public half
 * is published so the owner's device can wrap keys for it. Removing a device adds a new data key that only the
 * remaining devices receive, so it can't read anything written afterwards.
 */
import { WrongKeyError, decodeCode, newDataKey, newRecoveryCode, type Wrap } from "./crypto";

const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const buf = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>;
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const txt = (s: string) => new TextEncoder().encode(s);

export type DeviceKeys = { privateKey: CryptoKey; publicJwk: JsonWebKey };
export type Role = "owner" | "staff";
export type KeyMeta = {
  v: 2;
  createdAt: string;
  /** RK wrapped by the recovery code. */
  recovery: Wrap;
  /** RK wrapped for each owner device (RSA-OAEP, base64). */
  owners: Record<string, string>;
  /** Data keys, oldest first. `rk`: wrapped by RK; `devices`: wrapped for each device allowed to read it. */
  keys: { v: number; createdAt: string; rk: Wrap; devices: Record<string, string> }[];
  devices: Record<string, { publicJwk: JsonWebKey; role: Role; name: string; addedAt: string }>;
};
export type Keyring = { current: { v: number; key: Uint8Array }; byVersion: Map<number, Uint8Array>; rk: Uint8Array | null };

const RSA = { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;

/** A new device key pair. The private key can't be read out of the browser, only used. */
export async function newDeviceKeys(): Promise<DeviceKeys> {
  const pair = (await subtle().generateKey(RSA, false, ["encrypt", "decrypt"])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicJwk: await subtle().exportKey("jwk", pair.publicKey) };
}

async function rsaWrap(publicJwk: JsonWebKey, secret: Uint8Array) {
  const pub = await subtle().importKey("jwk", publicJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  return b64(new Uint8Array(await subtle().encrypt({ name: "RSA-OAEP" }, pub, buf(secret))));
}
async function rsaUnwrap(privateKey: CryptoKey, wrapped: string) {
  try { return new Uint8Array(await subtle().decrypt({ name: "RSA-OAEP" }, privateKey, buf(unb64(wrapped)))); }
  catch { throw new WrongKeyError("This device’s key no longer opens the data."); }
}
async function aesWrap(keyBytes: Uint8Array, secret: Uint8Array, label: string): Promise<Wrap> {
  const k = await subtle().importKey("raw", buf(keyBytes), "AES-GCM", false, ["encrypt"]);
  const iv = rand(12);
  return { iv: b64(iv), ct: b64(new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: txt(label) }, k, buf(secret)))) };
}
async function aesUnwrap(keyBytes: Uint8Array, w: Wrap, label: string, wrong: string) {
  const k = await subtle().importKey("raw", buf(keyBytes), "AES-GCM", false, ["decrypt"]);
  try { return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: buf(unb64(w.iv)), additionalData: txt(label) }, k, buf(unb64(w.ct)))); }
  catch { throw new WrongKeyError(wrong); }
}

const ringFrom = (keys: Map<number, Uint8Array>, rk: Uint8Array | null): Keyring => {
  const v = Math.max(...keys.keys());
  return { current: { v, key: keys.get(v)! }, byVersion: keys, rk };
};

/** New keys for a pharmacy, set up from the owner's first device. Returns the recovery code to show once. */
export async function createKeys(device: string, keys: DeviceKeys, name = "Owner’s device"): Promise<{ meta: KeyMeta; ring: Keyring; recoveryCode: string }> {
  const rk = newDataKey(), dk = newDataKey(), recoveryCode = newRecoveryCode(), now = new Date().toISOString();
  const meta: KeyMeta = {
    v: 2, createdAt: now,
    recovery: await aesWrap(decodeCode(recoveryCode), rk, "recovery"),
    owners: { [device]: await rsaWrap(keys.publicJwk, rk) },
    keys: [{ v: 1, createdAt: now, rk: await aesWrap(rk, dk, "dk:1"), devices: { [device]: await rsaWrap(keys.publicJwk, dk) } }],
    devices: { [device]: { publicJwk: keys.publicJwk, role: "owner", name, addedAt: now } },
  };
  return { meta, ring: ringFrom(new Map([[1, dk]]), rk), recoveryCode };
}

async function allWithRk(meta: KeyMeta, rk: Uint8Array) {
  const m = new Map<number, Uint8Array>();
  for (const k of meta.keys) m.set(k.v, await aesUnwrap(rk, k.rk, `dk:${k.v}`, "The pharmacy key doesn’t open the data."));
  return m;
}

/**
 * Opens the keys on this device: an owner device through RK; a staff device through the data keys it was given;
 * any device through the recovery code (the device then needs to be added — see addDevice).
 */
export async function openKeys(meta: KeyMeta, device: string, keys: DeviceKeys | null, recoveryCode?: string): Promise<Keyring | null> {
  if (keys && meta.owners[device]) {
    const rk = await rsaUnwrap(keys.privateKey, meta.owners[device]);
    return ringFrom(await allWithRk(meta, rk), rk);
  }
  if (keys && meta.devices[device]) {
    const m = new Map<number, Uint8Array>();
    for (const k of meta.keys) if (k.devices[device]) m.set(k.v, await rsaUnwrap(keys.privateKey, k.devices[device]));
    if (m.size) return ringFrom(m, null);
  }
  if (recoveryCode) {
    const rk = await aesUnwrap(decodeCode(recoveryCode), meta.recovery, "recovery", "That recovery code doesn’t open this pharmacy’s data.");
    return ringFrom(await allWithRk(meta, rk), rk);
  }
  return null;
}

/** Adds a device (owner devices only: needs RK). Staff devices get every data key so they can read history. */
export async function addDevice(meta: KeyMeta, ring: Keyring, device: string, publicJwk: JsonWebKey, role: Role, name: string): Promise<KeyMeta> {
  if (!ring.rk) throw new Error("Only an owner’s device can approve devices.");
  const next: KeyMeta = structuredClone(meta);
  next.devices[device] = { publicJwk, role, name, addedAt: new Date().toISOString() };
  if (role === "owner") next.owners[device] = await rsaWrap(publicJwk, ring.rk);
  for (const k of next.keys) k.devices[device] = await rsaWrap(publicJwk, ring.byVersion.get(k.v)!);
  return next;
}

/** Removes a device and starts a new data key it doesn't get. Returns the new meta and keyring. */
export async function removeDevice(meta: KeyMeta, ring: Keyring, device: string): Promise<{ meta: KeyMeta; ring: Keyring }> {
  if (!ring.rk) throw new Error("Only an owner’s device can remove devices.");
  const next: KeyMeta = structuredClone(meta);
  delete next.devices[device]; delete next.owners[device];
  for (const k of next.keys) delete k.devices[device];
  const v = Math.max(...next.keys.map((k) => k.v)) + 1, dk = newDataKey();
  const devices: Record<string, string> = {};
  for (const [id, d] of Object.entries(next.devices)) devices[id] = await rsaWrap(d.publicJwk, dk);
  next.keys.push({ v, createdAt: new Date().toISOString(), rk: await aesWrap(ring.rk, dk, `dk:${v}`), devices });
  const byVersion = new Map(ring.byVersion); byVersion.set(v, dk);
  return { meta: next, ring: { current: { v, key: dk }, byVersion, rk: ring.rk } };
}

// ---------- sealing files with a versioned key ----------

const MAGIC = txt("MDB2");

/** "MDB2" | key version (4 bytes) | IV (12) | ciphertext+tag. The purpose ("snapshot", "log") is authenticated. */
export async function sealWith(ring: Keyring, purpose: string, plain: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", buf(ring.current.key), "AES-GCM", false, ["encrypt"]);
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: txt(`${purpose}:${ring.current.v}`) }, k, buf(plain)));
  const out = new Uint8Array(4 + 4 + 12 + ct.length);
  out.set(MAGIC, 0); new DataView(out.buffer).setUint32(4, ring.current.v); out.set(iv, 8); out.set(ct, 20);
  return out;
}

export async function openWith(ring: Keyring, purpose: string, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 36 || MAGIC.some((b, i) => sealed[i] !== b)) throw new Error("This isn’t a Medoro DriveDB file.");
  const v = new DataView(sealed.buffer, sealed.byteOffset).getUint32(4);
  const key = ring.byVersion.get(v);
  if (!key) throw new WrongKeyError("This device doesn’t have the key for that file.");
  const k = await subtle().importKey("raw", buf(key), "AES-GCM", false, ["decrypt"]);
  try { return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: buf(sealed.subarray(8, 20)), additionalData: txt(`${purpose}:${v}`) }, k, buf(sealed.subarray(20)))); }
  catch { throw new WrongKeyError("The file couldn’t be opened: wrong key, or it was changed."); }
}
