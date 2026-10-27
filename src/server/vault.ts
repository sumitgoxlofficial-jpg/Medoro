import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Integration secrets and the backup key are sealed with a host key.
// Production should supply HOST_KEY from the OS keystore or Docker secrets.
const hostKey = () => createHash("sha256").update("medoro-host-key:" + (process.env.HOST_KEY ?? process.env.SESSION_SECRET ?? "")).digest();

export function seal(plain: Buffer | string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", hostKey(), iv);
  const body = Buffer.concat([c.update(typeof plain === "string" ? Buffer.from(plain) : plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function unseal(box: Buffer | Uint8Array): Buffer {
  const b = Buffer.from(box);
  const d = createDecipheriv("aes-256-gcm", hostKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

export const fingerprint = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase().match(/../g)!.join(":");
