/**
 * Which batches a recall notice affects. A batch is affected only when its batch number is on the notice AND it is the
 * right product:
 *  - the notice names one catalogue medicine: that medicine;
 *  - the notice names a manufacturer and product text instead: the medicine's manufacturer contains the notice's
 *    manufacturer and its name or generic contains the product text (case-insensitive);
 *  - an old notice with neither (recorded before recalls were tied to a medicine): batch number alone, as before.
 * Batch numbers are compared upper-case and trimmed.
 */
export type RecallRef = { medicineId: string | null; manufacturer?: string | null; product?: string | null; batchNos: string[] };
export type BatchRef = { medicineId: string; batchNo: string; medicine: { manufacturer: string; name: string; generic: string } };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const batchKey = (s: string) => s.trim().toUpperCase();

export function recallMatches(r: RecallRef, b: BatchRef): boolean {
  if (!r.batchNos.some((n) => batchKey(n) === batchKey(b.batchNo))) return false;
  if (r.medicineId) return r.medicineId === b.medicineId;
  if (r.manufacturer && r.manufacturer.trim()) {
    if (!norm(b.medicine.manufacturer).includes(norm(r.manufacturer))) return false;
    const p = norm(r.product ?? "");
    return p.length >= 3 && (norm(b.medicine.name).includes(p) || norm(b.medicine.generic).includes(p));
  }
  return true;
}
