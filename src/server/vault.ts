import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Integration secrets, the backup key and authenticator secrets are sealed with HOST_KEY (required in
// production, see env-check.ts). Installs from before HOST_KEY was required sealed with a key derived from
// SESSION_SECRET; those values still open via the legacy key so rotating in a HOST_KEY doesn't lose them.
const derive = (secret: string) => createHash("sha256").update("medoro-host-key:" + secret).digest();
const hostKey = () => derive(process.env.HOST_KEY || process.env.SESSION_SECRET || "");
// An empty HOST_KEY= line used to seal with derive(""), so that is a legacy key too.
const legacyKeys = () => [...new Set([process.env.SESSION_SECRET ?? "", ""])].filter((k) => k !== (process.env.HOST_KEY || process.env.SESSION_SECRET || "")).map(derive);

export function seal(plain: Buffer | string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", hostKey(), iv);
  const body = Buffer.concat([c.update(typeof plain === "string" ? Buffer.from(plain) : plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function open(b: Buffer, key: Buffer) {
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

let warned = false;
export function unseal(box: Buffer | Uint8Array): Buffer {
  const b = Buffer.from(box);
  try { return open(b, hostKey()); }
  catch (e) {
    for (const key of legacyKeys()) {
      let out: Buffer;
      try { out = open(b, key); } catch { continue; }
      if (!warned) { warned = true; console.warn("[medoro] Some secrets are still sealed with the old key derived from SESSION_SECRET. Keep SESSION_SECRET unchanged until they are re-sealed with HOST_KEY: reconnect WhatsApp and Google Drive, re-enter the backup recovery kit and re-enrol authenticators."); }
      return out;
    }
    throw e;
  }
}

export const fingerprint = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase().match(/../g)!.join(":");
