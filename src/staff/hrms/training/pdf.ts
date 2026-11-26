import "server-only";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { clean } from "@/domain/sales/pdf";
import { LOGO_ASPECT, LOGO_PNG_BASE64 } from "../logo";
import type { LessonContent, Slide } from "./shared";

// PDFs for the Sales Academy: the certificate (with a QR code to the public verification page) and a lesson's slides and
// notes. Standard PDF fonts only cover Latin text, so text is passed through `clean` (₹ and similar become plain text).

const TEAL = rgb(11 / 255, 94 / 255, 91 / 255), INK = rgb(15 / 255, 23 / 255, 42 / 255), MUTED = rgb(100 / 255, 116 / 255, 139 / 255), GOLD = rgb(217 / 255, 169 / 255, 58 / 255);
const t = (s: string) => clean(String(s ?? "").replace(/₹/g, "Rs. ").replace(/→/g, "->"), "-");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of t(text).split(/\n/)) {
    let line = "";
    for (const w of para.split(" ")) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}
const centre = (p: PDFPage, s: string, y: number, font: PDFFont, size: number, color = INK) => { const x = (p.getWidth() - font.widthOfTextAtSize(t(s), size)) / 2; p.drawText(t(s), { x, y, size, font, color }); };
const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export type CertData = { certNo: string; verifyCode: string; name: string; empNo: string; dept: string; programme: string; completedOn: string; score: number; trainer: string; revoked: boolean; signatory: string };

export async function certificatePdf(c: CertData, verifyUrl: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Medoro Sales Training Certificate ${c.certNo}`); doc.setAuthor("Medoro"); doc.setSubject(c.programme);
  const p = doc.addPage([842, 595]); // A4 landscape
  const [reg, bold, ital] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.HelveticaOblique)]);
  const W = p.getWidth(), H = p.getHeight();
  p.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: TEAL, borderWidth: 3 });
  p.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: GOLD, borderWidth: 1 });
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const lh = 54; p.drawImage(logo, { x: W / 2 - (lh * LOGO_ASPECT) / 2, y: H - 108, width: lh * LOGO_ASPECT, height: lh });
  centre(p, "MEDORO SALES TRAINING CERTIFICATE", H - 140, bold, 22, TEAL);
  centre(p, "This is to certify that", H - 178, ital, 13, MUTED);
  centre(p, c.name, H - 216, bold, 30);
  centre(p, `Employee ID ${c.empNo}  ·  ${c.dept}`.replace("·", "-"), H - 240, reg, 12, MUTED);
  centre(p, "has successfully completed the", H - 272, reg, 13, MUTED);
  centre(p, c.programme, H - 298, bold, 18, TEAL);
  centre(p, `on ${fmtDate(c.completedOn)} with a final score of ${c.score}/100`, H - 324, reg, 13);
  centre(p, "including the official Medoro Pharmacy product tour, sales skills lessons, a mock sales call, a product demonstration and the final assessment.", H - 348, reg, 9.5, MUTED);
  // Signatures
  const sig = (x: number, label: string, name: string) => {
    p.drawLine({ start: { x, y: 128 }, end: { x: x + 200, y: 128 }, thickness: 0.8, color: INK });
    if (name) p.drawText(t(name), { x, y: 134, size: 11, font: bold, color: INK });
    p.drawText(t(label), { x, y: 114, size: 9.5, font: reg, color: MUTED });
  };
  sig(70, "Trainer", c.trainer);
  sig(320, "Authorised signatory", c.signatory);
  // Verification
  const qr = await doc.embedPng(await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: 220, color: { dark: "#0B5E5B", light: "#FFFFFF" } }));
  p.drawImage(qr, { x: W - 175, y: 70, width: 110, height: 110 });
  p.drawText(t(`Certificate ID: ${c.certNo}`), { x: 70, y: 70, size: 10, font: bold, color: INK });
  p.drawText(t(`Verify: ${verifyUrl}`), { x: 70, y: 56, size: 8.5, font: reg, color: MUTED });
  p.drawText("Scan to verify", { x: W - 158, y: 58, size: 8.5, font: reg, color: MUTED });
  if (c.revoked) {
    p.drawText("REVOKED", { x: W / 2 - 150, y: H / 2 - 40, size: 90, font: bold, color: rgb(0.86, 0.15, 0.15), opacity: 0.25, rotate: degrees(20) });
  }
  return doc.save();
}

/** A lesson as a presentation-style PDF: one landscape page per slide with its narration, then the notes. */
export async function notesPdf(l: { title: string; summary: string; slides: Slide[]; content: LessonContent; version: number }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${t(l.title)} - slides and notes`); doc.setAuthor("Medoro Sales Academy");
  const [reg, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const W = 842, H = 595, M = 50;
  const header = (p: PDFPage, k: string) => {
    p.drawImage(logo, { x: M, y: H - 52, width: 22 * LOGO_ASPECT, height: 22 });
    p.drawText(t(`Medoro Sales Academy · ${l.title}`).replace("·", "-"), { x: M + 34, y: H - 44, size: 9, font: reg, color: MUTED });
    p.drawText(k, { x: W - M - reg.widthOfTextAtSize(k, 9), y: H - 44, size: 9, font: reg, color: MUTED });
  };
  // Title page
  let p = doc.addPage([W, H]);
  p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: TEAL });
  p.drawImage(logo, { x: M, y: H - 110, width: 50 * LOGO_ASPECT, height: 50 });
  let y = H - 220;
  for (const line of wrap(l.title, bold, 32, W - 2 * M)) { p.drawText(line, { x: M, y, size: 32, font: bold, color: rgb(1, 1, 1) }); y -= 40; }
  for (const line of wrap(l.summary, reg, 14, W - 2 * M)) { p.drawText(line, { x: M, y: y - 10, size: 14, font: reg, color: rgb(0.85, 0.95, 0.93) }); y -= 20; }
  p.drawText(t(`Version ${l.version} · Hinglish narration included`).replace("·", "-"), { x: M, y: 50, size: 10, font: reg, color: rgb(0.85, 0.95, 0.93) });
  // Slides
  l.slides.forEach((s, i) => {
    p = doc.addPage([W, H]); header(p, `${i + 1} / ${l.slides.length}`);
    let yy = H - 100;
    for (const line of wrap(s.title, bold, 24, W - 2 * M)) { p.drawText(line, { x: M, y: yy, size: 24, font: bold, color: TEAL }); yy -= 30; }
    yy -= 10;
    for (const b of s.bullets.filter(Boolean)) {
      const lines = wrap(b, reg, 14, W - 2 * M - 20);
      p.drawCircle({ x: M + 5, y: yy + 5, size: 3, color: GOLD });
      for (const line of lines) { if (yy < 150) break; p.drawText(line, { x: M + 18, y: yy, size: 14, font: reg, color: INK }); yy -= 19; }
      yy -= 5;
    }
    if (s.narration) {
      p.drawLine({ start: { x: M, y: 140 }, end: { x: W - M, y: 140 }, thickness: 0.5, color: MUTED });
      p.drawText("Narration", { x: M, y: 124, size: 9, font: bold, color: MUTED });
      let ny = 110;
      for (const line of wrap(s.narration, reg, 9.5, W - 2 * M).slice(0, 8)) { p.drawText(line, { x: M, y: ny, size: 9.5, font: reg, color: INK }); ny -= 12.5; }
    }
  });
  // Notes (portrait-free text pages in landscape)
  const sections: [string, string[]][] = [];
  const c = l.content ?? {};
  if (c.objectives?.length) sections.push(["Learning objectives", c.objectives]);
  if (c.keyPoints?.length) sections.push(["Important points", c.keyPoints]);
  if (c.chapter) sections.push(["What the software does", c.chapter.functions], ["How to explain it", [c.chapter.explain]]);
  if (c.scripts?.length) for (const s of c.scripts) sections.push([`Script: ${s.name} (${s.when})`, s.lines]);
  if (c.objections?.length) for (const o of c.objections) sections.push([`Objection: "${o.statement}"`, [`Meaning: ${o.meaning}`, `Avoid: ${o.avoid}`, `Reply: ${o.response}`, `Follow-up: ${o.followUp}`, `Next action: ${o.next}`]]);
  if (c.features?.length) for (const f of c.features) sections.push([f.feature, [`What it does: ${f.does}`, `Problem: ${f.problem}`, `Benefit: ${f.benefit}`, `Say: ${f.pitch}`, `Q: ${f.question}`, `A: ${f.answer}`]]);
  if (c.examples?.length) sections.push(["Examples", c.examples]);
  if (c.qa?.length) sections.push(["Customer questions", c.qa.map((x) => `Q: ${x.q}  A: ${x.a}`)]);
  if (c.takeaways?.length) sections.push(["Key takeaways", c.takeaways]);
  if (sections.length) {
    p = doc.addPage([W, H]); header(p, "Notes"); y = H - 90;
    const need = (n: number) => { if (y - n < 50) { p = doc.addPage([W, H]); header(p, "Notes"); y = H - 90; } };
    for (const [title, lines] of sections) {
      need(40); for (const line of wrap(title, bold, 13, W - 2 * M)) { p.drawText(line, { x: M, y, size: 13, font: bold, color: TEAL }); y -= 17; }
      for (const item of lines) for (const [k, line] of wrap(item, reg, 10.5, W - 2 * M - 14).entries()) { need(14); p.drawText((k ? "  " : "- ") + line, { x: M + 4, y, size: 10.5, font: reg, color: INK }); y -= 14; }
      y -= 8;
    }
  }
  return doc.save();
}
