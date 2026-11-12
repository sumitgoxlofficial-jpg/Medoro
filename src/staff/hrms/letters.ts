// Employment letters, written from an employee's HR record as proper corporate documents: letterhead, reference, a summary of the
// terms, numbered clauses, a salary annexure and signature blocks. Pure functions shared by the server (PDF, email) and the screens
// (preview, print). Nothing here talks to the database.
import { UDYAM } from "@/lib/udyam";

export const LETTER_TYPES = [
  { id: "offer", label: "Offer letter" }, { id: "appointment", label: "Appointment letter" }, { id: "nda", label: "Non-disclosure agreement" },
  { id: "experience", label: "Experience letter" }, { id: "relieving", label: "Relieving letter" },
] as const;
export type LetterType = (typeof LETTER_TYPES)[number]["id"];
export const JOINING_LETTERS: LetterType[] = ["offer", "appointment", "nda"]; // what a new joiner reads and accepts
export const EXIT_LETTERS: LetterType[] = ["experience", "relieving"]; // HR only, with a last working day
export const letterLabel = (t: string) => LETTER_TYPES.find((l) => l.id === t)?.label ?? t;

export const NOTICE_DAYS = 30; // one month, either side
export const PROBATION_MONTHS = 6;
export const OFFER_VALID_DAYS = 7;
export const JURISDICTION = "Bokaro Steel City, Jharkhand";

export type LetterPerson = {
  empNo: string; name: string; email: string; phone: string; address: string; desig: string; dept: string; empType: string; location: string; manager: string;
  joinDate: string | null; ctc: number; sales: boolean; incentivePct: number;
};
export type LetterCompany = {
  name: string; address: string; phone?: string; email?: string; gstin?: string;
  leave?: { casual: number; sick: number; privilege: number; comp: number }; ptax?: number;
};

export type Block =
  | { k: "p"; t: string; bold?: boolean }
  | { k: "clause"; n: number; title: string; t: string[] }
  | { k: "facts"; title?: string; rows: [string, string][] }
  | { k: "table"; title: string; head: string[]; rows: string[][]; foot?: string[]; note?: string }
  | { k: "sign"; boxes: { title: string; lines: string[] }[] }
  | { k: "break" };
export type Letter = {
  type: string; title: string; subject: string; ref: string; date: string; confidential: boolean;
  to: string; toLine: string; toAddress: string; company: string; address: string; contact: string; registration: string; blocks: Block[];
};
/** All the words of a letter in order (for search, tests and plain-text uses). */
export const letterText = (l: Letter) => l.blocks.flatMap((b) => (b.k === "p" ? [b.t] : b.k === "clause" ? [b.title, ...b.t] : b.k === "facts" ? b.rows.map((r) => r.join(": ")) : b.k === "table" ? [b.title, ...b.rows.map((r) => r.join(" ")), ...(b.foot ?? []), b.note ?? ""] : b.k === "sign" ? b.boxes.flatMap((x) => [x.title, ...x.lines]) : [])).join("\n");

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
/** "2026-11-11" or a date → "11 November 2026" (India). */
export const longDate = (d: string | Date) => (typeof d === "string" ? new Date(d.slice(0, 10) + "T00:00:00Z") : d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: typeof d === "string" ? "UTC" : "Asia/Kolkata" });
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
const refOf = (kind: string, empNo: string, d: Date) => `MDR/HR/${kind}/${d.getUTCFullYear()}/${empNo.replace(/\D/g, "") || empNo}`;
const REGISTRATION = `${UDYAM.enterprise} · Udyam Registration No. ${UDYAM.number} (${UDYAM.type})`;

/** Monthly salary split used by payroll: basic is half, HRA 40% of basic, the rest special allowance. Keep in step with computeSlip (pay.ts). */
export function salarySplit(ctc: number) {
  const monthly = Math.round(ctc / 12), basic = Math.round(monthly * 0.5), hra = Math.round(basic * 0.4);
  return { monthly, basic, hra, special: monthly - basic - hra };
}
const head = (co: LetterCompany) => ({ company: co.name || "Medoro", address: co.address, contact: [co.phone, co.email, "medoro.in"].filter(Boolean).join("  ·  "), registration: REGISTRATION + (co.gstin ? ` · GSTIN ${co.gstin}` : "") });
const addressee = (p: LetterPerson) => ({ to: p.name, toLine: [p.desig, p.dept].filter(Boolean).join(", "), toAddress: p.address });

type Ctx = { p: LetterPerson; co: LetterCompany; company: string; first: string; join: string; incentive: boolean };
const ctxOf = (p: LetterPerson, co: LetterCompany): Ctx => ({ p, co, company: co.name || "Medoro", first: p.name.trim().split(/\s+/)[0], join: p.joinDate ? longDate(p.joinDate) : "the date agreed with HR", incentive: p.sales && p.incentivePct > 0 });

/** The terms of employment, as numbered clauses: shared by the offer and the appointment letter. */
function terms(c: Ctx, from: number): Block[] {
  const { p, co, company } = c, lv = co.leave ?? { casual: 12, sick: 12, privilege: 15, comp: 0 }, s = salarySplit(p.ctc);
  const list: [string, string[]][] = [
    ["Position and duties", [`You will work as ${p.desig || "a team member"}${p.dept ? ` in the ${p.dept} team` : ""}${p.manager ? `, reporting to ${p.manager}` : ""}. You will carry out the duties of the role and any other work reasonably assigned to you, and devote your full working time to ${company}.`]],
    ["Commencement and place of work", [`Your employment begins on ${c.join}. You will be based at ${p.location || "the company’s office"}, and may be asked to work from, or travel to, other locations as the business requires.`]],
    ["Compensation", [
      p.ctc > 0 ? `Your annual cost to company (CTC) is ${inr(p.ctc)}, which is about ${inr(s.monthly)} a month before statutory deductions. The break-up is given in Annexure A. Salary is paid monthly by bank transfer after deductions required by law (provident fund, ESI where applicable, professional tax and income-tax at source).` : "Your compensation will be confirmed to you in writing by HR and will be paid monthly by bank transfer after deductions required by law.",
      ...(c.incentive ? [`In addition, you will earn a sales incentive of ${p.incentivePct}% of the annual subscription value of each pharmacy you win and activate in a month, paid with the following month’s salary. Leads reversed within 30 days are adjusted against it. The incentive is a variable pay and is not part of your fixed CTC.`] : []),
    ]],
    ["Probation", [`You will be on probation for ${PROBATION_MONTHS} months from your date of joining, which may be extended by up to three months. Your confirmation will be communicated in writing. Until confirmed, you remain on probation even if no letter has been issued.`]],
    ["Working hours, attendance and leave", [`Working hours, attendance and holidays follow the company policy published on the HRMS. You are entitled to ${lv.casual} days of casual leave, ${lv.sick} days of sick leave and ${lv.privilege} days of privilege leave in a year${lv.comp ? ` and ${lv.comp} comp off` : ""}, as per the leave policy.`]],
    ["Notice period and termination", [
      `Either party may end this employment by giving ${NOTICE_DAYS / 30} (one) month’s written notice (${NOTICE_DAYS} days), or by paying salary in lieu of the unserved notice period. The company may end your employment without notice or pay in lieu in case of misconduct, breach of confidentiality, fraud, or a serious breach of company policy.`,
      "On leaving, you will hand over your work, return all company property, documents and access, and complete the exit formalities. Your full and final settlement is processed after clearance, with the next payroll cycle.",
    ]],
    ["Confidentiality and data protection", [`You will keep confidential all non-public information of ${company} and of its customers, including pharmacy customer records, invoices, stock and batch data, prescriber details, pricing, source code and product plans, and handle personal data in line with the Digital Personal Data Protection Act, 2023. You will sign the Non-Disclosure Agreement that accompanies this letter. These obligations continue after your employment ends.`]],
    ["Intellectual property", [`All work you create in the course of your employment, including software, designs, documents and data, belongs to ${company}. You will do whatever is reasonably needed to record that ownership.`]],
    ["Non-solicitation and outside work", [`For 12 months after your employment ends you will not solicit the company’s customers, partner pharmacies or employees for a competing business. During employment you will not take up other paid work or a conflicting interest without written permission.`]],
    ["Code of conduct and company property", [`You will follow the company’s code of conduct and its policies on information security, harassment and ethics. Laptops, phones, access cards and accounts issued to you remain the company’s property and are to be used only for company work.`]],
    ["Documents and background verification", [`This offer depends on satisfactory verification of your identity, address, education and previous employment. Please bring photo ID, address proof, PAN, bank details, your educational certificates and your relieving letter from your last employer. Wrong or misleading information may lead to withdrawal of this offer or termination of employment.`]],
    ["Governing law", [`This letter is governed by the laws of India, and the courts at ${JURISDICTION} have jurisdiction over any dispute.`]],
  ];
  return list.map(([title, t], i) => ({ k: "clause" as const, n: from + i, title, t }));
}
const signOff = (c: Ctx, accept: string): Block => ({
  k: "sign",
  boxes: [
    { title: `For ${c.company}`, lines: ["", "Authorised Signatory", "Human Resources"] },
    { title: accept, lines: ["Signature:", `Name: ${c.p.name}`, "Date:"] },
  ],
});
const annexure = (c: Ctx): Block[] => {
  const { p, co } = c, s = salarySplit(p.ctc);
  if (p.ctc <= 0) return [];
  const row = (label: string, m: number): string[] => [label, inr(m), inr(m * 12)];
  return [
    { k: "break" },
    {
      k: "table", title: "Annexure A · Compensation structure", head: ["Component", "Per month", "Per year"],
      rows: [row("Basic salary", s.basic), row("House Rent Allowance (HRA)", s.hra), row("Special allowance", s.special)],
      foot: ["Total fixed pay (CTC)", inr(s.monthly), inr(s.monthly * 12)],
      note: `Basic salary is 50% of CTC and HRA is 40% of basic. Deductions from your monthly pay: provident fund at 12% of basic (basic taken up to ₹15,000), ESI where the monthly gross is ₹21,000 or less, professional tax of ${inr(co.ptax ?? 200)}, and income-tax at source as per your declaration.${c.incentive ? ` Sales incentive (${p.incentivePct}% of the annual plan value of pharmacies won) is paid separately and is not part of the CTC.` : ""}`,
    },
  ];
};

export function buildLetter(type: LetterType, p: LetterPerson, co: LetterCompany, opts: { lastDay?: string; today?: Date } = {}): Letter {
  const now = opts.today ?? new Date(), c = ctxOf(p, co), today = longDate(now), base = { ...head(co), ...addressee(p), date: today };
  const glance = (rows: [string, string][]): Block => ({ k: "facts", title: "Terms at a glance", rows });
  const facts: [string, string][] = [
    ["Designation", p.desig || "To be confirmed"], ["Department", p.dept || "To be confirmed"], ["Employment type", p.empType || "Full-time"], ["Reporting to", p.manager || "To be confirmed"],
    ["Place of work", p.location || "Company office"], ["Date of joining", c.join], ["Annual CTC", p.ctc > 0 ? `${inr(p.ctc)} per annum` : "As communicated by HR"],
    ["Probation", `${PROBATION_MONTHS} months`], ["Notice period", `One (1) month (${NOTICE_DAYS} days), either side`],
  ];
  if (type === "offer") return {
    ...base, type, title: "Offer of Employment", subject: `Offer of employment as ${p.desig || "team member"}`, ref: refOf("OFR", p.empNo, now), confidential: true,
    blocks: [
      { k: "p", t: `Dear ${c.first},` },
      { k: "p", t: `Further to our discussions, we are pleased to offer you employment with ${c.company}, the billing, stock and GST platform for Indian medical stores, on the terms below. We were impressed with you and look forward to you joining the team.` },
      glance(facts),
      ...terms(c, 1),
      { k: "p", t: `Please sign and return a copy of this letter as your acceptance within ${OFFER_VALID_DAYS} days, that is by ${longDate(plusDays(now, OFFER_VALID_DAYS))}, or accept it on the HRMS. The offer lapses if it is not accepted by then. On joining you will also sign the Non-Disclosure Agreement and receive your Letter of Appointment.` },
      { k: "p", t: `We welcome you to ${c.company}.` },
      signOff(c, "Accepted and agreed"),
      ...annexure(c),
    ],
  };
  if (type === "appointment") return {
    ...base, type, title: "Letter of Appointment", subject: `Appointment as ${p.desig || "team member"}`, ref: refOf("APT", p.empNo, now), confidential: true,
    blocks: [
      { k: "p", t: `Dear ${c.first},` },
      { k: "p", t: `Further to your acceptance of our offer, we are pleased to appoint you as ${p.desig || "team member"}${p.dept ? ` in the ${p.dept} team` : ""} of ${c.company}, with effect from ${c.join}. Your employee ID is ${p.empNo} and your official email is ${p.email}. Your appointment is on the following terms.` },
      glance([["Employee ID", p.empNo], ["Official email", p.email], ...facts]),
      ...terms(c, 1),
      { k: "p", t: "This letter, with the Non-Disclosure Agreement and the policies on the HRMS, is the entire agreement between you and the company on your employment and replaces earlier discussions. Please sign the duplicate copy as your acceptance." },
      signOff(c, "Accepted and agreed"),
      ...annexure(c),
    ],
  };
  if (type === "nda") return {
    ...base, type, title: "Non-Disclosure Agreement", subject: `Non-Disclosure Agreement with ${p.name} (${p.empNo})`, ref: refOf("NDA", p.empNo, now), confidential: true,
    blocks: [
      { k: "p", t: `This Non-Disclosure Agreement is made on ${today} between ${c.company} (“the Company”) and ${p.name}, employee ID ${p.empNo}${p.address ? `, of ${p.address}` : ""} (“the Employee”).` },
      { k: "p", t: "The Employee will have access to confidential information of the Company and its customers while working for it. The parties therefore agree as follows." },
      ...([
        ["Confidential information", [`Confidential information means all non-public information in any form, including pharmacy customer records, invoices, stock and batch data, prescriber and patient details, pricing and margins, source code, system design, product roadmaps, business plans, financial information, and anything shared by partner pharmacies, distributors or vendors.`]],
        ["Duty of confidence", [`The Employee will use confidential information only to do the work given by the Company, keep it secure, and not copy, share, publish or take it outside the Company without written permission. The Employee will report any loss or leak at once.`]],
        ["Exceptions", [`The duty does not cover information that is public without the Employee’s fault, that the Employee knew lawfully before joining, or that must be disclosed by law or a court order, in which case the Employee will tell the Company first where the law allows.`]],
        ["Personal data", [`The Employee will handle personal data of customers, patients and colleagues only as the Digital Personal Data Protection Act, 2023 and the Company’s policies allow.`]],
        ["Return of material", [`On request, and on leaving, the Employee will return or delete all confidential material, including copies on personal devices, and confirm this in writing.`]],
        ["Non-solicitation", [`For 12 months after leaving, the Employee will not solicit the Company’s customers, partner pharmacies or employees for a competing business.`]],
        ["Term", [`This agreement applies from the first day of employment and continues for two years after employment ends. For trade secrets and personal data it continues for as long as the information stays confidential.`]],
        ["Remedies", [`The Employee understands that a breach may cause serious harm for which damages alone may not be enough, so the Company may also seek an injunction, and may take disciplinary and legal action.`]],
        ["Governing law", [`This agreement is governed by the laws of India, and the courts at ${JURISDICTION} have jurisdiction.`]],
      ] as [string, string[]][]).map(([title, t], i) => ({ k: "clause" as const, n: i + 1, title, t })),
      { k: "sign", boxes: [{ title: `For ${c.company}`, lines: ["", "Authorised Signatory", "Human Resources"] }, { title: "The Employee", lines: ["Signature:", `Name: ${p.name}`, "Date:"] }] },
    ],
  };
  const last = opts.lastDay ? longDate(opts.lastDay) : today;
  if (type === "experience") return {
    ...base, type, title: "Experience Certificate", subject: "To whomsoever it may concern", ref: refOf("EXP", p.empNo, now), confidential: false,
    blocks: [
      { k: "p", t: `This is to certify that ${p.name} (employee ID ${p.empNo}) worked with ${c.company} as ${p.desig || "a team member"}${p.dept ? ` in the ${p.dept} team` : ""} from ${c.join} to ${last}.` },
      { k: "p", t: "During this period we found their work and conduct satisfactory. They have left the company on their own accord after serving the notice period, and have no pending obligation towards the company as on the date of this letter." },
      { k: "p", t: `We wish ${c.first} every success in the future.` },
      { k: "sign", boxes: [{ title: `For ${c.company}`, lines: ["", "Authorised Signatory", "Human Resources"] }] },
    ],
  };
  return {
    ...base, type: "relieving", title: "Relieving Letter", subject: "Relieving from services", ref: refOf("REL", p.empNo, now), confidential: true,
    blocks: [
      { k: "p", t: `Dear ${c.first},` },
      { k: "p", t: `With reference to your resignation, and after the notice period of one month, you are relieved from your duties as ${p.desig || "team member"}${p.dept ? `, ${p.dept}` : ""}, at the close of business on ${last}.` },
      { k: "p", t: "Your full and final settlement, including pending salary, leave encashment where applicable and statutory dues, will be processed with the next payroll after clearance of company assets and access." },
      { k: "p", t: `Please continue to honour the confidentiality and non-solicitation obligations in the Non-Disclosure Agreement you accepted at joining. Thank you for your contribution to ${c.company}. We wish you well.` },
      { k: "sign", boxes: [{ title: `For ${c.company}`, lines: ["", "Authorised Signatory", "Human Resources"] }] },
    ],
  };
}

export type OfferTerms = { position: string; empType: string; pay: string; joinDate: string; mode: string; terms: string; by: string; on: string };
/** The offer HR prepares for a candidate in Recruitment. */
export function buildCandidateOffer(name: string, o: OfferTerms, co: LetterCompany): Letter {
  const first = name.trim().split(/\s+/)[0], company = co.name || "Medoro", on = new Date(o.on + "T00:00:00Z");
  const p: LetterPerson = { empNo: "", name, email: "", phone: "", address: "", desig: o.position, dept: "", empType: o.empType, location: "", manager: "", joinDate: o.joinDate, ctc: 0, sales: false, incentivePct: 0 };
  const c = ctxOf(p, co);
  const clauses = terms(c, 1).filter((b) => b.k === "clause" && !["Compensation", "Position and duties", "Commencement and place of work"].includes(b.title)).map((b, i) => (b.k === "clause" ? { ...b, n: i + 4 } : b));
  return {
    ...head(co), to: name, toLine: o.position, toAddress: "", date: longDate(o.on), type: "offer", title: "Offer of Employment", subject: `Offer of employment as ${o.position}`, ref: `MDR/HR/OFR/${o.on.replace(/-/g, "")}`, confidential: true,
    blocks: [
      { k: "p", t: `Dear ${first},` },
      { k: "p", t: `We are pleased to offer you employment with ${company}, the billing, stock and GST platform for Indian medical stores, on the terms below.` },
      { k: "facts", title: "Terms at a glance", rows: [["Position", o.position], ["Employment type", o.empType], ["Work mode", o.mode], ["Date of joining", longDate(o.joinDate)], ["Pay", o.pay], ["Probation", `${PROBATION_MONTHS} months`], ["Notice period", `One (1) month (${NOTICE_DAYS} days), either side`]] },
      { k: "clause", n: 1, title: "Position and place of work", t: [`You will join as ${o.position} (${o.empType.toLowerCase()}, ${o.mode.toLowerCase()}) from ${longDate(o.joinDate)}.`] },
      { k: "clause", n: 2, title: "Compensation", t: [`Your pay will be ${o.pay}, paid monthly by bank transfer after deductions required by law. A detailed salary structure is given in your appointment letter.`] },
      ...(o.terms ? [{ k: "clause" as const, n: 3, title: "Other terms", t: [o.terms] }] : []),
      ...clauses.map((b, i) => (b.k === "clause" ? { ...b, n: i + (o.terms ? 4 : 3) } : b)),
      { k: "p", t: `Please reply to this email to accept, or sign and return a copy, within ${OFFER_VALID_DAYS} days, that is by ${longDate(plusDays(on, OFFER_VALID_DAYS))}. The offer lapses after that date.` },
      { k: "sign", boxes: [{ title: `For ${company}`, lines: ["", o.by || "Authorised Signatory", "Human Resources"] }, { title: "Accepted and agreed", lines: ["Signature:", `Name: ${name}`, "Date:"] }] },
    ],
  };
}
