import { describe, expect, it } from "vitest";
import { bucket, redact } from "./telemetry";
import { hasConsent } from "@/domain/parties/consent";
import { maskPhone } from "@/lib/mask";

describe("crash report redaction", () => {
  it("removes people, pharmacies, credentials and ids", () => {
    const s = redact(`Customer "Ramesh Kulkarni" 9822041736 (ramesh@x.in) GSTIN 27AAKFS3192P1Z6 id 3f2b1c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f token=abcdefghijklmnopqrstuvwxyz012345 Bearer eyJhbGciOi.x.y postgresql://u:p@db:5432/medoro`);
    expect(s).not.toMatch(/Ramesh|9822041736|ramesh@x\.in|27AAKFS3192P1Z6|3f2b1c4d|abcdefghijklmnop|eyJhbGciOi|u:p@db/);
    expect(s).toContain("[email]"); expect(s).toContain("[gstin]"); expect(s).toContain("[id]");
  });

  it("keeps the shape of ordinary error text", () => {
    expect(redact("Cannot read properties of undefined (reading 'qty')")).toBe("Cannot read properties of undefined (reading [text])");
  });

  it("buckets counts coarsely", () => {
    expect([0, 1, 5, 6, 99, 100, 101, 20000].map(bucket)).toEqual(["0", "≤5", "≤5", "≤10", "≤100", "≤100", "≤250", ">10000"]);
  });
});

describe("consent and masking helpers", () => {
  const base = { phone: "9822041736", erasedAt: null, waOptIn: true, smsOptIn: false, marketingWa: true, marketingSms: false, optInMethod: "Counter" };
  it("keeps marketing separate from transactional consent", () => {
    expect(hasConsent(base, "transactional", "whatsapp")).toBe(true);
    expect(hasConsent(base, "marketing", "whatsapp")).toBe(true);
    expect(hasConsent(base, "transactional", "sms")).toBe(false);
    expect(hasConsent({ ...base, marketingWa: false }, "marketing", "whatsapp")).toBe(false);
  });

  it("a STOP reply on WhatsApp also stops WhatsApp marketing; no phone or erased means no consent", () => {
    expect(hasConsent({ ...base, waOptIn: false, optInMethod: "Opted out by replying STOP on WhatsApp" }, "marketing", "whatsapp")).toBe(false);
    expect(hasConsent({ ...base, waOptIn: false, optInMethod: null }, "marketing", "whatsapp")).toBe(true);
    expect(hasConsent({ ...base, phone: null }, "transactional", "whatsapp")).toBe(false);
    expect(hasConsent({ ...base, erasedAt: new Date() }, "transactional", "whatsapp")).toBe(false);
    expect(hasConsent(null, "transactional", "whatsapp")).toBe(false);
  });

  it("masks phones but keeps enough to tell customers apart", () => {
    expect(maskPhone("9822041736")).toBe("98220•••36");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("123")).toBe("••••");
  });
});
