// Distributor digital bills (e-bills): CSV / Excel / pipe- or tab-delimited text exports → GRN draft lines.
// No single public field layout exists for these exports, so files are read through a column mapping: detected
// from header names where the file has them, otherwise chosen once per supplier and saved.
import { cleanNumber, headerKey, parseCsv, parseExpiry, readTable, type Table } from "@/domain/imports/parse";

export const EBILL_FIELDS = {
  name: "Item name", pack: "Pack", code: "Supplier item code", barcode: "Barcode", hsn: "HSN", batch: "Batch", expiry: "Expiry",
  qty: "Quantity", free: "Free quantity", scheme: "Scheme (10+2)", mrp: "MRP", ptr: "PTR / rate", pts: "PTS", gst: "GST %",
  schemePct: "Scheme discount %", discPct: "Trade discount %", cdPct: "Cash discount %", amount: "Line amount",
  invoiceNo: "Invoice no.", invoiceDate: "Invoice date",
} as const;
export type EbillField = keyof typeof EBILL_FIELDS;
export const REQUIRED_FIELDS: EbillField[] = ["name", "batch", "expiry", "qty", "ptr"];

/** Header spellings seen on Indian pharma distributor exports (Marg, BUSY, Logic, GoFrugal and spreadsheets), keyed by headerKey(). */
const SYNONYMS: Record<EbillField, string[]> = {
  name: ["itemname", "item", "product", "productname", "description", "itemdescription", "particulars", "medicine", "name", "itemdesc", "prodname"],
  pack: ["pack", "packing", "packsize", "unit", "uom", "pck"],
  code: ["itemcode", "productcode", "code", "icode", "prodcode", "itemid", "skucode", "pcode"],
  barcode: ["barcode", "ean", "eancode", "gtin", "upc"],
  hsn: ["hsn", "hsncode", "hsnsac", "hsnsaccode"],
  batch: ["batch", "batchno", "batchnumber", "bno", "lot", "lotno"],
  expiry: ["expiry", "exp", "expdate", "expirydate", "expdt", "expirydate"],
  qty: ["qty", "quantity", "billqty", "billedqty", "salequantity", "saleqty", "qnty", "pcs"],
  free: ["free", "freeqty", "fqty", "freequantity", "bonus", "bonusqty", "schqty", "schemeqty"],
  scheme: ["scheme", "sch", "deal", "offer"],
  mrp: ["mrp", "mrprs", "maxretailprice"],
  ptr: ["ptr", "rate", "purchaserate", "prate", "salerate", "srate", "billrate", "netrate", "price", "unitprice"],
  pts: ["pts", "pricetostockist"],
  gst: ["gst", "gstper", "gstpercent", "gstrate", "tax", "taxper", "taxrate", "igst", "igstper", "gstpct"],
  schemePct: ["schemeper", "schper", "schemepercent", "schdisc", "schemedisc", "halfscheme"],
  discPct: ["disc", "discper", "discount", "discountper", "td", "tdper", "tradedisc", "tradediscount", "dis", "disper"],
  cdPct: ["cd", "cdper", "cashdisc", "cashdiscount", "cashdiscper"],
  amount: ["amount", "amt", "value", "netamount", "netamt", "total", "lineamount", "taxableamount", "taxable", "grossamt"],
  invoiceNo: ["invoiceno", "billno", "invno", "invoicenumber", "billnumber", "docno", "voucherno"],
  invoiceDate: ["invoicedate", "billdate", "invdate", "date", "docdate", "voucherdate"],
};

export type EbillMapping = {
  /** Zero-based row holding column names; -1 when the file has none. */
  headerRow: number;
  cols: Partial<Record<EbillField, number>>;
  /** Column names as they appear in the header, so a saved mapping survives reordered columns. */
  names?: Partial<Record<EbillField, string>>;
  /** Only rows whose cell `col` equals `value` are item lines (record-type prefixes such as "D" or "T"). */
  rowFilter?: { col: number; value: string } | null;
};

export type EbillLine = {
  row: number; name: string; pack: string; code: string; barcode: string; hsn: string; batch: string; expiry: string | null;
  qty: number; free: number; scheme: string; mrp: number | null; ptr: number | null; pts: number | null; gst: number | null;
  schemePct: number; discPct: number; cdPct: number; amount: number | null; problems: string[];
};
export type EbillDraft = { invoiceNo: string; invoiceDate: string; total: number | null; lines: EbillLine[]; skipped: number };

/** Reads an uploaded bill into a table. Text files split on "|" when most lines carry pipes; else CSV rules apply. */
export function readEbillTable(fileName: string, bytes: Uint8Array): Table {
  if (/\.(txt|csv|tsv|dat|prn)$/i.test(fileName)) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length && lines.filter((l) => l.includes("|")).length >= lines.length / 2) {
      return lines.map((l) => l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
    }
    return parseCsv(text);
  }
  return readTable(fileName, bytes);
}

const fieldOf = (cell: string): EbillField | null => {
  const k = headerKey(cell);
  if (!k) return null;
  for (const [f, keys] of Object.entries(SYNONYMS) as [EbillField, string[]][]) if (keys.includes(k)) return f;
  return null;
};

/** Finds the header row among the first rows and maps its columns by name. Null when no row looks like a header. */
export function autoMapping(t: Table): EbillMapping | null {
  for (let r = 0; r < Math.min(t.length, 15); r++) {
    const cols: Partial<Record<EbillField, number>> = {}, names: Partial<Record<EbillField, string>> = {};
    t[r].forEach((cell, i) => { const f = fieldOf(cell); if (f && cols[f] === undefined) { cols[f] = i; names[f] = cell; } });
    if (cols.name !== undefined && cols.qty !== undefined && Object.keys(cols).length >= 4) return { headerRow: r, cols, names, rowFilter: null };
  }
  return null;
}

/** Re-anchors a saved mapping to this file: by header names when the file has them, else by column position. */
export function resolveMapping(t: Table, saved: EbillMapping): EbillMapping {
  if (saved.headerRow < 0 || !saved.names) return saved;
  for (let r = 0; r < Math.min(t.length, 15); r++) {
    const keys = t[r].map(headerKey);
    const cols: Partial<Record<EbillField, number>> = {};
    for (const [f, n] of Object.entries(saved.names) as [EbillField, string][]) { const i = keys.indexOf(headerKey(n)); if (i >= 0) cols[f] = i; }
    if (REQUIRED_FIELDS.every((f) => saved.cols[f] === undefined || cols[f] !== undefined) && Object.keys(cols).length) return { ...saved, headerRow: r, cols };
  }
  return saved;
}

export const missingFields = (m: EbillMapping) => REQUIRED_FIELDS.filter((f) => m.cols[f] === undefined);

const num = (s: string | undefined) => {
  const c = cleanNumber(s ?? "");
  if (c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};
const paise = (s: string | undefined) => { const n = num(s); return n == null ? null : Math.round(n * 100); };
const pctNum = (s: string | undefined) => { const n = num(s); return n == null || n < 0 || n >= 100 ? 0 : Math.round(n * 100) / 100; };

/** Bill date → yyyy-mm-dd (dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, "12 Oct 2026", Excel serials). */
export function parseBillDate(raw: string): string {
  const e = parseExpiry(raw.trim());
  if (e && e.length === 10) return e;
  const m = raw.trim().match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-](\d{2,4})$/i);
  if (m) {
    const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    if (mo) return `${y}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

/** Turns mapped rows into bill lines. Rows without an item name or a numeric quantity (totals, notes) are skipped. */
export function applyMapping(t: Table, m: EbillMapping): EbillDraft {
  const at = (r: string[], f: EbillField) => (m.cols[f] === undefined ? "" : (r[m.cols[f]!] ?? "").trim());
  const lines: EbillLine[] = [];
  let invoiceNo = "", invoiceDate = "", skipped = 0;
  for (let i = m.headerRow + 1; i < t.length; i++) {
    const r = t[i];
    if (m.rowFilter && (r[m.rowFilter.col] ?? "").trim().toUpperCase() !== m.rowFilter.value.trim().toUpperCase()) { skipped++; continue; }
    const name = at(r, "name"), qty = num(at(r, "qty"));
    if (!name || qty == null || qty <= 0 || /^(total|grand total|sub ?total|net amount)/i.test(name)) { skipped++; continue; }
    invoiceNo ||= at(r, "invoiceNo");
    invoiceDate ||= parseBillDate(at(r, "invoiceDate"));
    const scheme = at(r, "scheme").replace(/\s+/g, "");
    const l: EbillLine = {
      row: i + 1, name, pack: at(r, "pack"), code: at(r, "code"), barcode: at(r, "barcode").replace(/\D/g, ""), hsn: at(r, "hsn"), batch: at(r, "batch").toUpperCase().replace(/[^A-Z0-9/-]/g, ""),
      expiry: parseExpiry(at(r, "expiry")), qty: Math.round(qty), free: Math.max(0, Math.round(num(at(r, "free")) ?? 0)), scheme: /^\d+\+\d+$/.test(scheme) ? scheme : "",
      mrp: paise(at(r, "mrp")), ptr: paise(at(r, "ptr")), pts: paise(at(r, "pts")), gst: num(at(r, "gst")), schemePct: pctNum(at(r, "schemePct")), discPct: pctNum(at(r, "discPct")), cdPct: pctNum(at(r, "cdPct")),
      amount: paise(at(r, "amount")), problems: [],
    };
    if (!l.batch) l.problems.push("Batch missing");
    if (!l.expiry) l.problems.push("Expiry not readable");
    if (!l.ptr || l.ptr <= 0) l.problems.push("Rate missing");
    if (l.qty !== qty) l.problems.push("Quantity isn’t a whole number");
    lines.push(l);
  }
  return { invoiceNo: invoiceNo.slice(0, 40), invoiceDate, total: null, lines, skipped };
}

/** Normalised item name (+ pack) used to remember name-based matches per supplier. */
export const nameKey = (name: string, pack = "") => "N:" + (name + " " + pack).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100);

/** Word-overlap score between a bill name and a catalogue label, with a bonus when the pack matches. */
export function nameScore(billName: string, billPack: string, label: string, pack: string) {
  const words = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["tab", "tabs", "cap", "caps", "syp", "inj", "mg", "ml"].includes(w)));
  const a = words(billName), b = words(label);
  if (!a.size || !b.size) return 0;
  const inter = [...a].filter((w) => b.has(w)).length;
  let score = inter / Math.max(a.size, b.size) * 0.6 + inter / Math.min(a.size, b.size) * 0.4;
  const digits = (x: string) => x.replace(/\D+/g, " ").trim();
  if (billPack && pack && digits(billPack) && digits(billPack) === digits(pack)) score += 0.1;
  return Math.min(1, score);
}
