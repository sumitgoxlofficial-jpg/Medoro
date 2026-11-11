import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail } from "@/server/mail";
import { clean } from "@/domain/sales/pdf";
import { todayISO } from "@/lib/dates";
import { audit, loadSettings, need, type Me } from "./auth";
import { EXIT_LETTERS, JOINING_LETTERS, LETTER_TYPES, buildCandidateOffer, buildLetter, letterLabel, type Letter, type LetterPerson, type LetterType, type OfferTerms } from "./letters";

const isType = (t: unknown): t is LetterType => LETTER_TYPES.some((l) => l.id === t);
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d + "T00:00:00Z").getTime());

async function person(staffId: string): Promise<LetterPerson | null> {
  const u = await db.staffUser.findFirst({ where: { id: staffId, kind: "team", role: { not: "partner" } }, include: { hr: true } });
  if (!u) return null;
  const h = u.hr, mgr = h?.managerId ? await db.staffUser.findUnique({ where: { id: h.managerId }, select: { name: true } }) : null;
  return {
    empNo: u.empNo, name: u.name, email: u.email, desig: h?.designation ?? "", dept: h?.dept ?? "", empType: h?.empType ?? "Full-time", location: h?.location ?? "", manager: mgr?.name ?? "",
    joinDate: h?.joinDate ? h.joinDate.toISOString().slice(0, 10) : null, ctc: h?.ctc ?? 0, sales: h?.role === "sales" || u.role === "sales", incentivePct: Number(h?.incentivePct ?? 0),
  };
}

/** A letter for one person. Employees open their own joining letters; HR (Employees module) opens anyone's, and writes exit letters. */
export async function letterFor(me: Me, staffId: string, type: unknown, lastDay?: unknown): Promise<Letter> {
  if (!isType(type)) throw new UserError("Choose a letter.");
  const own = staffId === me.id && JOINING_LETTERS.includes(type);
  if (!own) need(me, "employees");
  if (EXIT_LETTERS.includes(type) && !isDay(lastDay) && lastDay !== undefined && lastDay !== "") throw new UserError("Enter the last working day.");
  const p = await person(staffId);
  if (!p) throw new UserError("Employee not found.");
  const s = await loadSettings();
  return buildLetter(type, p, { name: s.company.name, address: s.company.address }, { lastDay: isDay(lastDay) ? lastDay : undefined });
}
/** The offer HR prepared for a candidate. */
export async function candidateLetter(me: Me, id: string): Promise<Letter> {
  need(me, "recruitment");
  const c = await db.hrCandidate.findUnique({ where: { id } });
  if (!c?.offer) throw new UserError("Prepare the offer letter first.");
  const s = await loadSettings();
  return buildCandidateOffer(c.name, c.offer as unknown as OfferTerms, { name: s.company.name, address: s.company.address });
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
/** A4 letter on the company letterhead. Standard PDF fonts can't draw ₹ or Hindi, so those are written in plain letters. */
export async function letterPdf(l: Letter): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${l.title} · ${l.to}`); doc.setProducer("Medoro");
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 64, TEAL = rgb(0.043, 0.369, 0.357), GREY = rgb(0.4, 0.45, 0.5), INK = rgb(0.1, 0.12, 0.16);
  let page = doc.addPage([W, H]), y = H - 64;
  const head = () => {
    page.drawText(clean(l.company, "Medoro"), { x: M, y, size: 20, font: b, color: TEAL }); y -= 14;
    if (l.address) { page.drawText(clean(l.address).slice(0, 110), { x: M, y, size: 8.5, font: f, color: GREY }); y -= 10; }
    y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: TEAL }); y -= 26;
  };
  head();
  const line = (s: string, size = 11, font = f, color = INK, gap = 16) => {
    if (y < 90) { page = doc.addPage([W, H]); y = H - 64; }
    page.drawText(clean(s), { x: M, y, size, font, color }); y -= gap;
  };
  page.drawText(clean(`Ref: ${l.ref}`), { x: M, y, size: 9.5, font: f, color: GREY });
  const d = clean(`Date: ${l.date}`); page.drawText(d, { x: W - M - f.widthOfTextAtSize(d, 9.5), y, size: 9.5, font: f, color: GREY }); y -= 26;
  line(l.to, 11, b); if (l.toLine) line(l.toLine, 10, f, GREY, 24); else y -= 8;
  const t = clean(l.title.toUpperCase()); page.drawText(t, { x: (W - b.widthOfTextAtSize(t, 13)) / 2, y, size: 13, font: b, color: INK }); y -= 30;
  for (const p of l.paras) { for (const ln of wrap(clean(p), f, 11, W - 2 * M)) line(ln, 11, f, INK, 16); y -= 8; }
  y -= 18; line("Yours sincerely,", 11); y -= 18;
  for (const [i, s] of l.signoff.entries()) line(s, 11, i === 0 ? b : f);
  page.drawText(clean(`${l.ref} · generated by Medoro HRMS, valid without signature`), { x: M, y: 40, size: 8, font: f, color: GREY });
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
  for (const addr of to) await sendMail({ to: addr, subject: `${letter.title} · ${letter.company}`, text: `Dear ${letter.to.split(" ")[0]},\n\nPlease find your ${letterLabel(letter.type).toLowerCase()} attached.\n\nHuman Resources, ${letter.company}`, attachments: [{ filename: `${letter.title.replace(/\W+/g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }] });
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
  await sendMail({ to: c.email, subject: `${letter.title} · ${letter.company}`, text: `Dear ${c.name.split(" ")[0]},\n\nPlease find your offer letter attached. Reply to this email to accept within 7 days.\n\n${letter.signoff.join(", ")}`, attachments: [{ filename: "Offer-letter.pdf", content: Buffer.from(await letterPdf(letter)), contentType: "application/pdf" }] });
  await db.hrCandidate.update({ where: { id }, data: { offer: { ...(c.offer as object), sentOn: todayISO() } } });
  await audit(me, "Offer letter emailed", `${c.name}`);
  return { sentTo: c.email };
}
