/**
 * DriveDB encryption basics: random keys, the Drive recovery code, and a simple sealed-file format.
 * How the keys are kept and shared between devices is in keyring.ts.
 */

const MAGIC = new TextEncoder().encode("MDB1");
const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const bytesOf = (s: string) => new TextEncoder().encode(s);
/** A copy backed by a plain ArrayBuffer, as WebCrypto wants. */
const buf = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>;

export class WrongKeyError extends Error {}

/** A new 256-bit data key, as raw bytes (kept in memory only). */
export const newDataKey = () => rand(32);

const aesKey = (raw: Uint8Array, usages: KeyUsage[] = ["encrypt", "decrypt"]) => subtle().importKey("raw", buf(raw), "AES-GCM", false, usages);

/**
 * Encrypts `plain` for one purpose ("snapshot", "log", ...). The purpose is authenticated, so a file can't be
 * passed off as another kind. Layout: "MDB1" | 12-byte IV | ciphertext+tag.
 */
export async function seal(dataKey: Uint8Array, purpose: string, plain: Uint8Array): Promise<Uint8Array> {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: bytesOf(purpose) }, await aesKey(dataKey), buf(plain)));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16);
  return out;
}

export async function open(dataKey: Uint8Array, purpose: string, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 32 || MAGIC.some((b, i) => sealed[i] !== b)) throw new Error("This isn’t a Medoro DriveDB file.");
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: buf(sealed.subarray(4, 16)), additionalData: bytesOf(purpose) }, await aesKey(dataKey), buf(sealed.subarray(16))));
  } catch {
    throw new WrongKeyError("The file couldn’t be opened: wrong key, or it was changed.");
  }
}

// ---------- recovery code ----------

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

/** A new recovery code: 32 random bytes as 52 letters/digits in groups of 4. */
export function newRecoveryCode(): string {
  return encodeCode(rand(32));
}

export function encodeCode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

/** Reads a recovery code as typed: case, spaces and dashes don't matter; O/I/L are read as 0/1/1. */
export function decodeCode(code: string): Uint8Array {
  const s = code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== 52 || [...s].some((c) => !B32.includes(c))) throw new WrongKeyError("A recovery code has 52 letters and digits. Check it and try again.");
  const out = new Uint8Array(32);
  let bits = 0, value = 0, i = 0;
  for (const c of s) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { if (i < 32) out[i++] = (value >>> (bits - 8)) & 255; bits -= 8; }
  }
  return out;
}

export type Wrap = { iv: string; ct: string };
