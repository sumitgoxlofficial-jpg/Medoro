/**
 * Bank statements: reading the file, finding the columns and turning rows into signed amounts.
 * Pure code: runs on the server (self-hosted bank reconciliation) and on the device (Drive counters).
 *
 * Formats: CSV, XLSX, and the two kinds of ".xls" Indian banks usually hand out — an HTML table or Excel 2003
 * XML (SpreadsheetML) saved with an .xls name. Real binary .xls (Excel 97–2003) is refused with a clear message.
 */
import { cleanNumber, headerKey, type Table } from "@/domain/imports/parse";
import { parseBillDate, readEbillTable } from "@/domain/purchasing/ebill";
import { BANK_FIELDS, type BankField, type BankMapping } from "@/domain/accounting/bank-types";

export { BANK_FIELDS, type BankField, type BankMapping };

/** Statement files above this size are refused (Vercel's request limit is 4.5 MB). */
export const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;

const SYN: Record<BankField, string[]> = {
  date: ["date", "txndate", "transactiondate", "trandate", "postdate", "postingdate", "valuedate", "valuedt", "txndt", "tranddate", "transactiondatetime", "dateandtime"],
  description: ["description", "narration", "particulars", "remarks", "details", "transactiondetails", "transactionremarks", "transactiondescription"],
  ref: ["ref", "refno", "chqno", "chequeno", "chqrefno", "chequerefno", "referenceno", "refchqno", "utr", "utrno", "instrumentno", "chqrefnumber", "refnochequeno", "chequenorefno", "refnochqno", "chqnorefno", "chqrefno", "transactionid", "tranid", "txnid"],
  debit: ["debit", "withdrawal", "withdrawals", "withdrawalamt", "withdrawalamount", "dr", "debitamount", "debitamt", "withdrawalsdr", "withdrawalamountinr"],
  credit: ["credit", "deposit", "deposits", "depositamt", "depositamount", "cr", "creditamount", "creditamt", "depositscr", "depositamountinr"],
  amount: ["amount", "txnamount", "transactionamount", "amountinr"],
  balance: ["balance", "closingbalance", "runningbalance", "bal", "availablebalance", "balanceinr"],
};

const dec = (b: Uint8Array) => new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const unent = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (html: string) => unent(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/** Rows of every <table> in an HTML page (banks' "Excel" downloads are often this). colspan is honoured. */
export function parseHtmlTable(html: string): Table {
  const rows: Table = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  for (const tr of body.match(/<tr[\s>][\s\S]*?<\/tr>/gi) ?? []) {
    const row: string[] = [];
    for (const m of tr.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const span = Math.min(50, Math.max(1, Number(/colspan\s*=\s*["']?(\d+)/i.exec(m[2])?.[1] ?? 1)));
      row.push(text(m[3]));
      for (let i = 1; i < span; i++) row.push("");
    }
    if (row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

/** Excel 2003 XML (SpreadsheetML): first worksheet, ss:Index gaps kept. */
export function parseSpreadsheetMl(xml: string): Table {
  const sheet = /<(?:ss:)?Worksheet[\s\S]*?<\/(?:ss:)?Worksheet>/i.exec(xml)?.[0] ?? xml;
  const rows: Table = [];
  for (const r of sheet.match(/<(?:ss:)?Row[\s>/][\s\S]*?(?:<\/(?:ss:)?Row>|\/>)/gi) ?? []) {
    const row: string[] = [];
    for (const c of r.matchAll(/<(?:ss:)?Cell([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
      const idx = /(?:ss:)?Index\s*=\s*"(\d+)"/i.exec(c[1])?.[1];
      if (idx) while (row.length < Math.min(500, Number(idx) - 1)) row.push("");
      const data = /<(?:ss:)?Data[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(c[2] ?? "")?.[1] ?? "";
      row.push(text(data));
    }
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}

/** Reads a statement file into a table. Throws an Error with a message a person can act on. */
export function readStatementTable(fileName: string, bytes: Uint8Array): Table {
  if (bytes.length > MAX_STATEMENT_BYTES) throw new Error("The statement file is larger than 4 MB. Download a shorter date range.");
  if (/\.pdf$/i.test(fileName)) throw new Error("PDF statements can’t be read. Download the statement as Excel or CSV from your bank instead.");
  if (/\.(xls|htm|html|xml)$/i.test(fileName)) {
    // D0 CF 11 E0: the old binary Excel format.
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      throw new Error("This is an old binary Excel (.xls) file. Open it in Excel and use Save As → Excel Workbook (.xlsx) or CSV, then upload that.");
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readEbillTable(fileName.replace(/\.\w+$/, ".xlsx"), bytes); // an .xlsx renamed .xls
    const s = dec(bytes);
    const head = s.slice(0, 4096).toLowerCase();
    if (head.includes("urn:schemas-microsoft-com:office:spreadsheet") || /<(ss:)?workbook/.test(head)) return parseSpreadsheetMl(s);
    if (/<table|<html/.test(s.slice(0, 200_000).toLowerCase())) return parseHtmlTable(s);
    // Some banks send tab- or comma-separated text named .xls.
    if (!/[\x00-\x08]/.test(s.slice(0, 2000))) return readEbillTable(fileName.replace(/\.\w+$/, ".csv"), bytes);
    throw new Error("Couldn’t read this .xls file. Save it as Excel Workbook (.xlsx) or CSV and upload that.");
  }
  try { return readEbillTable(fileName, bytes); }
  catch (e) { throw new Error(e instanceof Error ? e.message : "Couldn’t read the file."); }
}

/** Finds the header row (first 25 rows) by column names. Null when no row has a date and an amount column. */
export function bankAutoMapping(t: Table): BankMapping | null {
  for (let r = 0; r < Math.min(t.length, 25); r++) {
    const cols: Partial<Record<BankField, number>> = {};
    t[r].forEach((c, i) => { const k = headerKey(c); for (const [f, keys] of Object.entries(SYN) as [BankField, string[]][]) if (keys.includes(k) && cols[f] === undefined) cols[f] = i; });
    // "Value date" next to "Txn date": keep the first date column.
    if (cols.date !== undefined && (cols.amount !== undefined || (cols.debit !== undefined && cols.credit !== undefined))) return { headerRow: r, cols };
  }
  return null;
}

export const mappingReady = (m: BankMapping | null | undefined): m is BankMapping =>
  !!m && Number.isInteger(m.headerRow) && m.headerRow >= 0 && m.cols.date !== undefined && (m.cols.amount !== undefined || (m.cols.debit !== undefined && m.cols.credit !== undefined));

/** "1,234.50", "1,234.50 Cr", "(500.00)", "-500", "₹ 500" → paise (signed). Dr = money out. */
export function bankAmount(raw: string): number | null {
  const s = raw.trim().replace(/^(rs\.?|inr|₹)\s*/i, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s) || /\bdr\.?$/i.test(s) || /^-/.test(s);
  const n = Number(cleanNumber(s.replace(/[()]/g, "").replace(/\s*(cr|dr)\.?$/i, "").replace(/^-/, "")));
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -Math.abs(n) : n) * 100);
}

/**
 * A statement date, with the time when the bank prints one: "02/11/2026", "02-Nov-2026 10:15", "2026-11-02T10:15:00",
 * "02/11/26 10:15:32 AM", or an Excel date serial. Day comes before month (Indian banks).
 */
export function statementDate(raw: string): { date: string; time: string | null } | null {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  let time: string | null = null;
  const tm = /[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (tm) {
    let h = Number(tm[1]);
    const pm = tm[4]?.toLowerCase().startsWith("p"), am = tm[4]?.toLowerCase().startsWith("a");
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h < 24 && Number(tm[2]) < 60) time = `${String(h).padStart(2, "0")}:${tm[2]}:${tm[3] ?? "00"}`;
    s = s.slice(0, tm.index).trim();
  }
  // Excel serial with a fraction of a day for the time.
  if (/^\d{5}\.\d+$/.test(s)) {
    const n = Number(s), mins = Math.round((n % 1) * 1440);
    time ??= `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00`;
    s = String(Math.floor(n));
  }
  const date = parseBillDate(s) || (/^\d{1,2} [a-z]{3,9},? \d{4}$/i.test(s) ? parseBillDate(s.replace(",", "").replace(/^(\d+) ([a-z]{3})[a-z]* /i, "$1-$2-")) : "");
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, time } : null;
}

export type StatementRow = { row: number; date: string; time: string | null; description: string; ref: string; amount: number; balance: number | null };
export type RowProblem = { row: number; reason: string };

/**
 * Turns mapped rows into signed amounts (+ money in). Blank lines, totals and notes without a date or an amount are
 * skipped; a row with a date but an amount that can't be read (or the reverse) is reported, never guessed.
 * Row numbers are 1-based, as a spreadsheet shows them.
 */
export function bankRows(t: Table, m: BankMapping): { rows: StatementRow[]; skipped: number; problems: RowProblem[] } {
  const at = (r: string[], f: BankField) => (m.cols[f] === undefined ? "" : (r[m.cols[f]!] ?? "").trim());
  const rows: StatementRow[] = [];
  const problems: RowProblem[] = [];
  let skipped = 0;
  for (let i = m.headerRow + 1; i < t.length; i++) {
    const r = t[i];
    const rawDate = at(r, "date");
    const d = statementDate(rawDate);
    let amount: number | null;
    if (m.cols.amount !== undefined) amount = bankAmount(at(r, "amount"));
    else {
      const cr = bankAmount(at(r, "credit")), dr = bankAmount(at(r, "debit"));
      amount = cr == null && dr == null ? null : (cr ?? 0) - Math.abs(dr ?? 0);
      if (cr && dr) { problems.push({ row: i + 1, reason: "Has both a debit and a credit amount." }); continue; }
    }
    if (!d && amount == null) { skipped++; continue; }
    if (!d) {
      // Opening/closing balance and total lines carry an amount but no date.
      if (/total|balance|opening|closing|b\/f|c\/f|brought|carried/i.test(r.join(" "))) { skipped++; continue; }
      problems.push({ row: i + 1, reason: rawDate ? `Date “${rawDate.slice(0, 30)}” isn’t a date.` : "No date." });
      continue;
    }
    if (amount == null) {
      if (/balance|opening|closing|b\/f|c\/f|brought|carried/i.test(r.join(" "))) { skipped++; continue; }
      problems.push({ row: i + 1, reason: "No amount." });
      continue;
    }
    if (amount === 0) { skipped++; continue; }
    rows.push({ row: i + 1, date: d.date, time: d.time, description: at(r, "description").slice(0, 300), ref: at(r, "ref").slice(0, 60), amount, balance: bankAmount(at(r, "balance")) });
  }
  return { rows, skipped, problems };
}

/** The first rows of a table, cut to a size that fits a mapping screen. */
export const previewOf = (t: Table) => t.slice(0, 15).map((r) => r.slice(0, 20).map((c) => c.slice(0, 60)));

/**
 * A short, stable fingerprint of a statement row (same row in a later file → same value). Pure JS (two FNV-1a
 * passes, 104 bits) so it runs synchronously on the device. `n` is the row's occurrence among identical rows.
 */
export function rowFingerprint(account: string, r: Pick<StatementRow, "date" | "amount" | "description" | "ref" | "balance">, n: number): string {
  const s = [account, r.date, r.amount, r.description.replace(/\s+/g, " ").trim().toUpperCase(), r.ref.trim().toUpperCase(), r.balance ?? "", n].join("|");
  const h = (seed: number) => {
    let a = 0x811c9dc5 ^ seed, b = 0x01000193 ^ (seed * 31);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c ^ (a & 0xff), 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  };
  return (h(0) + h(0x9e3779b9)).slice(0, 26);
}

/** Occurrence numbers for identical rows within one file, so two genuine same-day ₹100 credits stay two rows. */
export function withOccurrence<T extends Pick<StatementRow, "date" | "amount" | "description" | "ref" | "balance">>(rows: T[]): (T & { n: number })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = [r.date, r.amount, r.description.trim().toUpperCase(), r.ref.trim().toUpperCase(), r.balance ?? ""].join("|");
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...r, n };
  });
}

/** Banks for the statement picker. The code goes into the account key; nothing is fetched from the bank. */
export const BANKS = [
  ["SBI", "State Bank of India"], ["HDFC", "HDFC Bank"], ["ICICI", "ICICI Bank"], ["AXIS", "Axis Bank"], ["KOTAK", "Kotak Mahindra Bank"],
  ["PNB", "Punjab National Bank"], ["BOB", "Bank of Baroda"], ["CANARA", "Canara Bank"], ["UNION", "Union Bank of India"], ["BOI", "Bank of India"],
  ["INDIAN", "Indian Bank"], ["CENTRAL", "Central Bank of India"], ["IDFC", "IDFC FIRST Bank"], ["YES", "Yes Bank"], ["INDUSIND", "IndusInd Bank"],
  ["FEDERAL", "Federal Bank"], ["IDBI", "IDBI Bank"], ["AU", "AU Small Finance Bank"], ["RBL", "RBL Bank"], ["SARASWAT", "Saraswat Bank"],
  ["COOP", "Co-operative bank"], ["OTHER", "Other bank"],
] as const;
export type BankCode = (typeof BANKS)[number][0];
export const bankName = (code: string) => BANKS.find(([c]) => c === code)?.[1] ?? code;
/** "HDFC-1234": the account a statement belongs to (bank + last 4 digits typed by the user). */
export const accountKey = (bank: string, last4: string) => `${bank}-${last4}`;
export const accountLabel = (key: string) => { const [b, l] = key.split("-"); return `${bankName(b)} ••${l ?? ""}`; };
