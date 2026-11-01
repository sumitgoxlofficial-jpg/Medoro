import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { big, shareOf } from "@/lib/money";
import { isoOf } from "@/lib/dates";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import { counterSettings, deviceMedicine, driveModeOn, ownerOnly } from "./drive-mode";

/**
 * Phase 7: moving a pharmacy's data out of Medoro into its own Google Drive.
 *
 * 1. startMove: Medoro's copy goes read-only, so nothing changes while it is copied.
 * 2. moveExport: the owner's device downloads everything, part by part (each part fits a server response).
 * 3. The device loads it into its own database, checks the counts and totals against `summary`, and saves
 *    it to Drive, encrypted with keys only the pharmacy holds.
 * 4. completeMove: recorded as moved. Medoro's copy stays read-only for 7 days, when the move can still be undone.
 *    Deleting Medoro's copy is a separate step the owner confirms.
 */
export type MoveState = { state: "moving" | "moved"; startedAt: string; by: string; movedAt?: string; device?: string; checks?: number };
export const UNDO_DAYS = 7;
/** Opening balances and stock are dated here, before any real record. */
const OPENING_AT = "2000-01-01T00:00:00.000Z";
const MOVED_FROM = "medoro";

async function stateOf(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const settings = (t.settings ?? {}) as { driveMove?: MoveState };
  return { settings, move: settings.driveMove ?? null };
}

export async function moveStatus(ctx: Ctx) {
  const { move } = await stateOf(ctx.tenantId);
  if (!move) return null;
  const undoUntil = move.movedAt ? new Date(Date.parse(move.movedAt) + UNDO_DAYS * 86400_000).toISOString() : null;
  return { ...move, undoUntil, canUndo: move.state === "moving" || (!!undoUntil && Date.now() < Date.parse(undoUntil)) };
}

async function save(ctx: Ctx, move: MoveState | null, action: string, detail?: string) {
  await db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
    const rest = { ...((t.settings ?? {}) as Record<string, Prisma.InputJsonValue>) };
    delete rest.driveMove;
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: move ? { ...rest, driveMove: move } : rest } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action, entity: "tenant", entityId: ctx.tenantId, detail });
  });
}

/** Freezes Medoro's copy so the device gets a consistent copy. Owner only, Drive mode on. */
export async function startMove(ctx: Ctx) {
  ownerOnly(ctx, "move the pharmacy’s data to Google Drive");
  if (!(await driveModeOn(ctx.tenantId))) throw new UserError("Turn on Drive mode first.");
  const { move } = await stateOf(ctx.tenantId);
  if (move?.state === "moved") throw new UserError("This pharmacy’s data has already moved to Google Drive.");
  if (move) return moveStatus(ctx); // resuming an interrupted move
  await save(ctx, { state: "moving", startedAt: new Date().toISOString(), by: ctx.userName }, "Move to Google Drive started", "Medoro’s copy is read-only while it is copied");
  return moveStatus(ctx);
}

/** The device loaded and checked everything and saved it to Drive. */
export async function completeMove(ctx: Ctx, report: { device: string; checks: number }) {
  ownerOnly(ctx, "move the pharmacy’s data to Google Drive");
  const { move } = await stateOf(ctx.tenantId);
  if (!move) throw new UserError("Start the move first.");
  if (move.state === "moved") return moveStatus(ctx);
  const device = String(report.device ?? "").slice(0, 64), checks = Math.max(0, Math.floor(Number(report.checks) || 0));
  await save(ctx, { ...move, state: "moved", movedAt: new Date().toISOString(), device, checks }, "Data moved to Google Drive",
    `Checked ${checks} counts and totals on device ${device}. Medoro’s copy stays read-only; the move can be undone for ${UNDO_DAYS} days.`);
  return moveStatus(ctx);
}

/** Puts the pharmacy back on Medoro's copy: during the move, or within 7 days after it. */
export async function undoMove(ctx: Ctx) {
  ownerOnly(ctx, "undo the move to Google Drive");
  const st = await moveStatus(ctx);
  if (!st) throw new UserError("Nothing to undo: the data hasn’t moved.");
  if (!st.canUndo) throw new UserError(`The move can only be undone within ${UNDO_DAYS} days.`);
  await save(ctx, null, st.state === "moving" ? "Move to Google Drive cancelled" : "Move to Google Drive undone",
    st.state === "moved" ? "Medoro’s copy is in use again. Bills made on devices since the move are not in it." : undefined);
  return null;
}

// ---------- the export ----------

export const MOVE_PARTS = ["sales", "returns", "purchases", "movements", "loyalty"] as const;
export type MovePart = "base" | (typeof MOVE_PARTS)[number];
const PAGE = { sales: 400, returns: 1000, purchases: 300, movements: 5000, loyalty: 5000 } as const;

const payModeOf = (m: string) => (m === "cod" || m === "loyalty" ? "cash" : m);
/** Credit-note refund modes: money back in cash/UPI, or taken off the customer's dues. */
const refundOf = (m: string) => (m === "UPI refund" ? "upi" : m === "Adjust customer credit" ? "credit" : "cash");
const loyaltyKind = (k: string) => (k === "earn" || k === "redeem" ? k : "return");
const ref = <T extends { id: string }>(rows: T[], take: number) => (rows.length > take ? { rows: rows.slice(0, take), next: rows[take - 1].id } : { rows, next: null });

async function requireMoving(ctx: Ctx) {
  ownerOnly(ctx, "move the pharmacy’s data to Google Drive");
  const { move } = await stateOf(ctx.tenantId);
  if (move?.state !== "moving") throw new UserError("Start the move first (it makes Medoro’s copy read-only so the copy is complete).");
}

/** One part of the pharmacy's data, as the device stores it. Parts other than "base" come in pages: pass back `next`. */
export async function moveExport(ctx: Ctx, part: MovePart, cursor?: string | null) {
  await requireMoving(ctx);
  const t = ctx.tenantId, after = cursor ? { id: { gt: cursor } } : {};
  const voided = { voided: { is: null } };
  switch (part) {
    case "base": return moveBase(ctx);
    case "sales": {
      const sales = await db.sale.findMany({ where: { tenantId: t, ...voided, ...after }, include: { items: true, payments: true }, orderBy: { id: "asc" }, take: PAGE.sales + 1 });
      const page = ref(sales, PAGE.sales);
      // Invoice numbers are unique per branch here but per pharmacy on the device.
      const dup = new Set((await db.sale.groupBy({ by: ["invoiceNo"], where: { tenantId: t, invoiceNo: { in: page.rows.map((s) => s.invoiceNo) } }, _count: true, having: { invoiceNo: { _count: { gt: 1 } } } })).map((g) => g.invoiceNo));
      const codes = new Map(ctx.branches.map((b) => [b.id, b.code]));
      const all = dup.size ? new Map((await db.branch.findMany({ where: { tenantId: t }, select: { id: true, code: true } })).map((b) => [b.id, b.code])) : codes;
      return {
        next: page.next,
        rows: page.rows.map((s) => ({
          sale: {
            id: s.id, branchId: s.branchId, deviceId: MOVED_FROM, invoiceNo: dup.has(s.invoiceNo) ? `${s.invoiceNo}-${all.get(s.branchId) ?? s.branchId.slice(0, 4)}` : s.invoiceNo,
            customerId: s.customerId, patientName: s.patientName, prescriber: s.prescriber, prescriberReg: s.prescriberReg,
            subtotalPaise: big(s.subtotalPaise), discountPaise: big(s.discountPaise), discountPct: Number(s.discountPct), taxablePaise: big(s.taxablePaise),
            cgstPaise: big(s.cgstPaise), sgstPaise: big(s.sgstPaise), igstPaise: big(s.igstPaise), placeOfSupply: s.placeOfSupply,
            roundOffPaise: big(s.roundOffPaise), totalPaise: big(s.totalPaise), costPaise: big(s.costPaise), payMode: payModeOf(s.payMode), userId: s.userId, at: s.at.toISOString(),
          },
          items: s.items.map((i) => ({ id: i.id, saleId: s.id, batchId: i.batchId, medicineId: i.medicineId, qty: i.qty, loose: i.loose, packSize: i.packSize, mrpPaise: big(i.mrpPaise), discountPaise: big(i.discountPaise), taxablePaise: big(i.taxablePaise), gstRate: i.gstRate, costPaise: big(i.costPaise) })),
          // Points paid part of the bill: on the device that is the loyalty ledger, not a payment.
          payments: s.payments.filter((p) => p.mode !== "loyalty").map((p) => ({ id: p.id, saleId: s.id, mode: payModeOf(p.mode), amountPaise: big(p.amountPaise), ref: p.ref })),
        })),
      };
    }
    case "returns": {
      const rets = await db.salesReturn.findMany({ where: { tenantId: t, ...after }, orderBy: { id: "asc" }, take: PAGE.returns + 1 });
      const page = ref(rets, PAGE.returns);
      const saleIds = [...new Set(page.rows.map((r) => r.saleId))];
      const [items, siblings, voids, points] = await Promise.all([
        db.saleItem.findMany({ where: { saleId: { in: saleIds } } }),
        db.salesReturn.findMany({ where: { tenantId: t, saleId: { in: saleIds } }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { id: true, saleId: true, lines: true } }),
        db.saleVoid.findMany({ where: { saleId: { in: saleIds } }, select: { saleId: true } }),
        db.loyaltyLedger.groupBy({ by: ["returnId"], where: { tenantId: t, kind: "restore", returnId: { in: page.rows.map((r) => r.id) } }, _sum: { valuePaise: true } }),
      ]);
      const item = new Map(items.map((i) => [i.id, i])), gone = new Set(voids.map((v) => v.saleId));
      const pts = new Map(points.map((p) => [p.returnId, big(p._sum.valuePaise)]));
      // Each line's taxable share depends on how much of that bill line earlier credit notes took.
      const taxable = new Map<string, number>();
      const done = new Map<string, number>();
      for (const r of siblings) (r.lines as Line[]).forEach((l, n) => {
        const it = item.get(l.itemId);
        if (!it) return;
        const before = done.get(l.itemId) ?? 0;
        taxable.set(`${r.id}:${n}`, shareOf(big(it.taxablePaise), it.qty, before, l.qty));
        done.set(l.itemId, before + l.qty);
      });
      return {
        next: page.next,
        rows: page.rows.filter((r) => !gone.has(r.saleId)).map((r) => {
          const lines = (r.lines as Line[]).flatMap((l, n) => {
            const it = item.get(l.itemId);
            return it ? [{ id: `${r.id}-${n}`, returnId: r.id, saleItemId: it.id, batchId: it.batchId, qty: l.qty, amountPaise: Math.round(l.amount), taxablePaise: taxable.get(`${r.id}:${n}`) ?? 0, restocked: !!l.restocked }] : [];
          });
          return {
            ret: {
              id: r.id, saleId: r.saleId, branchId: r.branchId, deviceId: MOVED_FROM, creditNoteNo: r.creditNoteNo, reason: r.reason || "Return",
              condition: r.condition === "sealed" || r.condition === "opened" ? r.condition : "damaged", refundMode: refundOf(r.refundMode),
              amountPaise: big(r.amountPaise), taxablePaise: lines.reduce((a, l) => a + l.taxablePaise, 0), userId: r.userId, at: r.at.toISOString(), pointsValuePaise: pts.get(r.id) ?? 0,
            },
            lines,
          };
        }),
      };
    }
    case "purchases": {
      const grns = await db.grn.findMany({ where: { tenantId: t, ...after }, include: { items: true }, orderBy: { id: "asc" }, take: PAGE.purchases + 1 });
      const page = ref(grns, PAGE.purchases);
      return {
        next: page.next,
        rows: page.rows.map((g) => {
          const items = g.items.map((i) => {
            const tb = i.basePaise != null ? big(i.basePaise) : i.qty * big(i.ratePaise) - big(i.discPaise);
            return { id: i.id, purchaseId: g.id, batchId: i.batchId, medicineId: i.medicineId, packs: i.qty, freePacks: i.freeQty, costPaise: big(i.ratePaise), mrpPaise: big(i.mrpPaise ?? 0n), gstRate: i.gstRate, taxablePaise: tb, taxPaise: i.gstPaise != null ? big(i.gstPaise) : Math.round((tb * i.gstRate) / 100) };
          });
          return {
            purchase: { id: g.id, branchId: g.branchId, supplierId: g.supplierId, billNo: g.supplierInvoiceNo, billDate: isoOf(g.invoiceDate), taxablePaise: items.reduce((a, i) => a + i.taxablePaise, 0), taxPaise: items.reduce((a, i) => a + i.taxPaise, 0), totalPaise: big(g.totalPaise), userId: g.approvedBy, at: g.approvedAt.toISOString() },
            items,
          };
        }),
      };
    }
    case "movements": {
      const rows = await db.stockMovement.findMany({ where: { tenantId: t, ...after }, orderBy: { id: "asc" }, take: PAGE.movements + 1 });
      const page = ref(rows, PAGE.movements);
      return { next: page.next, rows: page.rows.map((m) => ({ id: m.id, branchId: m.branchId, batchId: m.batchId, qty: m.qty, type: m.type, refType: m.refType, refId: m.refId, userId: m.userId, at: m.at.toISOString(), note: m.note })) };
    }
    case "loyalty": {
      const rows = await db.loyaltyLedger.findMany({ where: { tenantId: t, ...after }, orderBy: { id: "asc" }, take: PAGE.loyalty + 1 });
      const page = ref(rows, PAGE.loyalty);
      return { next: page.next, rows: page.rows.map((l) => ({ id: l.id, customerId: l.customerId, points: l.points, kind: loyaltyKind(l.kind), refId: l.saleId ?? l.returnId ?? MOVED_FROM, at: l.at.toISOString() })) };
    }
    default: throw new UserError("Unknown part.");
  }
}
type Line = { itemId: string; qty: number; amount: number; restocked?: boolean };

/**
 * Catalogue, stock batches, customers, suppliers and counter settings; the opening rows that make the device's
 * balances equal Medoro's (stock, customer dues, supplier dues); and the summary the device checks itself against.
 */
async function moveBase(ctx: Ctx) {
  const t = ctx.tenantId;
  const [settings, meds, batches, customers, suppliers, custBal, suppBal] = await Promise.all([
    counterSettings(ctx),
    db.medicine.findMany({ where: { tenantId: t } }),
    db.batch.findMany({ where: { tenantId: t } }),
    db.customer.findMany({ where: { tenantId: t } }),
    db.supplier.findMany({ where: { tenantId: t } }),
    customerBalances(db, t),
    supplierBalances(db, t),
  ]);
  const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
  const [moved, credit, creditBack, grnTotals, points, counts, totals, open, quarantined] = await Promise.all([
    db.$queryRaw<{ id: string; q: bigint }[]>`SELECT "batchId" AS id, SUM(qty) AS q FROM "StockMovement" WHERE "tenantId" = ${t} GROUP BY "batchId"`,
    db.$queryRaw<{ id: string; v: bigint }[]>`SELECT s."customerId" AS id, SUM(p."amountPaise") AS v FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId"
      WHERE s."tenantId" = ${t} AND p.mode = 'credit' AND s."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id) GROUP BY s."customerId"`,
    db.$queryRaw<{ id: string; v: bigint }[]>`SELECT s."customerId" AS id, SUM(r."amountPaise" - COALESCE((SELECT SUM(l."valuePaise") FROM "LoyaltyLedger" l WHERE l."returnId" = r.id AND l.kind = 'restore'), 0)) AS v
      FROM "SalesReturn" r JOIN "Sale" s ON s.id = r."saleId" WHERE r."tenantId" = ${t} AND r."refundMode" = 'Adjust customer credit' AND s."customerId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id) GROUP BY s."customerId"`,
    db.$queryRaw<{ id: string; v: bigint }[]>`SELECT "supplierId" AS id, SUM("totalPaise") AS v FROM "Grn" WHERE "tenantId" = ${t} GROUP BY "supplierId"`,
    db.$queryRaw<{ id: string; v: bigint }[]>`SELECT "customerId" AS id, SUM(points) AS v FROM "LoyaltyLedger" WHERE "tenantId" = ${t} GROUP BY "customerId"`,
    db.$queryRaw<{ sales: bigint; items: bigint; payments: bigint; returns: bigint; purchases: bigint; purchaseItems: bigint; movements: bigint; loyalty: bigint; voided: bigint; igst: bigint }[]>`SELECT
      (SELECT COUNT(*) FROM "Sale" s WHERE s."tenantId" = ${t} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)) AS sales,
      (SELECT COUNT(*) FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" WHERE s."tenantId" = ${t} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)) AS items,
      (SELECT COUNT(*) FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" WHERE s."tenantId" = ${t} AND p.mode <> 'loyalty' AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)) AS payments,
      (SELECT COUNT(*) FROM "SalesReturn" r WHERE r."tenantId" = ${t} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = r."saleId")) AS returns,
      (SELECT COUNT(*) FROM "Grn" WHERE "tenantId" = ${t}) AS purchases,
      (SELECT COUNT(*) FROM "GrnItem" i JOIN "Grn" g ON g.id = i."grnId" WHERE g."tenantId" = ${t}) AS "purchaseItems",
      (SELECT COUNT(*) FROM "StockMovement" WHERE "tenantId" = ${t}) AS movements,
      (SELECT COUNT(*) FROM "LoyaltyLedger" WHERE "tenantId" = ${t}) AS loyalty,
      (SELECT COUNT(*) FROM "SaleVoid" WHERE "tenantId" = ${t}) AS voided,
      (SELECT COUNT(*) FROM "Sale" WHERE "tenantId" = ${t} AND "igstPaise" > 0) AS igst`,
    db.$queryRaw<{ sales: bigint | null; returns: bigint | null; purchases: bigint | null }[]>`SELECT
      (SELECT SUM("totalPaise") FROM "Sale" s WHERE s."tenantId" = ${t} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)) AS sales,
      (SELECT SUM("amountPaise") FROM "SalesReturn" r WHERE r."tenantId" = ${t} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = r."saleId")) AS returns,
      (SELECT SUM("totalPaise") FROM "Grn" WHERE "tenantId" = ${t}) AS purchases`,
    db.deliveryOrder.count({ where: { tenantId: t, status: { notIn: ["delivered", "cancelled", "returned"] } } }),
    db.batch.aggregate({ where: { tenantId: t }, _sum: { qtyQuarantined: true } }),
  ]);
  const movedQ = new Map(moved.map((m) => [m.id, num(m.q)]));
  const map = (rows: { id: string; v: bigint }[]) => new Map(rows.map((r) => [r.id, num(r.v)]));
  const creditOf = map(credit), backOf = map(creditBack), billedOf = map(grnTotals);

  // Opening rows: whatever the copied history doesn't explain (stock counted in before Medoro, opening dues…).
  const openingStock = batches.flatMap((b) => {
    const d = b.qtyAvailable - (movedQ.get(b.id) ?? 0);
    return d ? [{ id: randomUUID(), branchId: b.branchId, batchId: b.id, qty: d, type: "opening", refType: "opening", refId: b.id, userId: ctx.userId, at: OPENING_AT, note: "Opening stock, moved from Medoro" }] : [];
  });
  const openingDues = customers.flatMap((c) => {
    const d = (creditOf.get(c.id) ?? 0) - (backOf.get(c.id) ?? 0) - (custBal.get(c.id) ?? 0);
    return d ? [{ id: randomUUID(), customerId: c.id, amountPaise: d, mode: "cash", ref: "Opening balance, moved from Medoro", userId: ctx.userId, at: OPENING_AT }] : [];
  });
  const openingPayables = suppliers.flatMap((s) => {
    const d = (billedOf.get(s.id) ?? 0) - (suppBal.get(s.id) ?? 0);
    return d ? [{ id: randomUUID(), supplierId: s.id, amountPaise: d, mode: "bank", ref: "Opening balance, moved from Medoro", userId: ctx.userId, at: OPENING_AT }] : [];
  });

  const c = counts[0];
  const nonZero = (m: Map<string, number>) => Object.fromEntries([...m].filter(([, v]) => v !== 0));
  const summary = {
    counts: {
      medicine: meds.length, batch: batches.length, customer: customers.length, supplier: suppliers.length,
      sale: num(c.sales), saleItem: num(c.items), payment: num(c.payments), salesReturn: num(c.returns), purchase: num(c.purchases), purchaseItem: num(c.purchaseItems),
      stockMovement: num(c.movements) + openingStock.length, loyaltyLedger: num(c.loyalty), customerReceipt: openingDues.length, supplierPayment: openingPayables.length,
    },
    totals: { salesPaise: num(totals[0].sales), returnsPaise: num(totals[0].returns), purchasesPaise: num(totals[0].purchases) },
    stock: Object.fromEntries(batches.filter((b) => b.qtyAvailable).map((b) => [b.id, b.qtyAvailable])),
    customerDues: nonZero(custBal),
    supplierDues: nonZero(suppBal),
    points: nonZero(map(points)),
  };
  const warnings = [
    num(c.voided) ? `${num(c.voided)} cancelled bills stay only in Medoro’s copy (they don’t count anywhere).` : "",
    open ? `${open} delivery orders are still open. Finish or re-enter them on the device.` : "",
    num(quarantined._sum.qtyQuarantined) ? `${num(quarantined._sum.qtyQuarantined)} units set aside in quarantine aren’t moved as stock.` : "",
    "Payments received, payments made and expenses come across as opening balances, not one by one. Download a backup first to keep the full history.",
  ].filter(Boolean);

  await writeAudit(db, { tenantId: t, userId: ctx.userId, userName: ctx.userName, action: "Data copied to a device for the move to Google Drive", entity: "tenant", entityId: t, detail: `${meds.length} medicines, ${num(c.sales)} bills, ${customers.length} customers` });
  return {
    v: 1, exportedAt: new Date().toISOString(),
    settings,
    medicines: meds.map((m) => ({ ...deviceMedicine(m), active: m.active })),
    batches: batches.map((b) => ({ id: b.id, branchId: b.branchId, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: isoOf(b.expiryDate), costPaise: big(b.costPaise), mrpPaise: big(b.mrpPaise), supplierId: b.supplierId, status: b.status === "damaged" ? "quarantine" : b.status })),
    // Erased customers keep their bills but not their details.
    customers: customers.map((x) => x.erasedAt ? { id: x.id, name: "Erased customer", phone: null, gstin: null, creditLimitPaise: 0, erased: true } : { id: x.id, name: x.name, phone: x.phone, gstin: x.gstin, creditLimitPaise: big(x.creditLimitPaise), erased: false }),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone, gstin: s.gstin, dl: null, address: null })),
    opening: { stock: openingStock, receipts: openingDues, supplierPayments: openingPayables },
    summary, warnings,
  };
}
export type MoveBase = Awaited<ReturnType<typeof moveBase>>;
