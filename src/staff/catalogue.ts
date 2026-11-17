import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { pad } from "@/server/sequence";
import { todayISO, dateOnly, isoOf } from "@/lib/dates";
import { allow, staffAudit, type Staff } from "./auth";
import { EDITABLE_FIELDS, dedupeKeyOf, duplicatePairs, entrySaltKey, entrySchema, globalBarcode, type EntryInput } from "@/domain/inventory/catalogue-rules";

/**
 * Curation of the central medicine catalogue (Medoro super admin only). Entries start as drafts; "verified" means a named staff
 * member checked the entry against a recorded source on a recorded date. Every change is written to the append-only change log,
 * whose sequence number is the catalogue version. No entry is imported from anywhere automatically.
 */
type Tx = Prisma.TransactionClient;
const snapshot = (e: { gid: string; brand: string; generic: string; composition: string; strength: string; form: string; manufacturer: string; packSize: number; packLabel: string; hsn: string; gstRate: number; schedule: string; status: string; source: string; sourceRef: string | null; verifiedOn: Date | null; supersededByGid: string | null }) => ({ ...e, verifiedOn: e.verifiedOn ? isoOf(e.verifiedOn) : null });
const logChange = (tx: Tx, e: Parameters<typeof snapshot>[0] & { version: number }, action: string, by: string) => tx.catalogueChange.create({ data: { gid: e.gid, action, version: e.version, data: snapshot(e) as Prisma.InputJsonValue, by } });
const keyData = (i: ReturnType<typeof entrySchema.parse>) => ({ saltKey: entrySaltKey(i), dedupeKey: dedupeKeyOf(i) });

async function clash(tx: Tx, dedupeKey: string, exceptGid?: string) {
  const other = await tx.catalogueMedicine.findFirst({ where: { dedupeKey, status: { not: "deprecated" }, ...(exceptGid ? { NOT: { gid: exceptGid } } : {}) }, select: { gid: true, brand: true } });
  if (other) throw new UserError(`${other.brand} is already in the catalogue as ${other.gid} (same brand, salt, strength, form, manufacturer and pack size).`);
}

export async function catalogueVersion() {
  const r = await db.catalogueChange.aggregate({ _max: { seq: true } });
  return Number(r._max.seq ?? 0n);
}

export async function listCatalogue(q = "", status = "", take = 100) {
  const t = q.trim();
  const rows = await db.catalogueMedicine.findMany({
    where: { ...(status ? { status } : {}), ...(t ? { OR: [{ brand: { contains: t, mode: "insensitive" } }, { generic: { contains: t, mode: "insensitive" } }, { gid: { equals: t.toUpperCase() } }, { manufacturer: { contains: t, mode: "insensitive" } }] } : {}) },
    orderBy: { gid: "desc" }, take, include: { barcodes: true },
  });
  return rows.map((r) => ({ ...r, verifiedOn: r.verifiedOn ? isoOf(r.verifiedOn) : null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

async function createIn(tx: Tx, s: { id: string; email: string }, raw: EntryInput) {
  const i = entrySchema.parse(raw);
  const k = keyData(i);
  await clash(tx, k.dedupeKey);
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('catalogue_gid_seq') n`;
  const gid = `CM-${pad(Number(n), 6)}`;
  const e = await tx.catalogueMedicine.create({ data: { gid, brand: i.brand, generic: i.generic, composition: i.composition, strength: i.strength, form: i.form, manufacturer: i.manufacturer, packSize: i.packSize, packLabel: i.packLabel, hsn: i.hsn, gstRate: i.gstRate, schedule: i.schedule, ...k, status: "draft", source: i.source, sourceRef: i.sourceRef || null, createdBy: s.id } });
  await logChange(tx, e, "create", s.email);
  return e;
}

export async function createEntry(s: Staff, raw: EntryInput) {
  allow(s, "super_admin");
  const e = await db.$transaction((tx) => createIn(tx, s, raw));
  await staffAudit(s, "Catalogue entry created", `${e.gid} · ${e.brand} ${e.strength}`);
  return e.gid;
}

/** Edits an entry. A verified entry stays verified only if the editor restates the source reference; the verification date moves to today. */
async function updateIn(tx: Tx, s: { email: string }, gid: string, raw: EntryInput, version: number, action = "update") {
  const i = entrySchema.parse(raw);
  const cur = await tx.catalogueMedicine.findUnique({ where: { gid } });
  if (!cur) throw new UserError("Catalogue entry not found.");
  if (cur.status === "deprecated") throw new UserError("A deprecated entry can’t be edited.");
  if (cur.status === "verified" && !(i.sourceRef ?? "").trim()) throw new UserError("Changing a verified entry needs the source reference of the check.");
  const k = keyData(i);
  await clash(tx, k.dedupeKey, gid);
  const r = await tx.catalogueMedicine.updateMany({ where: { gid, version }, data: { brand: i.brand, generic: i.generic, composition: i.composition, strength: i.strength, form: i.form, manufacturer: i.manufacturer, packSize: i.packSize, packLabel: i.packLabel, hsn: i.hsn, gstRate: i.gstRate, schedule: i.schedule, ...k, source: i.source, sourceRef: i.sourceRef || null, version: { increment: 1 }, ...(cur.status === "verified" ? { verifiedOn: dateOnly(todayISO()), verifiedBy: s.email } : {}) } });
  if (!r.count) throw new UserError("Someone else changed this entry. Reload and try again.");
  const e = await tx.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
  await logChange(tx, e, action, s.email);
  return e;
}
export async function updateEntry(s: Staff, gid: string, raw: EntryInput, version: number) {
  allow(s, "super_admin");
  const e = await db.$transaction((tx) => updateIn(tx, s, gid, raw, version));
  await staffAudit(s, "Catalogue entry changed", `${gid} · v${e.version}`);
  return e.version;
}

export async function verifyEntry(s: Staff, gid: string, input: { sourceRef: string; verifiedOn?: string }) {
  allow(s, "super_admin");
  const ref = input.sourceRef.trim(), day = input.verifiedOn ?? todayISO();
  if (ref.length < 3) throw new UserError("Enter the source reference you checked this against (document, notice or pack photo).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > todayISO()) throw new UserError("The verification date can’t be in the future.");
  const e = await db.$transaction(async (tx) => {
    const cur = await tx.catalogueMedicine.findUnique({ where: { gid } });
    if (!cur) throw new UserError("Catalogue entry not found.");
    if (cur.status === "deprecated") throw new UserError("A deprecated entry can’t be verified.");
    entrySchema.parse({ ...cur, schedule: cur.schedule, sourceRef: ref });   // a half-filled draft can't be verified
    const u = await tx.catalogueMedicine.update({ where: { gid }, data: { status: "verified", sourceRef: ref, verifiedOn: dateOnly(day), verifiedBy: s.email, version: { increment: 1 } } });
    await logChange(tx, u, "verify", s.email);
    return u;
  });
  await staffAudit(s, "Catalogue entry verified", `${gid} · ${ref} · ${day}`);
  return e.version;
}

export async function deprecateEntry(s: Staff, gid: string, reason: string, supersededByGid?: string) {
  allow(s, "super_admin");
  if (reason.trim().length < 5) throw new UserError("Say why this entry is withdrawn.");
  await db.$transaction(async (tx) => {
    const cur = await tx.catalogueMedicine.findUnique({ where: { gid } });
    if (!cur) throw new UserError("Catalogue entry not found.");
    if (cur.status === "deprecated") throw new UserError("Already deprecated.");
    if (supersededByGid) {
      const n = await tx.catalogueMedicine.findFirst({ where: { gid: supersededByGid, status: { not: "deprecated" } } });
      if (!n || supersededByGid === gid) throw new UserError("The replacement entry must be a different, live entry.");
    }
    const u = await tx.catalogueMedicine.update({ where: { gid }, data: { status: "deprecated", supersededByGid: supersededByGid ?? null, version: { increment: 1 } } });
    await logChange(tx, { ...u, source: `${u.source} · withdrawn: ${reason.trim().slice(0, 150)}` }, "deprecate", s.email);
  });
  await staffAudit(s, "Catalogue entry deprecated", `${gid}${supersededByGid ? ` → ${supersededByGid}` : ""} · ${reason.trim().slice(0, 120)}`);
}

export async function addBarcode(s: Staff, gid: string, code: string, source: string, verified: boolean) {
  allow(s, "super_admin");
  const b = globalBarcode(code);
  if (!b.ok) throw new UserError(b.reason);
  if (source.trim().length < 3) throw new UserError("Say where the barcode was read (pack photo, manufacturer sheet).");
  await db.$transaction(async (tx) => {
    const e = await tx.catalogueMedicine.findUnique({ where: { gid } });
    if (!e || e.status === "deprecated") throw new UserError("Catalogue entry not found.");
    const used = await tx.catalogueBarcode.findUnique({ where: { barcode: b.code }, include: { medicine: { select: { gid: true } } } });
    if (used) throw new UserError(`Barcode ${b.code} already belongs to ${used.medicine.gid}.`);
    await tx.catalogueBarcode.create({ data: { medicineId: e.id, barcode: b.code, verified, source: source.trim(), verifiedOn: verified ? dateOnly(todayISO()) : null } });
    const u = await tx.catalogueMedicine.update({ where: { gid }, data: { version: { increment: 1 } } });
    await logChange(tx, { ...u, source: `${u.source} · barcode ${b.code}${verified ? " (verified)" : ""}` }, "barcode_add", s.email);
  });
  await staffAudit(s, "Catalogue barcode added", `${gid} · ${b.code}${verified ? " · verified" : ""}`);
}

export async function verifyBarcode(s: Staff, code: string) {
  allow(s, "super_admin");
  const b = await db.catalogueBarcode.findUnique({ where: { barcode: code }, include: { medicine: true } });
  if (!b) throw new UserError("Barcode not found.");
  if (b.verified) throw new UserError("Already verified.");
  await db.$transaction(async (tx) => {
    await tx.catalogueBarcode.update({ where: { id: b.id }, data: { verified: true, verifiedOn: dateOnly(todayISO()) } });
    const u = await tx.catalogueMedicine.update({ where: { id: b.medicineId }, data: { version: { increment: 1 } } });
    await logChange(tx, { ...u, source: `${u.source} · barcode ${code} (verified)` }, "barcode_verify", s.email);
  });
  await staffAudit(s, "Catalogue barcode verified", `${b.medicine.gid} · ${code}`);
}

export const IMPORT_MAX = 500;
/** Adds many drafts at once. Rows that duplicate a live entry or fail validation are reported and skipped; nothing is overwritten. */
export async function importEntries(s: Staff, rows: EntryInput[]) {
  allow(s, "super_admin");
  if (rows.length > IMPORT_MAX) throw new UserError(`Import at most ${IMPORT_MAX} rows at a time.`);
  const created: string[] = [], duplicates: { row: number; message: string }[] = [], invalid: { row: number; message: string }[] = [];
  for (const [n, row] of rows.entries()) {
    try { created.push((await db.$transaction((tx) => createIn(tx, s, row))).gid); }
    catch (e) {
      const msg = e instanceof UserError ? e.message : e instanceof Error && "issues" in e ? String((e as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid row.") : "Invalid row.";
      (e instanceof UserError ? duplicates : invalid).push({ row: n + 1, message: msg });
    }
  }
  await staffAudit(s, "Catalogue import", `${created.length} created, ${duplicates.length} duplicate, ${invalid.length} invalid`);
  return { created, duplicates, invalid };
}

export async function findDuplicates() {
  const rows = await db.catalogueMedicine.findMany({ where: { status: { not: "deprecated" } }, select: { gid: true, brand: true, generic: true, composition: true, strength: true, form: true, manufacturer: true, packSize: true, dedupeKey: true } });
  return duplicatePairs(rows);
}

export async function listCorrections(status = "open") {
  const rows = await db.catalogueCorrection.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 200 });
  const tenants = await db.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({ ...r, pharmacy: tenants.find((t) => t.id === r.tenantId)?.name ?? "", createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null }));
}

export async function resolveCorrection(s: Staff, id: string, accept: boolean, note: string) {
  allow(s, "super_admin");
  const c = await db.catalogueCorrection.findUnique({ where: { id } });
  if (!c) throw new UserError("Correction not found.");
  if (c.status !== "open") throw new UserError(`Already ${c.status}.`);
  if (!accept && note.trim().length < 5) throw new UserError("Say why the correction is declined.");
  await db.$transaction(async (tx) => {
    if (accept) {
      if (!(EDITABLE_FIELDS as readonly string[]).includes(c.field)) throw new UserError("This kind of correction can’t be applied automatically.");
      const cur = await tx.catalogueMedicine.findUnique({ where: { gid: c.gid } });
      if (!cur) throw new UserError("The catalogue entry no longer exists.");
      const next = { brand: cur.brand, generic: cur.generic, composition: cur.composition, strength: cur.strength, form: cur.form, manufacturer: cur.manufacturer, packSize: cur.packSize, packLabel: cur.packLabel, hsn: cur.hsn, gstRate: cur.gstRate, schedule: cur.schedule, source: `Pharmacy correction accepted by ${s.email}`, sourceRef: note.trim() || `correction ${id}`, [c.field]: c.proposed } as EntryInput;
      await updateIn(tx, s, c.gid, next, cur.version, "correction_accepted");
    }
    await tx.catalogueCorrection.update({ where: { id }, data: { status: accept ? "accepted" : "rejected", resolvedBy: s.email, resolvedAt: new Date(), resolutionNote: note.trim().slice(0, 300) || null } });
  });
  await staffAudit(s, accept ? "Catalogue correction accepted" : "Catalogue correction declined", `${c.gid} · ${c.field}`);
}
