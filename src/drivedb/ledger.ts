/**
 * Books and registers on the counter's own data (a pharmacy whose records live on its devices and in its Drive):
 *   - a double-entry journal built from the counter's records (bills, credit notes, receipts, purchase bills,
 *     supplier payments and credit notes, expenses), one balanced voucher each;
 *   - the day book, trial balance and profit & loss from that journal and the bills' cost of goods;
 *   - customer and supplier statements with an opening balance;
 *   - the Schedule H1 register;
 *   - Tally Prime XML (vouchers and masters), built with the same writer as Medoro's server.
 * Nothing here writes: every figure is worked out from the permanent records each time.
 */
import { DriveDB } from "./client";
import { addDays, istDate, istMidnight, todayISO } from "@/lib/dates";
import { ACC } from "@/domain/accounting/accounts";
import { defaultTallyMap, tallyMastersXml, tallyVouchersXml, type TallyParty, type TallyVoucher } from "@/domain/gst/tally";
import { H1_SCHEDULES } from "@/lib/rx";

const n = (v: unknown) => Number(v ?? 0);
const range = (fromIso: string, toIso: string) => [istMidnight(fromIso).toISOString(), istMidnight(addDays(toIso, 1)).toISOString()] as const;
const day = (at: string) => istDate(new Date(at));
/** Counter payment modes to accounts: cash in the drawer, everything else through the bank. */
const moneyAcc = (mode: string) => (mode === "cash" ? ACC.cash : ACC.bank);
/** Counter expense categories to the chart of accounts (and so to Tally ledgers). */
export const EXPENSE_ACCOUNT: Record<string, string> = {
  Rent: "Rent", Salaries: "Salaries", Electricity: "Electricity", "Internet & phone": "Telephone & internet", Transport: "Delivery expense",
  Repairs: "Repairs & maintenance", Stationery: "Printing & stationery", "Bank charges": "Bank charges", Other: "Miscellaneous expense",
};
const halves = (tax: number) => { const c = Math.floor(tax / 2); return [c, tax - c] as const; };

export type JournalLine = TallyVoucher["lines"][number];
export type Voucher = TallyVoucher & { at: string; amountPaise: number };

/**
 * Every record in the period as a balanced voucher, oldest first. Bills, credit notes and expenses are this branch's;
 * customer receipts and supplier payments belong to the whole pharmacy, so they are always included.
 */
export function journal(db: DriveDB, branchId: string, fromIso: string, toIso: string): Voucher[] {
  const [from, to] = range(fromIso, toIso);
  const out: Voucher[] = [];
  const push = (v: Omit<Voucher, "amountPaise">) => {
    const lines = v.lines.filter((l) => l.dr || l.cr);
    out.push({ ...v, lines, amountPaise: lines.reduce((a, l) => a + l.dr, 0) });
  };

  // Bills: the tender (cash, bank, the customer's account, points) against sales, GST and round off.
  const sales = db.engine.all<{ id: string; invoiceNo: string; at: string; total: number; taxable: number; cgst: number; sgst: number; igst: number; cust: string | null }>(
    `SELECT s.id, s.invoiceNo, s.at, s.totalPaise AS total, s.taxablePaise AS taxable, s.cgstPaise AS cgst, s.sgstPaise AS sgst, COALESCE(s.igstPaise, 0) AS igst, c.name AS cust
       FROM sale s LEFT JOIN customer c ON c.id = s.customerId WHERE s.branchId = ? AND s.at >= ? AND s.at < ? ORDER BY s.at`, [branchId, from, to]);
  const pays = new Map<string, { mode: string; amount: number }[]>();
  if (sales.length) {
    for (const p of db.engine.all<{ saleId: string; mode: string; amount: number }>(
      `SELECT p.saleId, p.mode, p.amountPaise AS amount FROM payment p JOIN sale s ON s.id = p.saleId WHERE s.branchId = ? AND s.at >= ? AND s.at < ?`, [branchId, from, to])) {
      (pays.get(p.saleId) ?? pays.set(p.saleId, []).get(p.saleId)!).push({ mode: p.mode, amount: n(p.amount) });
    }
  }
  for (const s of sales) {
    const total = n(s.total), taxable = n(s.taxable), cgst = n(s.cgst), sgst = n(s.sgst), igst = n(s.igst);
    const ps = pays.get(s.id) ?? [];
    const lines: JournalLine[] = ps.map((p) => p.mode === "credit"
      ? { account: ACC.debtors, dr: p.amount, cr: 0, partyLedger: s.cust ?? "Walk-in customer" }
      : { account: moneyAcc(p.mode), dr: p.amount, cr: 0 });
    const paid = ps.reduce((a, p) => a + p.amount, 0);
    if (total - paid > 0) lines.push({ account: ACC.loyalty, dr: total - paid, cr: 0 });
    lines.push({ account: ACC.sales, dr: 0, cr: taxable }, { account: ACC.cgst, dr: 0, cr: cgst }, { account: ACC.sgst, dr: 0, cr: sgst }, { account: ACC.igst, dr: 0, cr: igst });
    const round = total - taxable - cgst - sgst - igst;
    lines.push(round >= 0 ? { account: ACC.roundOff, dr: 0, cr: round } : { account: ACC.roundOff, dr: -round, cr: 0 });
    push({ no: s.invoiceNo, date: day(s.at), at: s.at, type: "sales", narration: `Bill ${s.invoiceNo}${s.cust ? ` · ${s.cust}` : ""}`, lines });
  }

  // Credit notes: sales returns and GST back, refunded in cash, by UPI, to the customer's account, or as points.
  for (const r of db.engine.all<{ no: string; at: string; amount: number; taxable: number; mode: string; points: number; igst: number; cust: string | null; invoiceNo: string }>(
    `SELECT r.creditNoteNo AS no, r.at, r.amountPaise AS amount, r.taxablePaise AS taxable, r.refundMode AS mode, COALESCE(r.pointsValuePaise, 0) AS points,
            COALESCE(s.igstPaise, 0) AS igst, c.name AS cust, s.invoiceNo
       FROM salesReturn r JOIN sale s ON s.id = r.saleId LEFT JOIN customer c ON c.id = s.customerId
      WHERE r.branchId = ? AND r.at >= ? AND r.at < ? ORDER BY r.at`, [branchId, from, to])) {
    const amount = n(r.amount), taxable = n(r.taxable), points = n(r.points), tax = amount - taxable;
    const [c, s2] = halves(tax);
    const refund = amount - points;
    const lines: JournalLine[] = [
      { account: ACC.salesReturns, dr: taxable, cr: 0 },
      ...(n(r.igst) > 0 ? [{ account: ACC.igst, dr: tax, cr: 0 }] : [{ account: ACC.cgst, dr: c, cr: 0 }, { account: ACC.sgst, dr: s2, cr: 0 }]),
      r.mode === "credit" ? { account: ACC.debtors, dr: 0, cr: refund, partyLedger: r.cust ?? "Walk-in customer" } : { account: moneyAcc(r.mode), dr: 0, cr: refund },
      { account: ACC.loyalty, dr: 0, cr: points },
    ];
    push({ no: r.no, date: day(r.at), at: r.at, type: "credit_note", narration: `Credit note ${r.no} against ${r.invoiceNo}`, lines });
  }

  // Money received from credit customers.
  for (const r of db.engine.all<{ id: string; at: string; amount: number; mode: string; ref: string | null; cust: string }>(
    `SELECT r.id, r.at, r.amountPaise AS amount, r.mode, r.ref, c.name AS cust FROM customerReceipt r JOIN customer c ON c.id = r.customerId WHERE r.at >= ? AND r.at < ? ORDER BY r.at`, [from, to])) {
    push({ no: `RCPT-${r.id.slice(0, 6).toUpperCase()}`, date: day(r.at), at: r.at, type: "receipt", narration: `Received from ${r.cust} (${r.mode}${r.ref ? ` · ${r.ref}` : ""})`,
      lines: [{ account: moneyAcc(r.mode), dr: n(r.amount), cr: 0 }, { account: ACC.debtors, dr: 0, cr: n(r.amount), partyLedger: r.cust }] });
  }

  // Purchase bills (dated by the supplier's bill date): purchases and input GST against the supplier.
  const [pFrom, pTo] = [fromIso, toIso];
  for (const p of db.engine.all<{ billNo: string; billDate: string; at: string; taxable: number; tax: number; total: number; sup: string }>(
    `SELECT p.billNo, p.billDate, p.at, p.taxablePaise AS taxable, p.taxPaise AS tax, p.totalPaise AS total, s.name AS sup
       FROM purchase p JOIN supplier s ON s.id = p.supplierId WHERE p.branchId = ? AND p.billDate >= ? AND p.billDate <= ? ORDER BY p.billDate, p.at`, [branchId, pFrom, pTo])) {
    const taxable = n(p.taxable), tax = n(p.tax), total = n(p.total);
    const [c, s2] = halves(tax);
    const round = total - taxable - tax;
    push({ no: p.billNo, date: p.billDate, at: p.at, type: "purchase", narration: `Purchase bill ${p.billNo} · ${p.sup}`,
      lines: [{ account: ACC.purchases, dr: taxable, cr: 0 }, { account: ACC.inCgst, dr: c, cr: 0 }, { account: ACC.inSgst, dr: s2, cr: 0 },
        round >= 0 ? { account: ACC.roundOff, dr: round, cr: 0 } : { account: ACC.roundOff, dr: 0, cr: -round },
        { account: ACC.creditors, dr: 0, cr: total, partyLedger: p.sup }] });
  }

  // Payments to suppliers, and the suppliers' credit notes against expiry/breakage claims.
  for (const x of db.engine.all<{ id: string; at: string; amount: number; mode: string; ref: string | null; sup: string }>(
    `SELECT x.id, x.at, x.amountPaise AS amount, x.mode, x.ref, s.name AS sup FROM supplierPayment x JOIN supplier s ON s.id = x.supplierId WHERE x.at >= ? AND x.at < ? ORDER BY x.at`, [from, to])) {
    push({ no: `PAY-${x.id.slice(0, 6).toUpperCase()}`, date: day(x.at), at: x.at, type: "payment", narration: `Paid ${x.sup} (${x.mode}${x.ref ? ` · ${x.ref}` : ""})`,
      lines: [{ account: ACC.creditors, dr: n(x.amount), cr: 0, partyLedger: x.sup }, { account: moneyAcc(x.mode), dr: 0, cr: n(x.amount) }] });
  }
  for (const e of db.engine.all<{ id: string; at: string; amount: number; ref: string | null; sup: string; claimNo: string }>(
    `SELECT e.id, e.at, e.amountPaise AS amount, e.ref, s.name AS sup, c.claimNo FROM claimEvent e JOIN supplierClaim c ON c.id = e.claimId JOIN supplier s ON s.id = e.supplierId
      WHERE e.kind = 'credit' AND e.at >= ? AND e.at < ? ORDER BY e.at`, [from, to])) {
    push({ no: e.ref || `CN-${e.id.slice(0, 6).toUpperCase()}`, date: day(e.at), at: e.at, type: "debit_note", narration: `Credit note from ${e.sup} for claim ${e.claimNo}`,
      lines: [{ account: ACC.creditors, dr: n(e.amount), cr: 0, partyLedger: e.sup }, { account: ACC.purchases, dr: 0, cr: n(e.amount) }] });
  }

  // Shop expenses.
  for (const e of db.engine.all<{ id: string; at: string; category: string; amount: number; mode: string; note: string | null }>(
    "SELECT id, at, category, amountPaise AS amount, mode, note FROM expense WHERE branchId = ? AND at >= ? AND at < ? ORDER BY at", [branchId, from, to])) {
    push({ no: `EXP-${e.id.slice(0, 6).toUpperCase()}`, date: day(e.at), at: e.at, type: "payment", narration: `${e.category}${e.note ? ` · ${e.note}` : ""}`,
      lines: [{ account: EXPENSE_ACCOUNT[e.category] ?? "Miscellaneous expense", dr: n(e.amount), cr: 0 }, { account: moneyAcc(e.mode), dr: 0, cr: n(e.amount) }] });
  }

  return out.sort((a, b) => (a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date)));
}

/** All vouchers of one day, in time order. */
export const dayBook = (db: DriveDB, branchId: string, iso = todayISO()) => journal(db, branchId, iso, iso);

/** Ledger balances for the period: debit and credit columns that always add up to the same total. */
export function trialBalance(db: DriveDB, branchId: string, fromIso: string, toIso: string) {
  const bal = new Map<string, number>();
  for (const v of journal(db, branchId, fromIso, toIso)) for (const l of v.lines) bal.set(l.account, (bal.get(l.account) ?? 0) + l.dr - l.cr);
  const rows = [...bal.entries()].filter(([, b]) => b !== 0).map(([account, b]) => ({ account, drPaise: b > 0 ? b : 0, crPaise: b < 0 ? -b : 0 }))
    .sort((a, b) => a.account.localeCompare(b.account));
  return { rows, drPaise: rows.reduce((a, r) => a + r.drPaise, 0), crPaise: rows.reduce((a, r) => a + r.crPaise, 0) };
}

/**
 * Profit & loss for the period, on the cost of the goods actually sold (each bill keeps the cost of its batches), so
 * it doesn't need a stock valuation: net sales − cost of goods sold = gross profit; less expenses and points = net.
 */
export function profitAndLoss(db: DriveDB, branchId: string, fromIso: string, toIso: string) {
  const [from, to] = range(fromIso, toIso);
  const s = db.engine.all<{ bills: number; taxable: number; cost: number; total: number; tax: number; discount: number }>(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(taxablePaise), 0) AS taxable, COALESCE(SUM(costPaise), 0) AS cost, COALESCE(SUM(totalPaise), 0) AS total,
            COALESCE(SUM(cgstPaise + sgstPaise + COALESCE(igstPaise, 0)), 0) AS tax, COALESCE(SUM(discountPaise), 0) AS discount
       FROM sale WHERE branchId = ? AND at >= ? AND at < ?`, [branchId, from, to])[0];
  const r = db.engine.all<{ taxable: number; cost: number; count: number }>(
    `SELECT COALESCE(SUM(r.taxablePaise), 0) AS taxable, COUNT(*) AS count,
            (SELECT COALESCE(SUM(ri.qty * si.costPaise), 0) FROM salesReturnItem ri JOIN salesReturn r2 ON r2.id = ri.returnId JOIN saleItem si ON si.id = ri.saleItemId
              WHERE r2.branchId = ?1 AND r2.at >= ?2 AND r2.at < ?3 AND ri.restocked = 1) AS cost
       FROM salesReturn r WHERE r.branchId = ?1 AND r.at >= ?2 AND r.at < ?3`, [branchId, from, to])[0];
  const exp = db.engine.all<{ category: string; amount: number }>(
    "SELECT category, COALESCE(SUM(amountPaise), 0) AS amount FROM expense WHERE branchId = ? AND at >= ? AND at < ? GROUP BY category ORDER BY amount DESC", [branchId, from, to])
    .map((e) => ({ category: e.category, amountPaise: n(e.amount) }));
  const tb = trialBalance(db, branchId, fromIso, toIso).rows;
  const of = (acc: string) => { const x = tb.find((t) => t.account === acc); return x ? x.drPaise - x.crPaise : 0; };
  const salesPaise = n(s.taxable), returnsPaise = n(r.taxable), netSalesPaise = salesPaise - returnsPaise;
  const cogsPaise = n(s.cost) - n(r.cost);
  const grossPaise = netSalesPaise - cogsPaise;
  const expensesPaise = exp.reduce((a, e) => a + e.amountPaise, 0);
  const loyaltyPaise = of(ACC.loyalty), roundOffPaise = -of(ACC.roundOff);
  const netPaise = grossPaise - expensesPaise - loyaltyPaise + roundOffPaise;
  return {
    from: fromIso, to: toIso, bills: n(s.bills), returns: n(r.count), salesPaise, returnsPaise, netSalesPaise, cogsPaise, grossPaise,
    grossMarginPct: netSalesPaise ? Math.round((grossPaise / netSalesPaise) * 1000) / 10 : 0,
    expenses: exp, expensesPaise, loyaltyPaise, roundOffPaise, netPaise, discountPaise: n(s.discount), gstCollectedPaise: n(s.tax),
  };
}

type StatementRow = { at: string; date: string; kind: string; ref: string; debitPaise: number; creditPaise: number; balancePaise: number };
function withBalance(rows: Omit<StatementRow, "balancePaise">[], fromIso?: string) {
  const start = fromIso ? istMidnight(fromIso).toISOString() : "";
  let opening = 0;
  const shown: StatementRow[] = [];
  let bal = 0;
  for (const r of rows.sort((a, b) => a.at.localeCompare(b.at))) {
    bal += r.debitPaise - r.creditPaise;
    if (start && r.at < start) { opening = bal; continue; }
    shown.push({ ...r, balancePaise: bal });
  }
  return { openingPaise: opening, rows: shown, closingPaise: bal };
}

/**
 * A credit customer's statement: bills on account (debit), money received and credit notes to the account (credit),
 * with the opening balance before the period. Bills paid at the counter don't touch the account and aren't listed.
 */
export function customerStatement(db: DriveDB, customerId: string, fromIso?: string, toIso = todayISO()) {
  const end = istMidnight(addDays(toIso, 1)).toISOString();
  const rows = [
    ...db.engine.all<{ at: string; ref: string; amount: number }>(
      `SELECT s.at, s.invoiceNo AS ref, p.amountPaise AS amount FROM payment p JOIN sale s ON s.id = p.saleId WHERE s.customerId = ? AND p.mode = 'credit' AND s.at < ?`, [customerId, end])
      .map((r) => ({ at: r.at, date: day(r.at), kind: "Bill on account", ref: r.ref, debitPaise: n(r.amount), creditPaise: 0 })),
    ...db.engine.all<{ at: string; mode: string; ref: string | null; amount: number }>(
      "SELECT at, mode, ref, amountPaise AS amount FROM customerReceipt WHERE customerId = ? AND at < ?", [customerId, end])
      .map((r) => ({ at: r.at, date: day(r.at), kind: `Received (${r.mode})`, ref: r.ref ?? "", debitPaise: 0, creditPaise: n(r.amount) })),
    ...db.engine.all<{ at: string; ref: string; amount: number }>(
      `SELECT r.at, r.creditNoteNo AS ref, r.amountPaise - COALESCE(r.pointsValuePaise, 0) AS amount FROM salesReturn r JOIN sale s ON s.id = r.saleId
        WHERE s.customerId = ? AND r.refundMode = 'credit' AND r.at < ?`, [customerId, end])
      .map((r) => ({ at: r.at, date: day(r.at), kind: "Credit note", ref: r.ref, debitPaise: 0, creditPaise: n(r.amount) })),
  ];
  const c = db.engine.all<{ name: string; phone: string | null; gstin: string | null; lim: number }>("SELECT name, phone, gstin, creditLimitPaise AS lim FROM customer WHERE id = ?", [customerId])[0];
  return { customer: c ? { ...c, limitPaise: n(c.lim) } : null, from: fromIso ?? null, to: toIso, ...withBalance(rows, fromIso) };
}

/** A supplier's statement: purchase bills (credit: we owe more), payments and the supplier's credit notes (debit). */
export function supplierStatement(db: DriveDB, supplierId: string, fromIso?: string, toIso = todayISO()) {
  const end = istMidnight(addDays(toIso, 1)).toISOString();
  const rows = [
    ...db.engine.all<{ at: string; billDate: string; ref: string; amount: number }>("SELECT at, billDate, billNo AS ref, totalPaise AS amount FROM purchase WHERE supplierId = ? AND billDate <= ?", [supplierId, toIso])
      .map((r) => ({ at: istMidnight(r.billDate).toISOString(), date: r.billDate, kind: "Purchase bill", ref: r.ref, debitPaise: 0, creditPaise: n(r.amount) })),
    ...db.engine.all<{ at: string; mode: string; ref: string | null; amount: number }>("SELECT at, mode, ref, amountPaise AS amount FROM supplierPayment WHERE supplierId = ? AND at < ?", [supplierId, end])
      .map((r) => ({ at: r.at, date: day(r.at), kind: `Paid (${r.mode})`, ref: r.ref ?? "", debitPaise: n(r.amount), creditPaise: 0 })),
    ...db.engine.all<{ at: string; ref: string | null; amount: number; claimNo: string }>(
      `SELECT e.at, e.ref, e.amountPaise AS amount, c.claimNo FROM claimEvent e JOIN supplierClaim c ON c.id = e.claimId WHERE e.supplierId = ? AND e.kind = 'credit' AND e.at < ?`, [supplierId, end])
      .map((r) => ({ at: r.at, date: day(r.at), kind: "Supplier credit note", ref: `${r.ref ?? ""} · ${r.claimNo}`, debitPaise: n(r.amount), creditPaise: 0 })),
  ];
  // Balance as "we owe": credits raise it, debits lower it.
  const flipped = withBalance(rows.map((r) => ({ ...r, debitPaise: r.creditPaise, creditPaise: r.debitPaise })), fromIso);
  const s = db.engine.all<{ name: string; phone: string | null; gstin: string | null }>("SELECT name, phone, gstin FROM supplier WHERE id = ?", [supplierId])[0];
  return {
    supplier: s ?? null, from: fromIso ?? null, to: toIso, openingPaise: flipped.openingPaise, closingPaise: flipped.closingPaise,
    rows: flipped.rows.map((r) => ({ ...r, debitPaise: r.creditPaise, creditPaise: r.debitPaise })),
  };
}

/**
 * Schedule H1 (and X / NDPS) register: every such line sold in the period with the patient, the prescriber and
 * their registration number, batch, expiry and quantity (less any returned), oldest first.
 */
export function h1Register(db: DriveDB, branchId: string, fromIso: string, toIso: string) {
  const [from, to] = range(fromIso, toIso);
  const marks = H1_SCHEDULES.map(() => "?").join(", ");
  return db.engine.all<{ id: string; at: string; invoiceNo: string; patient: string | null; prescriber: string | null; reg: string | null; medicine: string; strength: string | null; schedule: string; batchNo: string; expiry: string; qty: number; loose: number; packUnit: string; looseUnit: string; returned: number; customer: string | null }>(
    `SELECT i.id, s.at, s.invoiceNo, s.patientName AS patient, s.prescriber, s.prescriberReg AS reg, m.name AS medicine, m.strength, m.schedule, b.batchNo, b.expiryDate AS expiry,
            i.qty, i.loose, m.packUnit, m.looseUnit, c.name AS customer,
            (SELECT COALESCE(SUM(ri.qty), 0) FROM salesReturnItem ri WHERE ri.saleItemId = i.id) AS returned
       FROM saleItem i JOIN sale s ON s.id = i.saleId JOIN medicine m ON m.id = i.medicineId JOIN batch b ON b.id = i.batchId LEFT JOIN customer c ON c.id = s.customerId
      WHERE s.branchId = ? AND s.at >= ? AND s.at < ? AND m.schedule IN (${marks}) ORDER BY s.at, i.rowid`, [branchId, from, to, ...H1_SCHEDULES])
    .map((r) => ({ ...r, date: day(r.at), qty: n(r.qty), returned: n(r.returned), unit: r.loose ? r.looseUnit : r.packUnit, complete: !!(r.patient && r.prescriber && r.reg) }));
}

/** Tally Prime XML for the period: masters (ledgers and party ledgers) and vouchers, for Gateway of Tally → Import. */
export function tallyExport(db: DriveDB, branchId: string, fromIso: string, toIso: string, company: string) {
  const vouchers = journal(db, branchId, fromIso, toIso);
  const map = defaultTallyMap();
  const accounts = [...new Set(vouchers.flatMap((v) => v.lines.filter((l) => !l.partyLedger).map((l) => l.account)))];
  for (const a of accounts) if (!map[a]) map[a] = { ledger: a, group: "Indirect Expenses" };
  const parties = new Map<string, TallyParty>();
  for (const v of vouchers) for (const l of v.lines) if (l.partyLedger && !parties.has(l.partyLedger)) parties.set(l.partyLedger, { ledger: l.partyLedger, group: l.account === ACC.creditors ? "Sundry Creditors" : "Sundry Debtors" });
  for (const s of db.engine.all<{ name: string; gstin: string | null }>("SELECT name, gstin FROM supplier WHERE deletedAt IS NULL")) { const p = parties.get(s.name); if (p) p.gstin = s.gstin; }
  for (const c of db.engine.all<{ name: string; gstin: string | null }>("SELECT name, gstin FROM customer WHERE deletedAt IS NULL AND gstin IS NOT NULL")) { const p = parties.get(c.name); if (p) p.gstin = c.gstin; }
  return {
    vouchers: vouchers.length,
    vouchersXml: tallyVouchersXml(company, vouchers, map),
    mastersXml: tallyMastersXml(company, accounts, map, [...parties.values()]),
  };
}
