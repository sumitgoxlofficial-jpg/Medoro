import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { maskAadhaar, onlyDigits, spacedAadhaar, validAadhaar } from "@/lib/aadhaar";
import { audit, need, notify, type Me } from "./auth";

// Identity verification for every employee: an Aadhaar number and a PAN, each with proof. Aadhaar can be matched
// automatically against the person's own DigiLocker (see digilocker.ts) or checked by HR against an uploaded card; PAN is
// checked by HR against an uploaded card. Numbers are sealed with HOST_KEY and shown masked; HR can open the full
// numbers to compare them with the cards, and each opening is written to the audit log.

export const AADHAAR_DOC = "Aadhaar card", PAN_DOC = "PAN card";

/**
 * Brings the profile's KYC state up to date from what is on file. "Submitted": both numbers given and proof for each
 * (an Aadhaar match through DigiLocker, or an uploaded card, and an uploaded PAN card). "Verified": both proofs checked.
 * Called after anything that can change it: numbers saved, a card uploaded, removed or verified, a DigiLocker match.
 */
export async function refreshKyc(staffId: string) {
  const [p, docs] = await Promise.all([
    db.hrProfile.findUnique({ where: { staffId }, select: { aadhaarLast4: true, panMasked: true, aadhaarVerifiedAt: true, kycSubmittedAt: true, kycVerifiedAt: true } }),
    db.hrDocument.findMany({ where: { staffId, kind: { in: [AADHAAR_DOC, PAN_DOC] } }, orderBy: { createdAt: "desc" }, select: { kind: true, verifiedAt: true } }),
  ]);
  if (!p) return null;
  const aDoc = docs.find((d) => d.kind === AADHAAR_DOC), pDoc = docs.find((d) => d.kind === PAN_DOC); // the latest of each
  const aadhaarProof = !!p.aadhaarVerifiedAt || !!aDoc, aadhaarChecked = !!p.aadhaarVerifiedAt || !!aDoc?.verifiedAt;
  const submitted = !!p.aadhaarLast4 && !!p.panMasked && aadhaarProof && !!pDoc;
  const verified = submitted && aadhaarChecked && !!pDoc?.verifiedAt;
  const now = new Date();
  const data = { kycSubmittedAt: submitted ? p.kycSubmittedAt ?? now : null, kycVerifiedAt: verified ? p.kycVerifiedAt ?? now : null };
  if ((data.kycSubmittedAt === null) !== (p.kycSubmittedAt === null) || (data.kycVerifiedAt === null) !== (p.kycVerifiedAt === null)) await db.hrProfile.update({ where: { staffId }, data });
  return { submitted, verified, justVerified: verified && !p.kycVerifiedAt };
}

const numbers = z.object({
  aadhaar: z.string().transform(onlyDigits).refine((d) => !d || validAadhaar(d), "That Aadhaar number isn’t valid. Check all 12 digits.").default(""),
  pan: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{5}\d{4}[A-Z]$/, "PAN looks wrong (e.g. ABCDE1234F).").default(""),
  consent: z.boolean().default(false),
});
/** The employee gives (or corrects) their Aadhaar and PAN numbers. A blank one keeps what is saved. Needs their consent. */
export async function saveKycNumbers(me: Me, raw: z.input<typeof numbers>) {
  const i = numbers.parse(raw);
  if (!i.aadhaar && !i.pan) throw new UserError("Enter your Aadhaar number or PAN.");
  if (!i.consent) throw new UserError("Tick the box to allow Medoro to use your Aadhaar and PAN to verify you.");
  const h = await db.hrProfile.findUniqueOrThrow({ where: { staffId: me.id }, select: { aadhaarLast4: true } });
  const data: Record<string, unknown> = {};
  if (i.aadhaar) {
    data.aadhaarSealed = new Uint8Array(seal(i.aadhaar)); data.aadhaarLast4 = i.aadhaar.slice(-4);
    // A different number is not what DigiLocker matched, or what HR saw: it has to be verified again.
    if (i.aadhaar.slice(-4) !== h.aadhaarLast4) { data.aadhaarVerifiedAt = null; data.aadhaarVerifiedBy = ""; }
  }
  if (i.pan) { data.panSealed = new Uint8Array(seal(i.pan)); data.panMasked = i.pan.slice(0, 2) + "•••••" + i.pan.slice(-3); }
  await db.hrProfile.update({ where: { staffId: me.id }, data });
  await audit(me, "KYC numbers saved", `${i.aadhaar ? "Aadhaar" : ""}${i.aadhaar && i.pan ? " and " : ""}${i.pan ? "PAN" : ""} · consent given`);
  return refreshKyc(me.id);
}

export type KycState = Awaited<ReturnType<typeof kycState>>;
/** Where someone's KYC stands, for them and for HR. Numbers are masked. */
export async function kycState(staffId: string) {
  const [p, docs] = await Promise.all([
    db.hrProfile.findUnique({ where: { staffId }, select: { aadhaarLast4: true, aadhaarVerifiedAt: true, aadhaarVerifiedBy: true, panMasked: true, kycSubmittedAt: true, kycVerifiedAt: true } }),
    db.hrDocument.findMany({ where: { staffId, kind: { in: [AADHAAR_DOC, PAN_DOC] } }, orderBy: { createdAt: "desc" }, select: { kind: true, verifiedAt: true } }),
  ]);
  const doc = (k: string) => { const d = docs.find((x) => x.kind === k); return d ? (d.verifiedAt ? "verified" as const : "uploaded" as const) : "none" as const; };
  return {
    aadhaar: { masked: maskAadhaar(p?.aadhaarLast4 ?? ""), entered: !!p?.aadhaarLast4, doc: doc(AADHAAR_DOC), digilocker: !!p?.aadhaarVerifiedAt && p.aadhaarVerifiedBy === "DigiLocker", verifiedBy: p?.aadhaarVerifiedAt ? p.aadhaarVerifiedBy : "", verified: !!p?.aadhaarVerifiedAt || doc(AADHAAR_DOC) === "verified" },
    pan: { masked: p?.panMasked ?? "", entered: !!p?.panMasked, doc: doc(PAN_DOC), verified: doc(PAN_DOC) === "verified" },
    submitted: !!p?.kycSubmittedAt, verified: !!p?.kycVerifiedAt,
  };
}
/** Someone's KYC state, for HR (people with the Employees module). */
export async function kycStateFor(me: Me, staffId: string) {
  need(me, "employees");
  return kycState(staffId);
}
/** "verified", "submitted" (waiting for HR) or "missing", for the directory. */
export const kycLabel = (p: { kycSubmittedAt: Date | null; kycVerifiedAt: Date | null } | null | undefined) => (p?.kycVerifiedAt ? "verified" as const : p?.kycSubmittedAt ? "submitted" as const : "missing" as const);

/** HR opens someone's full Aadhaar and PAN to compare with their cards. Every opening is audited. */
export async function revealKyc(me: Me, staffId: string) {
  need(me, "employees");
  const p = await db.hrProfile.findUnique({ where: { staffId }, select: { aadhaarSealed: true, panSealed: true, staff: { select: { empNo: true } } } });
  if (!p) throw new UserError("Employee not found.");
  await audit(me, "KYC numbers opened", p.staff.empNo);
  return { aadhaar: p.aadhaarSealed ? spacedAadhaar(unseal(p.aadhaarSealed).toString()) : "", pan: p.panSealed ? unseal(p.panSealed).toString() : "" };
}

/** Tells the employee their KYC is fully verified. */
export async function notifyVerified(staffId: string) {
  await notify([staffId], "Your Aadhaar and PAN are verified. Thank you.", "profile");
}
