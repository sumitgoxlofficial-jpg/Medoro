import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Customer-facing invoice link for text-only WhatsApp messages: the sale id, an expiry and an HMAC with
// SESSION_SECRET, so the PDF opens without a login only until the link expires.
export const INVOICE_LINK_DAYS = 7;
const sign = (id: string, exp: number) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`invoice-link:${id}:${exp}`).digest("base64url").slice(0, 32);

export function invoiceLink(saleId: string, now = Date.now()) {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) return null;
  const exp = Math.floor(now / 1000) + INVOICE_LINK_DAYS * 86400;
  return `${base}/api/wa/invoice/${saleId}.${exp}.${sign(saleId, exp)}`;
}

/** The sale id when the token is genuine and unexpired. */
export function checkInvoiceLink(token: string, now = Date.now()): string | null {
  const [id, e, sig] = token.split(".");
  const exp = Number(e);
  if (!id || !sig || !Number.isInteger(exp) || exp * 1000 < now || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const want = sign(id, exp);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}
