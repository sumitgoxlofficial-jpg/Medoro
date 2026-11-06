import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { toCsv } from "@/lib/csv-format";
import { headerKey, readTable } from "@/domain/imports/parse";
import { gaudit, need, type Actor } from "./access";
import { insertLead, loadCandidates, sourceByKey, matchRows, normalizeLead, type Candidate, type LeadInput, type Match, type RawLead } from "./leads";
import { enqueue } from "./jobs";

export const MAX_ROWS = 10_000;
export const MAX_BYTES = 10 * 1024 * 1024;
export const INLINE_ROWS = 200;

export const FIELDS = [
  { key: "name", label: "Pharmacy name", required: true, aliases: ["pharmacyname", "name", "businessname", "storename", "shopname", "firmname", "medicalstore", "pharmacy"] },
  { key: "category", label: "Category", required: false, aliases: ["category", "type", "businesstype"] },
  { key: "ownerName", label: "Owner / contact person", required: false, aliases: ["owner", "ownername", "contactperson", "contactname", "proprietor"] },
  { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "phonenumber", "contactnumber", "mobileno", "mobilenumber", "phoneno", "tel", "telephone", "contact"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "emailid", "emailaddress", "mail"] },
  { key: "website", label: "Website", required: false, aliases: ["website", "web", "url", "site", "websiteurl"] },
  { key: "address", label: "Full address", required: false, aliases: ["address", "fulladdress", "addressline", "street", "address1"] },
  { key: "city", label: "City", required: false, aliases: ["city", "town", "village", "locality"] },
  { key: "district", label: "District", required: false, aliases: ["district", "dist"] },
  { key: "state", label: "State", required: false, aliases: ["state", "stateut", "province"] },
  { key: "pin", label: "PIN code", required: false, aliases: ["pin", "pincode", "postalcode", "zip", "zipcode", "postcode", "pinno"] },
  { key: "sourceUrl", label: "Source URL", required: false, aliases: ["sourceurl", "sourcelink", "link", "listingurl"] },
  { key: "lat", label: "Latitude", required: false, aliases: ["lat", "latitude"] },
  { key: "lng", label: "Longitude", required: false, aliases: ["lng", "lon", "long", "longitude"] },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
export type Mapping = Partial<Record<FieldKey, number>>; // field → column index

export function autoMap(header: string[]): Mapping {
  const keys = header.map(headerKey);
  const m: Mapping = {};
  for (const f of FIELDS) {
    const i = keys.findIndex((k, j) => (f.aliases as readonly string[]).includes(k) && !Object.values(m).includes(j));
    if (i >= 0) m[f.key] = i;
  }
  return m;
}

export type RowStatus = "new" | "duplicate" | "possible" | "invalid" | "erased";
export type PreviewRow = { line: number; name: string; phone: string; city: string; pin: string; status: RowStatus; messages: string[] };

function parse(fileName: string, bytes: Uint8Array) {
  if (bytes.byteLength > MAX_BYTES) throw new UserError("The file is larger than 10 MB. Split it into smaller files.");
  if (!/\.(csv|xlsx)$/i.test(fileName)) throw new UserError("Upload a .csv or .xlsx file.");
  let t: string[][];
  try { t = readTable(fileName, bytes); } catch (e) { throw new UserError(e instanceof Error ? e.message : "The file couldn’t be read."); }
  if (t.length < 2) throw new UserError("The file has no rows under the header.");
  if (t.length - 1 > MAX_ROWS) throw new UserError(`The file has ${t.length - 1} rows; the limit is ${MAX_ROWS.toLocaleString("en-IN")} per import.`);
  return { header: t[0], body: t.slice(1) };
}

const mappingSchema = z.record(z.string(), z.number().int().min(0).max(200));

/** Checks every row: validation, duplicates against existing leads and inside the file. Nothing is saved. */
async function evaluate(fileName: string, bytes: Uint8Array, rawMapping?: Record<string, number>, requirePhone = true) {
  const { header, body } = parse(fileName, bytes);
  const mapping: Mapping = rawMapping ? (mappingSchema.parse(rawMapping) as Mapping) : autoMap(header);
  if (mapping.name === undefined) throw new UserError("Map a column to “Pharmacy name”.");
  const records = body.map((cells, i) => {
    const raw: RawLead = {};
    for (const [k, idx] of Object.entries(mapping)) raw[k as FieldKey] = cells[idx as number] ?? "";
    return { line: i + 2, ...normalizeLead(raw) };
  });
  const ok = records.filter((r) => !r.errors.length);
  const existing: Candidate[] = await loadCandidates(db, {
    phones: [...new Set(ok.map((r) => r.value.phone).filter(Boolean) as string[])],
    domains: [...new Set(ok.map((r) => r.value.domain).filter(Boolean))],
    pins: [...new Set(ok.map((r) => r.value.pin).filter(Boolean))],
  });
  // Erased pharmacies are not collected again.
  const { valueHash } = await import("./compliance");
  const hashes = ok.flatMap((r) => [r.value.phone ? valueHash("phone", r.value.phone) : null, r.value.email ? valueHash("email", r.value.email) : null]).filter(Boolean) as string[];
  const erased = new Set((hashes.length ? await db.suppressionRecord.findMany({ where: { valueHash: { in: hashes }, reason: "erasure", liftedAt: null }, select: { valueHash: true } }) : []).map((x) => x.valueHash));
  const inFile: Candidate[] = [];
  const out: (PreviewRow & { value?: LeadInput; matches: Match[] })[] = [];
  for (const r of records) {
    const base = { line: r.line, name: r.value.name, phone: r.value.phone ?? r.value.phoneRaw, city: r.value.city, pin: r.value.pin };
    // Callers need a number: by default a row without a valid Indian phone isn't imported.
    if (requirePhone && !r.value.phone && !r.errors.length) r.errors.push(r.value.phoneRaw ? `“${r.value.phoneRaw}” isn’t a valid Indian phone number.` : "No phone number.");
    if (r.errors.length) { out.push({ ...base, status: "invalid", messages: [...r.errors, ...r.warnings], matches: [] }); continue; }
    const v = r.value;
    if ((v.phone && erased.has(valueHash("phone", v.phone))) || (v.email && erased.has(valueHash("email", v.email)))) { out.push({ ...base, status: "erased", messages: ["Asked for erasure; skipped."], matches: [] }); continue; }
    const fileDup = matchRows(v, inFile).find((m) => m.strong);
    if (fileDup) { out.push({ ...base, status: "duplicate", messages: [`Same as line ${fileDup.code} in this file (${fileDup.reason.toLowerCase()}).`], matches: [] }); continue; }
    const matches = matchRows(v, existing);
    const strong = matches.find((m) => m.strong);
    inFile.push({ id: `line-${r.line}`, code: String(r.line), name: v.name, nameKey: "", phone: v.phone, domain: v.domain, pin: "", address: "" });
    if (strong) out.push({ ...base, status: "duplicate", messages: [`Already a lead: ${strong.code} · ${strong.name} (${strong.reason.toLowerCase()}).`, ...r.warnings], matches, value: v });
    else if (matches.length) out.push({ ...base, status: "possible", messages: [`Possible duplicate of ${matches.map((m) => m.code).join(", ")}; created and queued for review.`, ...r.warnings], matches, value: v });
    else out.push({ ...base, status: "new", messages: r.warnings, matches, value: v });
  }
  return { header, mapping, rows: out };
}

export async function previewImport(a: Actor, fileName: string, bytes: Uint8Array, mapping?: Record<string, number>, requirePhone = true) {
  need(a, "leads.import");
  const e = await evaluate(fileName, bytes, mapping, requirePhone);
  const count = (s: RowStatus) => e.rows.filter((r) => r.status === s).length;
  return {
    header: e.header, mapping: e.mapping, fields: FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required })),
    counts: { total: e.rows.length, new: count("new"), possible: count("possible"), duplicate: count("duplicate"), invalid: count("invalid"), erased: count("erased") },
    rows: e.rows.slice(0, 200).map(({ line, name, phone, city, pin, status, messages }) => ({ line, name, phone, city, pin, status, messages })),
  };
}

export const sourceSchema = z.object({
  sourceId: z.string().uuid().optional(),
  newSource: z.object({ name: z.string().trim().min(3).max(100), kind: z.enum(["public_directory", "official_api", "provider", "upload", "submitted"]), licence: z.string().trim().max(100).default(""), attribution: z.string().trim().max(200).default(""), termsUrl: z.string().trim().max(300).default(""), allowsExport: z.boolean().default(true) }).optional(),
  requirePhone: z.boolean().default(true),
  confirmLawful: z.literal(true, { message: "Confirm the list was collected lawfully and its terms allow this use." }),
});

/** Re-checks the file on the server and starts the import. Small files finish now; larger ones run as a background job. */
export async function commitImport(a: Actor, fileName: string, bytes: Uint8Array, mapping: Record<string, number> | undefined, rawSource: z.input<typeof sourceSchema>) {
  need(a, "leads.import");
  const src = sourceSchema.parse(rawSource);
  const e = await evaluate(fileName, bytes, mapping, src.requirePhone);
  const source = src.sourceId
    ? await db.leadSource.findUnique({ where: { id: src.sourceId } })
    : src.newSource
      ? await db.leadSource.upsert({ where: { key: "upload:" + src.newSource.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") }, create: { key: "upload:" + src.newSource.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...src.newSource }, update: {} })
      : await sourceByKey("upload");
  if (!source) throw new UserError("Choose the source of this list.");
  // Rows duplicating an existing lead are processed (the existing lead gets this list as a source); rows repeating an
  // earlier line of the same file are only counted.
  const pending = e.rows.filter((r) => r.value && (r.status === "new" || r.status === "possible" || r.status === "duplicate")).map((r) => ({ line: r.line, v: r.value! }));
  const inFileDuplicates = e.rows.filter((r) => r.status === "duplicate" && !r.value).length;
  const errors = e.rows.filter((r) => r.status === "invalid" || r.status === "erased").map((r) => ({ line: r.line, name: r.name, errors: r.messages }));
  const job = await db.$transaction(async (tx) => {
    const code = "IMP-" + String(await nextSeq(tx, "_growth", "IMPORT")).padStart(5, "0");
    return tx.leadImportJob.create({ data: { code, fileName: fileName.slice(0, 200), sourceId: source.id, status: "running", mapping: e.mapping as Prisma.InputJsonValue, totalRows: e.rows.length, invalid: errors.length, duplicates: inFileDuplicates, errors, rows: pending as unknown as Prisma.InputJsonValue, createdById: a.id } });
  });
  await gaudit(a, "Import started", "import", job.id, `${job.code} · ${fileName} · ${e.rows.length} rows · source ${source.name}`);
  if (pending.length <= INLINE_ROWS) await processImport(job.id, INLINE_ROWS);
  else {
    // Larger files: a background job owns the import; this request also works on it for a while so most lists finish now
    // (hosts whose scheduler runs rarely, such as Vercel Hobby with a daily cron, don't leave it waiting).
    await enqueue("import", { jobId: job.id }, { key: `import:${job.id}`, by: a.id });
    await continueImport(a, job.id, 20_000);
  }
  return db.leadImportJob.findUniqueOrThrow({ where: { id: job.id }, select: { id: true, code: true, status: true, created: true, duplicates: true, possibleDuplicates: true, invalid: true, totalRows: true, processed: true } });
}

/**
 * Imports the next `chunk` pending rows. Each row and the job's progress counter commit together, so a retried job
 * continues where it stopped and never imports a row twice. Returns true when the job is finished.
 */
export async function processImport(jobId: string, chunk = 250): Promise<boolean> {
  const job = await db.leadImportJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "running") return true;
  const rows = (job.rows as unknown as { line: number; v: LeadInput }[] | null) ?? [];
  const by = { id: job.createdById, name: (await db.staffUser.findUnique({ where: { id: job.createdById }, select: { name: true } }))?.name ?? "Import" };
  for (let i = job.processed; i < Math.min(rows.length, job.processed + chunk); i++) {
    const { v } = rows[i];
    await db.$transaction(async (tx) => {
      const r = await insertLead(tx, v, { sourceId: job.sourceId, by, importJobId: job.id, kind: "imported" });
      if (r.strong) {
        // Keep the source record: the existing lead gets evidence that this list also has it.
        await tx.leadEvidence.create({ data: { leadId: r.strong.id, kind: "source", method: "source_listing", result: "info", detail: `Also listed in import ${job.code} (${job.fileName}, line ${rows[i].line})`, url: v.sourceUrl, byStaffId: by.id } });
      }
      const n = await tx.leadImportJob.updateMany({ where: { id: job.id, processed: i }, data: { processed: i + 1, created: { increment: r.created ? 1 : 0 }, duplicates: { increment: r.strong || r.erased ? 1 : 0 }, possibleDuplicates: { increment: r.possible.length ? 1 : 0 } } });
      if (!n.count) throw new Error("import progress moved; another worker has this job");
    });
  }
  const after = await db.leadImportJob.findUniqueOrThrow({ where: { id: jobId } });
  if (after.processed >= rows.length) {
    await db.leadImportJob.update({ where: { id: jobId }, data: { status: "completed", finishedAt: new Date(), rows: undefined } });
    await db.$executeRaw`UPDATE "LeadImportJob" SET "rows" = NULL WHERE "id" = ${jobId}`;
    return true;
  }
  return false;
}

/** Works on a running import for up to `budgetMs` (the "Continue" button and the commit request). */
export async function continueImport(a: Actor, jobId: string, budgetMs = 20_000) {
  need(a, "leads.import");
  const until = Date.now() + budgetMs;
  while (Date.now() < until) if (await processImport(jobId, 100)) break;
  return db.leadImportJob.findUniqueOrThrow({ where: { id: jobId }, select: { id: true, code: true, status: true, processed: true, created: true } });
}

export async function importHistory(a: Actor) {
  need(a, "leads.import");
  const jobs = await db.leadImportJob.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, code: true, fileName: true, status: true, totalRows: true, created: true, duplicates: true, possibleDuplicates: true, invalid: true, processed: true, createdAt: true, finishedAt: true, createdById: true, sourceId: true } });
  const sources = await db.leadSource.findMany({ select: { id: true, name: true } });
  return jobs.map((j) => ({ ...j, source: sources.find((s) => s.id === j.sourceId)?.name ?? "" }));
}

export async function importErrorsCsv(a: Actor, jobId: string) {
  need(a, "leads.import");
  const j = await db.leadImportJob.findUnique({ where: { id: jobId } });
  if (!j) throw new UserError("Import not found.");
  const errs = (j.errors as { line: number; name: string; errors: string[] }[]) ?? [];
  return { name: `${j.code}-errors`, csv: toCsv([["Line", "Pharmacy name", "Problem"], ...errs.map((e) => [e.line, e.name, e.errors.join("; ")])]) };
}

export const templateCsv = () => toCsv([FIELDS.map((f) => f.label), ["Shivam Medical & General Stores", "RETAIL", "Pravin Kulkarni", "020-2553 1234", "shivam.medicals@example.in", "shivammedicals.example.in", "Shop 4, FC Road, Shivajinagar", "Pune", "Pune", "Maharashtra", "411005", "", "", ""]]);
