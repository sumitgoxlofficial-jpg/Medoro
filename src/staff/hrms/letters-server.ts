import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail } from "@/server/mail";
import { lettersMail, offerMail } from "./mails";
import { clean } from "@/domain/sales/pdf";
import { todayISO } from "@/lib/dates";
import { audit, loadSettings, need, notify, type Me } from "./auth";
import { DATED_LETTERS, EXIT_LETTERS, JOINING_LETTERS, PROMOTION_LETTER, LETTER_TYPES, buildCandidateOffer, buildLetter, letterLabel, type Letter, type LetterCompany, type LetterPerson, type LetterType, type OfferTerms } from "./letters";
import { LOGO_ASPECT, LOGO_PNG_BASE64 } from "./logo";
import { scheduleText } from "./constants";
import { promotionTerms } from "./promotions";

const isType = (t: unknown): t is LetterType => LETTER_TYPES.some((l) => l.id === t);
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d + "T00:00:00Z").getTime());

const companyOf = async (): Promise<LetterCompany> => {
  const s = await loadSettings();
  const w = scheduleText(s);
  return { name: s.company.name, address: s.company.address, phone: s.company.phone, email: s.company.email, gstin: s.company.gstin, leave: s.leave, ptax: s.ptax, work: { start: w.start, end: w.end, hours: s.workHours, lunchFrom: w.lunchFrom, lunchTo: w.lunchTo } };
};

async function person(staffId: string): Promise<LetterPerson | null> {
  const u = await db.staffUser.findFirst({ where: { id: staffId, kind: "team", role: { not: "partner" } }, include: { hr: true } });
  if (!u) return null;
  const h = u.hr, mgr = h?.managerId ? await db.staffUser.findUnique({ where: { id: h.managerId }, select: { name: true } }) : null;
  return {
    empNo: u.empNo, name: u.name, email: u.email, phone: u.phone, address: h?.address ?? "", desig: h?.designation ?? "", dept: h?.dept ?? "", empType: h?.empType ?? "Full-time", location: h?.location ?? "", manager: mgr?.name ?? "",
    joinDate: h?.joinDate ? h.joinDate.toISOString().slice(0, 10) : null, ctc: h?.ctc ?? 0, sales: h?.role === "sales" || u.role === "sales", incentivePct: Number(h?.incentivePct ?? 0),
  };
}

/** A letter for one person. Employees open their own joining letters, and any exit letter HR has sent them; HR (Employees module) opens anyone's. */
export async function letterFor(me: Me, staffId: string, type: unknown, lastDay?: unknown): Promise<Letter> {
  if (!isType(type)) throw new UserError("Choose a letter.");
  const day = isDay(lastDay) ? lastDay : "";
  if (EXIT_LETTERS.includes(type) && lastDay !== undefined && lastDay !== "" && !isDay(lastDay)) throw new UserError("Enter the last working day.");
  if (type === PROMOTION_LETTER && !day) throw new UserError("Choose the promotion.");
  const mine = staffId === me.id;
  let sent = null;
  if (mine && DATED_LETTERS.includes(type)) {
    sent = await db.hrLetter.findFirst({ where: { staffId, type, ...(day ? { lastDay: day } : {}) }, orderBy: { sentAt: "desc" } });
    if (!sent) { need(me, "employees"); }
  } else if (!(mine && JOINING_LETTERS.includes(type))) need(me, "employees");
  const p = await person(staffId);
  if (!p) throw new UserError("Employee not found.");
  const promotion = type === PROMOTION_LETTER ? await promotionTerms(staffId, day) : undefined;
  if (promotion === null) throw new UserError("No promotion is recorded with that effective date.");
  const co = await companyOf();
  if (mine) await db.hrLetter.updateMany({ where: { staffId, type, readAt: null, ...(DATED_LETTERS.includes(type) && day ? { lastDay: day } : {}) }, data: { readAt: new Date() } }); // opening a letter HR sent marks it read
  return buildLetter(type, p, co, { lastDay: sent?.lastDay || day || undefined, promotion });
}
/** The offer HR prepared for a candidate. */
export async function candidateLetter(me: Me, id: string): Promise<Letter> {
  need(me, "recruitment");
  const c = await db.hrCandidate.findUnique({ where: { id } });
  if (!c?.offer) throw new UserError("Prepare the offer letter first.");
  return buildCandidateOffer(c.name, c.offer as unknown as OfferTerms, await companyOf());
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}
/**
 * A4 letter on the company letterhead: logo and contact block, reference and date, the body (clauses, tables, signature boxes) and a footer with
 * the registration line and page numbers on every page. Standard PDF fonts can't draw ₹ or Hindi, so those are written in plain letters.
 */
export async function letterPdf(l: Letter): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${l.title} · ${l.to}`); doc.setProducer("Medoro");
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold), it = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const W = 595, H = 842, M = 56, TOP = H - 50, BOTTOM = 70, CW = W - 2 * M;
  const TEAL = rgb(0.043, 0.369, 0.357), GREY = rgb(0.4, 0.45, 0.5), INK = rgb(0.1, 0.12, 0.16), LINE = rgb(0.78, 0.82, 0.86), SOFT = rgb(0.94, 0.98, 0.97);
  let page: PDFPage = doc.addPage([W, H]), y = TOP;
  const letterhead = () => {
    const lh = 34, lw = lh * LOGO_ASPECT;
    page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
    page.drawText(clean(l.company, "Medoro"), { x: M + lw + 10, y: y - 16, size: 20, font: b, color: TEAL });
    page.drawText("Billing, stock and GST software for Indian medical stores", { x: M + lw + 10, y: y - 29, size: 7.5, font: f, color: GREY });
    if (l.address) { const w = wrap(clean(l.address), f, 8, 190); w.slice(0, 3).forEach((t, i) => page.drawText(t, { x: W - M - f.widthOfTextAtSize(t, 8), y: y - 9 - i * 10, size: 8, font: f, color: GREY })); }
    if (l.contact) { const t = clean(l.contact.replace(/\s{2,}/g, "  ")); const w = wrap(t, f, 8, 220); w.slice(0, 2).forEach((x, i) => page.drawText(x, { x: W - M - f.widthOfTextAtSize(x, 8), y: y - 9 - (l.address ? 30 : 0) - i * 10, size: 8, font: f, color: GREY })); }
    y -= lh + 10; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.6, color: TEAL }); y -= 22;
  };
  const newPage = () => {
    page = doc.addPage([W, H]); y = TOP;
    page.drawText(clean(l.company, "Medoro"), { x: M, y: y - 8, size: 11, font: b, color: TEAL });
    const r = clean(`${l.title} · ${l.ref}`); page.drawText(r, { x: W - M - f.widthOfTextAtSize(r, 8), y: y - 8, size: 8, font: f, color: GREY });
    y -= 16; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE }); y -= 22;
  };
  const room = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const para = (t: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number; lead?: number } = {}) => {
    const size = o.size ?? 10, font = o.font ?? f, lead = o.lead ?? size * 1.45, width = o.width ?? CW;
    for (const ln of wrap(clean(t), font, size, width)) { room(lead); page.drawText(ln, { x: o.x ?? M, y: y - size, size, font, color: o.color ?? INK }); y -= lead; }
    y -= o.gap ?? 6;
  };
  letterhead();
  // Reference, date, confidentiality
  page.drawText(clean(`Ref: ${l.ref}`), { x: M, y: y - 9, size: 9, font: f, color: GREY });
  const d = clean(`Date: ${l.date}`); page.drawText(d, { x: W - M - f.widthOfTextAtSize(d, 9), y: y - 9, size: 9, font: f, color: GREY }); y -= 22;
  if (l.confidential) { para("STRICTLY PRIVATE AND CONFIDENTIAL", { size: 8, font: b, color: GREY, gap: 8 }); }
  para(l.to, { font: b, size: 11, gap: 1 });
  if (l.toLine) para(l.toLine, { size: 9.5, color: GREY, gap: 1 });
  if (l.toAddress) para(l.toAddress, { size: 9.5, color: GREY, gap: 1, width: 300 });
  y -= 8;
  // Subject
  room(40); para(`Subject: ${l.subject}`, { font: b, size: 11, gap: 10 });
  for (const blk of l.blocks) {
    if (blk.k === "p") para(blk.t, { font: blk.bold ? b : f, gap: 8 });
    else if (blk.k === "clause") {
      room(40); para(`${blk.n}.  ${blk.title}`, { font: b, size: 10.5, gap: 3, color: TEAL });
      for (const t of blk.t) para(t, { x: M + 16, width: CW - 16, gap: 5 });
      y -= 3;
    } else if (blk.k === "facts") {
      if (blk.title) { room(30); para(blk.title.toUpperCase(), { font: b, size: 8.5, color: GREY, gap: 4 }); }
      const kw = 150;
      for (const [k, v] of blk.rows) {
        const lines = wrap(clean(v), f, 9.5, CW - kw - 16), h = Math.max(1, lines.length) * 13 + 8;
        room(h); page.drawRectangle({ x: M, y: y - h, width: CW, height: h, borderColor: LINE, borderWidth: 0.6 });
        page.drawRectangle({ x: M, y: y - h, width: kw, height: h, color: SOFT, borderColor: LINE, borderWidth: 0.6 });
        page.drawText(clean(k), { x: M + 8, y: y - 14, size: 9, font: b, color: INK });
        lines.forEach((t, i) => page.drawText(t, { x: M + kw + 8, y: y - 14 - i * 13, size: 9.5, font: f, color: INK }));
        y -= h;
      }
      y -= 12;
    } else if (blk.k === "table") {
      room(90); para(blk.title, { font: b, size: 12, color: TEAL, gap: 8 });
      const cw = [CW * 0.5, CW * 0.25, CW * 0.25], row = (cells: string[], bold = false, fill?: ReturnType<typeof rgb>) => {
        room(24); if (fill) page.drawRectangle({ x: M, y: y - 22, width: CW, height: 22, color: fill });
        page.drawRectangle({ x: M, y: y - 22, width: CW, height: 22, borderColor: LINE, borderWidth: 0.6 });
        let x = M; cells.forEach((c, i) => { const t = clean(c), w = bold ? b : f; page.drawText(t, { x: i === 0 ? x + 8 : x + cw[i] - 8 - w.widthOfTextAtSize(t, 10), y: y - 15, size: 10, font: w, color: INK }); x += cw[i]; });
        y -= 22;
      };
      row(blk.head, true, SOFT); blk.rows.forEach((r) => row(r)); if (blk.foot) row(blk.foot, true, SOFT);
      y -= 8; if (blk.note) para(blk.note, { size: 9, color: GREY, font: it, gap: 6 });
    } else if (blk.k === "sign") {
      const n = blk.boxes.length, w = n === 1 ? 240 : (CW - 24) / n, h = 96;
      room(h + 24); y -= 8;
      blk.boxes.forEach((bx, i) => {
        const x = M + i * (w + 24);
        page.drawText(clean(bx.title), { x, y: y - 10, size: 10, font: b, color: TEAL });
        bx.lines.forEach((t, k) => { const yy = y - 38 - k * 17; if (t === "") page.drawLine({ start: { x, y: yy - 4 }, end: { x: x + w - 20, y: yy - 4 }, thickness: 0.7, color: GREY }); else page.drawText(clean(t), { x, y: yy, size: 9.5, font: k === 1 && n === 1 ? b : f, color: INK }); });
      });
      y -= h;
    } else if (blk.k === "break") newPage();
  }
  // Footer with the registration line and page numbers on every page.
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.6, color: LINE });
    pg.drawText(clean(l.registration).slice(0, 120), { x: M, y: 40, size: 7.5, font: f, color: GREY });
    const n = `Page ${i + 1} of ${pages.length}`; pg.drawText(n, { x: W - M - f.widthOfTextAtSize(n, 8), y: 40, size: 8, font: f, color: GREY });
    pg.drawText("This is a system-generated letter from Medoro HRMS.", { x: M, y: 30, size: 7, font: it, color: GREY });
  });
  return doc.save();
}

const sendable = (to: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
/** Emails a letter (as a PDF) to the employee's official and personal addresses. HR only. */
export async function emailLetter(me: Me, staffId: string, type: unknown, lastDay?: unknown) {
  need(me, "employees");
  if (!mailEnabled()) throw new UserError("Email isn’t set up on this server yet. Print or download the letter instead.");
  const letter = await letterFor(me, staffId, type, lastDay);
  const u = await db.staffUser.findUnique({ where: { id: staffId }, include: { hr: { select: { personalEmail: true } } } });
  const to = [...new Set([u?.hr?.personalEmail, u?.email].filter((x): x is string => !!x && sendable(x)))];
  if (!to.length) throw new UserError("This employee has no email address on record.");
  const pdf = Buffer.from(await letterPdf(letter));
  for (const addr of to) await sendMail({ to: addr, ...lettersMail({ name: letter.to, labels: [letterLabel(letter.type).toLowerCase()], org: letter.company }), attachments: [{ filename: `${letter.title.replace(/\W+/g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }] });
  await audit(me, "Letter emailed", `${letter.title} · ${letter.ref}`);
  return { sentTo: to };
}
/** Emails the prepared offer to the candidate and records that it was sent (acceptance pending). */
export async function emailOffer(me: Me, id: string) {
  need(me, "recruitment");
  const c = await db.hrCandidate.findUnique({ where: { id } });
  if (!c?.offer) throw new UserError("Prepare the offer letter first.");
  if (!sendable(c.email)) throw new UserError("Add the candidate’s email address first.");
  if (!mailEnabled()) throw new UserError("Email isn’t set up on this server yet. Print or download the offer instead.");
  const letter = await candidateLetter(me, id);
  await sendMail({ to: c.email, ...offerMail({ name: c.name, org: letter.company, title: letter.title, validDays: 7 }), attachments: [{ filename: "Offer-letter.pdf", content: Buffer.from(await letterPdf(letter)), contentType: "application/pdf" }] });
  await db.hrCandidate.update({ where: { id }, data: { offer: { ...(c.offer as object), sentOn: todayISO() } } });
  await audit(me, "Offer letter emailed", `${c.name}`);
  return { sentTo: c.email };
}

/** Letters HR has sent to this employee (exit and promotion letters show only once sent; joining letters are always there), newest first. */
export async function sentLetters(me: Pick<Me, "id">) {
  const rows = await db.hrLetter.findMany({ where: { staffId: me.id }, orderBy: { sentAt: "desc" }, take: 30 });
  return rows.map((r) => ({ id: r.id, type: r.type, label: letterLabel(r.type), lastDay: r.lastDay, sentAt: r.sentAt.toISOString(), unread: !r.readAt }));
}
export async function unreadLetters(staffId: string) { return db.hrLetter.count({ where: { staffId, readAt: null } }); }

/**
 * HR sends letters to an employee: they appear on the employee's own screen (My documents, with a notification and a "New" tag),
 * and, if asked and email is set up, go out as PDFs by email too. Sending a letter again puts it back as new.
 */
export async function sendLetters(me: Me, staffId: string, types: unknown, lastDay: unknown, email: boolean) {
  need(me, "employees");
  const list = [...new Set(Array.isArray(types) ? types.filter(isType) : [])];
  if (!list.length) throw new UserError("Choose at least one letter to send.");
  const exit = list.filter((t) => EXIT_LETTERS.includes(t));
  if (exit.length && !isDay(lastDay)) throw new UserError("Enter the last working day for the exit letters.");
  if (list.includes(PROMOTION_LETTER)) {
    if (exit.length) throw new UserError("Send the promotion letter on its own.");
    if (!isDay(lastDay) || !(await promotionTerms(staffId, lastDay))) throw new UserError("No promotion is recorded with that effective date.");
  }
  const u = await db.staffUser.findFirst({ where: { id: staffId, kind: "team", role: { not: "partner" } }, select: { id: true, name: true } });
  if (!u) throw new UserError("Employee not found.");
  if (email && !mailEnabled()) throw new UserError("Email isn’t set up on this server yet. Untick “Also email” to send to their screen only.");
  for (const type of list) {
    const day = DATED_LETTERS.includes(type) ? String(lastDay) : "";
    await db.hrLetter.upsert({ where: { staffId_type_lastDay: { staffId, type, lastDay: day } }, update: { sentAt: new Date(), sentById: me.id, readAt: null }, create: { staffId, type, lastDay: day, sentById: me.id } });
  }
  const labels = list.map((t) => letterLabel(t).toLowerCase());
  await notify([staffId], `HR sent you ${labels.length === 1 ? `your ${labels[0]}` : `${labels.length} letters`}: ${labels.join(", ")}. Open My documents.`, "profile");
  let emailed: string[] = [];
  if (email) {
    const atts = [];
    for (const type of list) { const l = await letterFor(me, staffId, type, DATED_LETTERS.includes(type) ? lastDay : undefined); atts.push({ filename: `${l.title.replace(/\W+/g, "-")}.pdf`, content: Buffer.from(await letterPdf(l)), contentType: "application/pdf" }); }
    const row = await db.staffUser.findUnique({ where: { id: staffId }, include: { hr: { select: { personalEmail: true } } } });
    emailed = [...new Set([row?.hr?.personalEmail, row?.email].filter((x): x is string => !!x && sendable(x)))];
    for (const to of emailed) await sendMail({ to, ...lettersMail({ name: u.name, labels, org: (await loadSettings()).company.name || "Medoro" }), attachments: atts });
  }
  await audit(me, "Letters sent", `${u.name} · ${list.join(", ")}${emailed.length ? " · emailed" : ""}`);
  return { sent: list.length, emailed };
}
