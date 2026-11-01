/**
 * Customer payments that reach Medoro while no counter is online (phase 6). Medoro seals each one for every
 * approved device with that device's public key, so only the pharmacy's own devices can read it; the first
 * counter online records it and Medoro deletes the entry. Used on the server (sealing) and the device (opening).
 */
import type { DriveDB } from "./client";

const subtle = () => globalThis.crypto.subtle;
const buf = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>;
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const AAD = new TextEncoder().encode("medoro-inbox-v1");

/** A paid payment link: who paid what, against which customer or bill. */
export type InboxPayment = { paymentId: string; linkId: string; amountPaise: number; customerId: string; saleId?: string | null; method: string; paidAt: string };

/** Seals a payment for one device: AES-GCM payload, its key wrapped with the device's RSA-OAEP public key. */
export async function sealForDevice(publicJwk: JsonWebKey, p: InboxPayment): Promise<string> {
  const pub = await subtle().importKey("jwk", { kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e }, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const k = await subtle().importKey("raw", buf(key), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: AAD }, k, new TextEncoder().encode(JSON.stringify(p))));
  return JSON.stringify({ k: b64(new Uint8Array(await subtle().encrypt({ name: "RSA-OAEP" }, pub, buf(key)))), iv: b64(iv), ct: b64(ct) });
}

/** Opens an entry sealed for this device. Throws if it was sealed for another key. */
export async function openForDevice(privateKey: CryptoKey, sealed: string): Promise<InboxPayment> {
  const s = JSON.parse(sealed) as { k: string; iv: string; ct: string };
  const key = new Uint8Array(await subtle().decrypt({ name: "RSA-OAEP" }, privateKey, buf(unb64(s.k))));
  const k = await subtle().importKey("raw", buf(key), "AES-GCM", false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: buf(unb64(s.iv)), additionalData: AAD }, k, buf(unb64(s.ct))))) as InboxPayment;
}

/** The receipt id for a payment: the same on every counter, so recording it twice keeps one receipt. */
export const receiptIdOf = (paymentId: string) => `rzp-${paymentId}`;

/**
 * Records paid links as UPI receipts on the customer's account. Returns the payment ids that are done (recorded now
 * or before) so Medoro can delete them; a payment for a customer this device doesn't have yet waits.
 */
export function applyPayments(db: DriveDB, payments: InboxPayment[]): string[] {
  const done: string[] = [];
  db.transaction(() => {
    for (const p of payments) {
      const id = receiptIdOf(p.paymentId);
      if (db.engine.all("SELECT 1 FROM customerReceipt WHERE id = ?", [id]).length) { done.push(p.paymentId); continue; }
      if (!db.engine.all("SELECT 1 FROM customer WHERE id = ?", [p.customerId]).length) continue;
      if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) { done.push(p.paymentId); continue; }
      const bill = p.saleId ? db.engine.all<{ invoiceNo: string }>("SELECT invoiceNo FROM sale WHERE id = ?", [p.saleId])[0]?.invoiceNo : null;
      db.from("customerReceipt").insert({ id, customerId: p.customerId, amountPaise: p.amountPaise, mode: "upi", ref: `Paid online (Razorpay ${p.paymentId})${bill ? ` for ${bill}` : ""}`.slice(0, 120), userId: "online", at: p.paidAt });
      done.push(p.paymentId);
    }
  });
  return done;
}
