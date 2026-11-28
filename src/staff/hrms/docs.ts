import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { UserError } from "@/server/action";
import { ALLOWED, MAX_BYTES, MAX_LABEL, getObject, putObject, sniff } from "@/server/storage";
import { audit, can, holders, need, notify, type Me } from "./auth";
import { DOC_KINDS } from "./constants";
import { AADHAAR_DOC, PAN_DOC, notifyVerified, refreshKyc } from "./kyc";

// Employee documents (identity, address, certificates). The employee uploads; HR opens and marks them verified.
// Files go through the normal file storage and open only for their owner and people with the Employees module.

const MAX_DOCS = 30;
/** Reminders go out this many days before a document expires, then on the day. */
export const EXPIRY_WARN_DAYS = [30, 7] as const;
const expiryState = (e: string | null, today = todayISO()) => (!e ? "" : e < today ? "expired" : e <= addDays(today, EXPIRY_WARN_DAYS[0]) ? "soon" : "valid");
const row = (d: { id: string; kind: string; name: string; verifiedAt: Date | null; createdAt: Date; expiresOn: Date | null }) => {
  const expiresOn = d.expiresOn ? isoOf(d.expiresOn) : null;
  return { id: d.id, kind: d.kind, name: d.name, verified: !!d.verifiedAt, at: d.createdAt.toISOString(), expiresOn, expiry: expiryState(expiresOn) };
};
const expiryInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the expiry date.").nullable();
function checkExpiry(e: string | null) {
  if (e && e < todayISO()) throw new UserError("That date has passed: the document has already expired. Upload a valid one.");
  if (e && e > addDays(todayISO(), 365 * 30)) throw new UserError("Check the expiry date: it is more than 30 years away.");
  return e ? dateOnly(e) : null;
}

export async function uploadDoc(me: Me, form: FormData) {
  const kind = z.enum(DOC_KINDS).parse(form.get("kind"));
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new UserError("Choose a file to upload.");
  const ext = ALLOWED[file.type as keyof typeof ALLOWED];
  if (!ext) throw new UserError("Upload a PDF, JPG or PNG.");
  if (file.size > MAX_BYTES) throw new UserError(`The file is too large (limit ${MAX_LABEL}).`);
  if ((await db.hrDocument.count({ where: { staffId: me.id } })) >= MAX_DOCS) throw new UserError(`You can keep up to ${MAX_DOCS} documents. Remove one first.`);
  const rawExp = String(form.get("expiresOn") ?? "").trim();
  const expiresOn = checkExpiry(rawExp ? expiryInput.parse(rawExp) : null);
  // The browser's file type is only a claim: the bytes must really be that kind of file.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (sniff(bytes) !== file.type) throw new UserError("That file isn’t really a PDF, JPG or PNG. Upload the original file.");
  const key = `_hrms/docs/${randomUUID()}.${ext}`;
  await putObject(key, bytes, file.type);
  await db.hrDocument.create({ data: { staffId: me.id, kind, name: file.name.replace(/[^\w.\- ]/g, "").slice(0, 80) || `document.${ext}`, key, expiresOn } });
  if (kind === AADHAAR_DOC || kind === PAN_DOC) await db.hrProfile.updateMany({ where: { staffId: me.id }, data: { kycNote: "" } });
  await refreshKyc(me.id);
  await notify((await holders("employees")).filter((x) => x !== me.id), `${me.name} uploaded a document: ${kind}.`, "hremployees");
}
export async function myDocs(staffId: string) {
  return (await db.hrDocument.findMany({ where: { staffId }, orderBy: { createdAt: "desc" } })).map(row);
}
/** Someone's documents, for HR. */
export async function employeeDocs(me: Me, staffId: string) {
  need(me, "employees");
  return myDocs(staffId);
}
/** The owner can remove a document until HR has verified it; HR can remove any. The row goes; the stored file is left to storage clean-up. */
export async function removeDoc(me: Me, id: string) {
  const d = await db.hrDocument.findUnique({ where: { id } });
  if (!d || (d.staffId !== me.id && !can(me, "employees"))) throw new UserError("Document not found.");
  if (d.verifiedAt && !can(me, "employees")) throw new UserError("HR has verified this document. Ask HR to remove it.");
  await db.hrDocument.delete({ where: { id } });
  await refreshKyc(d.staffId);
  if (d.staffId !== me.id) await audit(me, "Employee document removed", `${d.staffId} · ${d.kind}`);
}
export async function verifyDoc(me: Me, id: string, ok: boolean) {
  need(me, "employees");
  const d = await db.hrDocument.findUnique({ where: { id } });
  if (!d) throw new UserError("Document not found.");
  if (d.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to verify your own document.");
  await db.hrDocument.update({ where: { id }, data: { verifiedBy: ok ? me.id : null, verifiedAt: ok ? new Date() : null } });
  const k = await refreshKyc(d.staffId);
  if (k?.justVerified) await notifyVerified(d.staffId);
  else if (ok) await notify([d.staffId], `HR verified your document: ${d.kind}.`, "profile");
  await audit(me, ok ? "Employee document verified" : "Employee document unverified", `${d.staffId} · ${d.kind}`);
}
/**
 * HR found something wrong with a document (blurred, wrong person, number doesn't match): it goes back to the employee
 * with the reason. The upload is removed, so an Aadhaar or PAN proof has to be sent again; the employee is told in the
 * HRMS and sees the reason on their Aadhaar & PAN step.
 */
export async function rejectDoc(me: Me, id: string, rawReason: string) {
  need(me, "employees");
  const reason = String(rawReason ?? "").trim().slice(0, 300);
  if (!reason) throw new UserError("Say what is wrong, so the employee can fix it.");
  const d = await db.hrDocument.findUnique({ where: { id } });
  if (!d) throw new UserError("Document not found.");
  if (d.staffId === me.id && me.role !== "admin") throw new UserError("Someone else has to check your own document.");
  await db.hrDocument.delete({ where: { id } });
  const kyc = d.kind === AADHAAR_DOC || d.kind === PAN_DOC;
  if (kyc) await db.hrProfile.updateMany({ where: { staffId: d.staffId }, data: { kycNote: `${d.kind}: ${reason}` } });
  await refreshKyc(d.staffId);
  await notify([d.staffId], `HR sent back your ${d.kind}. Reason: ${reason.replace(/[.\s]+$/, "")}. Upload it again under My profile → Aadhaar & PAN.`, "profile");
  await audit(me, "Employee document sent back", `${d.staffId} · ${d.kind} · ${reason}`);
}
/** The file itself, for its owner and people with the Employees module. HR opening someone's document is audited. */
export async function docFile(me: Me, id: string) {
  const d = await db.hrDocument.findUnique({ where: { id } });
  if (!d || (d.staffId !== me.id && !can(me, "employees"))) return null;
  const bytes = await getObject(d.key);
  if (!bytes) return null;
  const ext = d.key.split(".").pop()!;
  if (d.staffId !== me.id) await audit(me, "Employee document opened", `${d.staffId} · ${d.kind}`);
  return { bytes, type: Object.entries(ALLOWED).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream", name: d.name };
}

/** The owner or HR sets or clears when a document expires. Reminders start again for the new date. */
export async function setDocExpiry(me: Me, id: string, raw: string | null) {
  const d = await db.hrDocument.findUnique({ where: { id } });
  if (!d || (d.staffId !== me.id && !can(me, "employees"))) throw new UserError("Document not found.");
  const expiresOn = checkExpiry(expiryInput.parse(raw || null));
  await db.hrDocument.update({ where: { id }, data: { expiresOn, expiryStage: 0 } });
  if (d.staffId !== me.id) await audit(me, "Document expiry set", `${d.staffId} · ${d.kind} · ${raw || "none"}`);
}

/** Documents of active people that have expired or expire within 30 days, soonest first (HR dashboard). */
export async function expiringDocs(me: Me) {
  if (!can(me, "employees")) return [];
  const rows = await db.hrDocument.findMany({ where: { expiresOn: { lte: dateOnly(addDays(todayISO(), EXPIRY_WARN_DAYS[0])) } }, orderBy: { expiresOn: "asc" }, take: 50 });
  const people = await db.staffUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.staffId))] }, status: "active" }, select: { id: true, name: true, empNo: true } });
  const by = new Map(people.map((p) => [p.id, p]));
  return rows.filter((r) => by.has(r.staffId)).map((r) => ({ ...row(r), staffId: r.staffId, person: by.get(r.staffId)!.name, empNo: by.get(r.staffId)!.empNo }));
}

/**
 * Daily (safe to run more often): tells the employee and HR when a document is 30 days and 7 days from expiring, and when it
 * has expired. Each stage is sent once per expiry date; a new date (setDocExpiry or a new upload) starts again.
 */
export async function docExpiryTick(today = todayISO()) {
  const due = await db.hrDocument.findMany({ where: { expiresOn: { lte: dateOnly(addDays(today, EXPIRY_WARN_DAYS[0])) }, expiryStage: { lt: 3 } } });
  if (!due.length) return 0;
  const active = new Map((await db.staffUser.findMany({ where: { id: { in: [...new Set(due.map((d) => d.staffId))] }, status: "active" }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const hr = await holders("employees");
  let sent = 0;
  for (const d of due) {
    const name = active.get(d.staffId); if (!name) continue;
    const e = isoOf(d.expiresOn!);
    const stage = e < today ? 3 : e <= addDays(today, EXPIRY_WARN_DAYS[1]) ? 2 : 1;
    if (stage <= d.expiryStage) continue;
    // Claim the stage first so two runs at once can't both send it.
    const { count } = await db.hrDocument.updateMany({ where: { id: d.id, expiryStage: d.expiryStage }, data: { expiryStage: stage } });
    if (!count) continue;
    const when = stage === 3 ? `expired on ${e}` : `expires on ${e}`;
    await notify([d.staffId], `Your ${d.kind} ${when}. Upload the renewed one under My profile → KYC & certificates.`, "profile");
    await notify(hr.filter((x) => x !== d.staffId), `${name}’s ${d.kind} ${when}.`, "hremployees");
    sent++;
  }
  return sent;
}
