import type { Me } from "./auth";

export type Gate = "password" | "profile" | "kyc" | "docs" | null;

/**
 * The first step a person must finish before the HRMS opens: their own password, their details, Aadhaar and PAN
 * (verified too when "hold people out until verified" is on), then the joining documents.
 * The super admin owns the system and is not asked to verify their identity, and (like every admin) isn't asked to accept joining documents.
 */
export function gateOf(me: Pick<Me, "mustChangePassword" | "profileDone" | "kycSubmitted" | "kycVerified" | "docsAccepted" | "role" | "staffRole">, kycBlock: boolean): Gate {
  if (me.mustChangePassword) return "password";
  if (!me.profileDone) return "profile";
  if (me.staffRole !== "super_admin" && (!me.kycSubmitted || (kycBlock && !me.kycVerified))) return "kyc";
  if (!me.docsAccepted && me.role !== "admin") return "docs";
  return null;
}
