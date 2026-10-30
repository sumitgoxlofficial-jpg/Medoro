import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRequestSignature, formatLicenceKey, parseLicenceKey, publicKeyOf, requestSignature, signDoc, verifyDoc, type LicenceDoc } from "./licence";

const pair = () => {
  const k = generateKeyPairSync("ed25519");
  return { priv: k.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), pub: k.publicKey.export({ format: "der", type: "spki" }).toString("base64") };
};
const doc: LicenceDoc = {
  v: 1, licenceId: "0b8f9c7e-1d2a-4b3c-9d4e-5f6a7b8c9d0e", customerCode: "T-1001", issuedAt: "2026-11-01T00:00:00.000Z", plan: "pro", planName: "Professional", cycle: "m",
  status: "active", endsOn: "2026-12-01", graceDays: 7, addons: ["ai"], invoices: [], billing: [], tickets: [], remote: [], processed: [],
};

describe("licence documents", () => {
  it("verifies with the matching public key and rejects tampering or another key", () => {
    const k = pair();
    const s = signDoc(doc, k.priv);
    expect(verifyDoc(s, k.pub)).toEqual(doc);
    expect(publicKeyOf(k.priv)).toBe(k.pub);
    const forged = Buffer.from(JSON.stringify({ ...doc, endsOn: "2099-01-01" })).toString("base64url");
    expect(verifyDoc({ doc: forged, sig: s.sig }, k.pub)).toBeNull();
    expect(verifyDoc(s, pair().pub)).toBeNull();
    expect(verifyDoc(s, "not a key")).toBeNull();
  });

  it("check-in requests are HMAC-signed with the instance token and expire", () => {
    const body = JSON.stringify({ appVersion: "0.1.0" });
    const h = requestSignature("tok", body, 1_000_000);
    expect(checkRequestSignature("tok", body, h, 1_000_000 + 60_000)).toBe(true);
    expect(checkRequestSignature("tok", body + " ", h, 1_000_000)).toBe(false);
    expect(checkRequestSignature("other", body, h, 1_000_000)).toBe(false);
    expect(checkRequestSignature("tok", body, h, 1_000_000 + 11 * 60_000)).toBe(false);
    expect(checkRequestSignature("tok", body, null)).toBe(false);
  });

  it("licence keys round-trip", () => {
    const key = formatLicenceKey(doc.licenceId, "A".repeat(32));
    expect(parseLicenceKey(` ${key} `)).toEqual({ licenceId: doc.licenceId, token: "A".repeat(32) });
    expect(parseLicenceKey("MEDORO-x.y")).toBeNull();
  });
});
