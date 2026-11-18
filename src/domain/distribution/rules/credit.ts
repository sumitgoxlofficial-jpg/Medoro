// Credit control for chemists. An order is held for approval (not refused) when it breaks a rule; a user with the
// credit-override permission can release it with a reason, which is audited.

export type CreditInput = {
  limit: number; // paise; 0 = cash only (no credit)
  balance: number; // current outstanding (ledger), paise
  orderValue: number; // this order, paise
  pendingOrders: number; // approved orders not yet invoiced, paise
  oldestOpenDays: number | null; // age of the oldest unpaid invoice
  creditDays: number;
  graceDays: number;
  status: string; // active, hold, blocked
  dlExpiry: string | null; // YYYY-MM-DD
  bouncedCheques90d?: number;
  today: string;
};

export type CreditDecision = { ok: boolean; hard: boolean; reasons: string[]; exposure: number; available: number };

export function creditCheck(i: CreditInput): CreditDecision {
  const reasons: string[] = [];
  let hard = false;
  const exposure = i.balance + i.pendingOrders + i.orderValue;
  if (i.status === "blocked") { reasons.push("Account is blocked."); hard = true; }
  if (i.status === "hold") reasons.push("Account is on hold.");
  if (!i.dlExpiry) { reasons.push("No drug licence on file."); hard = true; }
  else if (i.dlExpiry < i.today) { reasons.push(`Drug licence expired on ${i.dlExpiry}.`); hard = true; }
  if (i.limit <= 0) { if (i.balance + i.pendingOrders > 0 || i.orderValue > 0) reasons.push("No credit limit: cash / advance customer."); }
  else if (exposure > i.limit) reasons.push(`Credit limit exceeded by ₹${((exposure - i.limit) / 100).toFixed(2)}.`);
  if (i.oldestOpenDays != null && i.oldestOpenDays > i.creditDays + i.graceDays) reasons.push(`Oldest bill is ${i.oldestOpenDays} days old (credit ${i.creditDays} + grace ${i.graceDays} days).`);
  if ((i.bouncedCheques90d ?? 0) >= 2) reasons.push(`${i.bouncedCheques90d} cheques bounced in 90 days.`);
  return { ok: reasons.length === 0, hard, reasons, exposure, available: Math.max(0, i.limit - i.balance - i.pendingOrders) };
}
