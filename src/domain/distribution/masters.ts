import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { zId } from "@/lib/id";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { GST_STATES, validGstin } from "@/domain/accounting/gst";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { distAuthorize, distView } from "./context";
import { audit, lockKey, num, requireDistRoom } from "./common";
import { dlExpiryProblem, dlProblem, normaliseDl } from "./rules/licence";

const rupees = (msg = "Enter an amount.") => z.union([z.string(), z.number()]).transform((v, c) => {
  const s = String(v).trim().replace(/,/g, "");
  const n = s === "" ? 0 : Number(s);
  if (!Number.isFinite(n) || n < 0) { c.addIssue({ code: "custom", message: msg }); return 0; }
  return Math.round(n * 100);
});
const intIn = (min: number, max: number, d: number) => z.union([z.string(), z.number()]).optional().transform((v) => (v == null || String(v).trim() === "" ? d : Number(v))).pipe(z.number({ message: "Enter a whole number." }).int("Enter a whole number.").min(min, `Must be at least ${min}.`).max(max, `Must be at most ${max}.`));
const pct = z.union([z.string(), z.number()]).transform((v) => (String(v).trim() === "" ? 0 : Number(v))).pipe(z.number().min(0, "Percent can’t be negative.").max(100, "Percent can’t be above 100."));
const opt = (max = 120) => z.string().trim().max(max).default("");
const gstinField = z.string().trim().toUpperCase().default("").refine((g) => !g || validGstin(g), "GSTIN is not valid (checksum failed).");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
const P2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ───────────── Companies & principals ─────────────

export const companySchema = z.object({ name: z.string().trim().min(2, "Company name is required.").max(120), shortName: opt(20), gstin: gstinField, contact: opt(), phone: opt(20), email: opt(), address: opt(240), active: z.boolean().default(true) });

export async function listCompanies(ctx: Ctx) {
  distView(ctx, "masters", "order", "purchase", "reports");
  const [rows, counts] = await Promise.all([
    db.distCompany.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" } }),
    db.distProduct.groupBy({ by: ["companyId"], where: { tenantId: ctx.tenantId }, _count: true }),
  ]);
  return rows.map((c) => ({ ...c, products: counts.find((x) => x.companyId === c.id)?._count ?? 0 }));
}

export async function saveCompany(ctx: Ctx, id: string | null, raw: z.input<typeof companySchema>) {
  distAuthorize(ctx, "masters");
  const i = companySchema.parse(raw);
  const data = { name: i.name, shortName: i.shortName || null, gstin: i.gstin || null, contact: i.contact || null, phone: i.phone || null, email: i.email || null, address: i.address || null, active: i.active };
  try {
    return await db.$transaction(async (tx) => {
      const c = id
        ? await tx.distCompany.update({ where: { id: (await tx.distCompany.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } })).id }, data })
        : await tx.distCompany.create({ data: { tenantId: ctx.tenantId, ...data } });
      await audit(tx, ctx, id ? "Company updated" : "Company added", "dist_company", c.id, c.name);
      return c.id;
    });
  } catch (e) { if (P2002(e)) throw new UserError("A company with this name already exists."); throw e; }
}

export const principalSchema = z.object({
  companyId: zId("Choose the company."), supplierId: z.string().default(""), agreementNo: opt(60), divisions: z.string().default(""),
  startDate: z.string().default(""), endDate: z.string().default(""), marginPct: pct.default(10),
  claimBeforeDays: intIn(0, 365, 90), claimAfterDays: intIn(0, 730, 180), claimCreditPct: pct.default(100), active: z.boolean().default(true),
});

export async function listPrincipals(ctx: Ctx) {
  distView(ctx, "masters", "purchase", "reports");
  const [rows, companies, suppliers] = await Promise.all([
    db.distPrincipal.findMany({ where: { tenantId: ctx.tenantId } }),
    db.distCompany.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
  ]);
  return rows.map((p) => ({ ...p, company: companies.find((c) => c.id === p.companyId)?.name ?? "—", supplier: suppliers.find((s) => s.id === p.supplierId)?.name ?? null, marginPct: num(p.marginPct), claimCreditPct: num(p.claimCreditPct) }))
    .sort((a, b) => a.company.localeCompare(b.company));
}

export async function savePrincipal(ctx: Ctx, id: string | null, raw: z.input<typeof principalSchema>) {
  distAuthorize(ctx, "masters");
  const i = principalSchema.parse(raw);
  if (i.startDate && i.endDate && i.endDate < i.startDate) throw new UserError("Agreement end date is before its start.");
  const company = await db.distCompany.findFirst({ where: { id: i.companyId, tenantId: ctx.tenantId } });
  if (!company) throw new UserError("Company not found.");
  if (i.supplierId && !(await db.supplier.findFirst({ where: { id: i.supplierId, tenantId: ctx.tenantId } }))) throw new UserError("Supplier not found.");
  const data = {
    companyId: company.id, supplierId: i.supplierId || null, agreementNo: i.agreementNo || null, divisions: i.divisions.split(",").map((d) => d.trim()).filter(Boolean),
    startDate: i.startDate ? dateOnly(i.startDate) : null, endDate: i.endDate ? dateOnly(i.endDate) : null, marginPct: i.marginPct,
    claimBeforeDays: i.claimBeforeDays, claimAfterDays: i.claimAfterDays, claimCreditPct: i.claimCreditPct, active: i.active,
  };
  try {
    return await db.$transaction(async (tx) => {
      const p = id
        ? await tx.distPrincipal.update({ where: { id: (await tx.distPrincipal.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } })).id }, data })
        : await tx.distPrincipal.create({ data: { tenantId: ctx.tenantId, ...data } });
      await audit(tx, ctx, id ? "Principal updated" : "Principal added", "dist_principal", p.id, `${company.name} · claims ${i.claimBeforeDays}d before / ${i.claimAfterDays}d after expiry at ${i.claimCreditPct}%`);
      return p.id;
    });
  } catch (e) { if (P2002(e)) throw new UserError(`${company.name} is already a principal.`); throw e; }
}

// ───────────── Products ─────────────

export const productSchema = z.object({
  name: z.string().trim().min(2, "Product name is required.").max(120),
  generic: opt(160), strength: opt(40), form: z.string().trim().min(2, "Enter the form (tablet, syrup…).").max(40), pack: z.string().trim().min(1, "Enter the pack (10 tabs, 100 ml…).").max(40),
  companyId: z.string().default(""), division: opt(60),
  hsn: z.string().trim().regex(/^\d{4,8}$/, "HSN is 4 to 8 digits."),
  gstRate: z.coerce.number().refine((r) => [0, 5, 12, 18, 28].includes(r), "Choose the GST rate."),
  mrp: rupees("Enter the MRP.").refine((p) => p > 0, "Enter the MRP."), ptr: rupees("Enter the PTR.").refine((p) => p > 0, "Enter the PTR."), pts: rupees().default(0),
  schedule: z.enum(["", "H", "H1", "X", "G"]).default(""), barcode: opt(32), packSize: intIn(1, 10000, 1), caseSize: intIn(1, 10000, 1), minOrderQty: intIn(1, 10000, 1),
  reorderLevel: intIn(0, 1_000_000, 0), portalVisible: z.boolean().default(true), discontinued: z.boolean().default(false),
}).superRefine((p, c) => {
  const mrpEx = (p.mrp * 100) / (100 + p.gstRate);
  if (p.ptr > mrpEx) c.addIssue({ code: "custom", path: ["ptr"], message: "PTR plus GST is above the MRP. Check the rates." });
  if (p.pts && p.pts > p.ptr) c.addIssue({ code: "custom", path: ["pts"], message: "PTS should not be above PTR." });
});
export type ProductInput = z.input<typeof productSchema>;

export async function listProducts(ctx: Ctx, opts: { q?: string; companyId?: string; take?: number } = {}) {
  distView(ctx, "masters", "order", "bill", "purchase", "warehouse", "reports");
  const q = (opts.q ?? "").trim();
  const meds = await db.medicine.findMany({
    where: { tenantId: ctx.tenantId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { generic: { contains: q, mode: "insensitive" } }, { barcode: q }] } : {}) },
    orderBy: { name: "asc" }, take: opts.take ?? 300,
  });
  const ids = meds.map((m) => m.id);
  const [dp, companies, stock] = await Promise.all([
    db.distProduct.findMany({ where: { tenantId: ctx.tenantId, medicineId: { in: ids } } }),
    db.distCompany.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    db.batch.groupBy({ by: ["medicineId"], where: { tenantId: ctx.tenantId, medicineId: { in: ids }, status: "ok", expiryDate: { gt: dateOnly(todayISO()) } }, _sum: { qtyAvailable: true } }),
  ]);
  return meds.map((m) => {
    const d = dp.find((x) => x.medicineId === m.id);
    return {
      id: m.id, name: m.name, generic: m.generic, strength: m.strength, form: m.form, pack: m.pack, hsn: m.hsn, gstRate: m.gstRate, mrp: num(m.mrpPaise), schedule: m.schedule, barcode: m.barcode,
      packSize: m.packSize, caseSize: m.caseSize, reorderLevel: m.reorderLevel, active: m.active, version: m.version,
      companyId: d?.companyId ?? null, company: companies.find((c) => c.id === d?.companyId)?.name ?? m.manufacturer, division: d?.division ?? null,
      ptr: num(d?.ptrPaise), pts: num(d?.ptsPaise), minOrderQty: d?.minOrderQty ?? 1, portalVisible: d?.portalVisible ?? false, discontinued: d?.discontinued ?? false, distReady: !!d,
      stockUnits: stock.find((s) => s.medicineId === m.id)?._sum.qtyAvailable ?? 0,
    };
  }).filter((p) => !opts.companyId || p.companyId === opts.companyId);
}

export async function saveProduct(ctx: Ctx, id: string | null, raw: ProductInput, version?: number) {
  distAuthorize(ctx, "masters");
  const i = productSchema.parse(raw);
  const company = i.companyId ? await db.distCompany.findFirst({ where: { id: i.companyId, tenantId: ctx.tenantId } }) : null;
  if (i.companyId && !company) throw new UserError("Company not found.");
  const principal = company ? await db.distPrincipal.findFirst({ where: { tenantId: ctx.tenantId, companyId: company.id } }) : null;
  const med = {
    name: i.name, generic: i.generic || i.name, strength: i.strength, form: i.form, pack: i.pack, manufacturer: company?.name ?? "", hsn: i.hsn, gstRate: i.gstRate,
    mrpPaise: BigInt(i.mrp), schedule: i.schedule || null, barcode: i.barcode || null, packSize: i.packSize, caseSize: i.caseSize, reorderLevel: i.reorderLevel, active: !i.discontinued,
  };
  const dist = { companyId: company?.id ?? null, principalId: principal?.id ?? null, division: i.division || null, ptrPaise: BigInt(i.ptr), ptsPaise: BigInt(i.pts), minOrderQty: i.minOrderQty, portalVisible: i.portalVisible, discontinued: i.discontinued };
  try {
    return await db.$transaction(async (tx) => {
      let mid: string;
      if (id) {
        const r = await tx.medicine.updateMany({ where: { id, tenantId: ctx.tenantId, ...(version === undefined ? {} : { version }) }, data: { ...med, version: { increment: 1 } } });
        if (!r.count) throw new UserError("Someone else changed this product. Reopen it and try again.");
        mid = id;
      } else mid = (await tx.medicine.create({ data: { tenantId: ctx.tenantId, ...med } })).id;
      await tx.distProduct.upsert({ where: { medicineId: mid }, create: { medicineId: mid, tenantId: ctx.tenantId, ...dist }, update: dist });
      await audit(tx, ctx, id ? "Product updated" : "Product added", "dist_product", mid, `${i.name} · PTR ₹${(i.ptr / 100).toFixed(2)} · MRP ₹${(i.mrp / 100).toFixed(2)} · GST ${i.gstRate}%`);
      return mid;
    });
  } catch (e) { if (P2002(e)) throw new UserError("Another product has this barcode."); throw e; }
}

// ───────────── Chemists ─────────────

export const chemistSchema = z.object({
  name: z.string().trim().min(2, "Firm name is required.").max(120), ownerName: opt(), phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, "Enter a 10-digit mobile number.").or(z.literal("")).default(""),
  gstin: gstinField, stateCode: z.string().trim().refine((c) => !c || GST_STATES.some(([k]) => k === c), "Choose the state.").default(""),
  address: opt(240), pincode: z.string().trim().regex(/^\d{6}$/, "PIN code is 6 digits.").or(z.literal("")).default(""),
  dl20b: z.string().default(""), dl21b: z.string().default(""), dlExpiry: z.string().default(""),
  creditLimit: rupees("Credit limit can’t be negative.").default(0), creditDays: intIn(0, 180, 21), graceDays: intIn(0, 90, 7),
  territoryId: z.string().default(""), salesmanId: z.string().default(""), priceTier: z.enum(["ptr", "pts"]).default("ptr"), opening: rupees("Opening balance can’t be negative.").default(0),
}).superRefine((c, x) => {
  for (const [k, label] of [["dl20b", "Form 20B licence"], ["dl21b", "Form 21B licence"]] as const) {
    const p = dlProblem(c[k], label);
    if (p) x.addIssue({ code: "custom", path: [k], message: p });
  }
  const e = dlExpiryProblem(c.dlExpiry, todayISO());
  if (e) x.addIssue({ code: "custom", path: ["dlExpiry"], message: e });
  if (c.gstin && c.stateCode && c.gstin.slice(0, 2) !== c.stateCode) x.addIssue({ code: "custom", path: ["stateCode"], message: "The state doesn’t match the GSTIN." });
});
export type ChemistInput = z.input<typeof chemistSchema>;

export async function listChemists(ctx: Ctx, opts: { q?: string; territoryId?: string; salesmanId?: string; status?: string } = {}) {
  distView(ctx, "masters", "order", "bill", "payments", "reports", "approve");
  const q = (opts.q ?? "").trim();
  const profiles = await db.distChemist.findMany({
    where: { tenantId: ctx.tenantId, ...(opts.territoryId ? { territoryId: opts.territoryId } : {}), ...(opts.salesmanId ? { salesmanId: opts.salesmanId } : {}), ...(opts.status ? { status: opts.status } : {}) },
  });
  const custs = await db.customer.findMany({ where: { tenantId: ctx.tenantId, id: { in: profiles.map((p) => p.customerId) }, erasedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { gstin: { contains: q.toUpperCase() } }] } : {}) }, orderBy: { name: "asc" } });
  const [terr, sm] = await Promise.all([
    db.distTerritory.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    db.distSalesman.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
  ]);
  return custs.map((c) => {
    const p = profiles.find((x) => x.customerId === c.id)!;
    return {
      id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, stateCode: c.stateCode, address: c.address, pincode: c.pincode, creditLimit: num(c.creditLimitPaise), version: c.version,
      ownerName: p.ownerName, dl20b: p.dl20b, dl21b: p.dl21b, dlExpiry: p.dlExpiry ? isoOf(p.dlExpiry) : null, creditDays: p.creditDays, graceDays: p.graceDays,
      territoryId: p.territoryId, territory: terr.find((t) => t.id === p.territoryId)?.name ?? null, salesmanId: p.salesmanId, salesman: sm.find((s) => s.id === p.salesmanId)?.name ?? null,
      priceTier: p.priceTier, status: p.status, statusNote: p.statusNote, kycVerified: !!p.kycVerifiedAt, portal: !!p.portalAccountId,
    };
  });
}

export async function saveChemist(ctx: Ctx, id: string | null, raw: ChemistInput, version?: number) {
  distAuthorize(ctx, "masters");
  const i = chemistSchema.parse(raw);
  const [terr, sm] = await Promise.all([
    i.territoryId ? db.distTerritory.findFirst({ where: { id: i.territoryId, tenantId: ctx.tenantId } }) : null,
    i.salesmanId ? db.distSalesman.findFirst({ where: { id: i.salesmanId, tenantId: ctx.tenantId } }) : null,
  ]);
  if (i.territoryId && !terr) throw new UserError("Territory not found.");
  if (i.salesmanId && !sm) throw new UserError("Salesman not found.");
  if (!id) await requireDistRoom(ctx.tenantId, "chemists", await db.distChemist.count({ where: { tenantId: ctx.tenantId } }));
  const phone = i.phone ? i.phone.replace(/^\+91/, "") : null;
  return db.$transaction(async (tx) => {
    if (phone && (await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone, ...(id ? { NOT: { id } } : {}) } }))) throw new UserError("Another chemist has this mobile number.");
    const cust = { name: i.name, phone, gstin: i.gstin || null, stateCode: i.stateCode || (i.gstin ? i.gstin.slice(0, 2) : null), address: i.address || null, pincode: i.pincode || null, creditLimitPaise: BigInt(i.creditLimit) };
    const prof = { ownerName: i.ownerName || null, dl20b: normaliseDl(i.dl20b), dl21b: normaliseDl(i.dl21b), dlExpiry: dateOnly(i.dlExpiry), creditDays: i.creditDays, graceDays: i.graceDays, territoryId: terr?.id ?? null, salesmanId: sm?.id ?? null, priceTier: i.priceTier };
    let cid: string;
    if (id) {
      const before = await tx.distChemist.findFirst({ where: { customerId: id, tenantId: ctx.tenantId } });
      if (!before) throw new UserError("Chemist not found.");
      const r = await tx.customer.updateMany({ where: { id, tenantId: ctx.tenantId, ...(version === undefined ? {} : { version }) }, data: { ...cust, version: { increment: 1 } } });
      if (!r.count) throw new UserError("Someone else changed this chemist. Reopen it and try again.");
      // A changed licence must be checked again before it counts as verified.
      const relicensed = before.dl20b !== prof.dl20b || before.dl21b !== prof.dl21b || isoOf(before.dlExpiry ?? new Date(0)) !== i.dlExpiry;
      await tx.distChemist.update({ where: { customerId: id }, data: { ...prof, ...(relicensed ? { kycVerifiedAt: null, kycVerifiedBy: null } : {}) } });
      cid = id;
    } else {
      cid = (await tx.customer.create({ data: { tenantId: ctx.tenantId, ...cust } })).id;
      await tx.distChemist.create({ data: { customerId: cid, tenantId: ctx.tenantId, ...prof } });
      if (i.opening > 0) {
        distAuthorize(ctx, "payments");
        await postVoucher(tx, { tenantId: ctx.tenantId, type: "journal", userId: ctx.userId, refType: "opening", refId: cid, narration: `Opening balance · ${i.name}`,
          lines: [{ account: ACC.debtors, dr: i.opening, partyType: "customer", partyId: cid }, { account: ACC.opening, cr: i.opening }] });
      }
    }
    await audit(tx, ctx, id ? "Chemist updated" : "Chemist added", "dist_chemist", cid, `${i.name} · DL ${prof.dl20b}/${prof.dl21b} valid to ${i.dlExpiry} · limit ₹${(i.creditLimit / 100).toFixed(0)} · ${i.creditDays} days`);
    return cid;
  });
}

export async function verifyChemistKyc(ctx: Ctx, customerId: string) {
  distAuthorize(ctx, "masters");
  return db.$transaction(async (tx) => {
    const p = await tx.distChemist.findFirst({ where: { customerId, tenantId: ctx.tenantId } });
    if (!p) throw new UserError("Chemist not found.");
    const e = dlExpiryProblem(p.dlExpiry ? isoOf(p.dlExpiry) : null, todayISO());
    if (e) throw new UserError(e);
    await tx.distChemist.update({ where: { customerId }, data: { kycVerifiedAt: new Date(), kycVerifiedBy: ctx.userId } });
    await audit(tx, ctx, "Chemist licence verified", "dist_chemist", customerId, `DL ${p.dl20b}/${p.dl21b} checked against the licence copy`);
  });
}

export async function setChemistStatus(ctx: Ctx, customerId: string, status: "active" | "hold" | "blocked", note: string) {
  distAuthorize(ctx, status === "active" ? "creditOverride" : "masters");
  if (status !== "active" && note.trim().length < 3) throw new UserError("Give a reason.");
  return db.$transaction(async (tx) => {
    const p = await tx.distChemist.findFirst({ where: { customerId, tenantId: ctx.tenantId } });
    if (!p) throw new UserError("Chemist not found.");
    await tx.distChemist.update({ where: { customerId }, data: { status, statusNote: note.trim() || null } });
    await audit(tx, ctx, `Chemist ${status}`, "dist_chemist", customerId, `${p.status} → ${status}${note ? " · " + note : ""}`);
  });
}

// ───────────── Territories & salesmen ─────────────

export const territorySchema = z.object({ code: z.string().trim().toUpperCase().min(1).max(12), name: z.string().trim().min(2, "Territory name is required.").max(80), parentId: z.string().default(""), pincodes: z.string().default("") });

export async function listTerritories(ctx: Ctx) {
  distView(ctx, "masters", "order", "reports");
  return db.distTerritory.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { code: "asc" } });
}

export async function saveTerritory(ctx: Ctx, id: string | null, raw: z.input<typeof territorySchema>) {
  distAuthorize(ctx, "masters");
  const i = territorySchema.parse(raw);
  const pins = i.pincodes.split(/[\s,]+/).filter(Boolean);
  if (pins.some((p) => !/^\d{6}$/.test(p))) throw new UserError("PIN codes are 6 digits, separated by commas.");
  if (i.parentId && (i.parentId === id || !(await db.distTerritory.findFirst({ where: { id: i.parentId, tenantId: ctx.tenantId } })))) throw new UserError("Choose a valid parent territory.");
  const data = { code: i.code, name: i.name, parentId: i.parentId || null, pincodes: pins };
  try {
    return await db.$transaction(async (tx) => {
      const t = id ? await tx.distTerritory.update({ where: { id: (await tx.distTerritory.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } })).id }, data }) : await tx.distTerritory.create({ data: { tenantId: ctx.tenantId, ...data } });
      await audit(tx, ctx, id ? "Territory updated" : "Territory added", "dist_territory", t.id, `${t.code} ${t.name}`);
      return t.id;
    });
  } catch (e) { if (P2002(e)) throw new UserError("That territory code is in use."); throw e; }
}

export const salesmanSchema = z.object({ code: z.string().trim().toUpperCase().min(1).max(12), name: z.string().trim().min(2, "Name is required.").max(80), phone: opt(20), userId: z.string().default(""), territoryIds: z.array(z.string()).default([]), monthlyTarget: rupees().default(0), active: z.boolean().default(true) });

export async function listSalesmen(ctx: Ctx) {
  distView(ctx, "masters", "order", "reports", "payments");
  return db.distSalesman.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" } });
}

export async function saveSalesman(ctx: Ctx, id: string | null, raw: z.input<typeof salesmanSchema>) {
  distAuthorize(ctx, "masters");
  const i = salesmanSchema.parse(raw);
  if (i.userId && !(await db.user.findFirst({ where: { id: i.userId, tenantId: ctx.tenantId } }))) throw new UserError("User not found.");
  const terr = await db.distTerritory.count({ where: { tenantId: ctx.tenantId, id: { in: i.territoryIds } } });
  if (terr !== i.territoryIds.length) throw new UserError("Territory not found.");
  const data = { code: i.code, name: i.name, phone: i.phone || null, userId: i.userId || null, territoryIds: i.territoryIds, monthlyTargetPaise: BigInt(i.monthlyTarget), active: i.active };
  try {
    return await db.$transaction(async (tx) => {
      const s = id ? await tx.distSalesman.update({ where: { id: (await tx.distSalesman.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } })).id }, data }) : await tx.distSalesman.create({ data: { tenantId: ctx.tenantId, ...data } });
      await audit(tx, ctx, id ? "Salesman updated" : "Salesman added", "dist_salesman", s.id, `${s.code} ${s.name}`);
      return s.id;
    });
  } catch (e) { if (P2002(e)) throw new UserError("That code or user is already a salesman."); throw e; }
}

/** The salesman profile linked to the signed-in user, if any. */
export const mySalesman = (ctx: Ctx) => db.distSalesman.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, active: true } });

// ───────────── Godowns & racks ─────────────

export const godownSchema = z.object({ name: z.string().trim().min(2, "Godown name is required.").max(60), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, "Code is 2–6 letters or digits."), address: opt(240), gstin: gstinField, drugLicence: opt(80) });

export async function listGodowns(ctx: Ctx) {
  distView(ctx, "masters", "adjust", "warehouse", "reports");
  const [rows, racks, stock] = await Promise.all([
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
    db.distRack.groupBy({ by: ["branchId"], where: { tenantId: ctx.tenantId }, _count: true }),
    db.$queryRaw<{ branchId: string; v: bigint }[]>`SELECT b."branchId", SUM(b."qtyAvailable"::bigint * b."costPaise" / GREATEST(m."packSize", 1))::bigint v FROM "Batch" b JOIN "Medicine" m ON m.id = b."medicineId" WHERE b."tenantId" = ${ctx.tenantId} GROUP BY b."branchId"`,
  ]);
  return rows.map((b) => ({ ...b, racks: racks.find((r) => r.branchId === b.id)?._count ?? 0, stockValue: num(stock.find((s) => s.branchId === b.id)?.v) }));
}

export async function saveGodown(ctx: Ctx, id: string | null, raw: z.input<typeof godownSchema>) {
  distAuthorize(ctx, "users");
  const i = godownSchema.parse(raw);
  if (!id) await requireDistRoom(ctx.tenantId, "godowns", await db.branch.count({ where: { tenantId: ctx.tenantId, active: true } }));
  const data = { name: i.name, code: i.code, address: i.address || null, gstin: i.gstin || null, drugLicence: i.drugLicence || null };
  try {
    return await db.$transaction(async (tx) => {
      const b = id ? await tx.branch.update({ where: { id: (await tx.branch.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } })).id }, data }) : await tx.branch.create({ data: { tenantId: ctx.tenantId, ...data } });
      await audit(tx, ctx, id ? "Godown updated" : "Godown added", "branch", b.id, `${b.code} ${b.name}`);
      return b.id;
    });
  } catch (e) { if (P2002(e)) throw new UserError("A godown with this name or code exists."); throw e; }
}

export const rackSchema = z.object({ branchId: zId(), code: z.string().trim().toUpperCase().min(1, "Rack code is required.").max(16), zone: opt(30), seq: intIn(0, 100000, 0), coldChain: z.boolean().default(false) });

export async function listRacks(ctx: Ctx, branchId: string) {
  distView(ctx, "masters", "adjust", "warehouse");
  const [racks, placed] = await Promise.all([
    db.distRack.findMany({ where: { tenantId: ctx.tenantId, branchId }, orderBy: [{ seq: "asc" }, { code: "asc" }] }),
    db.medicineRack.groupBy({ by: ["rack"], where: { tenantId: ctx.tenantId, branchId }, _count: true }),
  ]);
  return racks.map((r) => ({ ...r, products: placed.find((p) => p.rack === r.code)?._count ?? 0 }));
}

export async function saveRack(ctx: Ctx, raw: z.input<typeof rackSchema>) {
  distAuthorize(ctx, "adjust");
  const i = rackSchema.parse(raw);
  if (!ctx.branches.some((b) => b.id === i.branchId)) throw new UserError("You don’t have access to that godown.");
  return db.$transaction(async (tx) => {
    const r = await tx.distRack.upsert({ where: { branchId_code: { branchId: i.branchId, code: i.code } }, create: { tenantId: ctx.tenantId, ...i }, update: { zone: i.zone || null, seq: i.seq, coldChain: i.coldChain } });
    await audit(tx, ctx, "Rack saved", "dist_rack", r.id, `${i.code}${i.zone ? " · " + i.zone : ""}`);
    return r.id;
  });
}

/** Places a product on a rack in a godown (the shared MedicineRack row the pharmacy screens also read). */
export async function placeOnRack(ctx: Ctx, branchId: string, medicineId: string, rackCode: string) {
  distAuthorize(ctx, "adjust");
  if (!ctx.branches.some((b) => b.id === branchId)) throw new UserError("You don’t have access to that godown.");
  return db.$transaction(async (tx) => {
    const rack = await tx.distRack.findFirst({ where: { branchId, code: rackCode.trim().toUpperCase(), active: true } });
    if (!rack) throw new UserError("Create the rack first.");
    const m = await tx.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } });
    if (!m) throw new UserError("Product not found.");
    await tx.medicineRack.upsert({ where: { branchId_medicineId: { branchId, medicineId } }, create: { tenantId: ctx.tenantId, branchId, medicineId, rack: rack.code }, update: { rack: rack.code } });
    await audit(tx, ctx, "Product placed on rack", "medicine", medicineId, `${m.name} → ${rack.code}`);
  });
}

// ───────────── Schemes & special rates ─────────────

export const schemeSchema = z.object({
  code: z.string().trim().toUpperCase().min(2, "Scheme code is required.").max(16), name: z.string().trim().min(2).max(80), kind: z.enum(["free", "discount"]),
  medicineId: z.string().default(""), companyId: z.string().default(""), buyQty: intIn(0, 10000, 0), freeQty: intIn(0, 10000, 0), discPct: pct.default(0), minQty: intIn(1, 100000, 1),
  customerIds: z.array(z.string()).default([]), validFrom: isoDate, validTo: isoDate, portal: z.boolean().default(true),
}).superRefine((s, c) => {
  if (!s.medicineId === !s.companyId) c.addIssue({ code: "custom", path: ["medicineId"], message: "Choose either one product or one company." });
  if (s.kind === "free" && (s.buyQty < 1 || s.freeQty < 1)) c.addIssue({ code: "custom", path: ["buyQty"], message: "Enter buy and free quantities (e.g. 10 + 1)." });
  if (s.kind === "discount" && s.discPct <= 0) c.addIssue({ code: "custom", path: ["discPct"], message: "Enter the discount %." });
  if (s.validTo < s.validFrom) c.addIssue({ code: "custom", path: ["validTo"], message: "End date is before the start." });
});

export async function listSchemes(ctx: Ctx, activeOnly = false) {
  distView(ctx, "masters", "order", "bill", "reports");
  const today = dateOnly(todayISO());
  const rows = await db.distScheme.findMany({ where: { tenantId: ctx.tenantId, ...(activeOnly ? { active: true, validFrom: { lte: today }, validTo: { gte: today } } : {}) }, orderBy: [{ active: "desc" }, { validTo: "desc" }] });
  const [meds, cos] = await Promise.all([
    db.medicine.findMany({ where: { id: { in: rows.map((r) => r.medicineId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    db.distCompany.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
  ]);
  return rows.map((s) => ({ ...s, discPct: num(s.discPct), validFrom: isoOf(s.validFrom), validTo: isoOf(s.validTo), target: s.medicineId ? meds.find((m) => m.id === s.medicineId)?.name ?? "—" : `All ${cos.find((c) => c.id === s.companyId)?.name ?? "—"} products` }));
}

export async function saveScheme(ctx: Ctx, id: string | null, raw: z.input<typeof schemeSchema>) {
  distAuthorize(ctx, "masters");
  const i = schemeSchema.parse(raw);
  if (i.medicineId && !(await db.medicine.findFirst({ where: { id: i.medicineId, tenantId: ctx.tenantId } }))) throw new UserError("Product not found.");
  if (i.companyId && !(await db.distCompany.findFirst({ where: { id: i.companyId, tenantId: ctx.tenantId } }))) throw new UserError("Company not found.");
  if (i.customerIds.length && (await db.distChemist.count({ where: { tenantId: ctx.tenantId, customerId: { in: i.customerIds } } })) !== i.customerIds.length) throw new UserError("Chemist not found.");
  const data = { code: i.code, name: i.name, kind: i.kind, medicineId: i.medicineId || null, companyId: i.companyId || null, buyQty: i.kind === "free" ? i.buyQty : 0, freeQty: i.kind === "free" ? i.freeQty : 0, discPct: i.kind === "discount" ? i.discPct : 0, minQty: i.minQty, customerIds: i.customerIds, validFrom: dateOnly(i.validFrom), validTo: dateOnly(i.validTo), portal: i.portal };
  try {
    return await db.$transaction(async (tx) => {
      const s = id ? await tx.distScheme.update({ where: { id: (await tx.distScheme.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } })).id }, data }) : await tx.distScheme.create({ data: { tenantId: ctx.tenantId, createdBy: ctx.userId, ...data } });
      await audit(tx, ctx, id ? "Scheme updated" : "Scheme created", "dist_scheme", s.id, `${i.code} · ${i.kind === "free" ? `${i.buyQty}+${i.freeQty}` : `${i.discPct}%`} · ${i.validFrom} to ${i.validTo}`);
      return s.id;
    });
  } catch (e) { if (P2002(e)) throw new UserError("That scheme code is in use."); throw e; }
}

export async function endScheme(ctx: Ctx, id: string) {
  distAuthorize(ctx, "masters");
  return db.$transaction(async (tx) => {
    const s = await tx.distScheme.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!s) throw new UserError("Scheme not found.");
    await tx.distScheme.update({ where: { id }, data: { active: false } });
    await audit(tx, ctx, "Scheme ended", "dist_scheme", id, s.code);
  });
}

export async function setSpecialRate(ctx: Ctx, customerId: string, medicineId: string, rate: string | number, validTo: string) {
  distAuthorize(ctx, "masters");
  const r = Math.round(Number(rate) * 100);
  if (!Number.isFinite(r) || r <= 0) throw new UserError("Enter the special rate.");
  if (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) throw new UserError("Enter a valid date.");
  return db.$transaction(async (tx) => {
    await lockKey(tx, `rate:${customerId}:${medicineId}`);
    const [c, p] = await Promise.all([tx.distChemist.findFirst({ where: { customerId, tenantId: ctx.tenantId } }), tx.distProduct.findFirst({ where: { medicineId, tenantId: ctx.tenantId } })]);
    if (!c || !p) throw new UserError("Chemist or product not found.");
    await tx.distSpecialRate.upsert({ where: { tenantId_customerId_medicineId: { tenantId: ctx.tenantId, customerId, medicineId } }, create: { tenantId: ctx.tenantId, customerId, medicineId, ratePaise: BigInt(r), validTo: validTo ? dateOnly(validTo) : null, createdBy: ctx.userId }, update: { ratePaise: BigInt(r), validTo: validTo ? dateOnly(validTo) : null, createdBy: ctx.userId } });
    await audit(tx, ctx, "Special rate set", "dist_special_rate", `${customerId}:${medicineId}`, `₹${(r / 100).toFixed(2)}${validTo ? " to " + validTo : ""} (PTR ₹${(num(p.ptrPaise) / 100).toFixed(2)})`);
  });
}
