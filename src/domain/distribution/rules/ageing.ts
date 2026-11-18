// Bill-wise outstanding without per-bill allocations: the party's ledger balance is matched against its invoices
// newest-first (FIFO settlement: payments clear the oldest bills). Always agrees with the ledger, including opening
// balances, credit notes, bounced cheques and reversals.

export type Bill = { id: string; no: string; date: string; dueDate: string; total: number };
export type OpenBill = Bill & { open: number; ageDays: number; overdueDays: number };

const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function openBills(bills: Bill[], balance: number, today: string): OpenBill[] {
  if (balance <= 0) return [];
  const sorted = [...bills].sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.no > b.no ? -1 : 1));
  const out: OpenBill[] = [];
  let left = balance;
  for (const b of sorted) {
    if (left <= 0) break;
    const open = Math.min(b.total, left);
    left -= open;
    out.push({ ...b, open, ageDays: days(b.date, today), overdueDays: Math.max(0, days(b.dueDate, today)) });
  }
  if (left > 0) out.push({ id: "opening", no: "Opening / on account", date: today, dueDate: today, total: left, open: left, ageDays: 0, overdueDays: 0 });
  return out.reverse();
}

export const AGE_BUCKETS = ["0-30", "31-60", "61-90", "91-120", "120+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function bucketOf(ageDays: number): AgeBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  if (ageDays <= 120) return "91-120";
  return "120+";
}

export function ageing(open: OpenBill[]): Record<AgeBucket, number> {
  const r = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0])) as Record<AgeBucket, number>;
  for (const b of open) r[bucketOf(b.ageDays)] += b.open;
  return r;
}
