import "server-only";
// Electronic signature of an offer letter by the candidate, and the hire that follows.
//
// HR sends the prepared offer for signature: the candidate gets an email with the letter attached and a private link (only a hash of it is
// stored). On the link the candidate reads the letter, verifies their email with a one-time code, enters their full name, mobile, the place
// of signing and their live location, signs (typed or drawn) and agrees to sign electronically. The signature goes into the letter, a
// certificate of electronic signature with the audit trail is added, and the signed PDF is kept. The employee record and account are then
// created from the offer (employee ID, official email, temporary password), and the new employee is emailed the welcome with the signed
// letter. If the record can't be created (say, the mobile is already in use), the signature stands and HR is told why, to fix and retry.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { mailEnabled, sendMail } from "@/server/mail";
import { hit } from "@/server/ratelimit";
import { hashCode, newCode, sameHash } from "@/server/otp";
import { MOBILE_RE, digits } from "../constants";
import { audit, holders, loadSettings, need, notify, type Me } from "./auth";
import { EMP_TYPES } from "./constants";
import { buildCandidateOffer, istTime, OFFER_VALID_DAYS, type Letter, type OfferSigned, type OfferTerms } from "./letters";
import { companyOf, letterPdf } from "./letters-server";
import { offerSignCodeMail, offerSignMail, offerSignedHrNote } from "./mails";
import { insertEmployee, newEmployeeSchema } from "./people";

/** The offer fields HR fills in Recruitment, including what the employee record needs once the candidate signs. */
export type OfferFields = OfferTerms & { dept?: string; ctc?: number; role?: "employee" | "sales"; location?: string; sentOn?: string };

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const CODE_SCOPE = "offer-sign";
const CODE_MINUTES = 10;
const VERIFIED_MINUTES = 60; // a verified email is good for this long before signing
/** The public signing page for a token. APP_URL when set, else the address HR is using. */
export const signLink = (token: string, origin = "") => `${(process.env.APP_URL?.trim() || origin).replace(/\/+$/, "")}/offer/sign/${token}`;
/** "s****a@gmail.com" */
export const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@)/, (_, a: string, mid: string, b: string) => a + "*".repeat(Math.min(6, Math.max(2, mid.length))) + b);
type Trail = { at: string; event: string; ip?: string | null; detail?: string }[];
const push = (t: unknown, e: Trail[number]): Prisma.InputJsonValue => [...(Array.isArray(t) ? (t as Trail) : []), e].slice(-60) as unknown as Prisma.InputJsonValue;

/** HR: sends the prepared offer for e-signature (or sends it again, which starts afresh and cancels the old link). */
export async function sendForSignature(me: Me, candidateId: string, origin = "") {
  need(me, "recruitment");
  const c = await db.hrCandidate.findUnique({ where: { id: candidateId }, include: { signing: true } });
  if (!c?.offer) throw new UserError("Prepare the offer letter first.");
  const o = c.offer as unknown as OfferFields;
  if (c.signing?.status === "signed") throw new UserError("The candidate has already signed this offer.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new UserError("Add the candidate’s email address first: the signing link and the code are sent there.");
  if (!o.dept || !(Number(o.ctc) > 0)) throw new UserError("Edit the offer and add the department and annual CTC first. They are needed to create the employee record when the candidate signs.");
  if (!process.env.APP_URL?.trim() && !origin) throw new UserError("Set APP_URL on the server so the signing link can be made.");
  const token = randomBytes(32).toString("base64url"), now = new Date();
  const co = await companyOf(), letter = buildCandidateOffer(c.name, o, co), pdf = await letterPdf(letter);
  const data = {
    tokenHash: sha256(token), status: "sent", email: c.email, docHash: sha256(pdf), sentById: me.id, sentByName: me.name, sentAt: now, expiresAt: new Date(now.getTime() + OFFER_VALID_DAYS * 86400_000),
    viewedAt: null, otpHash: null, otpExpiresAt: null, otpTries: 0, otpVerifiedAt: null, hireError: "", trail: [{ at: now.toISOString(), event: "Sent for signature", detail: `by ${me.name} to ${c.email}` }] as Prisma.InputJsonValue,
  };
  await db.hrOfferSign.upsert({ where: { candidateId }, update: data, create: { candidateId, ...data } });
  const url = signLink(token, origin);
  let emailed = false;
  if (mailEnabled()) {
    await sendMail({ to: c.email, ...offerSignMail({ name: c.name, org: letter.company, title: letter.title, url, validDays: OFFER_VALID_DAYS }), attachments: [{ filename: "Offer-letter.pdf", content: Buffer.from(pdf), contentType: "application/pdf" }] });
    emailed = true;
  }
  await db.hrCandidate.update({ where: { id: candidateId }, data: { stage: "offer", offer: { ...o, sentOn: now.toISOString().slice(0, 10) } as unknown as Prisma.InputJsonValue } });
  await audit(me, "Offer sent for e-signature", `${c.name} · ${c.email}`);
  return { url, emailed, to: c.email };
}

/** HR: where the e-signature stands for a candidate. */
export async function signingStatus(me: Me, candidateId: string) {
  need(me, "recruitment");
  const s = await db.hrOfferSign.findUnique({ where: { candidateId } });
  if (!s) return null;
  const emp = s.staffId ? await db.staffUser.findUnique({ where: { id: s.staffId }, select: { empNo: true, email: true } }) : null;
  return {
    status: s.status === "signed" ? "signed" : s.expiresAt < new Date() ? "expired" : s.status, sentAt: s.sentAt.toISOString(), viewedAt: s.viewedAt?.toISOString() ?? null, signedAt: s.signedAt?.toISOString() ?? null,
    expiresAt: s.expiresAt.toISOString(), email: s.email, place: s.place, lat: s.lat, lng: s.lng, signer: s.signerName, empNo: emp?.empNo ?? null, officialEmail: emp?.email ?? null, hireError: s.hireError,
  };
}
/** HR: the signed PDF. */
export async function signedOfferPdf(me: Me, candidateId: string) {
  need(me, "recruitment");
  const s = await db.hrOfferSign.findUnique({ where: { candidateId }, select: { signedPdf: true, signerName: true } });
  if (!s?.signedPdf) throw new UserError("The offer hasn’t been signed yet.");
  return { pdf: new Uint8Array(s.signedPdf), name: s.signerName };
}

// ── The candidate's side (by token, no account) ─────────────────────────────────────────────

async function byToken(token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw new UserError("This signing link isn’t valid. Open the link from your email.");
  const s = await db.hrOfferSign.findUnique({ where: { tokenHash: sha256(token) }, include: { candidate: true } });
  if (!s || s.status === "cancelled") throw new UserError("This signing link isn’t valid any more. If HR sent you a newer email, use the link in that one.");
  return s;
}
const offerOf = (s: { candidate: { offer: unknown } }) => s.candidate.offer as unknown as OfferFields;

export type SigningView = { state: "open" | "signed" | "expired"; name: string; phone: string; email: string; company: string; verified: boolean; expiresAt: string; signedAt: string | null; empNo: string | null; letter: Letter };
/** What the signing page shows. Opening it the first time is recorded. */
export async function signingView(token: unknown, ip: string | null): Promise<SigningView> {
  const s = await byToken(token), now = new Date(), co = await companyOf();
  const signed = s.status === "signed", expired = !signed && s.expiresAt < now;
  if (!signed && !expired && !s.viewedAt) await db.hrOfferSign.update({ where: { id: s.id }, data: { viewedAt: now, status: "viewed", trail: push(s.trail, { at: now.toISOString(), event: "Opened", ip }) } });
  const emp = s.staffId ? await db.staffUser.findUnique({ where: { id: s.staffId }, select: { empNo: true } }) : null;
  return {
    state: signed ? "signed" : expired ? "expired" : "open", name: s.candidate.name, phone: s.candidate.phone, email: maskEmail(s.email), company: co.name || "Medoro",
    verified: !!s.otpVerifiedAt && now.getTime() - s.otpVerifiedAt.getTime() < VERIFIED_MINUTES * 60_000, expiresAt: s.expiresAt.toISOString(), signedAt: s.signedAt?.toISOString() ?? null, empNo: emp?.empNo ?? null,
    letter: buildCandidateOffer(s.candidate.name, offerOf(s), co),
  };
}
const open = (s: { status: string; expiresAt: Date }) => {
  if (s.status === "signed") throw new UserError("You have already signed this offer.");
  if (s.expiresAt < new Date()) throw new UserError("This offer has lapsed. Please contact HR for a new link.");
};

/** Emails the candidate a 6-digit code to confirm it's them. */
export async function sendSignCode(token: unknown, ip: string | null) {
  const s = await byToken(token);
  open(s);
  if (!mailEnabled()) throw new UserError("Email isn’t available right now. Please contact HR.");
  const per = await hit({ name: "offerSignCode", limit: 5, windowSec: 900, what: "codes" }, s.id), perIp = ip ? await hit({ name: "offerSignCodeIp", limit: 20, windowSec: 3600, what: "codes" }, ip) : { ok: true };
  if (!per.ok || !perIp.ok) throw new UserError("Too many codes requested. Please wait a few minutes and try again.");
  const code = newCode(), now = new Date();
  await db.hrOfferSign.update({ where: { id: s.id }, data: { otpHash: hashCode(`${CODE_SCOPE}:${s.id}`, code), otpExpiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000), otpTries: 0, trail: push(s.trail, { at: now.toISOString(), event: "Code sent", ip, detail: s.email }) } });
  await sendMail({ to: s.email, ...offerSignCodeMail({ name: s.candidate.name, code, org: (await loadSettings()).company.name || "Medoro", minutes: CODE_MINUTES }) });
  return { to: maskEmail(s.email) };
}
export async function verifySignCode(token: unknown, raw: unknown, ip: string | null) {
  const s = await byToken(token);
  open(s);
  const code = String(raw ?? "").replace(/\D/g, "");
  if (!s.otpHash || !s.otpExpiresAt || s.otpExpiresAt < new Date()) throw new UserError("That code has expired. Ask for a new one.");
  if (s.otpTries >= 5) throw new UserError("Too many wrong codes. Ask for a new code.");
  if (code.length !== 6 || !sameHash(hashCode(`${CODE_SCOPE}:${s.id}`, code), s.otpHash)) {
    await db.hrOfferSign.update({ where: { id: s.id }, data: { otpTries: { increment: 1 } } });
    throw new UserError("That code isn’t right. Check the email and try again.");
  }
  const now = new Date();
  await db.hrOfferSign.update({ where: { id: s.id }, data: { otpHash: null, otpVerifiedAt: now, trail: push(s.trail, { at: now.toISOString(), event: "Email verified", ip }) } });
  return { verified: true };
}

const PNG_MAGIC = "iVBORw0KGgo";
export const signSchema = z.object({
  name: z.string().trim().min(3, "Enter your full name.").max(80),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter your 10-digit mobile number."),
  place: z.string().trim().min(2, "Enter the place (city or town) where you are signing.").max(80),
  lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).max(1_000_000),
  type: z.enum(["typed", "drawn"]),
  png: z.string().transform((v) => v.replace(/^data:image\/png;base64,/, "")).refine((v) => v.startsWith(PNG_MAGIC) && v.length < 400_000 && /^[A-Za-z0-9+/=]+$/.test(v), "Sign in the box first."),
  consent: z.literal(true, { error: "Tick the box to agree to sign electronically." }),
});

/** The candidate signs: the signed letter is made and kept, and the employee record is created. */
export async function signOffer(token: unknown, raw: unknown, ctx: { ip: string | null; userAgent: string }) {
  const s = await byToken(token);
  open(s);
  if (!s.otpVerifiedAt || Date.now() - s.otpVerifiedAt.getTime() > VERIFIED_MINUTES * 60_000) throw new UserError("Verify your email with the code first.");
  const i = signSchema.parse(raw);
  if (!s.viewedAt) throw new UserError("Open the offer letter first.");
  // Only one signature: the status moves on before the slow part, so a double submit can't sign twice.
  const claim = await db.hrOfferSign.updateMany({ where: { id: s.id, status: { in: ["sent", "viewed"] } }, data: { status: "signing" } });
  if (!claim.count) throw new UserError("This offer is already being signed. Refresh the page.");
  try {
    const now = new Date(), co = await companyOf(), o = offerOf(s);
    const signed: OfferSigned = {
      name: i.name, phone: i.phone, email: s.email, place: i.place, png: i.png, type: i.type, at: now.toISOString(), ip: ctx.ip ?? "", userAgent: ctx.userAgent.slice(0, 300),
      lat: i.lat, lng: i.lng, accuracy: i.accuracy, sentAt: s.sentAt.toISOString(), viewedAt: s.viewedAt.toISOString(), otpAt: s.otpVerifiedAt.toISOString(), docHash: s.docHash, sentBy: s.sentByName,
    };
    const pdf = await letterPdf(buildCandidateOffer(s.candidate.name, o, co, signed));
    await db.hrOfferSign.update({
      where: { id: s.id },
      data: {
        status: "signed", signedAt: now, signerName: i.name, signerPhone: i.phone, place: i.place, lat: i.lat, lng: i.lng, accuracy: i.accuracy, sigType: i.type, sigPng: Buffer.from(i.png, "base64"),
        ip: ctx.ip, userAgent: signed.userAgent, signedHash: sha256(pdf), signedPdf: Buffer.from(pdf),
        trail: push(s.trail, { at: now.toISOString(), event: "Signed", ip: ctx.ip, detail: `${i.place} (${i.lat.toFixed(4)}, ${i.lng.toFixed(4)})` }),
      },
    });
  } catch (e) {
    await db.hrOfferSign.update({ where: { id: s.id }, data: { status: s.viewedAt ? "viewed" : "sent" } });
    throw e;
  }
  await db.hrCandidate.update({ where: { id: s.candidateId }, data: { stage: "hired", ...(s.candidate.phone ? {} : { phone: i.phone }) } });
  await audit({ id: null, name: i.name }, "Offer e-signed", `${s.candidate.name} · ${i.place} · ${ctx.ip ?? "no IP"}`);
  const hire = await hireFromOffer(s.id);
  return { empNo: hire.empNo, mailed: hire.mailed };
}

/**
 * Creates the employee from a signed offer (once): employee ID, official email and account, and the welcome email with the signed letter.
 * Never throws: a problem is kept on the record and sent to HR, who can fix it and retry.
 */
export async function hireFromOffer(signId: string): Promise<{ empNo: string | null; mailed: boolean; error: string }> {
  const s = await db.hrOfferSign.findUnique({ where: { id: signId }, include: { candidate: { include: { job: true } } } });
  if (!s || s.status !== "signed") return { empNo: null, mailed: false, error: "The offer isn’t signed." };
  if (s.staffId) return { empNo: (await db.staffUser.findUnique({ where: { id: s.staffId }, select: { empNo: true } }))?.empNo ?? null, mailed: false, error: "" };
  const o = offerOf(s), hr = await holders("recruitment");
  try {
    const i = newEmployeeSchema.parse({
      name: s.candidate.name, personalEmail: s.email, phone: s.signerPhone || s.candidate.phone, dept: o.dept || s.candidate.job?.dept || "", designation: o.position,
      role: o.role === "sales" ? "sales" : "employee", empType: (EMP_TYPES as readonly string[]).includes(o.empType) ? o.empType : "Full-time", joinDate: o.joinDate, ctc: Number(o.ctc) || 0,
      location: o.location || s.candidate.job?.location || "", managerId: null, incentivePct: 0, homeState: "", emailUser: "",
    });
    const by = { id: s.sentById, name: s.sentByName || "HR" };
    const r = await insertEmployee(by, i, {
      attachments: s.signedPdf ? [{ filename: "Offer-letter-signed.pdf", content: Buffer.from(s.signedPdf), contentType: "application/pdf" }] : [],
      note: `Thank you for accepting our offer. Your signed offer letter is attached for your records. Your joining date is ${o.joinDate.split("-").reverse().join("/")}.`,
    });
    await db.hrOfferSign.update({ where: { id: s.id }, data: { staffId: r.id, hireError: "", trail: push(s.trail, { at: new Date().toISOString(), event: "Employee created", detail: `${r.empNo} · ${r.email}` }) } });
    await notify(hr, offerSignedHrNote({ name: s.candidate.name, empNo: r.empNo, place: s.place }), "recruit");
    return { empNo: r.empNo, mailed: r.mailed, error: "" };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? "Check the offer details." : e instanceof UserError ? e.message : "Something went wrong.";
    if (!(e instanceof z.ZodError) && !(e instanceof UserError)) log.error("hire from signed offer failed", { err: e });
    await db.hrOfferSign.update({ where: { id: s.id }, data: { hireError: msg.slice(0, 300) } });
    await notify(hr, `${s.candidate.name} signed the offer, but the employee record couldn’t be created: ${msg} Open Recruitment to fix and retry.`, "recruit");
    return { empNo: null, mailed: false, error: msg };
  }
}
/** HR: retries creating the employee after fixing what stopped it. */
export async function retryHire(me: Me, candidateId: string) {
  need(me, "recruitment");
  need(me, "employees");
  const s = await db.hrOfferSign.findUnique({ where: { candidateId } });
  if (!s || s.status !== "signed") throw new UserError("The offer hasn’t been signed yet.");
  const r = await hireFromOffer(s.id);
  if (r.error) throw new UserError(r.error);
  await audit(me, "Employee created from signed offer", `${r.empNo}`);
  return r;
}
export { istTime };
