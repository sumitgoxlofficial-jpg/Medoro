import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { ALLOWED, MAX_BYTES, MAX_LABEL, getObject, putObject } from "@/server/storage";
import { audit, can, holders, need, notify, type Me } from "./auth";
import { DOC_KINDS } from "./constants";
import { notifyVerified, refreshKyc } from "./kyc";

// Employee documents (identity, address, certificates). The employee uploads; HR opens and marks them verified.
// Files go through the normal file storage and open only for their owner and people with the Employees module.

const MAX_DOCS = 30;
const row = (d: { id: string; kind: string; name: string; verifiedAt: Date | null; createdAt: Date }) => ({ id: d.id, kind: d.kind, name: d.name, verified: !!d.verifiedAt, at: d.createdAt.toISOString() });

export async function uploadDoc(me: Me, form: FormData) {
  const kind = z.enum(DOC_KINDS).parse(form.get("kind"));
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new UserError("Choose a file to upload.");
  const ext = ALLOWED[file.type as keyof typeof ALLOWED];
  if (!ext) throw new UserError("Upload a PDF, JPG or PNG.");
  if (file.size > MAX_BYTES) throw new UserError(`The file is too large (limit ${MAX_LABEL}).`);
  if ((await db.hrDocument.count({ where: { staffId: me.id } })) >= MAX_DOCS) throw new UserError(`You can keep up to ${MAX_DOCS} documents. Remove one first.`);
  const key = `_hrms/docs/${randomUUID()}.${ext}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  await db.hrDocument.create({ data: { staffId: me.id, kind, name: file.name.replace(/[^\w.\- ]/g, "").slice(0, 80) || `document.${ext}`, key } });
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
