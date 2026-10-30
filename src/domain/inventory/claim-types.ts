export const CLAIM_REASONS = { expiry: "Expired", near_expiry: "Near expiry", breakage: "Breakage / damaged", wrong_item: "Wrong item supplied" } as const;
export type ClaimReason = keyof typeof CLAIM_REASONS;
export const CLAIM_STATUS = { raised: "Raised", acknowledged: "Acknowledged", credited: "Credit note received", rejected: "Rejected" } as const;
