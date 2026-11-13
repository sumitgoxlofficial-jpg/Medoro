import { describe, expect, it } from "vitest";
import { gateOf } from "./gate";

const base = { mustChangePassword: false, profileDone: true, kycSubmitted: false, kycVerified: false, docsAccepted: false, role: "employee" as const, staffRole: "employee" as const };

describe("the sign-in steps before the HRMS opens", () => {
  it("asks an employee for their password, details, Aadhaar and PAN, then the joining documents", () => {
    expect(gateOf({ ...base, mustChangePassword: true }, false)).toBe("password");
    expect(gateOf({ ...base, profileDone: false }, false)).toBe("profile");
    expect(gateOf(base, false)).toBe("kyc");
    expect(gateOf({ ...base, kycSubmitted: true }, false)).toBe("docs");
    expect(gateOf({ ...base, kycSubmitted: true, docsAccepted: true }, false)).toBeNull();
  });

  it("holds an employee at Aadhaar and PAN until they are verified when that setting is on", () => {
    expect(gateOf({ ...base, kycSubmitted: true, docsAccepted: true }, true)).toBe("kyc");
    expect(gateOf({ ...base, kycSubmitted: true, kycVerified: true, docsAccepted: true }, true)).toBeNull();
  });

  it("never asks the super admin to verify their identity or accept joining documents", () => {
    const sa = { ...base, role: "admin" as const, staffRole: "super_admin" as const };
    expect(gateOf(sa, false)).toBeNull();
    expect(gateOf(sa, true)).toBeNull(); // even with 'hold until verified' on
    expect(gateOf({ ...sa, mustChangePassword: true }, false)).toBe("password"); // their own password still comes first
  });

  it("still asks other admins for Aadhaar and PAN", () => {
    expect(gateOf({ ...base, role: "admin", staffRole: "employee" }, false)).toBe("kyc");
  });
});
