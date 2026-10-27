import { unzipSync, strFromU8 } from "fflate";

/** A table read from an uploaded file: header row first. */
export type Table = string[][];

/** RFC 4180 CSV with quoted fields, CRLF, a UTF-8 BOM, and comma, semicolon or tab separators. */
export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].sort((a, b) => count(first, b) - count(first, a))[0];
  const rows: Table = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return trimTable(rows);
}
const count = (s: string, ch: string) => s.split(ch).length - 1;

const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENT[e] ?? m);
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

/** Column letters → zero-based index: A → 0, Z → 25, AA → 26. */
export const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * Reads the first worksheet of an .xlsx file. Shared and inline strings, numbers and
 * booleans are supported; cells keep their raw stored value (dates stay as Excel serials).
 */
export function parseXlsx(bytes: Uint8Array): Table {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") }); } catch { throw new Error("This doesn’t look like an Excel (.xlsx) file."); }
  const shared = files["xl/sharedStrings.xml"] ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  const wb = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const rid = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : null;
  const path = target ? "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, "") : Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
  const sheet = path && files[path];
  if (!sheet) throw new Error("The Excel file has no worksheet.");
  const rows: Table = [];
  for (const r of strFromU8(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const val = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? texts(body) : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v !== undefined ? unxml(v) : "";
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push("");
      row[at] = val;
    }
    rows.push(row);
  }
  return trimTable(rows);
}

/** Drops empty trailing cells and fully empty rows. */
function trimTable(rows: Table): Table {
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

export function readTable(fileName: string, bytes: Uint8Array): Table {
  if (/\.xlsx$/i.test(fileName)) return parseXlsx(bytes);
  if (/\.xls$/i.test(fileName)) throw new Error("Old .xls files aren’t supported. In Excel, use Save As → Excel Workbook (.xlsx) or CSV.");
  if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(new TextDecoder("utf-8").decode(bytes));
  throw new Error("Upload a .xlsx or .csv file.");
}

/** Lower-case header key without spaces or punctuation: "GST Rate (%)" → "gstrate". */
export const headerKey = (h: string) => h.toLowerCase().replace(/\(.*?\)|[^a-z0-9]/g, "");

/** Excel date serial (1900 system) → yyyy-mm-dd. */
export function excelSerialDate(n: number) {
  return new Date(Math.round((n - 25569) * 86400_000)).toISOString().slice(0, 10);
}

/**
 * Expiry as printed on packs or typed in spreadsheets → "yyyy-mm" or "yyyy-mm-dd".
 * Accepts MM/YYYY, MM/YY, MM-YYYY, YYYY-MM(-DD), DD/MM/YYYY, "Nov 2026", "Nov-26" and Excel date serials.
 */
export function parseExpiry(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = (y: number) => (y < 100 ? 2000 + y : y);
  const ok = (y: number, m: number) => m >= 1 && m <= 12 && y >= 2000 && y <= 2100;
  let m: RegExpMatchArray | null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialDate(Number(s));
  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) { const [y, mo] = [+m[1], +m[2]]; return ok(y, mo) ? (m[3] ? `${y}-${pad(mo)}-${pad(+m[3])}` : `${y}-${pad(mo)}`) : null; }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) { const [d, mo, y] = [+m[1], +m[2], yy(+m[3])]; return ok(y, mo) && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{2,4})$/))) { const [mo, y] = [+m[1], yy(+m[2])]; return ok(y, mo) ? `${y}-${pad(mo)}` : null; }
  if ((m = s.match(/^([a-z]{3,9})[\s/.-]*(\d{2,4})$/i))) {
    const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const y = yy(+m[2]);
    return mo && ok(y, mo) ? `${y}-${pad(mo)}` : null;
  }
  return null;
}

/** "₹1,234.50" → "1234.50"; returns "" for blank. */
export const cleanNumber = (s: string) => s.replace(/[₹,\s]|rs\.?|inr/gi, "").replace(/%$/, "");
export const yes = (s: string) => /^(y|yes|true|1|haan|ha)$/i.test(s.trim());
