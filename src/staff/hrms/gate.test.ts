import { describe, expect, it } from "vitest";
import { gateOf } from "./gate";

const base = { mustChangePassword: false, profileDone: true, kycSubmitted: false, docsAccepted: false, role: "employee" as const, staffRole: "employee" as const };

describe("the sign-in steps before the HRMS opens", () => {
  it("asks an employee for their password, details, Aadhaar and PAN, then the joining documents", () => {
    expect(gateOf({ ...base, mustChangePassword: true })).toBe("password");
    expect(gateOf({ ...base, profileDone: false })).toBe("profile");
    expect(gateOf(base)).toBe("kyc");
    expect(gateOf({ ...base, kycSubmitted: true })).toBe("docs");
    expect(gateOf({ ...base, kycSubmitted: true, docsAccepted: true })).toBeNull();
  });

  it("never holds an employee while HR reviews their Aadhaar and PAN", () => {
    expect(gateOf({ ...base, kycSubmitted: true })).toBe("docs"); // submitted, not yet verified: carry on
    expect(gateOf({ ...base, kycSubmitted: true, docsAccepted: true })).toBeNull();
  });

  it("never asks the super admin to verify their identity or accept joining documents", () => {
    const sa = { ...base, role: "admin" as const, staffRole: "super_admin" as const };
    expect(gateOf(sa)).toBeNull();
    expect(gateOf({ ...sa, mustChangePassword: true })).toBe("password"); // their own password still comes first
  });

  it("still asks other admins for Aadhaar and PAN", () => {
    expect(gateOf({ ...base, role: "admin", staffRole: "employee" })).toBe("kyc");
  });
});
