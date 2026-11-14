import type { Me } from "./auth";

export type Gate = "password" | "profile" | "kyc" | "docs" | null;

/**
 * The first step a person must finish before the HRMS opens: their own password, their details, Aadhaar and PAN
 * (submitted with proof: nobody waits for HR to review them; HR sends a proof back if something is wrong), then the
 * joining documents.
 * The super admin owns the system and is not asked to verify their identity, and (like every admin) isn't asked to accept joining documents.
 */
export function gateOf(me: Pick<Me, "mustChangePassword" | "profileDone" | "kycSubmitted" | "docsAccepted" | "role" | "staffRole">): Gate {
  if (me.mustChangePassword) return "password";
  if (!me.profileDone) return "profile";
  if (me.staffRole !== "super_admin" && !me.kycSubmitted) return "kyc";
  if (!me.docsAccepted && me.role !== "admin") return "docs";
  return null;
}
