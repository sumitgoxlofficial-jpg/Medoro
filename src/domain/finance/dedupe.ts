/**
 * Is an incoming transaction one we already have? Confidence-based, first rule that fires decides:
 *   (statement row fingerprint — checked by the caller before this, rule 4 in the plan)
 *   2  same UTR/RRN, amount and direction                     → same transaction (also across sources)
 *   5  same account, date, amount, direction and narration,   → same transaction ("merged on attributes")
 *      neither side has a UTR
 *   6  same account, date, amount and direction, no UTR on    → kept, both flagged for a person to decide
 *      either side, from a different file whose dates cover this day
 * Anything else is new. Nothing is ever deleted.
 */
import { squash } from "./narration";

export type DedupeIn = { account: string; direction: "credit" | "debit"; amountPaise: number; date: string; utr: string | null; description: string };
export type DedupeHave = DedupeIn & { id: string; importId: string | null };
export type DedupeResult = { kind: "same"; id: string; rule: 2 | 5 } | { kind: "review"; id: string } | { kind: "new" };

/**
 * `taken` holds existing ids already paired with an earlier row of the same file, so two identical rows in a new
 * file pair with two existing rows, not both with the first. `coverage` gives each earlier import's date range.
 */
export function classify(t: DedupeIn, have: DedupeHave[], taken: Set<string>, coverage: Map<string, { from: string; to: string }>, importId: string | null): DedupeResult {
  if (t.utr) {
    const same = have.find((h) => h.utr === t.utr && h.amountPaise === t.amountPaise && h.direction === t.direction && !taken.has(h.id));
    if (same) return { kind: "same", id: same.id, rule: 2 };
  }
  const near = have.filter((h) => !taken.has(h.id) && h.account === t.account && h.date === t.date && h.amountPaise === t.amountPaise && h.direction === t.direction && h.importId !== importId);
  if (!near.length) return { kind: "new" };
  // Different UTRs: different payments, however alike.
  const open = near.filter((h) => !(h.utr && t.utr && h.utr !== t.utr));
  const desc = squash(t.description);
  const exact = open.find((h) => !h.utr && !t.utr && desc && squash(h.description) === desc);
  if (exact) return { kind: "same", id: exact.id, rule: 5 };
  const doubt = open.find((h) => !h.utr && !t.utr && h.importId && (() => { const c = coverage.get(h.importId!); return !!c && c.from <= t.date && t.date <= c.to; })());
  return doubt ? { kind: "review", id: doubt.id } : { kind: "new" };
}
