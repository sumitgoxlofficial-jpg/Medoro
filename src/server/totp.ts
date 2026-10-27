import "server-only";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { seal, unseal } from "./vault";

const totp = (secretB32: string, label: string) =>
  new TOTP({ issuer: "Medoro", label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretB32) });

export function newTotpSecret() {
  const s = new Secret({ size: 20 });
  return { b32: s.base32, sealed: seal(s.base32).toString("base64") };
}

export const openSecret = (sealed: string) => unseal(Buffer.from(sealed, "base64")).toString();

export async function totpQr(secretB32: string, label: string) {
  return QRCode.toDataURL(totp(secretB32, label).toString(), { margin: 1, width: 196, color: { dark: "#1F2328" } });
}

/** Accepts the current code and one step either side for clock drift. */
export const checkTotp = (secretB32: string, code: string) => totp(secretB32, "x").validate({ token: code, window: 1 }) !== null;
