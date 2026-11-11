// Employment letters, written from an employee's HR record. Pure functions shared by the server (PDF, email) and the
// screens (preview, print). Nothing here talks to the database.

export const LETTER_TYPES = [
  { id: "offer", label: "Offer letter" }, { id: "appointment", label: "Appointment letter" }, { id: "nda", label: "Non-disclosure agreement" },
  { id: "experience", label: "Experience letter" }, { id: "relieving", label: "Relieving letter" },
] as const;
export type LetterType = (typeof LETTER_TYPES)[number]["id"];
export const JOINING_LETTERS: LetterType[] = ["offer", "appointment", "nda"]; // what a new joiner reads and accepts
export const EXIT_LETTERS: LetterType[] = ["experience", "relieving"]; // HR only, with a last working day
export const letterLabel = (t: string) => LETTER_TYPES.find((l) => l.id === t)?.label ?? t;

export type LetterPerson = {
  empNo: string; name: string; email: string; desig: string; dept: string; empType: string; location: string; manager: string;
  joinDate: string | null; ctc: number; sales: boolean; incentivePct: number;
};
export type LetterCompany = { name: string; address: string };
export type Letter = {
  type: string; title: string; ref: string; date: string; to: string; toLine: string; paras: string[]; company: string; address: string; signoff: string[];
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
/** "2026-11-11" or a date → "11 November 2026" (India). */
export const longDate = (d: string | Date) => (typeof d === "string" ? new Date(d.slice(0, 10) + "T00:00:00Z") : d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: typeof d === "string" ? "UTC" : "Asia/Kolkata" });
const refOf = (kind: string, empNo: string) => `MDR/HR/${kind}/${empNo.replace(/\D/g, "") || empNo}`;
const SIGN = ["Human Resources", "Medoro"];

export function buildLetter(type: LetterType, p: LetterPerson, co: LetterCompany, opts: { lastDay?: string; today?: Date } = {}): Letter {
  const first = p.name.trim().split(/\s+/)[0], monthly = Math.round(p.ctc / 12), now = opts.today ?? new Date();
  const join = p.joinDate ? longDate(p.joinDate) : "the agreed date", today = longDate(now);
  const company = co.name || "Medoro";
  const base = { to: p.name, toLine: [p.desig, p.dept].filter(Boolean).join(", "), date: today, company, address: co.address, signoff: SIGN };
  const incentive = p.sales && p.incentivePct > 0;
  const pay = p.ctc > 0 ? `Your annual cost to company (CTC) will be ${inr(p.ctc)}, paid monthly at about ${inr(monthly)} before statutory deductions.` : "Your compensation will be shared with you in writing by HR.";
  if (type === "offer") return {
    ...base, type, title: "Offer of Employment", ref: refOf("OFR", p.empNo),
    paras: [
      `Dear ${first},`,
      `We are pleased to offer you the position of ${p.desig || "team member"}${p.dept ? ` in the ${p.dept} team` : ""} at ${company}, the billing, stock and GST platform for Indian medical stores.`,
      `Your employment will be ${(p.empType || "full-time").toLowerCase()}${p.location ? `, based at ${p.location}` : ""}${p.manager ? `, reporting to ${p.manager}` : ""}. Your expected date of joining is ${join}.`,
      pay,
      ...(incentive ? [`In addition, you will earn a sales incentive of ${p.incentivePct}% on the annual subscription value of every pharmacy you win, calculated monthly and paid with the next salary.`] : []),
      "Please accept this offer within 7 days by signing in to the HRMS and accepting your joining documents. This offer is subject to verification of the documents you submit.",
      `We look forward to having you at ${company}.`,
    ],
  };
  if (type === "appointment") return {
    ...base, type, title: "Letter of Appointment", ref: refOf("APT", p.empNo),
    paras: [
      `Dear ${first},`,
      `Further to your acceptance of our offer, we are pleased to appoint you as ${p.desig || "team member"}${p.dept ? `, ${p.dept}` : ""}, with effect from ${join}. Your employee ID is ${p.empNo} and your official email is ${p.email}.`,
      "Probation: six months from the date of joining. Confirmation will be communicated in writing.",
      p.ctc > 0 ? `Compensation: annual CTC of ${inr(p.ctc)} (${inr(monthly)} per month), covering basic pay, HRA and allowances as per the salary structure on the HRMS. PF, ESI and professional tax apply as per law.` : "Compensation: as communicated by HR and shown on your payslips. PF, ESI and professional tax apply as per law.",
      ...(incentive ? [`Sales incentive: ${p.incentivePct}% of the annual subscription value of pharmacies won and activated in a month, paid with the following month’s salary. Leads reversed within 30 days are adjusted.`] : []),
      "Leave and attendance follow the company policy published on the HRMS. Either side may end the employment with 30 days’ written notice, or pay in lieu of notice.",
      "You will keep to the company’s code of conduct, data-protection and confidentiality rules, including the non-disclosure agreement you accept with this letter.",
    ],
  };
  if (type === "nda") return {
    ...base, type, title: "Non-Disclosure Agreement", ref: refOf("NDA", p.empNo),
    paras: [
      `This agreement is made on ${today} between ${company} (“the Company”) and ${p.name}, ${p.empNo} (“the Employee”).`,
      "Confidential information includes pharmacy customer records, invoices, stock and batch data, prescriber details, pricing, source code, product roadmaps and anything shared by partner pharmacies or distributors.",
      "The Employee will use confidential information only to perform their duties, will not copy or share it outside the Company, and will handle personal data in line with the Digital Personal Data Protection Act, 2023.",
      "For 12 months after leaving, the Employee will not solicit the Company’s customers, partner pharmacies or employees for a competing business.",
      "These obligations continue for two years after employment ends. A breach may lead to disciplinary action and legal remedies.",
    ],
  };
  const last = opts.lastDay ? longDate(opts.lastDay) : today;
  if (type === "experience") return {
    ...base, type, title: "Experience Certificate", ref: refOf("EXP", p.empNo),
    paras: [
      "To whom it may concern,",
      `This is to certify that ${p.name} (employee ID ${p.empNo}) worked with ${company} as ${p.desig || "a team member"}${p.dept ? ` in the ${p.dept} team` : ""} from ${join} to ${last}.`,
      "During this period we found their work and conduct satisfactory. They have left the company on their own accord and are free of any pending obligation towards us as on the date of this letter.",
      `We wish ${first} every success in the future.`,
    ],
  };
  return {
    ...base, type: "relieving", title: "Relieving Letter", ref: refOf("REL", p.empNo),
    paras: [
      `Dear ${first},`,
      `With reference to your resignation, you are relieved from your duties as ${p.desig || "team member"}${p.dept ? `, ${p.dept}` : ""}, at the close of business on ${last}.`,
      "Your full and final settlement, including pending salary, leave encashment where applicable and statutory dues, will be processed with the next payroll after clearance of company assets and access.",
      "Please continue to honour the confidentiality obligations in the non-disclosure agreement you accepted at joining.",
      `Thank you for your contribution to ${company}. We wish you well.`,
    ],
  };
}

export type OfferTerms = { position: string; empType: string; pay: string; joinDate: string; mode: string; terms: string; by: string; on: string };
/** The offer HR prepares for a candidate in Recruitment. */
export function buildCandidateOffer(name: string, o: OfferTerms, co: LetterCompany): Letter {
  const first = name.trim().split(/\s+/)[0], company = co.name || "Medoro";
  return {
    type: "offer", title: "Offer of Employment", ref: `MDR/HR/OFR/${o.on.replace(/-/g, "")}`, date: longDate(o.on), to: name, toLine: o.position, company, address: co.address, signoff: [o.by || "Human Resources", "Medoro"],
    paras: [
      `Dear ${first},`,
      `We are pleased to offer you the position of ${o.position} (${o.empType.toLowerCase()}, ${o.mode.toLowerCase()}) at ${company}, starting ${longDate(o.joinDate)}, at ${o.pay}.`,
      ...(o.terms ? [o.terms] : []),
      "Please accept this offer within 7 days by replying to this email. This offer is subject to verification of the documents you submit.",
      `We look forward to having you at ${company}.`,
    ],
  };
}
