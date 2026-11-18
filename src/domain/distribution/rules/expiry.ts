// Expiry handling: which stock is near expiry, which of it the principal will take back, and what credit to expect.

export type ClaimPolicy = { claimBeforeDays: number; claimAfterDays: number; claimCreditPct: number };

export const DEFAULT_POLICY: ClaimPolicy = { claimBeforeDays: 90, claimAfterDays: 180, claimCreditPct: 100 };

export type ExpiryBand = "expired" | "30" | "60" | "90" | "180" | "ok";

export function expiryBand(daysLeft: number): ExpiryBand {
  if (daysLeft <= 0) return "expired";
  if (daysLeft <= 30) return "30";
  if (daysLeft <= 60) return "60";
  if (daysLeft <= 90) return "90";
  if (daysLeft <= 180) return "180";
  return "ok";
}

/** Whether the principal accepts this batch back now, and if not, why (or from when). */
export function claimEligibility(daysLeft: number, p: ClaimPolicy): { eligible: boolean; reason: string } {
  if (daysLeft > p.claimBeforeDays) return { eligible: false, reason: `Returns open ${p.claimBeforeDays} days before expiry (${daysLeft - p.claimBeforeDays} days from now).` };
  if (daysLeft < -p.claimAfterDays) return { eligible: false, reason: `Claim window closed ${-daysLeft - p.claimAfterDays} days ago (accepted up to ${p.claimAfterDays} days after expiry).` };
  return { eligible: true, reason: daysLeft <= 0 ? `Expired ${-daysLeft} days ago; inside the ${p.claimAfterDays}-day window.` : `Expires in ${daysLeft} days; inside the ${p.claimBeforeDays}-day window.` };
}

/** Credit expected from the principal on a claim: purchase value × credit %. */
export const expectedCredit = (purchaseValue: number, p: ClaimPolicy) => Math.round((purchaseValue * p.claimCreditPct) / 100);

/**
 * Expected loss on a batch if it keeps selling at its recent pace: units left at expiry, valued at cost, less what
 * the principal is expected to credit back for them.
 */
export function expiryLoss(units: number, dailyRate: number, daysLeft: number, unitCost: number, p: ClaimPolicy | null): { unsold: number; loss: number; recoverable: number } {
  const sellable = Math.max(0, daysLeft) * Math.max(0, dailyRate);
  const unsold = Math.max(0, Math.ceil(units - sellable));
  const value = unsold * unitCost;
  const recoverable = p ? Math.round((value * p.claimCreditPct) / 100) : 0;
  return { unsold, loss: value - recoverable, recoverable };
}
