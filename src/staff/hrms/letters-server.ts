import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail } from "@/server/mail";
import { lettersMail, offerMail } from "./mails";
import { clean } from "@/domain/sales/pdf";
import { todayISO } from "@/lib/dates";
import { audit, loadSettings, need, notify, type Me } from "./auth";
import { DATED_LETTERS, EXIT_LETTERS, JOINING_LETTERS, PROMOTION_LETTER, LETTER_TYPES, buildCandidateOffer, buildLetter, clauseParas, letterLabel, listLabel, type Letter, type LetterCompany, type LetterPerson, type LetterType, type OfferTerms } from "./letters";
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

/** Words wrapped to a width; `end` marks the last line of each paragraph (never justified). */
function wrap(text: string, font: PDFFont, size: number, width: number): { t: string; end: boolean }[] {
  const out: { t: string; end: boolean }[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push({ t: line, end: false }); line = w; } else line = next;
    }
    out.push({ t: line, end: true });
  }
  return out;
}
/** Shortens a line to fit, with an ellipsis. */
function fit(t: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > width) t = t.slice(0, -1);
  return t.trimEnd() + "...";
}

/**
 * A4 document on the company letterhead. The first page carries the full letterhead (logo, name, office and contact); later pages a running
 * header with the document title and reference. Every page has the company watermark behind the text, and a footer with the registration
 * line, the office address, the page number and, on documents the employee signs, a box for their initials. Body text is justified.
 * Standard PDF fonts can't draw ₹ or Hindi, so those are written in plain letters.
 */
export async function letterPdf(l: Letter): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${l.title} - ${l.to}`); doc.setAuthor(clean(l.company, "Medoro")); doc.setSubject(clean(l.subject)); doc.setProducer(clean(l.company, "Medoro")); doc.setCreator(clean(l.company, "Medoro"));
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold), it = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M, BOTTOM = 88, form = l.form ?? "letter";
  const TEAL = rgb(0.043, 0.369, 0.357), GREY = rgb(0.38, 0.42, 0.47), INK = rgb(0.09, 0.11, 0.14), LINE = rgb(0.8, 0.83, 0.86), SOFT = rgb(0.95, 0.97, 0.97), TINT = rgb(0.91, 0.96, 0.95);
  const company = clean(l.company, "Medoro");
  let page: PDFPage = doc.addPage([W, H]), y = H;
  const right = (t: string, x: number, yy: number, size: number, font: PDFFont, color = GREY) => page.drawText(t, { x: x - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  const center = (t: string, yy: number, size: number, font: PDFFont, color = INK) => page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y: yy, size, font, color });
  const watermark = () => {
    const w = 250, h = w / LOGO_ASPECT;
    page.drawImage(logo, { x: (W - w) / 2, y: H / 2 - h / 2 + 30, width: w, height: h, opacity: 0.04 });
    const name = company.toUpperCase(), size = 44;
    page.drawText(name, { x: (W - b.widthOfTextAtSize(name, size)) / 2, y: H / 2 - h / 2 - 20, size, font: b, color: TEAL, opacity: 0.035 });
  };
  const letterhead = () => {
    watermark();
    page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: TEAL });
    const lh = 42, lw = lh * LOGO_ASPECT, top = H - 30;
    page.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh });
    page.drawText(company, { x: M + lw + 12, y: top - 22, size: 22, font: b, color: TEAL });
    page.drawText("BILLING  |  INVENTORY  |  GST COMPLIANCE", { x: M + lw + 12, y: top - 35, size: 6.8, font: f, color: GREY });
    let ry = top - 7;
    right("REGISTERED OFFICE", W - M, ry, 6.5, b, TEAL); ry -= 10.5;
    if (l.address) for (const x of wrap(clean(l.address), f, 7.8, 200).slice(0, 3)) { right(x.t, W - M, ry, 7.8, f); ry -= 10; }
    if (l.contact) for (const x of wrap(clean(l.contact.replace(/\s{2,}/g, " ")), f, 7.8, 220).slice(0, 2)) { right(x.t, W - M, ry, 7.8, f); ry -= 10; }
    y = Math.min(top - lh - 12, ry - 4);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color: TEAL });
    page.drawLine({ start: { x: M, y: y - 2.2 }, end: { x: W - M, y: y - 2.2 }, thickness: 0.3, color: LINE });
    y -= 26;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    watermark();
    page.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: TEAL });
    const lh = 18, top = H - 26;
    page.drawImage(logo, { x: M, y: top - lh + 3, width: lh * LOGO_ASPECT, height: lh });
    page.drawText(company, { x: M + lh * LOGO_ASPECT + 7, y: top - 10, size: 11.5, font: b, color: TEAL });
    right(clean(l.title), W - M, top - 4, 8, b, INK);
    right(clean(`Ref: ${l.ref}`), W - M, top - 14, 7.5, f);
    y = top - lh - 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    y -= 26;
  };
  const room = (h: number) => { if (y - h < BOTTOM) newPage(); };
  type ParaOpts = { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number; lead?: number; justify?: boolean; label?: string; labelX?: number; labelFont?: PDFFont };
  const para = (t: string, o: ParaOpts = {}) => {
    const size = o.size ?? 9.3, font = o.font ?? f, lead = o.lead ?? size * 1.42, width = o.width ?? CW, x = o.x ?? M, color = o.color ?? INK;
    wrap(clean(t), font, size, width).forEach((ln, i) => {
      room(lead);
      if (i === 0 && o.label) page.drawText(clean(o.label), { x: o.labelX ?? M, y: y - size, size, font: o.labelFont ?? font, color });
      const words = ln.t.split(" ");
      if (o.justify !== false && !ln.end && words.length > 1) {
        const tw = words.reduce((s, w) => s + font.widthOfTextAtSize(w, size), 0), gap = (width - tw) / (words.length - 1);
        if (gap < size * 0.9) { let xx = x; for (const w of words) { page.drawText(w, { x: xx, y: y - size, size, font, color }); xx += font.widthOfTextAtSize(w, size) + gap; } y -= lead; return; }
      }
      page.drawText(ln.t, { x, y: y - size, size, font, color });
      y -= lead;
    });
    y -= o.gap ?? 5;
  };

  letterhead();
  // Reference and date
  page.drawText(clean(`Ref: ${l.ref}`), { x: M, y: y - 9, size: 9, font: f, color: GREY });
  right(clean(`Date: ${l.date}`), W - M, y - 9, 9, f); y -= 26;
  if (form === "letter") {
    if (l.confidential) para("STRICTLY PRIVATE AND CONFIDENTIAL", { size: 7.8, font: b, color: TEAL, gap: 8, justify: false });
    para(l.to, { font: b, size: 10.5, gap: 1, justify: false });
    if (l.toLine) para(l.toLine, { size: 9.3, color: GREY, gap: 1, justify: false });
    if (l.toAddress) para(l.toAddress, { size: 9.3, color: GREY, gap: 1, width: 280, justify: false });
    y -= 10; room(40);
    para(`Subject: ${l.subject}`, { font: b, size: 10.3, gap: 12, justify: false });
  } else {
    if (l.confidential) { center("STRICTLY PRIVATE AND CONFIDENTIAL", y - 8, 7.5, b, TEAL); y -= 22; }
    const t = clean(l.title).toUpperCase(); center(t, y - 15, 15, b, INK); y -= 24;
    page.drawLine({ start: { x: W / 2 - 28, y }, end: { x: W / 2 + 28, y }, thickness: 1.2, color: TEAL }); y -= 24;
    if (form === "certificate") para(l.subject.toUpperCase(), { font: b, size: 10, gap: 14, justify: false });
  }
  const NUM = 30; // hanging indent for clause numbers
  for (const blk of l.blocks) {
    if (blk.k === "p") {
      if (/^Yours (sincerely|faithfully),?$/.test(blk.t)) room(118); // keep the sign-off with the signature
      if (blk.center) { room(16); center(clean(blk.t), y - 10, 10, blk.bold ? b : f); y -= 20; }
      else if (blk.bold && blk.t.length < 60) { room(40); para(blk.t, { font: b, size: 9.8, gap: 5, justify: false }); }
      else para(blk.t, { font: blk.bold ? b : f, gap: 8 });
    } else if (blk.k === "h") {
      room(70);
      para(blk.t.toUpperCase(), { font: b, size: 8, color: TEAL, gap: 1, justify: false });
      if (blk.sub) para(blk.sub, { font: b, size: 14, color: INK, gap: 4, justify: false });
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 16;
    } else if (blk.k === "list") {
      blk.items.forEach((t, i) => para(t, { x: M + NUM, width: CW - NUM, label: listLabel(blk.style, i), labelX: M + 6, gap: 4 }));
      y -= 4;
    } else if (blk.k === "clause") {
      room(52);
      page.drawText(`${blk.n}.`, { x: M, y: y - 9.2, size: 9.2, font: b, color: TEAL });
      para(blk.title.toUpperCase(), { x: M + NUM, font: b, size: 9.2, color: TEAL, gap: 3, justify: false });
      for (const s of clauseParas(blk)) {
        if (s.item) para(s.text, { x: M + NUM + 24, width: CW - NUM - 24, label: s.label, labelX: M + NUM, gap: 2 });
        else para(s.text, { x: M + NUM, width: CW - NUM, label: s.label, labelX: M, labelFont: b, gap: 4 });
      }
      y -= 3;
    } else if (blk.k === "facts") {
      if (blk.title) { room(40); para(blk.title.toUpperCase(), { font: b, size: 8, color: TEAL, gap: 5, justify: false }); }
      const kw = 150;
      room(30); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color: TEAL });
      for (const [k, v] of blk.rows) {
        const lines = wrap(clean(v), f, 9.3, CW - kw - 18), h = Math.max(1, lines.length) * 12 + 7;
        room(h);
        page.drawRectangle({ x: M, y: y - h, width: kw, height: h, color: TINT });
        page.drawLine({ start: { x: M, y: y - h }, end: { x: W - M, y: y - h }, thickness: 0.5, color: LINE });
        page.drawText(clean(k), { x: M + 9, y: y - 13.5, size: 8.8, font: b, color: INK });
        lines.forEach((t, i) => page.drawText(t.t, { x: M + kw + 10, y: y - 13.5 - i * 12, size: 9.3, font: f, color: INK }));
        y -= h;
      }
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color: TEAL });
      y -= 18;
    } else if (blk.k === "table") {
      const n = blk.head.length, ws = (blk.widths ?? (n === 3 ? [0.5, 0.25, 0.25] : Array(n).fill(1 / n))).map((x) => x * CW);
      const al = blk.align ?? blk.head.map((_, i) => (i ? "r" : "l"));
      const row = (cells: string[], bold = false, fill?: ReturnType<typeof rgb>, color = INK) => {
        const font = bold ? b : f, size = 9.2;
        const wrapped = cells.map((c, i) => wrap(clean(c), font, size, ws[i] - 16));
        const h = Math.max(...wrapped.map((w) => w.length)) * 11.5 + 8.5;
        room(h);
        if (fill) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: fill });
        page.drawLine({ start: { x: M, y: y - h }, end: { x: W - M, y: y - h }, thickness: 0.5, color: LINE });
        let x = M;
        wrapped.forEach((ls, i) => {
          ls.forEach((ln, k) => {
            const tw = font.widthOfTextAtSize(ln.t, size), tx = al[i] === "r" ? x + ws[i] - 8 - tw : al[i] === "c" ? x + (ws[i] - tw) / 2 : x + 8;
            page.drawText(ln.t, { x: tx, y: y - 13.5 - k * 11.5, size, font, color });
          });
          x += ws[i];
        });
        y -= h;
      };
      room(60);
      row(blk.head, true, TEAL, rgb(1, 1, 1));
      blk.rows.forEach((r, i) => row(r, false, i % 2 ? SOFT : undefined));
      if (blk.foot) { row(blk.foot, true, TINT); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color: TEAL }); }
      y -= 10; if (blk.note) para(blk.note, { size: 8.6, color: GREY, font: it, gap: 10 });
    } else if (blk.k === "sign") {
      const per = Math.min(2, blk.boxes.length), w = per === 1 ? 240 : (CW - 40) / 2;
      for (let r = 0; r < blk.boxes.length; r += per) {
        const boxes = blk.boxes.slice(r, r + per), hOf = (ls: string[]) => 18 + ls.reduce((s, t) => s + (t === "" ? 40 : 15), 0), h = Math.max(...boxes.map((x) => hOf(x.lines)));
        room(h + 14); y -= 14;
        boxes.forEach((bx, i) => {
          const x = M + i * (w + 40);
          let yy = y - 10;
          page.drawText(clean(bx.title), { x, y: yy, size: 9.5, font: b, color: TEAL }); yy -= 8;
          bx.lines.forEach((t, k) => {
            if (t === "") { yy -= 32; page.drawLine({ start: { x, y: yy }, end: { x: x + w - 10, y: yy }, thickness: 0.6, color: GREY }); yy -= 8; }
            else { yy -= 13; page.drawText(clean(t), { x, y: yy, size: 9, font: k === 1 && /^[A-Z]/.test(t) && !t.includes(":") ? b : f, color: INK }); }
          });
        });
        y -= h;
      }
      y -= 6;
    } else if (blk.k === "break") { if (!blk.unless || y - blk.unless < BOTTOM) newPage(); else y -= 18; }
  }
  // Footer on every page: registration and office, page number, the employee's initials on documents they sign.
  const pages = doc.getPages(), office = clean([l.address, "medoro.in"].filter(Boolean).join("  |  "));
  pages.forEach((pg, i) => {
    page = pg;
    if (l.initials) {
      const t = "Initials", bw = 54;
      pg.drawRectangle({ x: W - M - bw, y: 66, width: bw, height: 16, borderColor: LINE, borderWidth: 0.6 });
      right(t, W - M - bw - 6, 71, 7, f);
      if (l.confidential) pg.drawText("PRIVATE AND CONFIDENTIAL", { x: M, y: 71, size: 6.5, font: b, color: GREY });
    }
    pg.drawLine({ start: { x: M, y: 58 }, end: { x: W - M, y: 58 }, thickness: 0.6, color: TEAL });
    pg.drawText(fit(clean(l.registration), f, 7, CW - 80), { x: M, y: 46, size: 7, font: f, color: GREY });
    pg.drawText(fit(office, f, 7, CW - 80), { x: M, y: 36, size: 7, font: f, color: GREY });
    right(`Page ${i + 1} of ${pages.length}`, W - M, 46, 7.5, b, INK);
    right(clean(l.ref), W - M, 36, 6.8, f);
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
