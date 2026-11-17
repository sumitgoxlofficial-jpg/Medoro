import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorizeAny, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { createMedicine } from "./service";
import { compositionOf, normStrength, squash } from "./salts";
import { EDITABLE_FIELDS, SENSITIVE_FIELDS, SYNC_FIELDS, matchLocal, type CatEntry, type SyncField } from "./catalogue-rules";

/**
 * A pharmacy's side of the central catalogue. Only verified entries are visible. Linking a medicine records the catalogue id;
 * it never changes the medicine. Catalogue fields come across only when the pharmacy applies them, one medicine and field at a
 * time, and the fields that can come across are listed in SYNC_FIELDS: never MRP, prices, supplier rates, rack, reorder level,
 * loose-sale setup, barcode or the brand name the pharmacy uses. A medicine with no link (a custom record) is never touched.
 */
const MANAGE = ["adjust", "purchase"] as const;
const VIEW = ["adjust", "purchase", "reports"] as const;

const version = async () => Number((await db.catalogueChange.aggregate({ _max: { seq: true } }))._max.seq ?? 0n);
const setting = async (tenantId: string) => ((await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings as { catalogue?: { reviewedSeq?: number } } | null)?.catalogue?.reviewedSeq ?? 0;

export type CentralEntry = { gid: string; brand: string; generic: string; composition: string; strength: string; form: string; manufacturer: string; packSize: number; packLabel: string; hsn: string; gstRate: number; schedule: string; verifiedOn: string | null; barcodes: string[]; version: number };
const pub = (e: { gid: string; brand: string; generic: string; composition: string; strength: string; form: string; manufacturer: string; packSize: number; packLabel: string; hsn: string; gstRate: number; schedule: string; verifiedOn: Date | null; version: number; barcodes: { barcode: string; verified: boolean }[] }): CentralEntry => ({ gid: e.gid, brand: e.brand, generic: e.generic, composition: e.composition, strength: e.strength, form: e.form, manufacturer: e.manufacturer, packSize: e.packSize, packLabel: e.packLabel, hsn: e.hsn, gstRate: e.gstRate, schedule: e.schedule, verifiedOn: e.verifiedOn ? e.verifiedOn.toISOString().slice(0, 10) : null, version: e.version, barcodes: e.barcodes.filter((b) => b.verified).map((b) => b.barcode) });

/** Search the verified catalogue (brand, generic, manufacturer or catalogue id). */
export async function searchCentral(ctx: Ctx, q: string, take = 20): Promise<CentralEntry[]> {
  authorizeView(ctx, ...VIEW);
  const t = q.trim();
  if (t.length < 2) return [];
  const rows = await db.catalogueMedicine.findMany({ where: { status: "verified", OR: [{ brand: { contains: t, mode: "insensitive" } }, { generic: { contains: t, mode: "insensitive" } }, { manufacturer: { contains: t, mode: "insensitive" } }, { gid: t.toUpperCase() }] }, take, orderBy: { brand: "asc" }, include: { barcodes: true } });
  return rows.map(pub);
}

export type Suggestion = { medicineId: string; name: string; strength: string; matches: { kind: "barcode" | "exact" | "similar"; score: number; entry: CentralEntry }[] };
/** Unlinked medicines with their likely central entries. Nothing is linked automatically. */
export async function linkSuggestions(ctx: Ctx, limit = 40): Promise<Suggestion[]> {
  authorizeView(ctx, ...VIEW);
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, catalogueGid: null }, orderBy: { name: "asc" }, take: 500 });
  if (!meds.length) return [];
  const keys = [...new Set(meds.map((m) => compositionOf({ composition: m.composition, generic: m.generic, strength: m.strength }).saltKey).filter((x): x is string => !!x))], codes = meds.map((m) => m.barcode).filter((x): x is string => !!x);
  const cand = await db.catalogueMedicine.findMany({ where: { status: "verified", OR: [{ saltKey: { in: keys } }, ...(codes.length ? [{ barcodes: { some: { barcode: { in: codes }, verified: true } } }] : [])] }, include: { barcodes: true }, take: 3000 });
  const entries: CatEntry[] = cand.map((c) => ({ gid: c.gid, brand: c.brand, generic: c.generic, composition: c.composition, strength: c.strength, form: c.form, manufacturer: c.manufacturer, packSize: c.packSize, dedupeKey: c.dedupeKey, barcodes: c.barcodes.filter((b) => b.verified).map((b) => b.barcode), status: c.status }));
  const out: Suggestion[] = [];
  for (const m of meds) {
    const hits = matchLocal({ id: m.id, name: m.name, generic: m.generic, composition: m.composition, strength: m.strength, form: m.form, manufacturer: m.manufacturer, packSize: m.packSize, barcode: m.barcode }, entries);
    if (hits.length) out.push({ medicineId: m.id, name: m.name, strength: m.strength, matches: hits.map((h) => ({ kind: h.kind, score: h.score, entry: pub(cand.find((c) => c.gid === h.gid)!) })) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function linkMedicine(ctx: Ctx, medicineId: string, gid: string) {
  authorizeAny(ctx, ...MANAGE);
  const [m, e] = await Promise.all([db.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } }), db.catalogueMedicine.findFirst({ where: { gid, status: "verified" } })]);
  if (!m) throw new UserError("Medicine not found.");
  if (!e) throw new UserError("That catalogue entry isn’t available. Only verified entries can be linked.");
  await db.medicine.update({ where: { id: m.id }, data: { catalogueGid: gid } });   // link only: no field of the medicine changes, so its version is left alone
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Medicine linked to central catalogue", entity: "medicine", entityId: m.id, detail: `${m.name} ${m.strength} → ${gid}${m.catalogueGid && m.catalogueGid !== gid ? ` (was ${m.catalogueGid})` : ""}` });
}
export async function unlinkMedicine(ctx: Ctx, medicineId: string) {
  authorizeAny(ctx, ...MANAGE);
  const m = await db.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } });
  if (!m || !m.catalogueGid) throw new UserError("This medicine isn’t linked.");
  await db.medicine.update({ where: { id: m.id }, data: { catalogueGid: null } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Medicine unlinked from central catalogue", entity: "medicine", entityId: m.id, detail: `${m.name} ${m.strength} ← ${m.catalogueGid}` });
}

export type Diff = { field: SyncField; local: string; central: string; sensitive: boolean };
export type MedicineDiff = { medicineId: string; name: string; strength: string; gid: string; centralVersion: number; diffs: Diff[]; withdrawn: { replacedBy: string | null } | null };
const eq = (field: SyncField, a: string, b: string) => field === "strength" ? normStrength(a) === normStrength(b) : field === "manufacturer" || field === "generic" ? squash(a) === squash(b) : a.trim().toLowerCase() === b.trim().toLowerCase();

/** What differs between each linked medicine and its catalogue entry, computed now; nothing is changed. */
export async function catalogueDiff(ctx: Ctx): Promise<MedicineDiff[]> {
  authorizeView(ctx, ...VIEW);
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, catalogueGid: { not: null } }, orderBy: { name: "asc" } });
  const entries = await db.catalogueMedicine.findMany({ where: { gid: { in: [...new Set(meds.map((m) => m.catalogueGid!))] } } });
  const out: MedicineDiff[] = [];
  for (const m of meds) {
    const e = entries.find((x) => x.gid === m.catalogueGid);
    if (!e) continue;
    if (e.status === "deprecated") { out.push({ medicineId: m.id, name: m.name, strength: m.strength, gid: e.gid, centralVersion: e.version, diffs: [], withdrawn: { replacedBy: e.supersededByGid } }); continue; }
    if (e.status !== "verified") continue;
    const local: Record<SyncField, string> = { generic: m.generic, composition: compositionOf({ composition: m.composition, generic: m.generic, strength: m.strength }).composition ?? "", strength: m.strength, form: m.form, manufacturer: m.manufacturer, hsn: m.hsn, gstRate: String(m.gstRate), schedule: m.schedule ?? "" };
    const central: Record<SyncField, string> = { generic: e.generic, composition: e.composition ? compositionOf({ composition: e.composition, generic: e.generic, strength: e.strength }).composition ?? "" : "", strength: e.strength, form: e.form, manufacturer: e.manufacturer, hsn: e.hsn, gstRate: String(e.gstRate), schedule: e.schedule };
    const diffs: Diff[] = SYNC_FIELDS.filter((f) => !(f === "composition" && !central.composition) && !eq(f, local[f], central[f])).map((f) => ({ field: f, local: local[f], central: central[f], sensitive: SENSITIVE_FIELDS.includes(f) }));
    if (diffs.length) out.push({ medicineId: m.id, name: m.name, strength: m.strength, gid: e.gid, centralVersion: e.version, diffs, withdrawn: null });
  }
  return out;
}

/** Applies the chosen catalogue fields to ONE linked medicine. Past bills are not touched: each sale line keeps the GST rate it was billed at. */
export async function applyCatalogue(ctx: Ctx, medicineId: string, fields: SyncField[]) {
  authorizeAny(ctx, ...MANAGE);
  const want = [...new Set(fields)];
  if (!want.length) throw new UserError("Choose at least one field to update.");
  if (want.some((f) => !(SYNC_FIELDS as readonly string[]).includes(f))) throw new UserError("That field can’t come from the catalogue.");
  return db.$transaction(async (tx) => {
    const m = await tx.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } });
    if (!m?.catalogueGid) throw new UserError("This medicine isn’t linked to the catalogue.");
    const e = await tx.catalogueMedicine.findFirst({ where: { gid: m.catalogueGid, status: "verified" } });
    if (!e) throw new UserError("The catalogue entry is no longer verified, so nothing was changed.");
    const data: Record<string, string | number | null> = {};
    const log: string[] = [];
    const set = (f: SyncField, v: string | number, before: string | number | null) => { data[f] = v; log.push(`${f}: ${before ?? ""} → ${v}`); };
    for (const f of want) {
      if (f === "gstRate") set(f, e.gstRate, m.gstRate);
      else if (f === "schedule") set(f, e.schedule || (null as never), m.schedule ?? "");
      else if (f === "composition") { if (e.composition) set(f, e.composition, m.composition); }
      else set(f, e[f], m[f]);
    }
    const generic = (data.generic as string) ?? m.generic, strength = (data.strength as string) ?? m.strength, composition = "composition" in data ? (data.composition as string) : m.composition;
    if (["generic", "strength", "composition"].some((k) => k in data)) data.saltKey = compositionOf({ composition, generic, strength }).saltKey;
    if (!Object.keys(data).length) throw new UserError("Nothing to update.");
    const r = await tx.medicine.updateMany({ where: { id: m.id, tenantId: ctx.tenantId, version: m.version }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw new UserError("Someone else changed this medicine. Reload and try again.");
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Catalogue update applied", entity: "medicine", entityId: m.id, detail: `${m.name} ${m.strength} · ${e.gid} v${e.version} · ${log.join("; ")}` });
    return log;
  });
}

/** Creates the pharmacy's own medicine from a catalogue entry. The pharmacy supplies its MRP and reorder level; the link is recorded. */
export async function addFromCatalogue(ctx: Ctx, gid: string, own: { mrp: string; reorderLevel?: number }) {
  authorizeAny(ctx, ...MANAGE);
  const e = await db.catalogueMedicine.findFirst({ where: { gid, status: "verified" }, include: { barcodes: true } });
  if (!e) throw new UserError("That catalogue entry isn’t available.");
  const code = e.barcodes.find((b) => b.verified)?.barcode ?? "";
  const taken = code ? await db.medicine.findFirst({ where: { tenantId: ctx.tenantId, barcode: code } }) : null;
  const id = await createMedicine(ctx, { name: e.brand, generic: e.generic, strength: e.strength, form: e.form as never, manufacturer: e.manufacturer, pack: e.packLabel, mrp: own.mrp, gstRate: e.gstRate, schedule: e.schedule as never, hsn: e.hsn, composition: e.composition, packSize: e.packSize, barcode: taken ? "" : code, reorderLevel: own.reorderLevel ?? 10 });
  await db.medicine.update({ where: { id }, data: { catalogueGid: gid } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Medicine added from central catalogue", entity: "medicine", entityId: id, detail: `${e.brand} ${e.strength} ← ${gid}` });
  return id;
}

const correctionSchema = z.object({ gid: z.string().regex(/^CM-\d{6}$/, "Choose a catalogue entry."), field: z.enum(EDITABLE_FIELDS), proposed: z.string().trim().min(1, "Enter the correct value.").max(300), reason: z.string().trim().min(5, "Say how you know.").max(500) });
export async function requestCorrection(ctx: Ctx, raw: z.input<typeof correctionSchema>) {
  authorizeAny(ctx, ...MANAGE);
  const i = correctionSchema.parse(raw);
  if (!(await db.catalogueMedicine.findFirst({ where: { gid: i.gid, status: { not: "deprecated" } }, select: { id: true } }))) throw new UserError("Catalogue entry not found.");
  if (await db.catalogueCorrection.findFirst({ where: { tenantId: ctx.tenantId, gid: i.gid, field: i.field, status: "open" }, select: { id: true } })) throw new UserError("You already have an open correction for this field.");
  if ((await db.catalogueCorrection.count({ where: { tenantId: ctx.tenantId, status: "open" } })) >= 50) throw new UserError("You have 50 corrections waiting for review. Wait for Medoro to work through them.");
  const c = await db.catalogueCorrection.create({ data: { tenantId: ctx.tenantId, gid: i.gid, field: i.field, proposed: i.proposed, reason: i.reason, createdBy: ctx.userId, createdByName: ctx.userName } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Catalogue correction requested", entity: "catalogue_correction", entityId: c.id, detail: `${i.gid} · ${i.field} → ${i.proposed.slice(0, 80)}` });
  return c.id;
}
export async function myCorrections(ctx: Ctx) {
  authorizeView(ctx, ...VIEW);
  return (await db.catalogueCorrection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 })).map((c) => ({ id: c.id, gid: c.gid, field: c.field, proposed: c.proposed, status: c.status, note: c.resolutionNote, at: c.createdAt.toISOString() }));
}

/** Where this pharmacy stands against the catalogue: the version, and how many entries it uses have changed since it last reviewed. */
export async function syncStatus(ctx: Ctx) {
  authorizeView(ctx, ...VIEW);
  const [v, seen, linked, unlinked] = await Promise.all([version(), setting(ctx.tenantId), db.medicine.findMany({ where: { tenantId: ctx.tenantId, catalogueGid: { not: null } }, select: { catalogueGid: true } }), db.medicine.count({ where: { tenantId: ctx.tenantId, active: true, catalogueGid: null } })]);
  const gids = [...new Set(linked.map((l) => l.catalogueGid!))];
  const changes = gids.length ? await db.catalogueChange.findMany({ where: { gid: { in: gids }, seq: { gt: BigInt(seen) }, action: { in: ["update", "verify", "deprecate", "correction_accepted", "barcode_add", "barcode_verify"] } }, orderBy: { seq: "asc" }, take: 200, select: { seq: true, gid: true, action: true, at: true } }) : [];
  return { catalogueVersion: v, reviewedVersion: seen, linked: linked.length, unlinked, changedEntries: [...new Set(changes.map((c) => c.gid))].length, changes: changes.map((c) => ({ seq: Number(c.seq), gid: c.gid, action: c.action, at: c.at.toISOString() })) };
}
export async function markCatalogueReviewed(ctx: Ctx) {
  authorizeAny(ctx, ...MANAGE);
  const v = await version(), t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...((t.settings as object) ?? {}), catalogue: { reviewedSeq: v } } } });
  return v;
}
