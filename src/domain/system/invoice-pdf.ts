import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Biller } from "@/lib/biller";
import { LOGO_H, LOGO_PNG_BASE64, LOGO_W } from "./invoice-logo";

/** Everything the PDF shows. No GST is charged, so there is no tax line: the total is what was paid. */
export type SubscriptionInvoice = {
  invoiceNo: string;
  /** ISO date-time the payment was made. */
  paidAt: string;
  status: "paid" | "refunded";
  refundedAt: string | null;
  buyer: { pharmacy: string; legalName: string | null; address: string | null; gstin: string | null; phone: string | null; name: string; email: string | null };
  /** "Medoro Multi-branch plan · 1 year" */
  item: string;
  periodFrom: string | null;
  periodTo: string | null;
  listPaise: number;
  discountPaise: number;
  couponCode: string | null;
  totalPaise: number;
  paymentId: string | null;
  orderId: string;
  method: string;
};

// Standard PDF fonts can't draw the rupee sign, so amounts use "Rs." like Medoro's other PDFs.
export const rs = (p: number) => (p < 0 ? "-" : "") + "Rs. " + (Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PUNCT: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "•": "*", "…": "...", "₹": "Rs.", " ": " ", "·": "-" };
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, (c) => PUNCT[c] ?? " ").replace(/\s+/g, " ").trim();
const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const W = 595, H = 842, M = 48;
// The palette is the logo's: its blue and its green, with the deep blue of its shadow.
const BLUE = rgb(0, 0.47, 0.85), NAVY = rgb(0, 0.28, 0.61), SEA = rgb(0, 0.66, 0.56), TEAL = BLUE, INK = rgb(0.09, 0.11, 0.15), MUTED = rgb(0.4, 0.44, 0.5), LINE = rgb(0.87, 0.9, 0.93), TINT = rgb(0.93, 0.96, 0.99), GREEN = rgb(0, 0.52, 0.44), RED = rgb(0.69, 0.2, 0.16);
/** A horizontal blue-to-green band (the logo's gradient), drawn as thin slices. */
function band(page: PDFPage, x: number, y: number, w: number, h: number) {
  const n = 48;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    page.drawRectangle({ x: x + (w * i) / n, y, width: w / n + 0.6, height: h, color: rgb(BLUE.red + (SEA.red - BLUE.red) * t, BLUE.green + (SEA.green - BLUE.green) * t, BLUE.blue + (SEA.blue - BLUE.blue) * t) });
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of clean(text).split(" ")) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else { if (line) out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** A professional one-page invoice for a subscription payment, in A4. */
export async function subscriptionInvoicePdf(inv: SubscriptionInvoice, from: Biller): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.invoiceNo}`); doc.setAuthor(from.legalName); doc.setCreator("Medoro"); doc.setSubject("Medoro subscription invoice");
  const page = doc.addPage([W, H]);
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);

  const text = (p: PDFPage, s: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const font = o.font ?? f, size = o.size ?? 10, t = clean(s);
    p.drawText(t, { x: o.right ? x - font.widthOfTextAtSize(t, size) : x, y, size, font, color: o.color ?? INK });
  };

  // Header: the Medoro mark and name on the left, the document title and number on the right.
  band(page, 0, H - 8, W, 8);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const lh = 46, lw = (lh * LOGO_W) / LOGO_H;
  page.drawImage(logo, { x: M, y: H - 38 - lh - 6, width: lw, height: lh });
  text(page, from.name, M + lw + 12, H - 66, { size: 22, font: b, color: NAVY });
  text(page, "Pharmacy software for Indian medical stores", M + lw + 12, H - 80, { size: 8.5, color: MUTED });
  text(page, "INVOICE", W - M, H - 66, { size: 24, font: b, right: true });
  text(page, inv.invoiceNo, W - M, H - 82, { size: 11, font: b, color: TEAL, right: true });

  // Status stamp.
  const refunded = inv.status === "refunded";
  const stamp = refunded ? "REFUNDED" : "PAID", stampColor = refunded ? RED : GREEN;
  const sw = b.widthOfTextAtSize(stamp, 10) + 20;
  page.drawRectangle({ x: W - M - sw, y: H - 118, width: sw, height: 22, borderColor: stampColor, borderWidth: 1.2, color: rgb(1, 1, 1) });
  text(page, stamp, W - M - sw / 2 - b.widthOfTextAtSize(stamp, 10) / 2, H - 111, { size: 10, font: b, color: stampColor });

  // From / Billed to.
  const top = H - 150;
  text(page, "FROM", M, top, { size: 8, font: b, color: MUTED });
  let y = top - 15;
  text(page, from.legalName, M, y, { size: 11, font: b }); y -= 14;
  for (const l of from.address) { text(page, l, M, y, { size: 9.5, color: MUTED }); y -= 12.5; }
  text(page, from.email, M, y, { size: 9.5, color: MUTED }); y -= 12.5;
  text(page, from.phone, M, y, { size: 9.5, color: MUTED }); y -= 12.5;
  text(page, from.website, M, y, { size: 9.5, color: MUTED });
  const leftEnd = y;

  const bx = W / 2 + 20, bw = W - M - bx;
  text(page, "BILLED TO", bx, top, { size: 8, font: b, color: MUTED });
  let by = top - 15;
  for (const l of wrap(inv.buyer.legalName || inv.buyer.pharmacy, b, 11, bw)) { text(page, l, bx, by, { size: 11, font: b }); by -= 14; }
  if (inv.buyer.legalName && inv.buyer.legalName !== inv.buyer.pharmacy) { text(page, `(${inv.buyer.pharmacy})`, bx, by, { size: 9.5, color: MUTED }); by -= 12.5; }
  if (inv.buyer.address) for (const l of wrap(inv.buyer.address, f, 9.5, bw)) { text(page, l, bx, by, { size: 9.5, color: MUTED }); by -= 12.5; }
  if (inv.buyer.gstin) { text(page, `GSTIN ${inv.buyer.gstin}`, bx, by, { size: 9.5, color: MUTED }); by -= 12.5; }
  text(page, inv.buyer.name, bx, by, { size: 9.5, color: MUTED }); by -= 12.5;
  if (inv.buyer.email) { text(page, inv.buyer.email, bx, by, { size: 9.5, color: MUTED }); by -= 12.5; }
  if (inv.buyer.phone) { text(page, inv.buyer.phone, bx, by, { size: 9.5, color: MUTED }); by -= 12.5; }

  // Summary strip.
  const sy = Math.min(leftEnd, by) - 24;
  page.drawRectangle({ x: M, y: sy - 38, width: W - 2 * M, height: 44, color: TINT });
  const cols: [string, string][] = [["Invoice date", dateText(inv.paidAt)], ["Payment method", inv.method], ["Payment ID", inv.paymentId ?? "-"], ["Order ID", inv.orderId]];
  const weights = [0.8, 1.05, 1.35, 1.5], total = weights.reduce((x, y) => x + y, 0), inner = W - 2 * M - 24;
  let colX = M + 12;
  cols.forEach(([k, v], i) => {
    const x = colX, cw = (inner * weights[i]) / total;
    colX += cw;
    text(page, k.toUpperCase(), x, sy - 8, { size: 7.5, font: b, color: MUTED });
    const s = clean(v); let size = 9.5;
    while (size > 6.5 && f.widthOfTextAtSize(s, size) > cw - 8) size -= 0.5;
    text(page, s, x, sy - 24, { size, font: b });
  });

  // Line items.
  let ty = sy - 74;
  page.drawLine({ start: { x: M, y: ty + 18 }, end: { x: W - M, y: ty + 18 }, thickness: 1.2, color: TEAL });
  text(page, "DESCRIPTION", M, ty + 4, { size: 8, font: b, color: MUTED });
  text(page, "AMOUNT", W - M, ty + 4, { size: 8, font: b, color: MUTED, right: true });
  page.drawLine({ start: { x: M, y: ty - 6 }, end: { x: W - M, y: ty - 6 }, thickness: 0.6, color: LINE });
  ty -= 24;
  const itemY = ty;
  for (const l of wrap(inv.item, b, 11, W - 2 * M - 120)) { text(page, l, M, ty, { size: 11, font: b }); ty -= 14; }
  if (inv.periodFrom && inv.periodTo) { text(page, `Subscription period: ${dateText(inv.periodFrom)} to ${dateText(inv.periodTo)}`, M, ty, { size: 9.5, color: MUTED }); ty -= 12.5; }
  text(page, rs(inv.listPaise), W - M, itemY, { size: 11, right: true });
  ty -= 8;
  page.drawLine({ start: { x: M, y: ty }, end: { x: W - M, y: ty }, thickness: 0.6, color: LINE });

  // Totals.
  const tx = W - M - 230;
  ty -= 22;
  const row = (k: string, v: string, o: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    text(page, k, tx, ty, { size: 10, font: o.bold ? b : f, color: o.color ?? MUTED });
    text(page, v, W - M, ty, { size: 10, font: o.bold ? b : f, color: o.color ?? INK, right: true });
    ty -= 18;
  };
  row("Subtotal", rs(inv.listPaise));
  if (inv.discountPaise > 0) row(inv.couponCode ? `Discount (coupon ${inv.couponCode})` : "Discount", rs(-inv.discountPaise), { color: GREEN });
  row("GST", "Not charged");
  ty -= 6;
  band(page, tx - 10, ty - 8, W - M - tx + 10, 30);
  text(page, refunded ? "Total (refunded)" : "Total paid", tx, ty + 2, { size: 11.5, font: b, color: rgb(1, 1, 1) });
  text(page, rs(inv.totalPaise), W - M - 10, ty + 2, { size: 13, font: b, color: rgb(1, 1, 1), right: true });
  ty -= 38;
  if (refunded && inv.refundedAt) { text(page, `Refunded on ${dateText(inv.refundedAt)}`, W - M, ty + 8, { size: 9.5, color: RED, right: true }); ty -= 14; }

  // Notes.
  let ny = Math.min(ty, 300) - 6;
  text(page, "NOTES", M, ny, { size: 8, font: b, color: MUTED }); ny -= 15;
  for (const l of [
    "No GST has been charged on this invoice. The total above is the amount paid.",
    ...(refunded ? [] : ["Your subscription is active for the period shown. Your records, exports and backups always stay available."]),
    `Questions about this invoice? Write to ${from.email} or WhatsApp ${from.phone}.`,
  ]) for (const w of wrap(l, f, 9.5, W - 2 * M)) { text(page, w, M, ny, { size: 9.5, color: INK }); ny -= 13; }

  // Footer.
  page.drawLine({ start: { x: M, y: 64 }, end: { x: W - M, y: 64 }, thickness: 0.6, color: LINE });
  text(page, "Thank you for choosing Medoro.", M, 48, { size: 10, font: b, color: TEAL });
  text(page, "This is a computer-generated invoice and does not need a signature.", M, 34, { size: 8.5, color: MUTED });
  text(page, from.website, W - M, 48, { size: 9, font: b, color: TEAL, right: true });
  text(page, `${from.email}  |  ${from.phone}`, W - M, 34, { size: 8.5, color: MUTED, right: true });

  return doc.save();
}
