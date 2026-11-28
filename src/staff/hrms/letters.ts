// Employment letters, written from an employee's HR record as proper corporate documents: letterhead, reference, a summary of the
// terms, numbered clauses, a salary annexure and signature blocks. Pure functions shared by the server (PDF, email) and the screens
// (preview, print). Nothing here talks to the database.
import { UDYAM } from "@/lib/udyam";
import { conductAnnexure, disciplineAnnexure, itAnnexure, leaveRules, payRules, poshAnnexure, privacyAnnexure, statutoryAnnexure, verificationConsent } from "./letter-schedules";

export const LETTER_TYPES = [
  { id: "offer", label: "Offer letter" }, { id: "appointment", label: "Appointment letter" }, { id: "nda", label: "Non-disclosure agreement" },
  { id: "experience", label: "Experience letter" }, { id: "relieving", label: "Relieving letter" }, { id: "promotion", label: "Letter of promotion" },
] as const;
export type LetterType = (typeof LETTER_TYPES)[number]["id"];
export const JOINING_LETTERS: LetterType[] = ["offer", "appointment", "nda"]; // what a new joiner reads and accepts
export const EXIT_LETTERS: LetterType[] = ["experience", "relieving"]; // HR only, with a last working day
export const PROMOTION_LETTER: LetterType = "promotion"; // written from a recorded promotion, keyed by its effective date
/** Letters written for a particular day (exit: the last working day; promotion: the effective date). The employee sees these once HR sends them. */
export const DATED_LETTERS: LetterType[] = [...EXIT_LETTERS, PROMOTION_LETTER];
export const letterLabel = (t: string) => LETTER_TYPES.find((l) => l.id === t)?.label ?? t;

export const NOTICE_DAYS = 30; // one month, either side
export const PROBATION_MONTHS = 6;
export const OFFER_VALID_DAYS = 7;
export const JURISDICTION = "Bokaro Steel City, Jharkhand";

export type LetterPerson = {
  empNo: string; name: string; email: string; phone: string; address: string; desig: string; dept: string; empType: string; location: string; manager: string;
  joinDate: string | null; ctc: number; sales: boolean; incentivePct: number;
};
/** A recorded promotion, as the letter needs it (manager names, not ids). */
export type PromotionTerms = {
  effective: string; fromDesig: string; toDesig: string; fromDept: string; toDept: string; fromManager: string; toManager: string;
  fromCtc: number; toCtc: number; responsibilities: string[]; note: string;
};
export type LetterCompany = {
  name: string; address: string; phone?: string; email?: string; gstin?: string;
  leave?: { casual: number; sick: number; privilege: number; comp: number }; ptax?: number;
  work?: { start: string; end: string; hours: number; lunchFrom: string; lunchTo: string }; // the working day, written out (see scheduleText)
};

export type Block =
  | { k: "p"; t: string; bold?: boolean; center?: boolean }
  | { k: "h"; t: string; sub?: string } // a heading for an annexure or schedule
  | { k: "list"; items: string[]; style?: "alpha" | "upper" | "num" }
  | { k: "clause"; n: number; title: string; t: string[] }
  | { k: "sec"; n: string; title: string; t: string[] } // a numbered section inside an annexure (laid out like a clause) // paragraphs are numbered n.1, n.2…; lines starting "(a) " are sub-items
  | { k: "facts"; title?: string; rows: [string, string][] }
  | { k: "table"; title: string; head: string[]; rows: string[][]; foot?: string[]; note?: string; widths?: number[]; align?: ("l" | "r" | "c")[] }
  | { k: "sign"; boxes: { title: string; lines: string[] }[] }
  | { k: "break"; unless?: number }; // a new page; with `unless`, only when less than that many points are left on this one
/** How the first page is laid out: a letter to a person, an agreement between two parties, or a certificate to whom it may concern. */
export type LetterForm = "letter" | "agreement" | "certificate";
export type Letter = {
  type: string; title: string; subject: string; ref: string; date: string; confidential: boolean; form?: LetterForm; initials?: boolean;
  to: string; toLine: string; toAddress: string; company: string; address: string; contact: string; registration: string; blocks: Block[];
};
const SUB_ITEM = /^\(([a-z]{1,2}|[ivx]{1,4})\)\s+/;
/** A clause's paragraphs with their labels: "5.1", "5.2"… when there is more than one, "(a)", "(b)"… for sub-items. */
export function clauseParas(b: { n: number | string; t: string[] }): { label: string; text: string; item: boolean }[] {
  const many = b.t.filter((t) => !SUB_ITEM.test(t)).length > 1;
  let k = 0;
  return b.t.map((t) => {
    const m = t.match(SUB_ITEM);
    if (m) return { label: `(${m[1]})`, text: t.slice(m[0].length), item: true };
    k += 1;
    return { label: many ? `${b.n}.${k}` : "", text: t, item: false };
  });
}
export const listLabel = (style: "alpha" | "upper" | "num" | undefined, i: number) => (style === "num" ? `${i + 1}.` : style === "upper" ? `(${String.fromCharCode(65 + i)})` : `(${String.fromCharCode(97 + i)})`);
/** All the words of a letter in order (for search, tests and plain-text uses). */
export const letterText = (l: Letter) => l.blocks.flatMap((b) => (b.k === "p" ? [b.t] : b.k === "h" ? [b.t, b.sub ?? ""] : b.k === "list" ? b.items : b.k === "clause" || b.k === "sec" ? [b.title, ...b.t] : b.k === "facts" ? b.rows.map((r) => r.join(": ")) : b.k === "table" ? [b.title, ...b.rows.map((r) => r.join(" ")), ...(b.foot ?? []), b.note ?? ""] : b.k === "sign" ? b.boxes.flatMap((x) => [x.title, ...x.lines]) : [])).join("\n");

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
const leaveOf = (co: LetterCompany) => co.leave ?? { casual: 12, sick: 12, privilege: 15, comp: 0 };
const clauses = (list: [string, string[]][], from = 1): Block[] => list.map(([title, t], i) => ({ k: "clause" as const, n: from + i, title, t }));
const companySign = (company: string, by = "Authorised Signatory"): { title: string; lines: string[] } => ({ title: `For and on behalf of ${company}`, lines: ["", by, "Human Resources"] });

/**
 * The terms of employment, as numbered clauses: shared by the offer and the appointment letter. Written the way an Indian employer's
 * standard terms read, and kept to what the law allows (no restraint after employment beyond non-solicitation; arbitration by agreement).
 */
/** Annexure letters the clauses refer to (only the offer carries the policy annexures). */
type Annex = { pay: string; leave: string; docs?: string; laws?: string; conduct?: string; posh?: string; discipline?: string; privacy?: string; it?: string };
const see = (x: string | undefined, t: (l: string) => string) => (x ? [t(x)] : []);
function terms(c: Ctx, doc: "offer" | "appointment", ax: Annex): [string, string[]][] {
  const { p, co, company } = c, lv = leaveOf(co), s = salarySplit(p.ctc), it = doc === "offer" ? "this offer" : "this appointment", pay = ax.pay ? `Annexure ${ax.pay}` : "";
  return [
    ["Definitions and interpretation", [
      `In this letter, “Company” means ${company} and includes its successors and assigns; “Policies” means the rules, policies and procedures of the Company in force from time to time, as published on the HRMS or otherwise communicated to you; “HRMS” means the Company’s human resources management system; and “Confidential Information” has the meaning given to it in the Non-Disclosure Agreement.`,
      "Headings are for convenience only and do not affect interpretation. The annexures form part of this letter. If this letter and a Policy differ on any point, this letter will prevail.",
    ]],
    ["Position and duties", [
      `You will be employed as ${p.desig || "a member of staff"}${p.dept ? ` in the ${p.dept} team` : ""}${p.manager ? `, reporting to ${p.manager}` : ""} or to any other person the Company may nominate from time to time.`,
      "You will perform the duties normally associated with your position, and such other duties as may reasonably be assigned to you that are consistent with your skills and experience. The Company may revise your role, responsibilities or reporting line as the needs of the business change.",
      `You will devote your full working time, attention and ability to the business of the Company, and will act at all times in good faith and in its best interests.`,
    ]],
    ["Commencement and place of work", [
      `Your employment will commence on ${c.join} (the “Date of Joining”).${doc === "offer" ? " If you do not report for duty on that date, or on a later date agreed with the Company in writing, this offer will stand withdrawn without further notice." : ""}`,
      `Your initial place of work will be ${p.location || "the Company’s office"}. You may be required to work at, or travel to, any other office, customer site or location in India as the business requires. The Company may also transfer you to another location, department or affiliate, with reasonable notice for any permanent transfer.`,
    ]],
    ["Compensation", [
      p.ctc > 0
        ? `Your annual cost to company (CTC) is ${inr(p.ctc)}, which is approximately ${inr(s.monthly)} per month before statutory deductions. The break-up is set out in ${pay}. Salary is paid monthly in arrears by bank transfer, after the deductions required by law, including provident fund, employees’ state insurance where applicable, professional tax and income-tax deducted at source.`
        : "Your compensation will be confirmed to you in writing by Human Resources, and will be paid monthly in arrears by bank transfer after the deductions required by law.",
      ...(c.incentive ? [`In addition, you will be eligible for a sales incentive of ${p.incentivePct}% of the annual subscription value of each pharmacy you win and activate in a month, paid with the following month’s salary. Subscriptions cancelled or refunded within 30 days are adjusted against it. The sales incentive is variable pay, does not form part of your fixed CTC, and is governed by the sales plan in force from time to time.`] : []),
      "Your compensation will be reviewed annually in line with the Company’s review cycle. A review does not imply an increase; any revision will depend on your performance and the performance of the Company, and will be confirmed to you in writing.",
      "Your compensation is personal and confidential to you, and you should not discuss it with other employees except as permitted by law.",
    ]],
    ["Statutory and other benefits", [
      "You will be covered under the provident fund, employees’ state insurance (while your wages are within the coverage limit) and gratuity, as required by applicable law and in accordance with the rules of each scheme. Contributions will be made at the rates prescribed from time to time.",
      "Statutory bonus, where payable, will be paid in accordance with applicable law. Any other benefit the Company may introduce is at its discretion, and may be modified or withdrawn by the Company.",
      ...see(ax.laws && ax.pay, () => `The rules on payment of wages, deductions, provident fund, employees’ state insurance, gratuity, bonus and income-tax are explained in ${pay}.`),
    ]],
    ["Probation", [
      `You will be on probation for ${PROBATION_MONTHS} months from the Date of Joining. During this period the Company will assess your performance, conduct and attendance, and may extend your probation by up to three (3) months by written notice.`,
      "On successful completion of probation, your confirmation will be communicated to you in writing. Until a letter of confirmation is issued, you will continue to be on probation.",
    ]],
    ["Working hours and attendance", [
      co.work
        ? `Your normal working day is ${co.work.hours} hours, from ${co.work.start} to ${co.work.end}, with a lunch break from ${co.work.lunchFrom} to ${co.work.lunchTo} which is not counted as working time. You will work six days a week unless the Policies provide otherwise.`
        : "Your working hours will be as set out in the Policies published on the HRMS.",
      "Attendance is recorded on the HRMS. You will check in with a photograph at the start of each working day and check out at the end of it. Your activity on the HRMS is monitored as set out in the clause on information technology and monitoring below, and in the Policies.",
      "You may be required to work additional hours where the business reasonably requires it. The Company may change working hours in line with the needs of the business and applicable law.",
    ]],
    ["Leave and holidays", [
      `You are entitled to ${lv.casual} days of casual leave, ${lv.sick} days of sick leave and ${lv.privilege} days of privilege leave in each calendar year${lv.comp ? `, and ${lv.comp} days of compensatory off` : ""}, credited in proportion to your service in the year of joining. A summary is given in Annexure ${ax.leave}.`,
      "Leave must be applied for on the HRMS and approved in advance, except in the case of sudden illness or emergency, which must be reported to your manager on the same day. Absence without approved leave for more than eight (8) consecutive working days may be treated as voluntary abandonment of employment.",
      "Public holidays will be observed as per the holiday list published by the Company at the beginning of each year.",
    ]],
    ["Travel and expenses", [
      "The Company will reimburse reasonable expenses that you incur, with prior approval, in the course of its business, in accordance with the travel and expense Policy. Claims must be submitted on the HRMS with original bills within thirty (30) days of the expense being incurred.",
    ]],
    ["Code of conduct and company policies", [
      "You will comply with the Policies, including the code of conduct and the Policies on information security, attendance and leave, as amended from time to time. A breach of a Policy may result in disciplinary action, up to and including termination of employment.",
      "You will conduct yourself with honesty and integrity, treat colleagues, customers and partners with courtesy and respect, and will not report for work under the influence of alcohol or any intoxicating substance.",
      ...see(ax.conduct, (l) => `The Code of conduct is set out in Annexure ${l}.`),
    ]],
    ["Prevention of sexual harassment and equal opportunity", [
      "The Company is committed to providing a workplace free from harassment and discrimination of any kind. Harassment or discrimination on the basis of gender, religion, caste, disability, age or any other characteristic protected by law will not be tolerated.",
      "The Company complies with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013. Complaints may be made to the Internal Committee constituted by the Company or, where none has been constituted, to the Local Committee under that Act. No person will be victimised for making a complaint in good faith.",
      ...see(ax.posh, (l) => `The procedure for complaints and inquiries, and the Company’s equal opportunity policy, are set out in Annexure ${l}.`),
    ]],
    ["Conflict of interest and anti-bribery", [
      "You will disclose to the Company in writing any interest, direct or indirect, that you or a close relative have in a competitor, customer, supplier or partner of the Company.",
      `You will not offer, give, request or accept any bribe, commission or improper payment in connection with the Company’s business, and will comply with the Prevention of Corruption Act, 1988. Gifts or hospitality beyond a nominal value must be declared to your manager.`,
    ]],
    ["Confidentiality and data protection", [
      `You will keep confidential all non-public information of ${company} and of its customers, partners and vendors, including pharmacy customer records, invoices, stock and batch data, prescriber and patient details, pricing, source code and product plans, and will use it only to perform your duties.`,
      "You will handle personal data in accordance with the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000 and the Policies, and will report any actual or suspected data breach to the Company immediately.",
      ...see(ax.privacy, (l) => `How the Company processes your own personal data, and your rights as a data principal, are explained in the notice in Annexure ${l}.`),
      `You will sign the Non-Disclosure Agreement that accompanies ${it}. Your obligations of confidentiality continue after your employment ends.`,
    ]],
    ["Information technology, monitoring and acceptable use", [
      "Laptops, phones, email, software and accounts provided to you are the property of the Company and are to be used for Company work only. You will not install unlicensed software, share your passwords or one-time codes, or store Company data on personal devices or accounts unless the Company permits it in writing.",
      "To protect its business and its customers’ data, the Company may monitor and record the use of its systems, devices, email and the HRMS, including attendance photographs and activity on the HRMS. You consent to such monitoring, and to the processing of your personal data for the purposes of your employment, in accordance with the Policies and applicable law.",
      ...see(ax.it, (l) => `The rules on information security and acceptable use are set out in Annexure ${l}.`),
    ]],
    ["Intellectual property", [
      `All work you create in the course of your employment or using the Company’s resources, including software, source code, designs, documents, data, inventions and improvements, will belong to ${company} from the moment it is created. To the extent any such rights do not vest in the Company automatically, you assign them to the Company, worldwide and for their full term, without further payment.`,
      "To the extent permitted by law, you waive any moral rights in such work. You will disclose such work promptly and do whatever is reasonably required, during or after your employment, to record or protect the Company’s ownership.",
    ]],
    ["Non-solicitation and outside work", [
      "During your employment you will not, without the prior written consent of the Company, take up any other employment, consultancy or business, whether paid or unpaid, or hold any interest in a business that competes with the Company.",
      "For twelve (12) months after your employment ends, you will not, directly or indirectly, solicit or entice away any employee of the Company, or any customer, partner pharmacy or distributor with whom you dealt in the last twelve (12) months of your employment, for the benefit of a competing business.",
    ]],
    ["Notice period and termination", [
      `After confirmation, either party may end this employment by giving ${NOTICE_DAYS / 30} (one) month’s written notice (${NOTICE_DAYS} days), or salary in lieu of the notice period not served. The same notice applies during probation. The Company may, at its discretion, accept a shorter notice period or waive the notice period. Leave balance cannot be adjusted against the notice period without the Company’s approval.`,
      "The Company may terminate your employment immediately, without notice or salary in lieu, if you:",
      "(a) commit any act of misconduct, dishonesty, fraud or insubordination;",
      "(b) breach your obligations of confidentiality or the Non-Disclosure Agreement;",
      "(c) are found to have given false information or withheld material information at the time of joining;",
      "(d) commit a serious or repeated breach of the Policies or of this letter; or",
      "(e) are convicted of a criminal offence involving moral turpitude.",
      ...see(ax.discipline, (l) => `Before any action for misconduct, the Company will follow the disciplinary procedure in Annexure ${l}, which also sets out how you may raise a grievance.`),
      "During the notice period the Company may require you not to attend work, or to carry out only such duties as it may specify, while continuing to pay your salary.",
      "Unless extended in writing, your employment will end on the last day of the month in which you attain the age of fifty-eight (58) years.",
    ]],
    ["Return of company property and exit", [
      "On leaving, you will hand over your work and return all property, documents, devices, access cards and data of the Company in your possession, delete any copies held on personal devices or accounts, and complete the exit formalities set out in the Policies.",
      "Your full and final settlement, relieving letter and experience letter will be issued after clearance, with the next payroll cycle.",
    ]],
    ["Documents and background verification", [
      `${doc === "offer" ? "This offer is" : "Your appointment is"} subject to satisfactory verification of your identity, address, education, previous employment and references. You authorise the Company, and any agency appointed by it, to carry out such verification. The documents to be submitted are listed in ${ax.docs ? `Annexure ${ax.docs}` : "the Policies"}.`,
      "You confirm that you are not bound by any agreement with a previous employer or any other person that would prevent you from joining the Company or performing your duties, and that you will not bring to the Company or use any confidential information belonging to any other person.",
      `If any information or document you have provided is found to be false or misleading, the Company may withdraw ${it} or terminate your employment without notice.`,
    ]],
    ["Deductions and recovery", [
      "The Company may deduct from your salary, or from your full and final settlement, any amount you owe to the Company, including advances, excess payments, the value of unreturned property and salary in lieu of notice not served, subject to applicable law.",
    ]],
    ["General", [
      "This letter, together with the Non-Disclosure Agreement and the Policies, constitutes the entire agreement between you and the Company on your employment and supersedes all earlier discussions, representations and correspondence.",
      "No amendment to this letter is valid unless made in writing and signed by an authorised signatory of the Company. If any provision of this letter is held invalid or unenforceable, the remaining provisions will continue in full force. A failure or delay by the Company in exercising any right does not operate as a waiver of it.",
      "Notices under this letter will be given in writing, by hand, post or email, to the address or email address recorded on the HRMS (for you) or to Human Resources at the Company’s office (for the Company). A notice sent by email is treated as received on the working day it is sent.",
      "The clauses on confidentiality, intellectual property, non-solicitation, return of property, governing law and dispute resolution will survive the end of your employment.",
    ]],
    ["Governing law", [`This letter is governed by and construed in accordance with the laws of India.`, ...see(ax.laws, (l) => `The principal laws that apply to your employment are listed in Annexure ${l}. Where a term of this letter is less favourable to you than the law requires, the law will prevail.`)]],
    ["Dispute resolution", [
      "The parties will first try to resolve any dispute arising out of or in connection with this letter by discussion in good faith within thirty (30) days of either party raising it in writing.",
      `To the extent permitted by law, a dispute not so resolved will be referred to arbitration by a sole arbitrator appointed by mutual agreement of the parties, in accordance with the Arbitration and Conciliation Act, 1996. The seat of arbitration will be ${JURISDICTION.split(",")[0]} and the proceedings will be conducted in English. Subject to this, the courts at ${JURISDICTION} will have exclusive jurisdiction.`,
    ]],
  ];
}

/** Annexure A: the salary break-up (only when the CTC is on record). */
const payAnnexure = (c: Ctx, letter: string, title = "Compensation structure"): Block[] =>
  c.p.ctc <= 0 ? [] : [{ k: "break", unless: 360 }, { k: "h", t: `Annexure ${letter}`, sub: title }, ...payTable(c, letter, title)];
const payTable = (c: Ctx, letter: string, title = "Compensation structure"): Block[] => {
  const { p, co } = c, s = salarySplit(p.ctc);
  if (p.ctc <= 0) return [];
  const row = (label: string, m: number): string[] => [label, inr(m), inr(m * 12)];
  return [
    {
      k: "table", title: `Annexure ${letter} · ${title}`, head: ["Component", "Per month", "Per year"],
      rows: [row("Basic salary", s.basic), row("House Rent Allowance (HRA)", s.hra), row("Special allowance", s.special)],
      foot: ["Total fixed pay (CTC)", inr(s.monthly), inr(s.monthly * 12)],
      note: `Basic salary is 50% of CTC and HRA is 40% of basic salary. Deductions from monthly pay: provident fund at 12% of basic salary (on basic salary up to ₹15,000), employees’ state insurance where the monthly gross is ₹21,000 or less, professional tax of ${inr(co.ptax ?? 200)}, and income-tax at source as per your investment declaration.${c.incentive ? ` The sales incentive (${p.incentivePct}% of the annual plan value of pharmacies won) is paid separately and does not form part of the CTC.` : ""}`,
    },
    { k: "p", t: "Notes", bold: true },
    { k: "list", style: "num", items: [
      "The figures above are before statutory deductions. Your take-home pay will depend on the deductions applicable to you each month.",
      "Income-tax is deducted at source on the basis of the tax regime and the investment declaration you submit on the HRMS. Proof of investments must be submitted by the date notified by the Company each year.",
      "The salary structure may be revised by the Company to comply with changes in law, without reducing your total CTC.",
    ] },
  ];
};
/** Annexure B: leave at a glance. */
const leaveAnnexure = (c: Ctx, letter: string): Block[] => [{ k: "h", t: `Annexure ${letter}`, sub: "Leave and holidays" }, ...leaveTable(c, letter)];
const leaveTable = (c: Ctx, letter: string): Block[] => {
  const lv = leaveOf(c.co);
  return [
    {
      k: "table", title: `Annexure ${letter} · Leave and holidays`, head: ["Type of leave", "Days a year", "How it works"], widths: [0.28, 0.17, 0.55], align: ["l", "c", "l"],
      rows: [
        ["Casual leave", String(lv.casual), "For personal matters. Applied for in advance on the HRMS. Not carried forward to the next year."],
        ["Sick leave", String(lv.sick), "For illness. A medical certificate may be required for absence of more than two consecutive days."],
        ["Privilege leave", String(lv.privilege), "For planned time off. Carried forward and encashed only as the leave policy allows."],
        ...(lv.comp ? [["Compensatory off", String(lv.comp), "For approved work on a weekly off or holiday. To be availed within the period set in the leave policy."]] : []),
        ["Maternity leave", "26 weeks", "As provided under applicable law, for eligible employees."],
        ["Public holidays", "As notified", "As per the holiday list published at the start of each year."],
      ],
      note: "Leave in the year of joining is credited in proportion to the months of service. In case of any difference between this summary and the leave policy, the leave policy will prevail.",
    },
  ];
};
/** The documents a joiner brings on the first day. */
const documentsTable = (letter: string): Block[] => [
  {
    k: "table", title: `Annexure ${letter} · Documents to be submitted on joining`, head: ["Document", "Details"], widths: [0.32, 0.68], align: ["l", "l"],
    rows: [
      ["Proof of identity", "Aadhaar card (a masked copy is acceptable), passport or voter ID card"],
      ["PAN card", "Copy of your permanent account number card, for income-tax"],
      ["Proof of address", "Current and permanent address, if different"],
      ["Educational certificates", "Certificate and mark sheets of your highest qualification"],
      ["Previous employment", "Relieving letter and last three months’ payslips from your most recent employer"],
      ["Bank details", "Cancelled cheque or first page of passbook of an account in your name"],
      ["Provident fund", "Universal Account Number (UAN), if you were a member with a previous employer"],
      ["Photographs", "Two recent passport-size photographs"],
    ],
    note: "Please bring the originals for verification, with self-attested copies, or upload them on the HRMS before joining.",
  },
];

/** The joiner's acceptance and declaration, on a page of its own. */
const acceptance = (c: Ctx, letter: string, ref: string, date: string, doc: string, own = false): Block[] => [
  own ? { k: "break" } : { k: "break", unless: 340 },
  { k: "h", t: `Annexure ${letter}`, sub: "Acceptance and declaration" },
  { k: "p", t: `To: Human Resources, ${c.company}` },
  { k: "p", t: `I have read and understood the ${doc} dated ${date} (Ref: ${ref}) and its annexures, and I accept employment with ${c.company} on the terms and conditions set out in it. I declare that:` },
  { k: "list", items: [
    "the information I have given to the Company, including in my application, interviews and the documents I submit, is true and complete, and I have disclosed in writing any criminal proceedings pending against me;",
    "I am not bound by any agreement or obligation that prevents me from joining the Company or performing my duties;",
    "I will not bring to the Company, or use in my work, any confidential information belonging to a previous employer or any other person, and I have listed in writing any prior work or inventions I wish to exclude from the clause on intellectual property;",
    "I consent to the Company verifying my background and processing my personal data for the purposes of my employment, as described in this letter; and",
    `I will report for duty on ${c.join}.`,
  ] },
  { k: "sign", boxes: [{ title: "Accepted and agreed", lines: ["", `Name: ${c.p.name}`, "Date and place:"] }] },
];

/**
 * The annexures of an offer, lettered in order, each on its own page: pay and statutory benefits, the applicable laws, leave, the code of
 * conduct, POSH, discipline and grievances, the data protection notice, IT use, documents and verification, and acceptance. Also the contents
 * table for the first pages and the letters the clauses refer to.
 */
function offerPack(c: Ctx, ref: string, date: string, payLines: Block[]) {
  const parts: [keyof Annex | "accept", string, (l: string) => Block[]][] = [
    ["pay", "Compensation and statutory benefits", (l) => [{ k: "break" }, { k: "h", t: `Annexure ${l}`, sub: "Compensation and statutory benefits" }, ...payLines, ...payRules(c.co.ptax ?? 200)]],
    ["laws", "Applicable laws and statutory framework", (l) => statutoryAnnexure(l, c.company)],
    ["leave", "Leave and holidays", (l) => [{ k: "break" }, { k: "h", t: `Annexure ${l}`, sub: "Leave and holidays" }, ...leaveTable(c, l), ...leaveRules()]],
    ["conduct", "Code of conduct", (l) => conductAnnexure(l, c.company)],
    ["posh", "Prevention of sexual harassment and equal opportunity", (l) => poshAnnexure(l, c.company)],
    ["discipline", "Disciplinary procedure and grievance redressal", (l) => disciplineAnnexure(l, c.company)],
    ["privacy", "Notice on the processing of your personal data", (l) => privacyAnnexure(l, c.company)],
    ["it", "Information security and acceptable use", (l) => itAnnexure(l, c.company)],
    ["docs", "Documents and background verification", (l) => [{ k: "break" }, { k: "h", t: `Annexure ${l}`, sub: "Documents and background verification" }, ...documentsTable(l), ...verificationConsent(c.company, c.p.name)]],
    ["accept", "Acceptance and declaration", (l) => acceptance(c, l, ref, date, "offer letter", true)],
  ];
  const ax: Annex & { accept?: string } = { pay: "", leave: "" };
  const blocks: Block[] = [], rows: string[][] = [];
  parts.forEach(([key, title, make], i) => { const l = String.fromCharCode(65 + i); ax[key] = l; rows.push([`Annexure ${l}`, title]); blocks.push(...make(l)); });
  const contents = (clauses: number): Block => ({ k: "table", title: "Contents", head: ["Part", "Contents"], widths: [0.24, 0.76], align: ["l", "l"], rows: [["Letter", `Terms and conditions of employment (clauses 1 to ${clauses})`], ...rows] });
  return { ax, blocks, contents };
}

/** The responsibilities HR typed, one per line, without bullets or numbering. */
export const responsibilityLines = (t: string) => t.split(/\r?\n/).map((x) => x.replace(/^\s*(?:[-*•·]|\(?[a-z0-9]{1,2}[.)])\s*/i, "").trim()).filter(Boolean).slice(0, 15);

function promotionLetter(p: LetterPerson, co: LetterCompany, pr: PromotionTerms, now: Date): Letter {
  // The letter is written as of the promotion: the new role, the new pay and the new manager, whatever the profile says later.
  const np: LetterPerson = { ...p, desig: pr.toDesig, dept: pr.toDept, manager: pr.toManager, ctc: pr.toCtc };
  const c = ctxOf(np, co), eff = longDate(pr.effective), raise = pr.toCtc - pr.fromCtc, pct = pr.fromCtc > 0 ? Math.round((raise / pr.fromCtc) * 1000) / 10 : 0;
  const change = (a: string, b: string) => (a && a !== b ? `${b} (previously ${a})` : b || "Unchanged");
  const rows: [string, string][] = [
    ["Effective from", eff], ["New designation", pr.toDesig], ["Previous designation", pr.fromDesig || "—"], ["Department", change(pr.fromDept, pr.toDept)],
    ["Reporting to", change(pr.fromManager, pr.toManager || "To be confirmed")],
    ["Annual CTC", raise ? `${inr(pr.toCtc)} per annum (previously ${inr(pr.fromCtc)}${pct > 0 ? `, an increase of ${pct}%` : ""})` : pr.toCtc > 0 ? `${inr(pr.toCtc)} per annum (unchanged)` : "Unchanged"],
  ];
  const resp = pr.responsibilities;
  const list: [string, string[]][] = [
    ["New role and responsibilities", [
      `With effect from ${eff} you will hold the position of ${pr.toDesig}${pr.toDept ? ` in the ${pr.toDept} team` : ""}${pr.toManager ? `, reporting to ${pr.toManager}` : ""}.${resp.length ? " In this role you will be responsible for:" : " Your manager will brief you on the responsibilities of the new role, which are also recorded on the HRMS."}`,
      ...resp.map((r, i) => `(${String.fromCharCode(97 + i)})  ${r}`),
      "You will also carry out such other duties as may reasonably be assigned to you in keeping with the role.",
    ]],
    ["Compensation", [raise
      ? `Your annual cost to company (CTC) is revised from ${inr(pr.fromCtc)} to ${inr(pr.toCtc)} with effect from ${eff}, which is approximately ${inr(salarySplit(pr.toCtc).monthly)} per month before statutory deductions. The revised break-up is set out in Annexure A, and the revised salary will be paid from the payroll that covers ${eff}.`
      : "Your compensation remains unchanged."]],
    ["Other terms", [`All other terms and conditions of your employment, including the notice period, the obligations of confidentiality and the Non-Disclosure Agreement, remain unchanged. This letter forms part of your employment record and should be read together with your letter of appointment.`]],
  ];
  return {
    ...head(co), to: p.name, toLine: [pr.toDesig, pr.toDept].filter(Boolean).join(", "), toAddress: p.address, date: longDate(now), form: "letter",
    type: "promotion", title: "Letter of Promotion", subject: `Promotion to ${pr.toDesig}`, ref: `${refOf("PRM", p.empNo, new Date(pr.effective + "T00:00:00Z"))}/${pr.effective.slice(5, 7)}`, confidential: true,
    blocks: [
      { k: "p", t: `Dear ${c.first},` },
      { k: "p", t: `We are pleased to inform you that, in recognition of your performance and contribution to ${c.company}, you have been promoted${pr.fromDesig ? ` from ${pr.fromDesig}` : ""} to ${pr.toDesig} with effect from ${eff}.` },
      { k: "facts", title: "Promotion at a glance", rows },
      ...clauses(list),
      ...(pr.note ? [{ k: "p" as const, t: pr.note }] : []),
      { k: "p", t: `Congratulations on your promotion. We look forward to your continued contribution to ${c.company} in your new role.` },
      { k: "p", t: "Yours sincerely," },
      { k: "sign", boxes: [companySign(c.company), { title: "Received and acknowledged", lines: ["", `Name: ${p.name}`, "Date:"] }] },
      ...(raise !== 0 ? payAnnexure(c, "A", "Revised compensation structure") : []),
    ],
  };
}

export function buildLetter(type: LetterType, p: LetterPerson, co: LetterCompany, opts: { lastDay?: string; today?: Date; promotion?: PromotionTerms } = {}): Letter {
  const now = opts.today ?? new Date(), c = ctxOf(p, co), today = longDate(now), base = { ...head(co), ...addressee(p), date: today };
  if (type === "promotion") {
    if (!opts.promotion) throw new Error("A promotion letter needs the promotion.");
    return promotionLetter(p, co, opts.promotion, now);
  }
  const glance = (rows: [string, string][]): Block => ({ k: "facts", title: "Terms at a glance", rows });
  const facts: [string, string][] = [
    ["Designation", p.desig || "To be confirmed"], ["Department", p.dept || "To be confirmed"], ["Employment type", p.empType || "Full-time"], ["Reporting to", p.manager || "To be confirmed"],
    ["Place of work", p.location || "Company office"], ["Date of joining", c.join], ["Annual CTC", p.ctc > 0 ? `${inr(p.ctc)} per annum` : "As communicated by HR"],
    ["Probation", `${PROBATION_MONTHS} months`], ["Notice period", `One (1) month (${NOTICE_DAYS} days), either side`],
  ];
  // Annexures are lettered in the order they appear (A is the pay table, which is left out when no CTC is on record).
  const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  if (type === "offer") {
    const ref = refOf("OFR", p.empNo, now), pack = offerPack(c, ref, today, payTable(c, "A")), list = terms(c, "offer", pack.ax);
    return {
      ...base, type, title: "Offer of Employment", subject: `Offer of employment as ${p.desig || "team member"}`, ref, confidential: true, form: "letter", initials: true,
      blocks: [
        { k: "p", t: `Dear ${c.first},` },
        { k: "p", t: `Further to your application and the discussions you have had with us, we are pleased to offer you employment with ${c.company} on the terms and conditions set out in this letter and its annexures. The principal terms are summarised below; the full terms follow.` },
        glance(facts),
        { k: "p", t: "This letter consists of the terms and conditions below and the annexures listed in the following table, all of which form part of the offer." },
        pack.contents(list.length),
        ...clauses(list),
        { k: "p", t: `Acceptance. Please confirm your acceptance by signing Annexure ${pack.ax.accept} and returning a signed copy of this letter, or by accepting it on the HRMS, within ${OFFER_VALID_DAYS} days, that is by ${longDate(plusDays(now, OFFER_VALID_DAYS))}. If we do not receive your acceptance by then, this offer will lapse. On joining you will be asked to sign the Non-Disclosure Agreement and will be issued a Letter of Appointment.` },
        { k: "p", t: `We look forward to welcoming you to ${c.company}.` },
        { k: "p", t: "Yours sincerely," },
        { k: "sign", boxes: [companySign(c.company)] },
        ...pack.blocks,
      ],
    };
  }
  if (type === "appointment") {
    const ref = refOf("APT", p.empNo, now), pay = p.ctc > 0, [a, b, cc] = pay ? letters(3) : ["", ...letters(2)];
    const list = terms(c, "appointment", { pay: a, leave: b });
    return {
      ...base, type, title: "Letter of Appointment", subject: `Appointment as ${p.desig || "team member"}`, ref, confidential: true, form: "letter", initials: true,
      blocks: [
        { k: "p", t: `Dear ${c.first},` },
        { k: "p", t: `With reference to your acceptance of our offer of employment, we are pleased to appoint you as ${p.desig || "a member of staff"}${p.dept ? ` in the ${p.dept} team` : ""} of ${c.company} with effect from ${c.join}. Your employee ID is ${p.empNo} and your official email address is ${p.email}.` },
        { k: "p", t: "Your appointment is governed by the terms and conditions below, the annexures to this letter, the Non-Disclosure Agreement and the Policies of the Company." },
        glance([["Employee ID", p.empNo], ["Official email", p.email], ...facts]),
        ...clauses(list),
        { k: "p", t: `Please sign the duplicate copy of this letter and Annexure ${cc} as a token of your acceptance, or accept it on the HRMS. We wish you a long and rewarding association with ${c.company}.` },
        { k: "p", t: "Yours sincerely," },
        { k: "sign", boxes: [companySign(c.company)] },
        ...payAnnexure(c, a),
        ...(pay ? [] : [{ k: "break" as const }]),
        ...leaveAnnexure(c, b),
        { k: "break", unless: 260 },
        { k: "h", t: `Annexure ${cc}`, sub: "Acknowledgement and acceptance" },
        { k: "p", t: `I, ${p.name}, employee ID ${p.empNo}, acknowledge that I have received, read and understood the Letter of Appointment dated ${today} (Ref: ${ref}) and its annexures. I accept the appointment on the terms and conditions set out in it, and agree to abide by the Policies of the Company as amended from time to time.` },
        { k: "p", t: "I confirm that the information and documents I have provided to the Company are true and complete, and I understand that the Company may verify them at any time during my employment." },
        { k: "sign", boxes: [{ title: "Accepted and agreed", lines: ["", `Name: ${p.name}`, `Employee ID: ${p.empNo}`, "Date:", "Place:"] }] },
      ],
    };
  }
  if (type === "nda") return {
    ...base, type, title: "Non-Disclosure Agreement", subject: `Non-Disclosure Agreement with ${p.name} (${p.empNo})`, ref: refOf("NDA", p.empNo, now), confidential: true, form: "agreement", initials: true,
    blocks: [
      { k: "p", t: `This Non-Disclosure Agreement (the “Agreement”) is made at ${JURISDICTION.split(",")[0]} on ${today}.` },
      { k: "p", t: "BETWEEN", bold: true },
      { k: "p", t: `${c.company}, a micro enterprise registered under Udyam Registration No. ${UDYAM.number}${co.address ? `, having its office at ${co.address}` : ""} (the “Company”, which expression includes its successors and permitted assigns), of the one part;` },
      { k: "p", t: "AND", bold: true },
      { k: "p", t: `${p.name}, employee ID ${p.empNo}${p.address ? `, residing at ${p.address}` : ""} (the “Employee”), of the other part.` },
      { k: "p", t: "The Company and the Employee are each referred to as a “Party” and together as the “Parties”." },
      { k: "p", t: "BACKGROUND", bold: true },
      { k: "list", style: "upper", items: [
        "The Company develops and operates software for billing, inventory management and GST compliance used by medical stores and pharmaceutical distributors in India.",
        "In the course of the Employee’s employment, the Employee will have access to confidential and proprietary information of the Company, and of its customers, partners and vendors, including personal data of patients and customers.",
        "The Parties wish to set out the terms on which that information is to be protected.",
      ] },
      { k: "p", t: "NOW, THEREFORE, the Parties agree as follows:", bold: true },
      ...clauses([
        ["Definitions", [
          "“Confidential Information” means all information, in any form or medium, disclosed to or obtained by the Employee in connection with the Employment that is not publicly available, including the categories set out in Schedule 1, whether or not it is marked as confidential.",
          "“Personal Data” has the meaning given to it in the Digital Personal Data Protection Act, 2023, and includes data relating to customers, patients, prescribers and employees.",
          "“Trade Secrets” means Confidential Information that derives commercial value from being kept secret, including source code, algorithms, pricing models and customer lists.",
          "“Employment” means the Employee’s employment with the Company, including any period of probation and notice, and “Purpose” means the performance of the Employee’s duties for the Company.",
        ]],
        ["Duty of confidence", [
          "The Employee shall:",
          "(a) hold all Confidential Information in strict confidence;",
          "(b) use Confidential Information only for the Purpose;",
          "(c) not disclose Confidential Information to any person other than employees of the Company who need to know it for the Purpose;",
          "(d) not copy, download, photograph or remove Confidential Information from the Company’s systems or premises, except as the Purpose requires; and",
          "(e) not use Confidential Information for personal benefit or to the detriment of the Company.",
          "These obligations apply to Confidential Information received before as well as after the date of this Agreement.",
        ]],
        ["Security of information", [
          "The Employee shall protect Confidential Information with the degree of care required by the Company’s information security Policy and in any case with no less than reasonable care.",
          "Without limiting the above, the Employee shall use only devices and accounts approved by the Company, shall not forward Confidential Information to personal email or cloud storage, shall not share passwords or one-time codes, and shall not discuss Confidential Information in public places.",
        ]],
        ["Exceptions", [
          "The obligations in this Agreement do not apply to information that the Employee can show by written records:",
          "(a) is or becomes publicly available other than through a breach of this Agreement;",
          "(b) was lawfully known to the Employee before it was disclosed, without any obligation of confidence;",
          "(c) is lawfully received from a third party who is free to disclose it; or",
          "(d) is developed independently by the Employee without the use of Confidential Information.",
        ]],
        ["Disclosure required by law", [
          "If the Employee is required by law, regulation or an order of a court or authority to disclose any Confidential Information, the Employee shall, where lawful, give the Company prompt written notice, co-operate with any effort by the Company to obtain protective relief, and disclose only the part that is legally required.",
          "Nothing in this Agreement prevents the Employee from reporting a suspected violation of law to a government authority, making a complaint under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, or giving evidence in legal proceedings.",
        ]],
        ["Third-party information", [
          "The Employee shall treat information received by the Company from its customers, partner pharmacies, distributors and vendors under a duty of confidence as Confidential Information, and shall comply with any additional restrictions the Company has agreed with those parties.",
          "The Employee shall not disclose to the Company, or use in the course of the Employment, any confidential information or trade secret belonging to a previous employer or any other person without that person’s written consent.",
        ]],
        ["Public statements and social media", [
          "The Employee shall not make any public statement, post on social media, speak to the press or present at any event on matters concerning the Company, its customers or its products, except as authorised by the Company in writing.",
          "The Employee may state on a professional networking profile that the Employee works for the Company and the Employee’s job title, but shall not disclose any Confidential Information in doing so.",
        ]],
        ["Personal data", [
          "The Employee shall process Personal Data only on the instructions of the Company and in accordance with the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000 and the Company’s Policies.",
          "The Employee shall not access customer or patient records except as required for the Purpose, and acknowledges that access to such records is logged and audited.",
          "The Employee shall report any actual or suspected personal data breach to the Company immediately, and in any case within twenty-four (24) hours of becoming aware of it, so that the Company can meet its obligations to the Data Protection Board of India and to affected persons.",
        ]],
        ["Intellectual property", [
          "All work product created by the Employee in the course of the Employment, including software, documents, designs and data, and all intellectual property rights in it, belong to the Company. To the extent such rights do not vest in the Company automatically, the Employee assigns them to the Company, worldwide and for their full term, and waives any moral rights in them to the extent permitted by law.",
          "The Employee shall promptly disclose such work product to the Company and, during and after the Employment, sign such documents and do such acts as the Company may reasonably require to record or protect its rights, at the Company’s cost.",
        ]],
        ["Return of material", [
          "On request by the Company at any time, and in any case on or before the last working day of the Employment, the Employee shall return all documents, devices, storage media and other material containing Confidential Information, permanently delete all copies held on personal devices and accounts, and confirm in writing that this has been done.",
        ]],
        ["No licence and no warranty", [
          "Nothing in this Agreement grants the Employee any licence or right in the Confidential Information or in any intellectual property of the Company, other than the limited right to use it for the Purpose. Confidential Information is provided without any warranty as to its accuracy or completeness.",
        ]],
        ["Non-solicitation", [
          "For twelve (12) months after the Employment ends, the Employee shall not, directly or indirectly, solicit or entice away any employee of the Company, or any customer, partner pharmacy, distributor or vendor of the Company with whom the Employee dealt during the last twelve (12) months of the Employment, for the benefit of a competing business.",
          "The Employee acknowledges that this restriction is reasonable and necessary to protect the Confidential Information and goodwill of the Company.",
        ]],
        ["Term and survival", [
          "This Agreement takes effect from the first day of the Employment or the date of signature, whichever is earlier, and continues during the Employment and for two (2) years after it ends.",
          "The obligations in relation to Trade Secrets and Personal Data continue for as long as the information remains confidential.",
        ]],
        ["Remedies", [
          "The Employee acknowledges that a breach of this Agreement may cause the Company irreparable harm for which damages alone would not be an adequate remedy. The Company is therefore entitled to seek an injunction or specific performance under the Specific Relief Act, 1963, in addition to any other remedy available to it.",
          "A breach of this Agreement constitutes misconduct and may result in disciplinary action, including termination of employment. The Employee shall indemnify the Company against loss arising from any wilful or grossly negligent breach of this Agreement.",
        ]],
        ["General", [
          "This Agreement supplements the Employee’s offer letter and letter of appointment. In the event of a conflict on any matter of confidentiality, this Agreement will prevail.",
          "No amendment to this Agreement is valid unless made in writing and signed by both Parties. If any provision is held invalid or unenforceable, the remaining provisions will continue in full force. A failure or delay in exercising a right does not operate as a waiver of it.",
          "The Company may assign this Agreement to an affiliate or a successor to its business. The Employee may not assign this Agreement.",
          "This Agreement may be executed electronically, including by acceptance on the HRMS, and an electronic record of acceptance will be valid and binding under the Information Technology Act, 2000.",
        ]],
        ["Governing law and jurisdiction", [
          "This Agreement is governed by and construed in accordance with the laws of India.",
          `To the extent permitted by law, any dispute arising out of or in connection with this Agreement that is not resolved by discussion within thirty (30) days will be referred to arbitration by a sole arbitrator appointed by mutual agreement of the Parties under the Arbitration and Conciliation Act, 1996. The seat of arbitration will be ${JURISDICTION.split(",")[0]} and the language English. Nothing in this clause prevents the Company from seeking urgent interim relief from the courts at ${JURISDICTION}, which will have exclusive jurisdiction subject to this clause.`,
        ]],
      ]),
      { k: "p", t: "IN WITNESS WHEREOF the Parties have signed this Agreement on the date first written above." },
      { k: "sign", boxes: [
        companySign(c.company),
        { title: "The Employee", lines: ["", `Name: ${p.name}`, `Employee ID: ${p.empNo}`, "Date:"] },
        { title: "Witness 1", lines: ["", "Name:", "Address:"] },
        { title: "Witness 2", lines: ["", "Name:", "Address:"] },
      ] },
      { k: "break" },
      { k: "h", t: "Schedule 1", sub: "Categories of Confidential Information" },
      {
        k: "table", title: "Schedule 1 · Categories of Confidential Information", head: ["Category", "Includes"], widths: [0.3, 0.7], align: ["l", "l"],
        rows: [
          ["Customer and patient data", "Pharmacy customer records, patient names and contact details, prescriptions, prescriber details and purchase history"],
          ["Commercial information", "Pricing, discounts, margins, subscription plans, sales pipeline, and the terms agreed with partner pharmacies and distributors"],
          ["Product and technology", "Source code, system architecture, databases, APIs, credentials, security measures and product roadmaps"],
          ["Financial information", "Revenue, costs, payroll, budgets, bank details and tax records"],
          ["Operational information", "Stock and batch data, invoices, vendor lists, internal processes and Policies"],
          ["Employee information", "Personal details, salaries and performance records of other employees"],
          ["Third-party information", "Information received from partner pharmacies, distributors, vendors and other parties under a duty of confidence"],
        ],
        note: "The categories above are illustrative and do not limit the definition of Confidential Information in clause 1.",
      },
    ],
  };
  const last = opts.lastDay ? longDate(opts.lastDay) : today;
  if (type === "experience") return {
    ...base, type, title: "Experience Certificate", subject: "To whomsoever it may concern", ref: refOf("EXP", p.empNo, now), confidential: false, form: "certificate",
    blocks: [
      { k: "p", t: `This is to certify that ${p.name} (employee ID ${p.empNo}) was employed with ${c.company} as ${p.desig || "a member of staff"}${p.dept ? ` in the ${p.dept} team` : ""} from ${c.join} to ${last}.` },
      { k: "p", t: "During this period their work and conduct were found to be satisfactory. They have been relieved of their duties after serving the notice period, and have no pending obligations towards the Company as on the date of this certificate." },
      { k: "p", t: `This certificate is issued on request. We wish ${c.first} every success in the future.` },
      { k: "sign", boxes: [companySign(c.company)] },
    ],
  };
  return {
    ...base, type: "relieving", title: "Relieving Letter", subject: "Relieving from services", ref: refOf("REL", p.empNo, now), confidential: true, form: "letter",
    blocks: [
      { k: "p", t: `Dear ${c.first},` },
      { k: "p", t: `With reference to your resignation, and on completion of the notice period of one month, you are relieved from your duties as ${p.desig || "a member of staff"}${p.dept ? `, ${p.dept}` : ""}, with effect from the close of business on ${last}.` },
      { k: "p", t: "Your full and final settlement, including salary up to your last working day, leave encashment where applicable and statutory dues, will be processed with the next payroll cycle after clearance of Company assets and access." },
      { k: "p", t: `Please note that your obligations of confidentiality and non-solicitation under the Non-Disclosure Agreement continue after your employment ends. We thank you for your contribution to ${c.company} and wish you well in your future endeavours.` },
      { k: "p", t: "Yours sincerely," },
      { k: "sign", boxes: [companySign(c.company)] },
    ],
  };
}

export type OfferTerms = { position: string; empType: string; pay: string; joinDate: string; mode: string; terms: string; by: string; on: string };
/** The offer HR prepares for a candidate in Recruitment. */
export function buildCandidateOffer(name: string, o: OfferTerms, co: LetterCompany): Letter {
  const company = co.name || "Medoro", on = new Date(o.on + "T00:00:00Z"), ref = `MDR/HR/OFR/${o.on.replace(/-/g, "")}`, date = longDate(o.on);
  const p: LetterPerson = { empNo: "", name, email: "", phone: "", address: "", desig: o.position, dept: "", empType: o.empType, location: "", manager: "", joinDate: o.joinDate, ctc: 0, sales: false, incentivePct: 0 };
  const c = ctxOf(p, co);
  // The candidate's own pay and work mode replace the record-based clauses; the annexures are the same as on an offer from the HR record.
  const pack = offerPack(c, ref, date, [{ k: "p", t: `Your compensation will be ${o.pay}. The component-wise break-up will be set out in your Letter of Appointment, and will comply with the definition of wages under the Code on Wages, 2019.` }]);
  const skip = ["Compensation", "Position and duties", "Commencement and place of work"];
  const rest = terms(c, "offer", pack.ax).filter(([t]) => !skip.includes(t));
  const list: [string, string[]][] = [
    rest[0],
    ["Position and place of work", [`You will join as ${o.position} (${o.empType.toLowerCase()}, ${o.mode.toLowerCase()}) with effect from ${longDate(o.joinDate)} (the “Date of Joining”). If you do not report for duty on that date, or on a later date agreed in writing, this offer will stand withdrawn.`, "You will perform the duties normally associated with your position and such other duties as may reasonably be assigned to you."]],
    ["Compensation", [`Your compensation will be ${o.pay}, paid monthly in arrears by bank transfer after the deductions required by law. A detailed salary structure will be given in your Letter of Appointment. Statutory benefits and the rules on payment of wages are explained in Annexure ${pack.ax.pay}.`]],
    ...(o.terms ? [["Other terms", [o.terms]] as [string, string[]]] : []),
    ...rest.slice(1),
  ];
  return {
    ...head(co), to: name, toLine: o.position, toAddress: "", date, type: "offer", title: "Offer of Employment", subject: `Offer of employment as ${o.position}`, ref, confidential: true, form: "letter", initials: true,
    blocks: [
      { k: "p", t: `Dear ${c.first},` },
      { k: "p", t: `Further to your application and the discussions you have had with us, we are pleased to offer you employment with ${company} on the terms and conditions set out in this letter and its annexures. ${company} builds billing, inventory and GST compliance software used by medical stores and pharmaceutical distributors across India.` },
      { k: "facts", title: "Terms at a glance", rows: [["Position", o.position], ["Employment type", o.empType], ["Work mode", o.mode], ["Date of joining", longDate(o.joinDate)], ["Compensation", o.pay], ["Probation", `${PROBATION_MONTHS} months`], ["Notice period", `One (1) month (${NOTICE_DAYS} days), either side`]] },
      { k: "p", t: "This letter consists of the terms and conditions below and the annexures listed in the following table, all of which form part of the offer." },
      pack.contents(list.length),
      ...clauses(list),
      { k: "p", t: `Acceptance. Please confirm your acceptance by signing Annexure ${pack.ax.accept} and returning a signed copy of this letter, or by replying to the email that accompanies it, within ${OFFER_VALID_DAYS} days, that is by ${longDate(plusDays(on, OFFER_VALID_DAYS))}. If we do not receive your acceptance by then, this offer will lapse.` },
      { k: "p", t: `We look forward to welcoming you to ${company}.` },
      { k: "p", t: "Yours sincerely," },
      { k: "sign", boxes: [companySign(company, o.by || "Authorised Signatory")] },
      ...pack.blocks,
    ],
  };
}
