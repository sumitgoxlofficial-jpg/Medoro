// Batch-wise stock allocation for wholesale orders: FEFO (first expiry, first out) across the godown's sellable
// batches, honouring stock already reserved by open pick lists and a minimum remaining shelf life the chemist
// will accept. Pure: the caller locks the batch rows before calling and writes the result in the same transaction.

export type AllocBatch = { id: string; medicineId: string; batchNo: string; expiry: string; qtyAvailable: number; status: string; rack?: string | null };

export type Allocation = { batchId: string; batchNo: string; expiry: string; rack: string | null; units: number };

export function freeUnits(b: AllocBatch, reserved: Record<string, number>) {
  return Math.max(0, b.qtyAvailable - (reserved[b.id] ?? 0));
}

/**
 * Allocates `units` stock units of a product in whole packs (`packSize` units each) FEFO. Batches with less than
 * `minShelfDays` left are skipped. Throws with the quantity available when stock is short.
 */
export function allocateFefoReserved(batches: AllocBatch[], medicineId: string, units: number, opts: { reserved?: Record<string, number>; today: string; minShelfDays?: number; packSize?: number }): Allocation[] {
  const reserved = opts.reserved ?? {}, pack = Math.max(1, opts.packSize ?? 1);
  const cutoff = addDaysIso(opts.today, Math.max(1, opts.minShelfDays ?? 1));
  const usable = batches
    .filter((b) => b.medicineId === medicineId && b.status === "ok" && b.expiry >= cutoff && freeUnits(b, reserved) >= pack)
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.batchNo < b.batchNo ? -1 : 1));
  const out: Allocation[] = [];
  let left = units;
  for (const b of usable) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(freeUnits(b, reserved) / pack) * pack);
    if (take <= 0) continue;
    out.push({ batchId: b.id, batchNo: b.batchNo, expiry: b.expiry, rack: b.rack ?? null, units: take });
    left -= take;
  }
  if (left > 0) {
    const have = usable.reduce((a, b) => a + Math.floor(freeUnits(b, reserved) / pack), 0);
    throw new ShortStockError(medicineId, Math.floor(units / pack), have);
  }
  return out;
}

export class ShortStockError extends Error {
  constructor(public medicineId: string, public wanted: number, public available: number) {
    super(`Only ${available} available (needed ${wanted}).`);
  }
}

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Splits allocated stock units of a line into paid and free parts, paid first (free goods ride on the last batches). */
export function splitPaidFree(allocs: Allocation[], paidUnits: number): (Allocation & { paidUnits: number })[] {
  let paidLeft = paidUnits;
  return allocs.map((a) => {
    const paid = Math.min(a.units, paidLeft);
    paidLeft -= paid;
    return { ...a, paidUnits: paid };
  });
}
