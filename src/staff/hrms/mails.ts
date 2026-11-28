import { compose } from "@/server/mail-template";
import { digestFacts, type DigestStats } from "./ai-hr/digest";

/** Wording of every email HRMS sends to an employee or candidate. Plain, courteous, one look (see src/server/mail-template.ts). */
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";
const signoff = (org: string) => ({ name: "Human Resources", org });
const loginUrl = () => (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/staff/employee` : "");

export function welcomeMail(i: { name: string; empNo: string; email: string; temp: string; org: string; note?: string }) {
  const url = loginUrl();
  const subject = `Welcome to ${i.org}: your employee account is ready`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Welcome to ${i.org}. We are pleased to have you on the team, and your employee profile is now ready.` },
      ...(i.note ? [{ p: i.note }] : []),
      { facts: [["Employee ID", i.empNo], ["Official email", i.email], ["Temporary password", i.temp]] },
      ...(url ? [{ button: { label: "Sign in to your account", url } }] : []),
      { p: "On your first sign-in you will be asked to set a password of your own, complete your personal details and accept your joining documents." },
      { note: "For your security, please change the temporary password straight away and do not share it with anyone." },
      { p: "If you have any trouble signing in, please reply to this email or speak to HR." },
    ],
    signoff: signoff(i.org),
    secure: true,
  }, subject);
  return { subject, ...m };
}

export function otpMail(i: { name: string; code: string; org: string }) {
  const subject = `Your ${i.org} one-time password`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: "Use the one-time password below to sign in to your employee account." },
      { code: i.code, note: "Valid for 10 minutes and can be used once." },
      { p: "After signing in you will be asked to choose a new password." },
      { note: "If you did not request this code, please ignore this email and let HR know. Never share this code with anyone, including people who say they are from Medoro." },
    ],
    signoff: signoff(i.org),
  }, subject);
  return { subject, ...m };
}

/** One or more letters sent to an employee (attached) and shown under My documents. */
export function lettersMail(i: { name: string; labels: string[]; org: string }) {
  const one = i.labels.length === 1;
  const subject = one ? `${cap(i.labels[0])} · ${i.org}` : `Your letters from ${i.org}`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: one ? `Please find your ${i.labels[0]} attached to this email.` : `Please find the following documents attached to this email:\n${i.labels.map((l) => `• ${cap(l)}`).join("\n")}` },
      { p: "You can also read and download them at any time in the HR portal under My documents." },
      { p: "Please review the documents carefully. If anything needs to be corrected, or you have any questions, reply to this email and HR will be glad to help." },
    ],
    signoff: signoff(i.org),
  }, subject);
  return { subject, ...m };
}

export function offerMail(i: { name: string; org: string; title: string; validDays: number }) {
  const subject = `${i.title} · ${i.org}`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Thank you for the time you spent with us during the selection process. We are delighted to offer you a position at ${i.org}, and your offer letter is attached to this email.` },
      { p: `Please read the letter carefully. To accept, kindly reply to this email confirming your acceptance within ${i.validDays} days. If you have any questions about the role or the terms, we will be happy to discuss them.` },
      { p: "We look forward to welcoming you to the team." },
    ],
    signoff: signoff(i.org),
  }, subject);
  return { subject, ...m };
}

/** The offer, with a link to read and sign it electronically. */
export function offerSignMail(i: { name: string; org: string; title: string; url: string; validDays: number }) {
  const subject = `${i.title} · ${i.org}: please review and sign`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Thank you for the time you spent with us during the selection process. We are delighted to offer you a position at ${i.org}. Your offer letter is attached to this email for your records.` },
      { p: `Please read the letter and its annexures carefully, and accept it by signing electronically using the button below. You will be asked to confirm your email with a one-time code, enter your full name, mobile number and the place of signing, allow your browser to share your current location, and then sign.` },
      { button: { label: "Review and sign the offer", url: i.url } },
      { note: `This link is personal to you. Please do not forward it. The offer is open for ${i.validDays} days.` },
      { p: "Once you have signed, your employee ID and the details to sign in to your employee account will be emailed to you. If you have any questions about the role or the terms, please reply to this email." },
    ],
    signoff: signoff(i.org),
  }, subject);
  return { subject, ...m };
}
export function offerSignCodeMail(i: { name: string; code: string; org: string; minutes: number }) {
  const subject = `${i.code} is your code to sign your offer · ${i.org}`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: "Use this code to confirm your email address and sign your offer letter:" },
      { code: i.code, note: `The code is valid for ${i.minutes} minutes.` },
      { p: "If you did not ask for this code, you can ignore this email." },
    ],
    signoff: signoff(i.org),
    secure: true,
  }, subject);
  return { subject, ...m };
}
/** The employee's own copy of a joining letter they have just e-signed. */
export function signedCopyMail(i: { name: string; title: string; org: string }) {
  const subject = `Your signed ${i.title} · ${i.org}`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Thank you for signing your ${i.title}. Your signed copy is attached for your records, with the certificate of electronic signature as its last page.` },
      { p: "You can also download it at any time from My documents in the HRMS." },
    ],
    signoff: signoff(i.org),
  }, subject);
  return { subject, ...m };
}
/** The in-app note to HR when a candidate signs and their employee record is created. */
export const offerSignedHrNote = (i: { name: string; empNo: string; place: string }) => `${i.name} signed the offer${i.place ? ` at ${i.place}` : ""}. Employee ${i.empNo} has been created and the welcome email sent.`;

/** Sent straight after someone applies on the careers page. */
export function applicationMail(i: { name: string; org: string; title: string; dept: string; location: string; ref: string; statusUrl: string }) {
  const subject = `Thank you for your interest in the ${i.title} role at ${i.org}`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Thank you for your interest in the ${i.title} role at ${i.org}. We have received your application, and we truly appreciate the time you took to apply.` },
      { facts: [["Role", i.title], ["Team", i.dept], ["Location", i.location], ["Application reference", i.ref]] },
      { p: "Our hiring team reviews every application carefully. If your profile matches what we are looking for, we will contact you by email or phone to arrange the next steps, usually within 7 to 10 working days." },
      ...(i.statusUrl ? [{ button: { label: "Track your application", url: i.statusUrl } }] : []),
      { note: "Medoro never asks for any payment at any stage of hiring. If anyone asks you for money in Medoro's name, please do not pay and let us know." },
      { p: "We wish you the very best, and thank you once again for considering a career with us." },
    ],
    signoff: { name: "Talent Acquisition Team", org: i.org },
  }, subject);
  return { subject, ...m };
}

/** The sign-in code a job seeker asks for on the careers page. */
export function applicantCodeMail(i: { code: string; org: string }) {
  const subject = `${i.code} is your ${i.org} careers sign-in code`;
  const m = compose({
    greeting: "Hello,",
    blocks: [
      { p: `Use this code to sign in on the ${i.org} careers page, apply for jobs and track your applications.` },
      { code: i.code, note: "Valid for 10 minutes and can be used once." },
      { note: "If you did not ask for this code, you can ignore this email. Never share this code with anyone." },
    ],
    signoff: { name: "Talent Acquisition Team", org: i.org },
  }, subject);
  return { subject, ...m };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The AI HR Assistant's weekly summary to HR: counts only, no names or conversation text. */
export function aiHrDigestMail(i: { name: string; org: string; week: string; stats: DigestStats }) {
  const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
  const from = new Date(`${i.week}T00:00:00Z`), to = new Date(from.getTime() - 86400_000), start = new Date(from.getTime() - 7 * 86400_000);
  const d = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const subject = `AI HR Assistant: weekly summary (${d(start)} to ${d(to)})`;
  const s = i.stats;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Here is what the AI HR Assistant handled in the last seven days. Every number is counted from the HRMS records.` },
      { facts: digestFacts(s) },
      ...(s.urgentOpen ? [{ note: `${s.urgentOpen} urgent item${s.urgentOpen === 1 ? " is" : "s are"} waiting for HR. Please review them first.` }] : []),
      ...(s.unclear ? [{ p: "Some answers weren’t understood. Review them under Escalations & review, and teach the assistant what they mean." }] : []),
      ...(base ? [{ button: { label: "Open the AI HR Assistant", url: `${base}/staff/hrms/aihr?tab=escalations` } }] : []),
      { note: "You receive this because you manage attendance and leave. A super admin can turn it off in AI HR Assistant → Settings." },
    ],
    signoff: signoff(i.org),
  }, subject);
  return { subject, ...m };
}
