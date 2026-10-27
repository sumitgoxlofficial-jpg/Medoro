import { daysTo, todayISO } from "@/lib/dates";

export type BatchLike = {
  id: string;
  medicineId: string;
  expiryDate: Date | string;
  qtyAvailable: number;
  status: string;
};

/** A batch can be sold only if it is status ok, not expired, and has stock. */
export function isSellable(b: BatchLike, today = todayISO()): boolean {
  return b.status === "ok" && daysTo(b.expiryDate, today) > 0 && b.qtyAvailable > 0;
}

const expKey = (b: BatchLike) => (typeof b.expiryDate === "string" ? b.expiryDate : b.expiryDate.toISOString());

/** Sellable batches for a medicine, earliest expiry first. */
export function fefoOrder<T extends BatchLike>(batches: T[], medicineId: string, today = todayISO()): T[] {
  return batches
    .filter((b) => b.medicineId === medicineId && isSellable(b, today))
    .sort((a, b) => (expKey(a) < expKey(b) ? -1 : expKey(a) > expKey(b) ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Next FEFO batch with free quantity, given what is already allocated in the cart.
 * `used` maps batchId → qty already in the cart.
 */
export function nextFefo<T extends BatchLike>(
  batches: T[], medicineId: string, used: Record<string, number> = {}, today = todayISO(),
): T | undefined {
  return fefoOrder(batches, medicineId, today).find((b) => b.qtyAvailable - (used[b.id] ?? 0) > 0);
}

/** Split a requested quantity across batches in FEFO order. Throws if stock is short. */
export function allocateFefo<T extends BatchLike>(
  batches: T[], medicineId: string, qty: number, today = todayISO(),
): { batch: T; qty: number }[] {
  const out: { batch: T; qty: number }[] = [];
  let left = qty;
  for (const b of fefoOrder(batches, medicineId, today)) {
    if (left <= 0) break;
    const take = Math.min(left, b.qtyAvailable);
    out.push({ batch: b, qty: take });
    left -= take;
  }
  if (left > 0) throw new Error(`Only ${qty - left} sellable in stock`);
  return out;
}
