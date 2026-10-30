import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { big } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { internalCode } from "@/lib/barcode";
import { fmtQty } from "@/lib/units";
import { isSellable, fefoOrder } from "./fefo";
import { compositionOf, parseComposition, searchTokens, similarity, squash } from "./salts";
import { createMedicineIn } from "./service";
import SAMPLE from "./salts-sample.json";

// ───────────── Search ─────────────

/**
 * Catalogue search for the counter: a full barcode (manufacturer's or Medoro's internal code) finds the item
 * directly; otherwise every token must match the brand, the generic or the composition, so "para 500" finds
 * every Paracetamol 500mg brand. With no hit, a trigram similarity pass forgives typos ("paracetmol").
 */
export async function searchCatalog(tenantId: string, q: string, take = 8) {
  const term = q.trim();
  if (!term) return { meds: [], barcodeHit: false };
  if (/^\d{6,}$/.test(term)) {
    const exact = await db.medicine.findMany({ where: { tenantId, active: true, barcode: term } });
    if (exact.length) return { meds: exact, barcodeHit: true };
  }
  const tokens = searchTokens(term);
  const field = (t: string) => ({ OR: [{ name: { contains: t, mode: "insensitive" as const } }, { generic: { contains: t, mode: "insensitive" as const } }, { composition: { contains: t, mode: "insensitive" as const } }] });
  const found = await db.medicine.findMany({ where: { tenantId, active: true, AND: tokens.map(field) }, orderBy: { name: "asc" }, take: 60 });
  const lc = term.toLowerCase(), sq = squash(term);
  const rank = (m: { name: string; generic: string }) => (m.name.toLowerCase().startsWith(lc) || squash(m.name).startsWith(sq) ? 0 : m.name.toLowerCase().includes(lc) ? 1 : m.generic.toLowerCase().startsWith(lc) ? 2 : 3);
  if (found.length) return { meds: found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, take), barcodeHit: false };
  if (term.length < 3) return { meds: [], barcodeHit: false };
  const head = term.slice(0, 2);
  const pool = await db.medicine.findMany({ where: { tenantId, active: true, OR: [{ name: { startsWith: head, mode: "insensitive" } }, { generic: { startsWith: head, mode: "insensitive" } }, { composition: { startsWith: head, mode: "insensitive" } }] }, take: 500 });
  const scored = pool.map((m) => ({ m, s: Math.max(similarity(term, m.name), similarity(term, m.generic), ...(m.composition ? parseComposition(m.composition).map((x) => similarity(term, x.name)) : [])) }))
    .filter((x) => x.s >= 0.3).sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name));
  return { meds: scored.slice(0, take).map((x) => x.m), barcodeHit: false };
}

// ───────────── Racks ─────────────

/** Branch rack overrides: medicineId → rack. */
export async function branchRacks(tenantId: string, branchId: string) {
  const rows = await db.medicineRack.findMany({ where: { tenantId, branchId }, select: { medicineId: true, rack: true } });
  return new Map(rows.map((r) => [r.medicineId, r.rack]));
}

/** Sets this branch's rack for a medicine; blank clears it so the catalogue rack applies again. */
export async function setBranchRack(ctx: Ctx, medicineId: string, rack: string) {
  authorizeAny(ctx, "adjust", "purchase");
  const r = rack.trim().slice(0, 20);
  const m = await db.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } });
  if (!m) throw new UserError("Medicine not found.");
  await db.$transaction(async (tx) => {
    if (r) await tx.medicineRack.upsert({ where: { branchId_medicineId: { branchId: ctx.branchId, medicineId } }, create: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId, rack: r }, update: { rack: r } });
    else await tx.medicineRack.deleteMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Rack updated", entity: "medicine", entityId: medicineId, detail: `${m.name} · ${ctx.branchName}: ${r || `cleared (uses ${m.rack ?? "none"})`}` });
  });
}

/** Racks in use at this branch (overrides and catalogue racks), for the rack filter. */
export async function racksInUse(ctx: Ctx) {
  const [over, cat] = await Promise.all([
    db.medicineRack.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, select: { rack: true }, distinct: ["rack"] }),
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, rack: { not: null } }, select: { rack: true }, distinct: ["rack"] }),
  ]);
  return [...new Set([...over.map((x) => x.rack), ...cat.map((x) => x.rack!)])].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

// ───────────── Substitutes ─────────────

type Med = { id: string; name: string; manufacturer: string; mrpPaise: bigint; gstRate: number; packSize: number; packUnit: string; looseUnit: string; unitsPerPack: number; composition: string | null; rack: string | null };

/** Price of one dose unit, to compare a strip of 10 with a strip of 15. */
const perUnit = (mrp: number, m: Pick<Med, "packSize" | "unitsPerPack">) => mrp / (m.packSize > 1 ? m.packSize : Math.max(1, m.unitsPerPack));

/**
 * Same-composition medicines with this branch's stock, in stock first, then cheapest per unit (or best
 * margin). Price is the next FEFO batch's MRP; margin is MRP net of GST over batch cost.
 */
export async function substitutesFor(ctx: Ctx, medicineId: string, sort: "price" | "margin" = "price") {
  const m = await db.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } });
  if (!m?.saltKey) return [];
  const alts = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, saltKey: m.saltKey, NOT: { id: m.id } }, take: 40 });
  return rankSubstitutes(ctx, alts, sort);
}

export async function rankSubstitutes(ctx: Ctx, alts: Med[], sort: "price" | "margin" = "price") {
  const today = todayISO();
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: alts.map((a) => a.id) }, qtyAvailable: { gt: 0 } } });
  const racks = await branchRacks(ctx.tenantId, ctx.branchId);
  const rows = alts.map((a) => {
    const mine = batches.filter((b) => b.medicineId === a.id);
    const stock = mine.filter((b) => isSellable(b, today)).reduce((s, b) => s + b.qtyAvailable, 0);
    const next = fefoOrder(mine, a.id, today)[0];
    const mrp = next ? big(next.mrpPaise) : big(a.mrpPaise);
    const net = (mrp * 100) / (100 + a.gstRate);
    const margin = next ? Math.round(((net - big(next.costPaise)) / net) * 1000) / 10 : null;
    return { id: a.id, name: a.name, manufacturer: a.manufacturer, composition: a.composition, stock, stockText: fmtQty(stock, a), inStock: stock > 0, mrp, perUnit: Math.round(perUnit(mrp, a)), margin, rack: racks.get(a.id) ?? a.rack };
  });
  return rows.sort((x, y) => Number(y.inStock) - Number(x.inStock) || (sort === "margin" ? (y.margin ?? -999) - (x.margin ?? -999) : x.perUnit - y.perUnit) || x.name.localeCompare(y.name));
}

// ───────────── Composition maintenance ─────────────

/** Recomputes composition text and substitute keys for every medicine (after an import or a rule change). */
export async function rebuildSaltKeys(ctx: Ctx) {
  authorizeAny(ctx, "adjust", "purchase");
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, composition: true, generic: true, strength: true, saltKey: true } });
  let changed = 0;
  for (const m of meds) {
    const c = compositionOf(m);
    if (c.composition === m.composition && c.saltKey === m.saltKey) continue;
    await db.medicine.update({ where: { id: m.id }, data: { ...c, version: { increment: 1 } } });
    changed++;
  }
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Composition keys rebuilt", entity: "medicine", detail: `${changed} of ${meds.length} medicines updated` });
  return { changed, total: meds.length };
}

type SampleRow = { name: string; composition: string; form: string; manufacturer: string; packSize: number; packUnit: string; looseUnit: string; mrp: number; gstRate: number; schedule: string };
export const SAMPLE_SALTS = SAMPLE as SampleRow[];

/**
 * Adds the bundled sample of common Indian brands with their salts. Brands already in the catalogue get their
 * composition filled in (never overwritten); missing ones are created with no stock. MRPs are indicative:
 * each batch is sold at the MRP entered when it is received.
 */
export async function importSampleSalts(ctx: Ctx) {
  authorizeAny(ctx, "adjust", "purchase");
  let created = 0, enriched = 0;
  await db.$transaction(async (tx) => {
    for (const s of SAMPLE_SALTS) {
      const salts = parseComposition(s.composition);
      const generic = salts.map((x) => x.name).join(" + "), strength = salts.map((x) => x.strength).join(" + ");
      const found = await tx.medicine.findFirst({ where: { tenantId: ctx.tenantId, active: true, name: { equals: s.name, mode: "insensitive" } } });
      if (found) {
        if (found.composition && found.saltKey) continue;
        await tx.medicine.update({ where: { id: found.id }, data: { ...compositionOf({ composition: s.composition, generic, strength }), version: { increment: 1 } } });
        enriched++;
        continue;
      }
      await createMedicineIn(tx, ctx, {
        name: s.name, generic, strength, form: s.form as never, manufacturer: s.manufacturer, pack: s.packSize > 1 ? `${s.packSize} ${s.looseUnit}s` : "", mrp: s.mrp,
        gstRate: s.gstRate, schedule: s.schedule as never, reorderLevel: 0, barcode: "", hsn: "3004", rack: "", composition: s.composition,
        packSize: s.packSize, packUnit: s.packUnit, looseUnit: s.looseUnit, allowLoose: s.packSize > 1 && (s.form === "Tablet" || s.form === "Capsule"), caseSize: 1, caseUnit: "box",
      });
      created++;
    }
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Sample salts imported", entity: "medicine", detail: `${created} medicines added, ${enriched} given a composition` });
  }, { timeout: 60000 });
  return { created, enriched };
}

// ───────────── Barcodes and labels ─────────────

/** Gives medicines without a barcode an in-store EAN-13 (prefix 29 + number + check digit). */
export async function assignInternalBarcodes(ctx: Ctx, medicineIds: string[]) {
  authorizeAny(ctx, "adjust", "purchase");
  return db.$transaction(async (tx) => {
    const meds = await tx.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: medicineIds }, barcode: null } });
    for (const m of meds) {
      let code = "";
      do code = internalCode(await nextSeq(tx, ctx.tenantId, "BARCODE"));
      while (await tx.medicine.findFirst({ where: { tenantId: ctx.tenantId, barcode: code }, select: { id: true } }));
      await tx.medicine.update({ where: { id: m.id }, data: { barcode: code, version: { increment: 1 } } });
    }
    if (meds.length) await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Internal barcodes assigned", entity: "medicine", detail: `${meds.length} medicine${meds.length > 1 ? "s" : ""}: ${meds.map((m) => m.name).slice(0, 5).join(", ")}${meds.length > 5 ? "…" : ""}` });
    return meds.length;
  });
}

export type Label = { key: string; name: string; strength: string; batchNo: string | null; expiry: string | null; mrp: number; code: string | null; rack: string | null; pack: string };

/** Label rows: one per batch (or one per medicine with no batch here), repeated `copies` times. */
export async function labelRows(ctx: Ctx, sel: { batchIds?: string[]; medicineIds?: string[] }, copies = 1): Promise<Label[]> {
  const n = Math.min(Math.max(1, Math.floor(copies) || 1), 100);
  const batches = await db.batch.findMany({
    where: { tenantId: ctx.tenantId, branchId: ctx.branchId, OR: [{ id: { in: sel.batchIds ?? [] } }, { medicineId: { in: sel.medicineIds ?? [] }, qtyAvailable: { gt: 0 } }] },
    include: { medicine: true }, orderBy: [{ medicine: { name: "asc" } }, { expiryDate: "asc" }],
  });
  const withBatch = new Set(batches.map((b) => b.medicineId));
  const bare = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: (sel.medicineIds ?? []).filter((id) => !withBatch.has(id)) } }, orderBy: { name: "asc" } });
  const racks = await branchRacks(ctx.tenantId, ctx.branchId);
  const pack = (m: { pack: string; packSize: number; packUnit: string; looseUnit: string }) => (m.packSize > 1 ? `${m.packUnit} of ${m.packSize} ${m.looseUnit}` : m.pack);
  const rows: Label[] = [
    ...batches.map((b) => ({ key: b.id, name: b.medicine.name, strength: b.medicine.strength, batchNo: b.batchNo, expiry: b.expiryDate.toISOString().slice(0, 10), mrp: big(b.mrpPaise), code: b.medicine.barcode, rack: racks.get(b.medicineId) ?? b.medicine.rack, pack: pack(b.medicine) })),
    ...bare.map((m) => ({ key: m.id, name: m.name, strength: m.strength, batchNo: null, expiry: null, mrp: big(m.mrpPaise), code: m.barcode, rack: racks.get(m.id) ?? m.rack, pack: pack(m) })),
  ];
  return rows.flatMap((r) => Array.from({ length: n }, (_, i) => ({ ...r, key: `${r.key}:${i}` }))).slice(0, 600);
}
