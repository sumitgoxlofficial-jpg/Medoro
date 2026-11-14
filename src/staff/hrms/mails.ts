import { compose } from "@/server/mail-template";

/** Wording of every email HRMS sends to an employee or candidate. Plain, courteous, one look (see src/server/mail-template.ts). */
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";
const signoff = (org: string) => ({ name: "Human Resources", org });
const loginUrl = () => (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/staff/employee` : "");

export function welcomeMail(i: { name: string; empNo: string; email: string; temp: string; org: string }) {
  const url = loginUrl();
  const subject = `Welcome to ${i.org}: your employee account is ready`;
  const m = compose({
    greeting: `Dear ${first(i.name)},`,
    blocks: [
      { p: `Welcome to ${i.org}. We are pleased to have you on the team, and your employee profile is now ready.` },
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
