import { ACC, EXPENSE_ACCOUNTS } from "@/domain/accounting/accounts";

// Tally Prime XML import (Gateway of Tally → Import → Masters / Transactions, or the XML-over-HTTP port).

export type TallyMapRow = { ledger: string; group: string };
export type TallyMap = Record<string, TallyMapRow>;

export const TALLY_GROUPS = ["Sundry Debtors", "Sundry Creditors", "Sales Accounts", "Purchase Accounts", "Duties & Taxes", "Cash-in-Hand", "Bank Accounts", "Indirect Expenses", "Indirect Incomes", "Direct Expenses", "Stock-in-Hand", "Capital Account", "Current Assets", "Current Liabilities", "Suspense A/c"] as const;

/** Default Medoro account → Tally ledger and parent group. Editable in GST settings. */
export function defaultTallyMap(): TallyMap {
  const m: TallyMap = {
    [ACC.cash]: { ledger: "Cash", group: "Cash-in-Hand" },
    [ACC.bank]: { ledger: "Bank Account", group: "Bank Accounts" },
    [ACC.sales]: { ledger: "Sales", group: "Sales Accounts" },
    [ACC.salesReturns]: { ledger: "Sales Returns", group: "Sales Accounts" },
    [ACC.purchases]: { ledger: "Purchases", group: "Purchase Accounts" },
    [ACC.cgst]: { ledger: "Output CGST", group: "Duties & Taxes" },
    [ACC.sgst]: { ledger: "Output SGST", group: "Duties & Taxes" },
    [ACC.igst]: { ledger: "Output IGST", group: "Duties & Taxes" },
    [ACC.inCgst]: { ledger: "Input CGST", group: "Duties & Taxes" },
    [ACC.inSgst]: { ledger: "Input SGST", group: "Duties & Taxes" },
    [ACC.inIgst]: { ledger: "Input IGST", group: "Duties & Taxes" },
    [ACC.roundOff]: { ledger: "Round Off", group: "Indirect Expenses" },
    [ACC.debtors]: { ledger: "Sundry Debtors (Medoro)", group: "Sundry Debtors" },
    [ACC.creditors]: { ledger: "Sundry Creditors (Medoro)", group: "Sundry Creditors" },
    [ACC.inventory]: { ledger: "Inventory", group: "Stock-in-Hand" },
    [ACC.stockLoss]: { ledger: "Stock Loss", group: "Indirect Expenses" },
    [ACC.cashDiff]: { ledger: "Cash Short/Excess", group: "Indirect Expenses" },
    [ACC.opening]: { ledger: "Opening Balance Equity", group: "Capital Account" },
  };
  for (const e of EXPENSE_ACCOUNTS) m[e] = { ledger: e, group: "Indirect Expenses" };
  return m;
}

const VCH: Record<string, string> = { sales: "Sales", purchase: "Purchase", receipt: "Receipt", payment: "Payment", credit_note: "Credit Note", debit_note: "Debit Note", journal: "Journal", reversal: "Journal" };
const DUTY: Record<string, string> = { [ACC.cgst]: "Central Tax", [ACC.inCgst]: "Central Tax", [ACC.sgst]: "State Tax", [ACC.inSgst]: "State Tax", [ACC.igst]: "Integrated Tax", [ACC.inIgst]: "Integrated Tax" };

export const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const amt = (p: number) => (p / 100).toFixed(2);

export type TallyVoucher = { no: string; date: string /* YYYY-MM-DD, IST */; type: string; narration: string; lines: { account: string; dr: number; cr: number; partyLedger?: string }[] };
export type TallyParty = { ledger: string; group: "Sundry Debtors" | "Sundry Creditors"; gstin?: string | null; state?: string | null };

/** Ledger a posted line goes to: the party's own ledger for party lines, else the mapped ledger. */
export const ledgerOf = (map: TallyMap, account: string, partyLedger?: string) => partyLedger ?? map[account]?.ledger ?? account;

const envelope = (report: string, company: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY>\n<IMPORTDATA>\n<REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>\n<REQUESTDATA>\n${body}</REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>\n`;

/**
 * Vouchers XML. Tally signs: a debit is ISDEEMEDPOSITIVE Yes with a negative AMOUNT, a credit is No with a
 * positive AMOUNT, so every voucher's amounts add up to zero.
 */
export function tallyVouchersXml(company: string, vouchers: TallyVoucher[], map: TallyMap): string {
  const body = vouchers.map((v) => {
    const type = VCH[v.type] ?? "Journal";
    const lines = v.lines.filter((l) => l.dr || l.cr);
    const party = lines.find((l) => l.partyLedger)?.partyLedger ?? (type === "Sales" || type === "Receipt" ? ledgerOf(map, ACC.cash) : undefined);
    const entries = lines.map((l) => {
      const debit = l.dr > 0, value = debit ? -(l.dr - l.cr) : l.cr - l.dr;
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledgerOf(map, l.account, l.partyLedger))}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>${l.partyLedger ? "Yes" : "No"}</ISPARTYLEDGER><AMOUNT>${amt(value)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    }).join("\n");
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF">\n<VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>${v.date.replace(/-/g, "")}</DATE><EFFECTIVEDATE>${v.date.replace(/-/g, "")}</EFFECTIVEDATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(v.no)}</VOUCHERNUMBER>${party ? `<PARTYLEDGERNAME>${xml(party)}</PARTYLEDGERNAME>` : ""}<NARRATION>${xml(v.narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>\n${entries}\n</VOUCHER>\n</TALLYMESSAGE>\n`;
  }).join("");
  return envelope("Vouchers", company, body);
}

/** Masters XML: one ledger per mapped account in use, plus party ledgers under Sundry Debtors/Creditors. */
export function tallyMastersXml(company: string, accounts: string[], map: TallyMap, parties: TallyParty[]): string {
  const seen = new Set<string>();
  const ledger = (name: string, group: string, extra = "") => {
    if (seen.has(name)) return "";
    seen.add(name);
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF">\n<LEDGER NAME="${xml(name)}" ACTION="Create"><NAME.LIST><NAME>${xml(name)}</NAME></NAME.LIST><PARENT>${xml(group)}</PARENT>${extra}</LEDGER>\n</TALLYMESSAGE>\n`;
  };
  const body = [
    ...accounts.map((a) => {
      const m = map[a] ?? { ledger: a, group: "Suspense A/c" };
      const duty = DUTY[a] ? `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${DUTY[a]}</GSTDUTYHEAD>` : "";
      return ledger(m.ledger, m.group, `${duty}<ISBILLWISEON>${m.group.startsWith("Sundry") ? "Yes" : "No"}</ISBILLWISEON>`);
    }),
    ...parties.map((p) => ledger(p.ledger, p.group, `<ISBILLWISEON>Yes</ISBILLWISEON>${p.gstin ? `<PARTYGSTIN>${xml(p.gstin)}</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>` : ""}${p.state ? `<LEDSTATENAME>${xml(p.state)}</LEDSTATENAME>` : ""}`)),
  ].join("");
  return envelope("All Masters", company, body);
}
