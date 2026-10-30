import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Invoice } from "./service";

// Standard PDF fonts can't draw the rupee sign, so amounts use "Rs.".
const rs = (p: number) => (p < 0 ? "-" : "") + "Rs. " + (Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PUNCT: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"', "\u2013": "-", "\u2014": "-", "\u2022": "*", "\u2026": "...", "\u20B9": "Rs.", "\u00A0": " ", "\u00B7": "-" };
/**
 * Standard fonts are WinAnsi only, and pdf-lib can't shape Devanagari even with an embedded font, so
 * other scripts are dropped. Text left with nothing readable shows the placeholder instead of vanishing.
 */
export const clean = (s: string, placeholder = "") => {
  const a = s.replace(/[^\x20-\x7E]/g, (c) => PUNCT[c] ?? " ").replace(/\s+/g, " ").trim();
  return /[A-Za-z0-9]/.test(a) || !/[^\x20-\x7E]/.test(s) ? a : placeholder;
};

/** Rows per page so that the totals block fits after the last row (it may get a page of its own). */
export function pageRows(n: number, first: number, next: number, footer: number): number[] {
  if (footer > next) throw new Error("Totals block taller than a page");
  const pages: number[] = [];
  let left = n;
  for (;;) {
    const cap = pages.length ? next : first;
    if (left + footer <= cap) { pages.push(left); return pages; }
    const take = Math.min(left, cap);
    pages.push(take); left -= take;
  }
}

const W = 595, H = 842, TOP = 800, BOTTOM = 40, ROW = 14;
const FOOTER_ROWS = Math.ceil(140 / ROW);

/** A4 GST tax invoice PDF built from the committed sale. Prescriber details are left out for sharing. */
export async function invoicePdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.invoiceNo}`); doc.setProducer("Medoro");
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([W, H]);
  let y = TOP;
  const text = (s: string, x: number, size = 9, font: PDFFont = f, color = rgb(0.1, 0.1, 0.1)) => page.drawText(clean(s), { x, y, size, font, color });
  const right = (s: string, x: number, size = 9, font: PDFFont = f) => page.drawText(clean(s), { x: x - font.widthOfTextAtSize(clean(s), size), y, size, font });
  const rule = (x0: number, thickness = 0.5, color = rgb(0.7, 0.7, 0.7)) => page.drawLine({ start: { x: x0, y }, end: { x: 555, y }, thickness, color });
  const seller = clean(inv.pharmacy.legalName ?? inv.pharmacy.name, "Pharmacy");
  const cols: [string, number, boolean][] = [["#", 40, false], ["Item", 56, false], ["Batch", 230, false], ["Exp", 292, false], ["Qty", 345, true], ["MRP", 395, true], ["Disc", 440, true], ["GST%", 475, true], ["Amount", 555, true]];
  const tableHead = () => {
    for (const [h, x, r] of cols) if (r) right(h, x, 8.5, b); else text(h, x, 8.5, b);
    y -= 6; rule(40); y -= 13;
  };

  text(seller, 40, 15, b); right("TAX INVOICE", 555, 13, b); y -= 16;
  if (inv.pharmacy.address) text(inv.pharmacy.address, 40); right(inv.invoiceNo, 555, 10, b); y -= 12;
  text(`${inv.pharmacy.gstin ? "GSTIN " + inv.pharmacy.gstin : ""}${inv.pharmacy.dl ? "   DL " + inv.pharmacy.dl : ""}`, 40);
  right(new Date(inv.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), 555); y -= 10;
  rule(40, 1.2, rgb(0.04, 0.37, 0.36)); y -= 18;
  text(`Bill to: ${inv.customer ? clean(inv.customer.name, "Customer") : "Walk-in customer"}`, 40, 10); y -= 22;
  tableHead();

  const rowsFrom = (top: number) => Math.floor((top - BOTTOM) / ROW);
  const plan = pageRows(inv.lines.length, rowsFrom(y), rowsFrom(TOP - 16 - 6 - 13), FOOTER_ROWS);
  let i = 0;
  plan.forEach((count, p) => {
    if (p > 0) {
      page = doc.addPage([W, H]); y = TOP;
      text(seller, 40, 10, b); right(`${inv.invoiceNo} (continued)`, 555, 10, b); y -= 16;
      tableHead();
    }
    for (const l of inv.lines.slice(i, i + count)) {
      const exp = new Date(l.expiry + "T00:00:00Z");
      const vals = [String(i + 1), clean(l.name, "Item").slice(0, 32), l.batchNo, `${exp.getUTCMonth() + 1}/${exp.getUTCFullYear()}`, l.qtyText, rs(l.mrp), rs(l.discount), String(l.gstRate), rs(l.amount - l.discount)];
      cols.forEach(([, x, r], k) => (r ? right(vals[k], x) : text(vals[k], x)));
      y -= ROW; i++;
    }
  });

  y -= 4; rule(330); y -= 14;
  const t = inv.totals;
  for (const [k, v, bold] of [["MRP total", t.mrp], ["Discount", -t.discount], ["Taxable value", t.taxable], ["CGST", t.cgst], ["SGST", t.sgst], ["Round off", t.roundOff], ["Total", t.total, true]] as [string, number, boolean?][]) {
    text(k, 340, bold ? 11 : 9, bold ? b : f); right(rs(v), 555, bold ? 11 : 9, bold ? b : f); y -= bold ? 18 : 13;
  }
  y -= 6; text(`Paid by ${inv.payments.map((p) => p.mode.toUpperCase()).join(" + ")}. Prices are MRP inclusive of GST.`, 40); y -= 12;
  text("Computer-generated invoice from Medoro.", 40, 8, f, rgb(0.45, 0.45, 0.45));

  const pages = doc.getPages();
  if (pages.length > 1) pages.forEach((pg, n) => {
    const s = `Page ${n + 1} of ${pages.length}`;
    pg.drawText(s, { x: 555 - f.widthOfTextAtSize(s, 8), y: 22, size: 8, font: f, color: rgb(0.45, 0.45, 0.45) });
  });
  return doc.save();
}
