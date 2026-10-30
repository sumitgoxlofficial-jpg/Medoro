import { generateKeyPairSync, sign } from "node:crypto";

/** A stand-in for Google's token and JWKS endpoints, signing ID tokens with a throwaway RSA key. */
export function fakeGoogle(kid = "test-kid") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const idToken = (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const h = b64({ alg: "RS256", kid, typ: "JWT", ...header }), p = b64(claims);
    return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
  };
  const claims = (o: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { iss: "https://accounts.google.com", aud: "client-123.apps.googleusercontent.com", sub: "g-sub-1", email: "owner@test.in", email_verified: true, iat: now, exp: now + 3600, ...o };
  };
  return { jwk, idToken, claims, certs: () => Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=3600" } }) };
}
