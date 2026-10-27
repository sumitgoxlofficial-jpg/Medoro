import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Invoice } from "./service";

// Standard PDF fonts can't draw the rupee sign, so amounts use "Rs.".
const rs = (p: number) => (p < 0 ? "-" : "") + "Rs. " + (Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "");

/** A4 GST tax invoice PDF built from the committed sale. Prescriber details are left out for sharing. */
export async function invoicePdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.invoiceNo}`); doc.setProducer("Medoro");
  const page = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const text = (s: string, x: number, size = 9, font = f, color = rgb(0.1, 0.1, 0.1)) => page.drawText(clean(s), { x, y, size, font, color });
  const right = (s: string, x: number, size = 9, font = f) => page.drawText(clean(s), { x: x - font.widthOfTextAtSize(clean(s), size), y, size, font });
  text(inv.pharmacy.legalName ?? inv.pharmacy.name, 40, 15, b); right("TAX INVOICE", 555, 13, b); y -= 16;
  if (inv.pharmacy.address) text(inv.pharmacy.address, 40); right(inv.invoiceNo, 555, 10, b); y -= 12;
  text(`${inv.pharmacy.gstin ? "GSTIN " + inv.pharmacy.gstin : ""}${inv.pharmacy.dl ? "   DL " + inv.pharmacy.dl : ""}`, 40);
  right(new Date(inv.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), 555); y -= 10;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1.2, color: rgb(0.04, 0.37, 0.36) }); y -= 18;
  text(`Bill to: ${inv.customer?.name ?? "Walk-in customer"}`, 40, 10); y -= 22;
  const cols: [string, number, boolean][] = [["#", 40, false], ["Item", 56, false], ["Batch", 230, false], ["Exp", 292, false], ["Qty", 345, true], ["MRP", 395, true], ["Disc", 440, true], ["GST%", 475, true], ["Amount", 555, true]];
  for (const [h, x, r] of cols) r ? right(h, x, 8.5, b) : text(h, x, 8.5, b);
  y -= 6; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); y -= 13;
  inv.lines.forEach((l, i) => {
    const exp = new Date(l.expiry + "T00:00:00Z");
    const vals = [String(i + 1), l.name.slice(0, 32), l.batchNo, `${exp.getUTCMonth() + 1}/${exp.getUTCFullYear()}`, String(l.qty), rs(l.mrp), rs(l.discount), String(l.gstRate), rs(l.amount - l.discount)];
    cols.forEach(([, x, r], k) => (r ? right(vals[k], x) : text(vals[k], x)));
    y -= 14;
  });
  y -= 4; page.drawLine({ start: { x: 330, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); y -= 14;
  const t = inv.totals;
  for (const [k, v, bold] of [["MRP total", t.mrp], ["Discount", -t.discount], ["Taxable value", t.taxable], ["CGST", t.cgst], ["SGST", t.sgst], ["Round off", t.roundOff], ["Total", t.total, true]] as [string, number, boolean?][]) {
    text(k, 340, bold ? 11 : 9, bold ? b : f); right(rs(v), 555, bold ? 11 : 9, bold ? b : f); y -= bold ? 18 : 13;
  }
  y -= 6; text(`Paid by ${inv.payments.map((p) => p.mode.toUpperCase()).join(" + ")}. Prices are MRP inclusive of GST.`, 40); y -= 12;
  text("Computer-generated invoice from Medoro.", 40, 8, f, rgb(0.45, 0.45, 0.45));
  return doc.save();
}
