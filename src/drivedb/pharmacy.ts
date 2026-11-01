/**
 * Pharmacy work on the device database: catalogue, stock in, search, stock levels and billing.
 * Uses the same rules as the server (FEFO batches, MRP-inclusive GST, loose units, Schedule H/H1 checks,
 * GST invoice numbers) from src/lib and src/domain, so a bill comes out the same either way.
 */
import { z } from "zod";
import { DriveDB, DriveDBError } from "./client";
import { allocateUnits, isSellable } from "@/domain/inventory/fefo";
import { cartTotals } from "@/lib/money";
import { baseQty, canSellLoose, unitCost, unitPrice, type SaleUnit } from "@/lib/units";
import { addDays, fiscalYear, istMidnight, todayISO } from "@/lib/dates";
import { gstDocNo, validSeries } from "@/lib/docno";
import { isH1 } from "@/lib/rx";
import { customerBalance } from "./trade";

/** A mistake the person at the counter can fix (shown as-is). */
export class CounterError extends DriveDBError {}

export type Medicine = {
  id: string; name: string; generic: string; strength: string; form: string; manufacturer: string; barcode: string | null;
  hsn: string; gstRate: number; mrpPaise: number; schedule: string | null; packSize: number; packUnit: string; looseUnit: string;
  allowLoose: number; reorderLevel: number; rack: string | null; composition: string | null; active: number;
};
export type Batch = { id: string; branchId: string; medicineId: string; batchNo: string; expiryDate: string; costPaise: number; mrpPaise: number; status: string };
export type BatchStock = Batch & { qtyAvailable: number };

const money = z.number().int().min(0).max(10_000_000_00);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-31.");

export const medicineInput = z.object({
  name: z.string().trim().min(1, "Enter the medicine name.").max(120),
  generic: z.string().trim().max(120).default(""),
  strength: z.string().trim().max(40).default(""),
  form: z.string().trim().max(40).default(""),
  manufacturer: z.string().trim().max(120).default(""),
  barcode: z.string().trim().max(40).nullable().default(null),
  hsn: z.string().trim().max(10).default("3004"),
  gstRate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]),
  mrpPaise: money,
  schedule: z.string().trim().max(10).nullable().default(null),
  packSize: z.number().int().min(1).max(1000).default(1),
  packUnit: z.string().trim().max(20).default("pack"),
  looseUnit: z.string().trim().max(20).default("unit"),
  allowLoose: z.boolean().default(false),
  reorderLevel: z.number().int().min(0).default(0),
  rack: z.string().trim().max(20).nullable().default(null),
  composition: z.string().trim().max(300).nullable().default(null),
});
export type MedicineInput = z.input<typeof medicineInput>;

export function addMedicine(db: DriveDB, input: MedicineInput): Medicine {
  const m = medicineInput.parse(input);
  if (m.barcode && db.from("medicine").eq("barcode", m.barcode).count()) throw new CounterError(`Barcode ${m.barcode} is already on another medicine.`);
  return db.from<Medicine>("medicine").insert({ ...m, active: true })[0];
}

export const stockInput = z.object({
  branchId: z.string().min(1),
  medicineId: z.string().min(1),
  batchNo: z.string().trim().min(1, "Enter the batch number.").max(40),
  expiryDate: isoDate,
  /** Stock units (tabs for a medicine sold loose, else packs). */
  qty: z.number().int().min(1).max(1_000_000),
  costPaise: money,
  mrpPaise: money,
  type: z.enum(["grn", "opening"]).default("grn"),
  refId: z.string().max(64).optional(),
  userId: z.string().min(1),
});

/** Adds stock to a batch (creating the batch the first time). Returns the batch id. */
export function receiveStock(db: DriveDB, input: z.input<typeof stockInput>): string {
  const s = stockInput.parse(input);
  return db.transaction(() => {
    if (!db.from("medicine").eq("id", s.medicineId).count()) throw new CounterError("Medicine not found.");
    const existing = db.from<Batch>("batch").eq("branchId", s.branchId).eq("medicineId", s.medicineId).eq("batchNo", s.batchNo).first();
    const batchId = existing?.id ?? db.from<Batch>("batch").insert({
      branchId: s.branchId, medicineId: s.medicineId, batchNo: s.batchNo, expiryDate: s.expiryDate, costPaise: s.costPaise, mrpPaise: s.mrpPaise, status: "ok",
    })[0].id;
    if (existing && existing.expiryDate !== s.expiryDate) throw new CounterError(`Batch ${s.batchNo} is already in stock with expiry ${existing.expiryDate}. Check the batch number.`);
    db.from("stockMovement").insert({
      branchId: s.branchId, batchId, qty: s.qty, type: s.type, refType: s.type, refId: s.refId ?? batchId, userId: s.userId, at: new Date().toISOString(), note: null,
    });
    return batchId;
  });
}

/** Batches of a medicine in a branch with their current stock, earliest expiry first. */
export function batchesOf(db: DriveDB, medicineId: string, branchId: string): BatchStock[] {
  return db.engine.all<BatchStock>(
    `SELECT b.id, b.branchId, b.medicineId, b.batchNo, b.expiryDate, b.costPaise, b.mrpPaise, b.status,
            COALESCE((SELECT SUM(m.qty) FROM stockMovement m WHERE m.batchId = b.id), 0) AS qtyAvailable
       FROM batch b WHERE b.medicineId = ? AND b.branchId = ? AND b.deletedAt IS NULL ORDER BY b.expiryDate, b.id`,
    [medicineId, branchId],
  ).map((b) => ({ ...b, qtyAvailable: Number(b.qtyAvailable) }));
}

/** Sellable stock units of a medicine in a branch (ok, unexpired batches). */
export function stockOf(db: DriveDB, medicineId: string, branchId: string, today = todayISO()): number {
  return batchesOf(db, medicineId, branchId).filter((b) => isSellable(b, today)).reduce((n, b) => n + b.qtyAvailable, 0);
}

/** Counter search: exact barcode, then names starting with the text, then names containing it. Empty text lists A–Z. */
export function searchMedicines(db: DriveDB, text: string, limit = 20): Medicine[] {
  const q = text.trim();
  if (!q) return db.engine.all<Medicine>("SELECT * FROM medicine WHERE deletedAt IS NULL AND active = 1 ORDER BY name COLLATE NOCASE LIMIT ?", [limit]);
  const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.engine.all<Medicine>(
    `SELECT * FROM medicine WHERE deletedAt IS NULL AND active = 1 AND (barcode = ? OR name LIKE ? ESCAPE '\\' OR generic LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(barcode = ?, 0) DESC, (name LIKE ? ESCAPE '\\') DESC, name COLLATE NOCASE LIMIT ?`,
    [q, `%${esc}%`, `${esc}%`, q, `${esc}%`, limit],
  );
}

export const saleInput = z.object({
  branchId: z.string().min(1),
  /** This counter's invoice series: 1–5 letters/digits starting with a letter, unique per counter (e.g. MAIN1). */
  series: z.string().refine(validSeries, "Counter series must be 1–5 letters or digits, starting with a letter."),
  userId: z.string().min(1),
  lines: z.array(z.object({ medicineId: z.string().min(1), qty: z.number().int().min(1).max(10000), unit: z.enum(["pack", "loose"]).optional() }))
    .min(1, "Cart is empty.").max(200),
  customerId: z.string().nullable().default(null),
  discountPct: z.number().min(0, "Discount can’t be negative.").max(100).default(0),
  /** The pharmacy's discount ceiling (Settings). */
  maxDiscountPct: z.number().min(0).max(100).default(100),
  pay: z.object({
    mode: z.enum(["cash", "upi", "card", "split", "credit"]),
    cashPaise: z.number().int().min(0).optional(),
    tenderedPaise: z.number().int().min(0).optional(),
    ref: z.string().trim().max(60).optional(),
  }),
  prescriber: z.string().trim().max(120).optional(),
  prescriberReg: z.string().trim().max(40).optional(),
  patientName: z.string().trim().max(120).optional(),
  /** Loyalty points the customer spends as part payment. */
  redeemPoints: z.number().int().min(0).max(10_000_000).optional(),
  /** A cash-on-delivery order: billed to the customer's account until the rider collects, outside their credit limit. */
  codDelivery: z.boolean().optional(),
});
export type SaleInput = z.input<typeof saleInput>;
export type SaleResult = { saleId: string; invoiceNo: string; totalPaise: number; duePaise: number; pointsEarned: number; lines: { medicineId: string; batchId: string; batchNo: string; qty: number; unit: SaleUnit }[] };

/**
 * Makes a bill on this device: picks batches FEFO, checks stock, expiry, loose sale and prescription rules,
 * works out GST, numbers the invoice from this counter's series and records stock going out.
 */
export function createSale(db: DriveDB, input: SaleInput, today = todayISO()): SaleResult {
  const s = saleInput.parse(input);
  if (s.discountPct > s.maxDiscountPct) throw new CounterError(`Discounts above ${s.maxDiscountPct}% aren’t allowed.`);
  return db.transaction(() => {
    const used: Record<string, number> = {};
    const meds = new Map<string, Medicine>();
    const lines: { m: Medicine; b: BatchStock; qty: number; unit: SaleUnit; base: number; mrp: number; cost: number }[] = [];
    for (const l of s.lines) {
      const m = meds.get(l.medicineId) ?? db.from<Medicine>("medicine").eq("id", l.medicineId).first();
      if (!m || !m.active) throw new CounterError("A medicine in the cart isn’t in the catalogue any more. Review the cart.");
      meds.set(m.id, m);
      const unit: SaleUnit = l.unit ?? "pack";
      if (unit === "loose" && !canSellLoose({ packSize: m.packSize, allowLoose: !!m.allowLoose })) throw new CounterError(`${m.name} isn’t sold loose. Sell whole ${m.packUnit}s.`);
      const per = baseQty(1, unit, m.packSize);
      let parts;
      try { parts = allocateUnits(batchesOf(db, m.id, s.branchId), m.id, l.qty, per, today, used); }
      catch { throw new CounterError(`Not enough ${m.name} in stock for ${l.qty} ${unit === "loose" ? m.looseUnit : m.packUnit}(s).`); }
      for (const p of parts) {
        used[p.batch.id] = (used[p.batch.id] ?? 0) + p.qty * per;
        lines.push({ m, b: p.batch, qty: p.qty, unit, base: p.qty * per, mrp: unitPrice(p.batch.mrpPaise, unit, m.packSize), cost: unitCost(p.batch.costPaise, unit, m.packSize) });
      }
    }

    const customer = s.customerId ? db.from<{ id: string; name: string; creditLimitPaise: number }>("customer").eq("id", s.customerId).first() : null;
    if (s.customerId && !customer) throw new CounterError("Customer not found.");
    const rx = lines.some((l) => l.m.schedule);
    if (rx && !s.prescriber) throw new CounterError("Enter the prescriber’s name for Schedule H/H1 items.");
    const h1 = lines.some((l) => isH1(l.m.schedule));
    const patientName = s.patientName || (h1 ? customer?.name ?? "" : "");
    if (h1 && (!patientName || !s.prescriberReg)) {
      throw new CounterError(`Schedule H1, X and NDPS items need the ${[!patientName && "patient’s name", !s.prescriberReg && "prescriber’s registration no."].filter(Boolean).join(" and ")} for the register.`);
    }

    const t = cartTotals(lines.map((l) => ({ mrpPaise: l.mrp, qty: l.qty, gstRate: l.m.gstRate, costPaise: l.cost })), s.discountPct);
    if (t.total <= 0) throw new CounterError("The bill total must be more than zero.");

    // Loyalty: points spent are a tender; the bill, its taxable value and GST stay as billed.
    const loyalty = loyaltyOf(db);
    let redeemValue = 0;
    if (s.redeemPoints) {
      if (!loyalty.enabled) throw new CounterError("Loyalty points aren’t switched on.");
      if (!customer) throw new CounterError("Select the customer to use their points.");
      if (s.redeemPoints < loyalty.minRedeem) throw new CounterError(`Use at least ${loyalty.minRedeem} points.`);
      const have = pointsBalance(db, customer.id);
      if (s.redeemPoints > have) throw new CounterError(`${customer.name} has only ${have} points.`);
      redeemValue = s.redeemPoints * loyalty.pointValuePaise;
      if (redeemValue > t.total) throw new CounterError(`Those points are worth more than the bill. Use at most ${Math.floor(t.total / loyalty.pointValuePaise)}.`);
    }
    const due = t.total - redeemValue;

    const pays: { mode: "cash" | "upi" | "card" | "credit"; amountPaise: number }[] = [];
    if (due === 0) {
      // Paid fully with points: no money changes hands.
    } else if (s.pay.mode === "split") {
      const cash = s.pay.cashPaise ?? -1;
      if (cash <= 0 || cash >= due) throw new CounterError("Enter a cash part between ₹1 and the amount to pay.");
      pays.push({ mode: "cash", amountPaise: cash }, { mode: "upi", amountPaise: due - cash });
    } else if (s.pay.mode === "credit") {
      if (!customer) throw new CounterError("Select a customer for a credit sale.");
      const owed = customerBalance(db, customer.id);
      if (!s.codDelivery && owed + due > customer.creditLimitPaise) throw new CounterError(`Exceeds ${customer.name}’s credit limit.`);
      pays.push({ mode: "credit", amountPaise: due });
    } else {
      if (s.pay.mode === "cash" && s.pay.tenderedPaise && s.pay.tenderedPaise < due) throw new CounterError("Cash tendered is less than the total.");
      pays.push({ mode: s.pay.mode, amountPaise: due });
    }

    const fy = fiscalYear(today);
    const invoiceNo = gstDocNo(s.series, fy, db.nextSeq(`INV:${s.series}:${fy}`));
    const at = new Date().toISOString();
    const sale = db.from<{ id: string }>("sale").insert({
      branchId: s.branchId, deviceId: db.device, invoiceNo, customerId: customer?.id ?? null, patientName: patientName || null,
      prescriber: s.prescriber || null, prescriberReg: s.prescriberReg || null,
      subtotalPaise: t.mrpTotal, discountPaise: t.discount, discountPct: s.discountPct, taxablePaise: t.taxable, cgstPaise: t.cgst, sgstPaise: t.sgst,
      roundOffPaise: t.roundOff, totalPaise: t.total, costPaise: t.cost, payMode: s.pay.mode, userId: s.userId, at,
    })[0];
    db.from("saleItem").insert(lines.map((l, i) => ({
      saleId: sale.id, batchId: l.b.id, medicineId: l.m.id, qty: l.qty, loose: l.unit === "loose", packSize: l.m.packSize,
      mrpPaise: l.mrp, discountPaise: t.lines[i].discount, taxablePaise: t.lines[i].taxable, gstRate: l.m.gstRate, costPaise: l.cost,
    })));
    db.from("stockMovement").insert(lines.map((l) => ({
      branchId: s.branchId, batchId: l.b.id, qty: -l.base, type: "sale", refType: "sale", refId: sale.id, userId: s.userId, at, note: invoiceNo,
    })));
    if (pays.length) db.from("payment").insert(pays.map((p) => ({ saleId: sale.id, mode: p.mode, amountPaise: p.amountPaise, ref: p.mode === "upi" || p.mode === "card" ? s.pay.ref ?? null : null })));
    let earned = 0;
    if (customer && loyalty.enabled) {
      if (s.redeemPoints) db.from("loyaltyLedger").insert({ customerId: customer.id, points: -s.redeemPoints, kind: "redeem", refId: sale.id, at });
      earned = Math.max(0, Math.floor((due * loyalty.earnPer100) / 10000));
      if (earned) db.from("loyaltyLedger").insert({ customerId: customer.id, points: earned, kind: "earn", refId: sale.id, at });
    }
    return { saleId: sale.id, invoiceNo, totalPaise: t.total, duePaise: due, pointsEarned: earned, lines: lines.map((l) => ({ medicineId: l.m.id, batchId: l.b.id, batchNo: l.b.batchNo, qty: l.qty, unit: l.unit })) };
  });
}

/** Bills and takings for one day (India time). */
export function dayTotals(db: DriveDB, branchId: string, isoDate: string) {
  const from = istMidnight(isoDate).toISOString(), to = istMidnight(addDays(isoDate, 1)).toISOString();
  const r = db.engine.all<{ bills: number; total: number; tax: number }>(
    "SELECT COUNT(*) AS bills, COALESCE(SUM(totalPaise), 0) AS total, COALESCE(SUM(cgstPaise + sgstPaise + igstPaise), 0) AS tax FROM sale WHERE branchId = ? AND at >= ? AND at < ?",
    [branchId, from, to])[0];
  return { bills: Number(r.bills), totalPaise: Number(r.total), taxPaise: Number(r.tax) };
}

// ---------- loyalty ----------

export type Loyalty = { enabled: boolean; earnPer100: number; pointValuePaise: number; minRedeem: number };
export const LOYALTY_OFF: Loyalty = { enabled: false, earnPer100: 1, pointValuePaise: 100, minRedeem: 50 };
/** The pharmacy's loyalty settings, copied to the device with the catalogue. */
export function loyaltyOf(db: DriveDB): Loyalty {
  const raw = db.getMeta("loyalty");
  return raw ? { ...LOYALTY_OFF, ...(JSON.parse(raw) as Partial<Loyalty>) } : LOYALTY_OFF;
}
export const pointsBalance = (db: DriveDB, customerId: string) =>
  Number(db.engine.all<{ n: number }>("SELECT COALESCE(SUM(points), 0) AS n FROM loyaltyLedger WHERE customerId = ?", [customerId])[0].n);
