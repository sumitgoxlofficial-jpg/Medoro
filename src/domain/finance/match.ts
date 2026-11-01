/**
 * Which bill, counter payment or recorded receipt does a bank credit belong to? Pure rules; the caller loads the
 * data and records the result. Only credits that are not duplicates, settlements, interest or charges come here.
 *
 *  1  narration carries the bill's Medoro payment reference (MD + invoice number, from a Medoro UPI QR) → automatic
 *  2  the UTR/RRN was already typed on the counter payment or on a recorded receipt                       → automatic
 *  3  narration carries the exact invoice number of exactly one open bill                                  → automatic
 *  4  exact amount, one candidate both ways in the time window                                             → suggestion;
 *     automatic only for a bill of a customer this payer's UPI ID paid before, when the owner allows it
 *  5  everything else that fits the amount                                                                 → suggestion
 *
 * Amount alone never matches automatically.
 */
import { squash } from "./narration";
import { addDays } from "@/lib/dates";

export type OpenBill = { saleId: string; invoiceNo: string; customerId: string; customerName: string; date: string; balancePaise: number };
export type CounterUpi = { paymentId: string; saleId: string; invoiceNo: string; amountPaise: number; date: string; ref: string | null };
export type LooseReceipt = { receiptId: string; customerId: string; customerName: string; amountPaise: number; date: string; ref: string | null };
export type CreditIn = { id: string; remainingPaise: number; date: string; description: string; utr: string | null; vpa: string | null };

export type Target = "bill" | "counter" | "receipt";
export type Proposal = {
  txnId: string; target: Target; targetId: string; saleId: string | null; customerId: string | null;
  amountPaise: number; rule: 1 | 2 | 3 | 4 | 5; auto: boolean; label: string; reason: string;
};

export const BILL_WINDOW_DAYS = 60;
export const COUNTER_WINDOW_DAYS = 3;

/** The Medoro payment reference of a bill: what a Medoro UPI QR puts in the payment note. */
export const medoroRef = (invoiceNo: string) => `MD${squash(invoiceNo)}`;
/** A UPI payment link/QR for an amount using the pharmacy's own UPI ID (money goes straight to its bank). */
export function upiIntent(vpa: string, payee: string, amountPaise: number, note: string) {
  return `upi://pay?${new URLSearchParams({ pa: vpa, pn: payee.slice(0, 40), am: (amountPaise / 100).toFixed(2), cu: "INR", tn: note.slice(0, 50) })}`;
}

export type MatchData = {
  bills: OpenBill[]; counter: CounterUpi[]; receipts: LooseReceipt[];
  /** "txnId|targetId" pairs a person rejected: never proposed again. */
  rejected: Set<string>;
  /** UPI ID → customer it paid for before (from earlier matches). */
  knownPayers: Map<string, string>;
  autoKnownPayers: boolean;
};

const inWindow = (d: string, from: string, days: number) => d >= from && d <= addDays(from, days);
const refHas = (ref: string | null, utr: string) => !!ref && squash(ref).includes(utr);

/** Proposals for every credit; each credit's list is best first. Auto proposals never share a target or a credit. */
export function propose(credits: CreditIn[], d: MatchData): Map<string, Proposal[]> {
  const out = new Map<string, Proposal[]>(credits.map((c) => [c.id, []]));
  const add = (p: Proposal) => { if (!d.rejected.has(`${p.txnId}|${p.targetId}`)) out.get(p.txnId)!.push(p); };
  const billKey = d.bills.map((b) => ({ b, key: squash(b.invoiceNo) }));
  const billP = (c: CreditIn, b: OpenBill, rule: Proposal["rule"], auto: boolean, reason: string): Proposal => ({
    txnId: c.id, target: "bill", targetId: b.saleId, saleId: b.saleId, customerId: b.customerId, amountPaise: Math.min(c.remainingPaise, b.balancePaise),
    rule, auto, label: `${b.invoiceNo} · ${b.customerName}`, reason,
  });

  // Rules 1–3: references.
  const strong = new Set<string>();
  for (const c of credits) {
    const text = squash(c.description);
    const byRef = billKey.filter(({ key }) => key.length >= 6 && text.includes(`MD${key}`));
    if (byRef.length === 1) { add(billP(c, byRef[0].b, 1, true, "Medoro payment reference in the narration")); strong.add(c.id); continue; }
    if (c.utr) {
      const cs = d.counter.filter((p) => refHas(p.ref, c.utr!));
      const rs = d.receipts.filter((r) => refHas(r.ref, c.utr!));
      if (cs.length + rs.length === 1) {
        if (cs.length) add({ txnId: c.id, target: "counter", targetId: cs[0].paymentId, saleId: cs[0].saleId, customerId: null, amountPaise: Math.min(c.remainingPaise, cs[0].amountPaise), rule: 2, auto: cs[0].amountPaise === c.remainingPaise, label: `Counter UPI on ${cs[0].invoiceNo}`, reason: "UTR typed at the counter" });
        else add({ txnId: c.id, target: "receipt", targetId: rs[0].receiptId, saleId: null, customerId: rs[0].customerId, amountPaise: Math.min(c.remainingPaise, rs[0].amountPaise), rule: 2, auto: rs[0].amountPaise === c.remainingPaise, label: `Receipt from ${rs[0].customerName}`, reason: "UTR on a receipt already recorded" });
        strong.add(c.id); continue;
      }
    }
    const byNo = billKey.filter(({ key }) => key.length >= 8 && text.includes(key));
    if (byNo.length === 1) { add(billP(c, byNo[0].b, 3, true, "Invoice number in the narration")); strong.add(c.id); }
  }

  // Rule 4: exact amount, unique both ways. Rule 5: the rest.
  type Cand = { c: CreditIn; kind: Target; id: string; make: (rule: 4 | 5, auto: boolean, reason: string) => Proposal };
  const cands: Cand[] = [];
  for (const c of credits) {
    if (strong.has(c.id)) continue;
    for (const b of d.bills) if (b.balancePaise === c.remainingPaise && inWindow(c.date, b.date, BILL_WINDOW_DAYS)) cands.push({ c, kind: "bill", id: b.saleId, make: (r, a, why) => billP(c, b, r, a, why) });
    for (const p of d.counter) if (p.amountPaise === c.remainingPaise && inWindow(c.date, p.date, COUNTER_WINDOW_DAYS)) cands.push({ c, kind: "counter", id: p.paymentId, make: (rule, auto, reason) => ({ txnId: c.id, target: "counter", targetId: p.paymentId, saleId: p.saleId, customerId: null, amountPaise: p.amountPaise, rule, auto, label: `Counter UPI on ${p.invoiceNo}`, reason }) });
    for (const r of d.receipts) if (r.amountPaise === c.remainingPaise && Math.abs(Date.parse(c.date) - Date.parse(r.date)) <= COUNTER_WINDOW_DAYS * 86400_000) cands.push({ c, kind: "receipt", id: r.receiptId, make: (rule, auto, reason) => ({ txnId: c.id, target: "receipt", targetId: r.receiptId, saleId: null, customerId: r.customerId, amountPaise: r.amountPaise, rule, auto, label: `Receipt from ${r.customerName}`, reason }) });
  }
  const perCredit = new Map<string, number>(), perTarget = new Map<string, number>();
  for (const x of cands) { perCredit.set(x.c.id, (perCredit.get(x.c.id) ?? 0) + 1); perTarget.set(x.id, (perTarget.get(x.id) ?? 0) + 1); }
  for (const x of cands) {
    const unique = perCredit.get(x.c.id) === 1 && perTarget.get(x.id) === 1;
    if (!unique) { add(x.make(5, false, "Same amount; other payments or bills fit too")); continue; }
    const known = x.kind === "bill" && !!x.c.vpa && d.autoKnownPayers && d.knownPayers.get(x.c.vpa) === d.bills.find((b) => b.saleId === x.id)?.customerId;
    add(x.make(4, known, known ? "Same amount, and this UPI ID paid this customer’s bills before" : "Only payment and only bill of this amount in the period"));
  }
  for (const [id, ps] of out) out.set(id, ps.sort((a, b) => a.rule - b.rule).slice(0, 8));

  // Two credits must never claim the same target automatically in one pass.
  const claimed = new Map<string, number>();
  for (const ps of out.values()) for (const p of ps) if (p.auto) claimed.set(p.targetId, (claimed.get(p.targetId) ?? 0) + 1);
  for (const ps of out.values()) for (const p of ps) if (p.auto && claimed.get(p.targetId)! > 1) { p.auto = false; p.reason += " (another payment points to it too)"; }
  return out;
}
