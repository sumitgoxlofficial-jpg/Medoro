import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Integration secrets, the backup key and authenticator secrets are sealed with HOST_KEY (required in
// production, see env-check.ts). Older values may be sealed with an earlier key, which still opens them:
//  - HOST_KEY_PREVIOUS: the HOST_KEY before it was changed (e.g. a short key replaced by a 32+ character one);
//  - a key derived from SESSION_SECRET, used by installs from before HOST_KEY was required.
const derive = (secret: string) => createHash("sha256").update("medoro-host-key:" + secret).digest();
const current = () => process.env.HOST_KEY || process.env.SESSION_SECRET || "";
const hostKey = () => derive(current());
// An empty HOST_KEY= line used to seal with derive(""), so that is a legacy key too.
const legacyKeys = () => [...new Set([process.env.HOST_KEY_PREVIOUS ?? "", process.env.SESSION_SECRET ?? "", ""])].filter((k) => k !== current()).map(derive);

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

function openAny(box: Buffer | Uint8Array): { out: Buffer; legacy: boolean } {
  const b = Buffer.from(box);
  try { return { out: open(b, hostKey()), legacy: false }; }
  catch (e) {
    for (const key of legacyKeys()) {
      try { return { out: open(b, key), legacy: true }; } catch { continue; }
    }
    throw e;
  }
}

let warned = false;
export function unseal(box: Buffer | Uint8Array): Buffer {
  const { out, legacy } = openAny(box);
  if (legacy && !warned) { warned = true; console.warn("[medoro] Some secrets are still sealed with an older key (HOST_KEY_PREVIOUS, or one derived from SESSION_SECRET). Keep that setting until they are re-sealed with HOST_KEY: the backup key and Google Drive re-seal on their next use; reconnect WhatsApp and re-enrol authenticators. See docs/DEPLOYMENT.md."); }
  return out;
}

/** The same secret sealed with the current HOST_KEY when it was sealed with an older key, otherwise null. */
export function reseal(box: Buffer | Uint8Array): Buffer | null {
  const { out, legacy } = openAny(box);
  return legacy ? seal(out) : null;
}

export const fingerprint = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase().match(/../g)!.join(":");
