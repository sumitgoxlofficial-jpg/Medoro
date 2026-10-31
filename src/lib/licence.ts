import { createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from "node:crypto";

/** What the licence server (Medoro's staff console) signs and returns on every check-in. */
export type LicenceDoc = {
  v: 1;
  licenceId: string;
  customerCode: string;
  issuedAt: string; // ISO timestamp
  plan: string; // starter, pro, multi
  planName: string;
  cycle: string; // m, y
  status: string; // trial, active, grace, cancelled
  endsOn: string | null; // trial end or paid-until, YYYY-MM-DD
  graceDays: number;
  addons: string[];
  invoices: { number: string; date: string; description: string; amountPaise: number; gstPaise: number; reference: string | null }[];
  billing: { id: string; requestId: string | null; kind: string; status: string; detail: string; at: string }[];
  tickets: { code: string; subject: string; status: string; createdAt: string; messages: { id: string; by: string; text: string; at: string; fromCustomer: boolean }[] }[];
  remote: { id: string; by: string; ticket: string | null; requestedAt: string }[];
  /** What the server did with each request sent in this check-in (by outbox id). */
  processed: { id: string; ok: boolean; ref?: string; error?: string }[];
};

export type SignedDoc = { doc: string; sig: string };

const b64u = (b: Buffer) => b.toString("base64url");

/** Keys are base64 DER (PKCS#8 private, SPKI public) or PEM. scripts/licence-keys.mjs generates a pair. */
function keyOf(raw: string, kind: "private" | "public"): KeyObject {
  const s = raw.trim();
  if (s.includes("-----BEGIN")) return kind === "private" ? createPrivateKey(s) : createPublicKey(s);
  const der = Buffer.from(s, "base64");
  return kind === "private" ? createPrivateKey({ key: der, format: "der", type: "pkcs8" }) : createPublicKey({ key: der, format: "der", type: "spki" });
}

export function signDoc(doc: LicenceDoc, privateKey: string): SignedDoc {
  const body = Buffer.from(JSON.stringify(doc));
  return { doc: b64u(body), sig: b64u(sign(null, body, keyOf(privateKey, "private"))) };
}

/** Returns the document only if the Ed25519 signature checks out with `publicKey`. */
export function verifyDoc(s: SignedDoc, publicKey: string): LicenceDoc | null {
  if (!s || typeof s.doc !== "string" || typeof s.sig !== "string") return null;
  const body = Buffer.from(s.doc, "base64url");
  let ok = false;
  try { ok = verify(null, body, keyOf(publicKey, "public"), Buffer.from(s.sig, "base64url")); } catch { return null; }
  if (!ok) return null;
  try {
    const d = JSON.parse(body.toString("utf8")) as LicenceDoc;
    return d?.v === 1 && typeof d.licenceId === "string" ? d : null;
  } catch { return null; }
}

/** The public key that pairs with a signing key (for the staff console's own self-check). */
export const publicKeyOf = (privateKey: string) => Buffer.from(createPublicKey(keyOf(privateKey, "private")).export({ format: "der", type: "spki" })).toString("base64");

// ── Requests from a pharmacy are signed with its instance token (HMAC-SHA256 over time + body).
export const LICENCE_HEADER = "x-medoro-licence";
export const SIGNATURE_HEADER = "x-medoro-signature";
const MAX_SKEW_MS = 10 * 60_000;

/** What a pay link signs: the installation's own licence id (see /pay and src/staff/online-pay.ts). */
export const payLinkBody = (licenceId: string) => `pay:${licenceId}`;

export const requestSignature = (token: string, body: string, at = Date.now()) => `${at}.${createHmac("sha256", token).update(`${at}.${body}`).digest("hex")}`;

export function checkRequestSignature(token: string, body: string, header: string | null, now = Date.now()) {
  const [at, mac] = String(header ?? "").split(".");
  if (!at || !mac || !/^\d+$/.test(at) || Math.abs(now - Number(at)) > MAX_SKEW_MS) return false;
  const want = createHmac("sha256", token).update(`${at}.${body}`).digest();
  const got = Buffer.from(mac, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A licence key as staff hand it to a pharmacy: "MEDORO-<licenceId>.<token>". */
export const formatLicenceKey = (licenceId: string, token: string) => `MEDORO-${licenceId}.${token}`;
export function parseLicenceKey(key: string) {
  const m = /^MEDORO-([0-9a-f-]{36})\.([\w-]{32,})$/i.exec(String(key ?? "").trim());
  return m ? { licenceId: m[1].toLowerCase(), token: m[2] } : null;
}
