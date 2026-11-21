import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { big, shareOf } from "@/lib/money";
import { isoOf, todayISO } from "@/lib/dates";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import { ACC } from "@/domain/accounting/accounts";
import { layout } from "./restore";
import { relayStore } from "./gdrive";
import { MANIFEST, SNAPSHOT } from "./drivedb-relay";
import { deleteObject } from "@/server/storage";
import { log } from "@/server/log";
import { counterSettings, deviceMedicine, driveModeOn, ownerOnly } from "./drive-mode";
import { driveRequired } from "./drive-state";
import { rulesOf } from "@/domain/purchasing/pricing";

/**
 * Phase 7: moving a pharmacy's data out of Medoro into its own Google Drive.
 *
 * 1. startMove: Medoro's copy goes read-only, so nothing changes while it is copied.
 * 2. moveExport: the owner's device downloads everything, part by part (each part fits a server response).
 * 3. The device loads it into its own database, checks the counts and totals against `summary`, and saves
 *    it to Drive, encrypted with keys only the pharmacy holds.
 * 4. completeMove: recorded as moved. Medoro's copy stays read-only for 7 days, when the move can still be undone.
 *    Deleting Medoro's copy is a step the owner confirms; on Medoro's hosted server it also happens on its own after 7 days.
 */
export type MoveState = { state: "moving" | "moved" | "purged"; startedAt: string; by: string; movedAt?: string; device?: string; checks?: number; purgedAt?: string; purgedBy?: string };
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
  return { ...move, undoUntil, canUndo: move.state === "moving" || (move.state === "moved" && !!undoUntil && Date.now() < Date.parse(undoUntil)) };
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
  if (move && move.state !== "moving") throw new UserError("This pharmacy’s data has already moved to Google Drive.");
  if (move) return moveStatus(ctx); // resuming an interrupted move
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { product: true } });
  if (tenant.product === "distribution") await distReadyToMove(ctx.tenantId);
  await save(ctx, { state: "moving", startedAt: new Date().toISOString(), by: ctx.userName }, "Move to Google Drive started", "Medoro’s copy is read-only while it is copied");
  return moveStatus(ctx);
}

/** The device loaded and checked everything and saved it to Drive. */
export async function completeMove(ctx: Ctx, report: { device: string; checks: number }) {
  ownerOnly(ctx, "move the pharmacy’s data to Google Drive");
  const { move } = await stateOf(ctx.tenantId);
  if (!move) throw new UserError("Start the move first.");
  if (move.state !== "moving") return moveStatus(ctx);
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

// ---------- deleting Medoro's copy ----------

/**
 * What stays on Medoro's server after the copy is deleted: the account, sign-in, staff, branches and devices. The audit
 * log goes too (its entries name customers and bills); one entry recording the deletion itself is written afterwards.
 */
const KEEP_ON_DELETE = new Set(["Branch", "Counter", "Device", "DriveDevice", "Invite", "Role", "User", "RecoveryCode", "SupportGrant"]);
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** When the device last saved a full copy to Drive (Medoro reads only the plain manifest, never the data). */
export async function driveCopySavedAt(tenantId: string): Promise<string | null> {
  const store = relayStore(tenantId);
  const [m] = (await store.list(MANIFEST)).filter((f) => f.name === MANIFEST);
  if (!m || !(await store.list(SNAPSHOT)).some((f) => f.name === SNAPSHOT)) return null;
  try {
    const { bytes } = await store.read(m.id, 0, 64 * 1024);
    const at = (JSON.parse(bytes.toString("utf8")) as { snapshotAt?: string }).snapshotAt;
    return at && !Number.isNaN(Date.parse(at)) ? at : null;
  } catch { return null; }
}

/**
 * Deletes Medoro's copy of a moved pharmacy, when the owner confirms with the pharmacy code: bills, stock, customers,
 * suppliers, accounts, messages and stored files. Refused unless Drive holds a full copy saved after the move.
 * Can't be undone; the pharmacy keeps working from its Drive.
 */
export async function deleteMedoroCopy(ctx: Ctx, input: { code: string }) {
  ownerOnly(ctx, "delete Medoro’s copy");
  const st = await moveStatus(ctx);
  if (st?.state === "purged") throw new UserError("Medoro’s copy was already deleted.");
  if (st?.state !== "moved") throw new UserError("Move the data to Google Drive first.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true } });
  if (String(input.code ?? "").trim().toUpperCase() !== t.code.toUpperCase()) throw new UserError("Type the pharmacy code exactly to confirm.");
  const saved = await driveCopySavedAt(ctx.tenantId);
  if (!saved || Date.parse(saved) < Date.parse(st.movedAt!)) throw new UserError("Google Drive has no full copy saved since the move. On Billing (device), press “Save full copy now”, then try again.");
  return purgeCopy(ctx.tenantId, { userId: ctx.userId, userName: ctx.userName }, saved);
}

/**
 * Where Drive is required (Medoro's hosted server), Medoro's copy is deleted on its own once the 7 days to undo the
 * move are over, so no pharmacy's records stay on Medoro's server. Only when Drive holds a full copy saved after
 * the move; otherwise the owner is reminded on the counter and it's tried again the next day.
 */
export async function autoDeleteMovedCopies(now = new Date()) {
  if (!driveRequired()) return 0;
  let done = 0;
  for (const t of await db.tenant.findMany({ select: { id: true, settings: true } })) {
    const move = ((t.settings ?? {}) as { driveMove?: MoveState }).driveMove;
    if (move?.state !== "moved" || !move.movedAt || now.getTime() < Date.parse(move.movedAt) + UNDO_DAYS * 86400_000) continue;
    try {
      const saved = await driveCopySavedAt(t.id);
      if (!saved || Date.parse(saved) < Date.parse(move.movedAt)) { log.warn("Medoro’s copy not deleted yet: no full Drive copy since the move.", { tenantId: t.id }); continue; }
      await purgeCopy(t.id, { userId: null, userName: "Medoro (automatic)" }, saved);
      done++;
    } catch (e) { log.error("Couldn’t delete Medoro’s copy after the move to Drive.", { err: e, tenantId: t.id }); }
  }
  return done;
}

async function purgeCopy(tenantId: string, by: { userId: string | null; userName: string }, saved: string) {
  const [files, docs, backups] = await Promise.all([
    db.fileObject.findMany({ where: { tenantId }, select: { key: true } }),
    db.scanDocument.findMany({ where: { tenantId, storagePath: { not: null } }, select: { storagePath: true } }),
    db.backupManifest.findMany({ where: { tenantId, localPath: { not: null } }, select: { localPath: true } }),
  ]);
  const L = await layout();
  const gone = L.tables.filter((x) => !KEEP_ON_DELETE.has(x.name));
  const blocked = L.edges.find((e) => KEEP_ON_DELETE.has(e.table) && !KEEP_ON_DELETE.has(e.parent));
  if (blocked) throw new Error(`Kept table ${blocked.table} points at ${blocked.parent}.`);
  let rows = 0;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL medoro.restore = 'on'`);
    const del = (name: string, via?: { col: string; parent: string }) => tx.$executeRawUnsafe(
      `DELETE FROM public.${q(name)} WHERE ${via ? `${q(via.col)} IN (SELECT id FROM public.${q(via.parent)} WHERE "tenantId" = $1)` : `"tenantId" = $1`}`, tenantId);
    for (const x of [...gone].reverse()) rows += await del(x.name, x.via);
    rows += await tx.fileObject.deleteMany({ where: { tenantId } }).then((r) => r.count);
    rows += await tx.backupManifest.deleteMany({ where: { tenantId, localPath: { not: null } } }).then((r) => r.count);
    const cur = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const settings = (cur.settings ?? {}) as Record<string, Prisma.InputJsonValue> & { driveMove: MoveState };
    await tx.tenant.update({ where: { id: tenantId }, data: { settings: { ...settings, driveMove: { ...settings.driveMove, state: "purged", purgedAt: new Date().toISOString(), purgedBy: by.userName } } } });
    await writeAudit(tx, { tenantId, userId: by.userId, userName: by.userName, action: "Medoro’s copy deleted", entity: "tenant", entityId: tenantId,
      detail: `${rows} records deleted after the move to Google Drive (Drive copy saved ${saved}). The account, staff, branches and devices stay.` });
  }, { timeout: 120_000 });
  // Stored files last, once the records are gone. Best effort: a missing file is fine.
  for (const key of [...files.map((f) => f.key), ...docs.map((d) => d.storagePath!), ...backups.map((b) => b.localPath!)]) {
    try { await deleteObject(key); } catch (e) { log.error("Couldn’t delete a stored file after the move to Drive.", { err: e }); }
  }
  return { rows };
}

// ---------- the export ----------

export const MOVE_PARTS = ["sales", "returns", "purchases", "movements", "loyalty", "money"] as const;
export type MovePart = "base" | (typeof MOVE_PARTS)[number];
const PAGE = { sales: 400, returns: 1000, purchases: 300, movements: 5000, loyalty: 5000, money: 2000 } as const;

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
    case "money": {
      const page = ref(await db.voucher.findMany({ where: { tenantId: t, refType: { in: MONEY_REFS }, ...after }, include: { lines: true }, orderBy: { id: "asc" }, take: PAGE.money + 1 }), PAGE.money);
      const reversed = await reversedIds(t, page.rows.map((v) => v.id));
      return { next: page.next, rows: page.rows.filter((v) => !reversed.has(v.id)).flatMap((v) => moneyRow(v, ctx)) };
    }
    default: throw new UserError("Unknown part.");
  }
}
type Line = { itemId: string; qty: number; amount: number; restocked?: boolean };

// ---------- money received, paid and spent (ledger vouchers) ----------

const MONEY_REFS = ["customer_receipt", "cheque_receipt", "supplier_payment", "cheque_payment", "expense"];
type MoneyVoucher = Prisma.VoucherGetPayload<{ include: { lines: true } }>;
export type MoneyRow =
  | { kind: "receipt"; row: { id: string; customerId: string; amountPaise: number; mode: string; ref: string; userId: string; at: string } }
  | { kind: "payment"; row: { id: string; supplierId: string; amountPaise: number; mode: string; ref: string; userId: string; at: string } }
  | { kind: "expense"; row: { id: string; branchId: string; category: string; amountPaise: number; mode: string; note: string | null; userId: string; at: string } };

/** Vouchers among `ids` that were later reversed (both stay in Medoro; neither moves). */
async function reversedIds(tenantId: string, ids?: string[]) {
  const rows = await db.voucher.findMany({ where: { tenantId, reversesId: ids ? { in: ids } : { not: null } }, select: { reversesId: true } });
  return new Set(rows.map((r) => r.reversesId!));
}

/** A receipt, supplier payment or expense voucher as the device stores it (same id). */
function moneyRow(v: MoneyVoucher, ctx: Ctx): MoneyRow[] {
  const at = v.date.toISOString(), userId = v.postedBy || ctx.userId, ref = v.no;
  const via = (acc: string | undefined, upi: boolean) => (acc === ACC.cash ? "cash" : acc === ACC.chequesInHand || acc === ACC.chequesIssued ? "cheque" : upi ? "upi" : "bank");
  const upi = / · UPI\b/.test(v.narration);
  if (v.refType === "customer_receipt" || v.refType === "cheque_receipt") {
    const party = v.lines.find((l) => l.account === ACC.debtors && l.partyType === "customer" && l.partyId);
    if (!party) return [];
    const m = via(v.lines.find((l) => big(l.debitPaise) > 0)?.account, upi);
    // Cash, UPI and cheques keep their mode (the device takes cheque receipts and tracks the cheque itself); bank transfers come in as UPI with the voucher number.
    return [{ kind: "receipt", row: { id: v.id, customerId: party.partyId!, amountPaise: big(party.creditPaise) - big(party.debitPaise), mode: m === "cash" ? "cash" : m === "cheque" ? "cheque" : "upi", ref: m === "bank" ? `${ref} · bank` : ref, userId, at } }];
  }
  if (v.refType === "supplier_payment" || v.refType === "cheque_payment") {
    const party = v.lines.find((l) => l.account === ACC.creditors && l.partyType === "supplier" && l.partyId);
    if (!party) return [];
    return [{ kind: "payment", row: { id: v.id, supplierId: party.partyId!, amountPaise: big(party.debitPaise) - big(party.creditPaise), mode: via(v.lines.find((l) => big(l.creditPaise) > 0)?.account, upi), ref, userId, at } }];
  }
  const cost = v.lines.find((l) => big(l.debitPaise) > 0), paid = v.lines.find((l) => big(l.creditPaise) > 0);
  if (!cost) return [];
  const note = v.narration.split(" · ").slice(1, -1).join(" · ") || null;
  const mode = via(paid?.account, upi);
  return [{ kind: "expense", row: { id: v.id, branchId: v.branchId ?? ctx.branchId, category: cost.account, amountPaise: big(cost.debitPaise), mode: mode === "cheque" ? "bank" : mode, note, userId, at } }];
}

/** Totals of the moving receipts per customer and payments per supplier, and how many of each kind move. */
async function moneyTotals(ctx: Ctx) {
  const reversed = await reversedIds(ctx.tenantId);
  const received = new Map<string, number>(), paid = new Map<string, number>(), count = { receipt: 0, payment: 0, expense: 0 }, ids = new Set<string>();
  let spent = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await db.voucher.findMany({ where: { tenantId: ctx.tenantId, refType: { in: MONEY_REFS }, ...(cursor ? { id: { gt: cursor } } : {}) }, include: { lines: true }, orderBy: { id: "asc" }, take: 2000 });
    for (const v of page) {
      if (reversed.has(v.id)) continue;
      for (const r of moneyRow(v, ctx)) {
        count[r.kind]++;
        ids.add(r.row.id);
        if (r.kind === "receipt") received.set(r.row.customerId, (received.get(r.row.customerId) ?? 0) + r.row.amountPaise);
        if (r.kind === "payment") paid.set(r.row.supplierId, (paid.get(r.row.supplierId) ?? 0) + r.row.amountPaise);
        if (r.kind === "expense") spent += r.row.amountPaise;
      }
    }
    if (page.length < 2000) break;
    cursor = page[page.length - 1].id;
  }
  return { received, paid, count, spent, ids };
}

// ---------- doctors, recalls, cheques, supplier claims and terms, settings ----------

const RECALL_STATES = new Set(["open", "investigating", "supplier_return", "resolved"]);
/** Older notices used other words for the same steps. */
const recallStatus = (s: string) => (RECALL_STATES.has(s) ? s : s === "quarantined" ? "investigating" : s === "returned" ? "supplier_return" : "open");
const dayOf = (d: Date) => todayISO(d);
type ClaimCredit = { ref: string; amount: number; at: string; voucherNo?: string };

/**
 * Everything else the counter keeps, in the device's own form (src/drivedb: doctors, recalls, cheques, purchase-tools,
 * insights), so the counter carries on where Medoro left off:
 * - Cheques with their steps. A bounce on Medoro is one journal entry; on the device it is the cheque's reversing
 *   receipt / payment (and any charge) plus a Bank charges expense, with the same fixed ids the device uses
 *   (`<cheque>-rev`, `-chg`, `-bank`), so a later step on the counter sees the cheque as bounced.
 * - Supplier claims with their acknowledgement, each credit note, and the write-off on closing.
 * Balances stay equal to Medoro's: the rows that change dues are counted before the opening balances are worked out.
 */
async function moveExtras(ctx: Ctx, movedMoney: Set<string>, tenantSettings: Record<string, unknown>) {
  const t = ctx.tenantId;
  const [doctors, recalls, disposals, cheques, claims, suppliers, maps] = await Promise.all([
    db.doctor.findMany({ where: { tenantId: t }, orderBy: { createdAt: "asc" } }),
    db.recall.findMany({ where: { tenantId: t }, orderBy: { createdAt: "asc" } }),
    db.recallDisposal.count({ where: { tenantId: t } }),
    db.cheque.findMany({ where: { tenantId: t }, orderBy: { createdAt: "asc" } }),
    db.supplierClaim.findMany({ where: { tenantId: t }, orderBy: { raisedAt: "asc" } }),
    db.supplier.findMany({ where: { tenantId: t }, select: { id: true, acceptsReturns: true, returnWindowDays: true, ebillMapping: true } }),
    db.supplierItemMap.findMany({ where: { tenantId: t } }),
  ]);
  const vouchers = async (refType: string, refIds: string[]) => refIds.length
    ? db.voucher.findMany({ where: { tenantId: t, refType, refId: { in: refIds } }, include: { lines: true } }) : [];
  const [bounces, claimVouchers, batches] = await Promise.all([
    vouchers("cheque_bounce", cheques.filter((c) => c.status === "bounced").map((c) => c.id)),
    vouchers("supplier_claim", claims.map((c) => c.stockOutId)),
    claims.length ? db.batch.findMany({ where: { tenantId: t, id: { in: [...new Set(claims.map((c) => c.batchId))] } }, select: { id: true, medicineId: true } }) : [],
  ]);

  // Cheques: only those whose receipt / payment moves (a reversed one stays behind with its cheque).
  const cheque: Record<string, string | number | null>[] = [], chequeEvent: typeof cheque = [];
  const receipts: { id: string; customerId: string; amountPaise: number; mode: string; ref: string; userId: string; at: string }[] = [];
  const payments: { id: string; supplierId: string; amountPaise: number; mode: string; ref: string; userId: string; at: string }[] = [];
  const expenses: { id: string; branchId: string; category: string; amountPaise: number; mode: string; note: string; userId: string; at: string }[] = [];
  let chequesLeft = 0;
  for (const c of cheques) {
    if (!movedMoney.has(c.voucherId)) { chequesLeft++; continue; }
    const recv = c.direction === "received", amt = big(c.amountPaise), userId = c.createdBy;
    cheque.push({ id: c.id, direction: c.direction, customerId: recv ? c.partyId : null, supplierId: recv ? null : c.partyId, chequeNo: c.no, bank: c.bank,
      chequeDate: isoOf(c.chequeDate), amountPaise: amt, linkId: c.voucherId, note: c.note, userId, at: c.createdAt.toISOString() });
    const step = (id: string, kind: string, at: Date, more: { reason?: string | null; chargePaise?: number; bankChargePaise?: number } = {}) =>
      chequeEvent.push({ id, chequeId: c.id, kind, day: dayOf(at), reason: more.reason ?? null, chargePaise: more.chargePaise ?? 0, bankChargePaise: more.bankChargePaise ?? 0, userId, at: at.toISOString() });
    if (c.depositedAt) step(`${c.id}-dep`, "deposited", c.depositedAt);
    if (c.status === "cleared" && c.clearedAt) step(`${c.id}-end`, "cleared", c.clearedAt);
    if (c.status === "bounced") {
      const at = c.bouncedAt ?? c.createdAt, charge = big(c.chargePaise), reason = c.bounceReason ?? "Returned unpaid";
      // Our bank's deduction is the Bank account credit in the bounce entry.
      const v = bounces.find((b) => b.refId === c.id);
      const bankCharge = v ? v.lines.filter((l) => l.account === ACC.bank).reduce((a, l) => a + big(l.creditPaise) - big(l.debitPaise), 0) : 0;
      step(`${c.id}-end`, "bounced", at, { reason, chargePaise: charge, bankChargePaise: bankCharge });
      const why = `Cheque ${c.no} bounced · ${reason}`.slice(0, 120), when = at.toISOString();
      if (recv) {
        receipts.push({ id: `${c.id}-rev`, customerId: c.partyId, amountPaise: -amt, mode: "cheque", ref: why, userId, at: when });
        if (charge) receipts.push({ id: `${c.id}-chg`, customerId: c.partyId, amountPaise: -charge, mode: "cheque", ref: `Cheque ${c.no} return charges`, userId, at: when });
      } else {
        payments.push({ id: `${c.id}-rev`, supplierId: c.partyId, amountPaise: -amt, mode: "cheque", ref: why, userId, at: when });
        if (charge) payments.push({ id: `${c.id}-chg`, supplierId: c.partyId, amountPaise: -charge, mode: "cheque", ref: `Cheque ${c.no} return charges (supplier’s penalty)`, userId, at: when });
      }
      if (bankCharge > 0) expenses.push({ id: `${c.id}-bank`, branchId: c.branchId, category: "Bank charges", amountPaise: bankCharge, mode: "bank", note: `Cheque ${c.no} returned`, userId, at: when });
    }
  }

  // Supplier claims: the claim, then its steps. GST on the claim is what the debit note took off input GST.
  const medicineOf = new Map(batches.map((b) => [b.id, b.medicineId]));
  const supplierClaim: Record<string, string | number | null>[] = [], claimEvent: typeof supplierClaim = [];
  const credited = new Map<string, number>();
  for (const c of claims) {
    const medicineId = medicineOf.get(c.batchId);
    if (!medicineId) continue;
    const claimPaise = big(c.claimPaise), v = claimVouchers.find((x) => x.refId === c.stockOutId);
    const taxable = v ? v.lines.filter((l) => l.account === ACC.purchases).reduce((a, l) => a + big(l.creditPaise) - big(l.debitPaise), 0) : claimPaise;
    supplierClaim.push({ id: c.id, claimNo: c.no, branchId: c.branchId, supplierId: c.supplierId, batchId: c.batchId, medicineId, qty: c.qty, reason: c.reason, note: c.note,
      claimPaise, taxPaise: Math.max(0, claimPaise - taxable), userId: c.raisedBy, at: c.raisedAt.toISOString() });
    const ev = (id: string, kind: string, at: string, amountPaise: number, ref: string | null, note: string | null) =>
      claimEvent.push({ id, claimId: c.id, supplierId: c.supplierId, kind, amountPaise, ref, note, userId: c.raisedBy, at });
    const credits = ((c.credits ?? []) as ClaimCredit[]).filter((x) => Number(x.amount) > 0);
    // An acknowledgement of its own. A credit note on a raised claim sets ackAt too, at or after the credit's time.
    if (c.ackAt && (!credits.length || c.ackAt.getTime() < Date.parse(credits[0].at))) ev(`${c.id}-ack`, "ack", c.ackAt.toISOString(), 0, null, null);
    credits.forEach((x, i) => {
      ev(`${c.id}-cr${i + 1}`, "credit", x.at, Math.round(Number(x.amount)), (x.ref || "").slice(0, 40) || null, null);
      credited.set(c.supplierId, (credited.get(c.supplierId) ?? 0) + Math.round(Number(x.amount)));
    });
    const writeOff = big(c.writeOffPaise);
    if (writeOff > 0) ev(`${c.id}-close`, "close", (c.settledAt ?? c.raisedAt).toISOString(), writeOff, null, c.writeOffReason ?? "Written off");
  }

  // Each supplier's return terms and e-bill mapping (only where they differ from the device's defaults), item codes, pricing rules.
  const supplierTerms = suppliers.filter((s) => !s.acceptsReturns || s.returnWindowDays !== 90 || s.ebillMapping != null)
    .map((s) => ({ id: s.id, acceptsReturns: s.acceptsReturns ? 1 : 0, returnWindowDays: s.returnWindowDays, ebillMapping: s.ebillMapping == null ? null : JSON.stringify(s.ebillMapping) }));
  const supplierItemMap = maps.map((m) => ({ id: m.id, supplierId: m.supplierId, code: m.code, medicineId: m.medicineId, userId: ctx.userId, at: m.updatedAt.toISOString() }));
  const rules = rulesOf(tenantSettings);
  const purchaseSetting = tenantSettings.purchasing ? [{ id: "rules", gstBase: rules.gstBase, itc: rules.itc ? 1 : 0, minMarginPct: 0 }] : [];
  // Intelligence settings: the counter keeps them on each device.
  const intel = { policy: (tenantSettings.policy as { cover: number; safety: number } | undefined) ?? null, anomaly: (tenantSettings.anomaly as { disc: number; refunds: number } | undefined) ?? null };

  const warnings = [
    chequesLeft ? `${chequesLeft} cheques whose receipt or payment was reversed stay only in Medoro’s copy.` : "",
    disposals ? `${disposals} recall disposal records (stock destroyed or returned) stay only in Medoro’s copy; the stock they took out is moved.` : "",
  ].filter(Boolean);

  return {
    tables: { doctor: doctors.map((d) => ({ id: d.id, name: d.name, qualification: d.qualification, regNo: d.regNo, clinic: d.clinic, phone: d.phone, address: d.address, active: d.active ? 1 : 0 })),
      recall: recalls.map((r) => ({ id: r.id, ref: r.noticeNo || r.sourceRef || r.id.slice(0, 8), source: r.source, publishedAt: isoOf(r.publishedAt), product: r.product, medicineId: r.medicineId,
        batchNos: JSON.stringify(r.batchNos), reason: r.reason || "Not specified", status: recallStatus(r.status), userId: r.createdBy, createdAt: r.createdAt.toISOString() })),
      cheque, chequeEvent, supplierClaim, claimEvent, supplierTerms, supplierItemMap, purchaseSetting },
    money: { receipts, payments, expenses },
    credited, intel, warnings,
  };
}
export type MoveExtras = Awaited<ReturnType<typeof moveExtras>>;

// ---------- MEDORO Distribution (docs/DIST_DRIVE_PLAN.md, phase D6) ----------

/** Open orders and deliveries out on a van must be finished first: their reservations and trips don't move. */
async function distReadyToMove(tenantId: string) {
  const [open, out] = await Promise.all([
    db.distOrder.count({ where: { tenantId, status: { in: ["pending", "approved", "picking", "packed"] } } }),
    db.distDelivery.count({ where: { tenantId, status: "out" } }),
  ]);
  if (open) throw new UserError(`${open} order(s) are still open. Invoice, cancel or reject them before moving to Google Drive.`);
  if (out) throw new UserError(`${out} delivery(ies) are out on a van. Record them as delivered or failed before moving to Google Drive.`);
}

/**
 * A distributor's masters in the device's form: companies, product terms, chemist profiles, special rates, schemes and
 * principals. The move carries them, and so does loading the catalogue onto a device (same ids, so a later move skips them).
 */
export async function distMasters(t: string) {
  const [cos, products, chems, custs, specials, schemes, principals] = await Promise.all([
    db.distCompany.findMany({ where: { tenantId: t } }),
    db.distProduct.findMany({ where: { tenantId: t } }),
    db.distChemist.findMany({ where: { tenantId: t } }),
    db.customer.findMany({ where: { tenantId: t }, select: { id: true, stateCode: true } }),
    db.distSpecialRate.findMany({ where: { tenantId: t } }),
    db.distScheme.findMany({ where: { tenantId: t } }),
    db.distPrincipal.findMany({ where: { tenantId: t } }),
  ]);
  const state = new Map(custs.map((c) => [c.id, c.stateCode]));
  const principalCo = new Map(principals.map((p) => [p.id, p.companyId]));
  const iso = (d: Date | null) => (d ? isoOf(d) : null);
  return {
    distCompany: cos.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName, gstin: c.gstin, phone: c.phone, active: c.active ? 1 : 0 })),
    distProduct: products.map((p) => ({ id: p.medicineId, companyId: p.companyId ?? (p.principalId ? principalCo.get(p.principalId) ?? null : null), division: p.division, ptrPaise: big(p.ptrPaise), ptsPaise: big(p.ptsPaise), minOrderQty: p.minOrderQty, portalVisible: p.portalVisible ? 1 : 0, discontinued: p.discontinued ? 1 : 0 })),
    distChemist: chems.map((c) => ({ id: c.customerId, ownerName: c.ownerName, stateCode: state.get(c.customerId) ?? null, dl20b: c.dl20b, dl21b: c.dl21b, dlExpiry: iso(c.dlExpiry), creditDays: c.creditDays, graceDays: c.graceDays,
      territoryId: c.territoryId, salesmanId: c.salesmanId, priceTier: c.priceTier === "pts" ? "pts" : "ptr", status: ["active", "hold", "blocked"].includes(c.status) ? c.status : "active", statusNote: c.statusNote, portalAccountId: c.portalAccountId })),
    distSpecialRate: specials.map((r) => ({ id: `${r.customerId}:${r.medicineId}`, customerId: r.customerId, medicineId: r.medicineId, ratePaise: big(r.ratePaise), validTo: iso(r.validTo) })),
    distScheme: schemes.map((x) => ({ id: x.id, code: x.code, name: x.name, kind: x.kind, medicineId: x.medicineId, companyId: x.companyId, buyQty: x.buyQty, freeQty: x.freeQty, discPct: Number(x.discPct), minQty: x.minQty,
      customerIds: JSON.stringify(x.customerIds), validFrom: isoOf(x.validFrom), validTo: isoOf(x.validTo), active: x.active ? 1 : 0 })),
    distPrincipal: principals.map((p) => ({ id: p.id, companyId: p.companyId, supplierId: p.supplierId, marginPct: Number(p.marginPct), claimBeforeDays: p.claimBeforeDays, claimAfterDays: p.claimAfterDays, claimCreditPct: Number(p.claimCreditPct), active: p.active ? 1 : 0 })),
  };
}

/**
 * A distributor's records in the device's own form (src/drivedb/dist*.ts): companies, product terms, chemist profiles,
 * special rates, schemes, principals, wholesale invoices (and cancellations), credit notes, proof of delivery and
 * collections; its settings; what each chemist was billed and credited (for the opening balances); and an opening
 * adjustment so each batch's returned-goods pool equals the quarantined stock on Medoro.
 */
async function moveDist(ctx: Ctx, tenantSettings: Record<string, unknown>, movedMoney: Set<string>) {
  const t = ctx.tenantId;
  const [masters, invs, cancels, rets, deliveries, collections, batches] = await Promise.all([
    distMasters(t),
    db.distInvoice.findMany({ where: { tenantId: t }, include: { lines: true }, orderBy: { at: "asc" } }),
    db.distInvoiceCancel.findMany({ where: { tenantId: t } }),
    db.distReturn.findMany({ where: { tenantId: t }, include: { lines: true }, orderBy: { at: "asc" } }),
    db.distDelivery.findMany({ where: { tenantId: t, status: "delivered" } }),
    db.distCollection.findMany({ where: { tenantId: t } }),
    db.batch.findMany({ where: { tenantId: t }, select: { id: true, qtyQuarantined: true, medicine: { select: { packSize: true } } } }),
  ]);
  const cancelled = new Set(cancels.map((c) => c.invoiceId));
  const billed = new Map<string, number>(), credited = new Map<string, number>();
  for (const i of invs) if (!cancelled.has(i.id)) billed.set(i.customerId, (billed.get(i.customerId) ?? 0) + big(i.totalPaise));
  for (const r of rets) credited.set(r.customerId, (credited.get(r.customerId) ?? 0) + big(r.totalPaise));
  // Each batch's returned-goods pool on the device must equal its quarantined stock here.
  const restocked = new Set((await db.stockMovement.findMany({ where: { tenantId: t, refType: "dist_return", type: "return" }, select: { refId: true, batchId: true } })).map((m) => `${m.refId}:${m.batchId}`));
  const pack = new Map(batches.map((b) => [b.id, Math.max(1, b.medicine.packSize)]));
  const returned = new Map<string, number>();
  for (const r of rets) for (const l of r.lines) if (l.condition !== "saleable" || !restocked.has(`${r.id}:${l.batchId}`)) returned.set(l.batchId, (returned.get(l.batchId) ?? 0) + l.qty * (pack.get(l.batchId) ?? 1));
  const openingPool = batches.flatMap((b) => {
    const extra = (returned.get(b.id) ?? 0) - b.qtyQuarantined;
    return extra > 0 ? [{ id: `open-${b.id}`, claimId: null, batchId: b.id, fromReturnsUnits: extra, at: OPENING_AT }] : [];
  });
  const vouchers = new Map((await db.voucher.findMany({ where: { tenantId: t, no: { in: collections.map((c) => c.voucherNo) } }, select: { id: true, no: true } })).map((v) => [v.no, v.id]));
  const tables = {
    ...masters,
    distInvoice: invs.map((i) => ({ id: i.id, branchId: i.branchId, deviceId: MOVED_FROM, no: i.no, orderId: null, customerId: i.customerId, salesmanId: i.salesmanId, date: isoOf(i.date), dueDate: isoOf(i.dueDate), placeOfSupply: i.placeOfSupply,
      customerGstin: i.customerGstin, igst: i.igst ? 1 : 0, grossPaise: big(i.grossPaise), discPaise: big(i.discPaise), taxablePaise: big(i.taxablePaise), cgstPaise: big(i.cgstPaise), sgstPaise: big(i.sgstPaise), igstPaise: big(i.igstPaise),
      roundOffPaise: big(i.roundOffPaise), totalPaise: big(i.totalPaise), costPaise: big(i.costPaise), idempotencyKey: i.idempotencyKey, userId: i.createdBy, at: i.at.toISOString() })),
    distInvoiceLine: invs.flatMap((i) => i.lines.map((l) => ({ id: l.id, invoiceId: i.id, medicineId: l.medicineId, batchId: l.batchId, qty: l.qty, freeQty: l.freeQty, ratePaise: big(l.ratePaise), mrpPaise: big(l.mrpPaise),
      discPct: Number(l.discPct), discPaise: big(l.discPaise), schemeId: l.schemeId, taxablePaise: big(l.taxablePaise), gstRate: l.gstRate, taxPaise: big(l.taxPaise), costPaise: big(l.costPaise) }))),
    distInvoiceCancel: cancels.map((c) => ({ id: `${c.invoiceId}-cancel`, invoiceId: c.invoiceId, reason: c.reason, userId: c.by, at: c.at.toISOString() })),
    distReturn: rets.map((r) => ({ id: r.id, branchId: r.branchId, deviceId: MOVED_FROM, no: r.no, invoiceId: r.invoiceId, customerId: r.customerId, reason: r.reason, taxablePaise: big(r.taxablePaise), taxPaise: big(r.taxPaise), totalPaise: big(r.totalPaise), userId: r.createdBy, at: r.at.toISOString() })),
    distReturnLine: rets.flatMap((r) => r.lines.map((l) => ({ id: l.id, returnId: r.id, invoiceLineId: l.invoiceLineId, batchId: l.batchId, qty: l.qty, condition: l.condition, creditPct: Number(l.creditPct), taxablePaise: big(l.taxablePaise), taxPaise: big(l.taxPaise) }))),
    distDeliveryEvent: deliveries.map((d) => ({ id: `${d.invoiceId}-delivered`, invoiceId: d.invoiceId, dispatchId: null, kind: "delivered", receiverName: d.receiverName, note: d.podNote, collectedPaise: big(d.collectedPaise), collectMode: d.collectMode, receiptId: null, userId: d.updatedBy ?? ctx.userId, at: (d.deliveredAt ?? d.updatedAt).toISOString() })),
    // A collection moves with its receipt (a reversed receipt stays behind, and so does its collection).
    distCollection: collections.flatMap((c) => { const v = vouchers.get(c.voucherNo); return v && movedMoney.has(v) ? [{ id: c.id, customerId: c.customerId, receiptId: v, amountPaise: big(c.amountPaise), mode: c.mode.toLowerCase(), ref: c.ref, salesmanId: c.salesmanId, invoiceId: null, userId: c.byUser, at: c.at.toISOString() }] : []; }),
    distClaimSource: openingPool,
  };
  const settings = (tenantSettings.dist ?? {}) as Record<string, unknown>;
  return { tables, settings, billed, credited };
}

/**
 * Catalogue, stock batches, customers, suppliers and counter settings; the opening rows that make the device's
 * balances equal Medoro's (stock, customer dues, supplier dues); and the summary the device checks itself against.
 */
async function moveBase(ctx: Ctx) {
  const t = ctx.tenantId;
  const [settings, meds, batches, customers, suppliers, custBal, suppBal, money] = await Promise.all([
    counterSettings(ctx),
    db.medicine.findMany({ where: { tenantId: t } }),
    db.batch.findMany({ where: { tenantId: t } }),
    db.customer.findMany({ where: { tenantId: t } }),
    db.supplier.findMany({ where: { tenantId: t } }),
    customerBalances(db, t),
    supplierBalances(db, t),
    moneyTotals(ctx),
  ]);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: t }, select: { settings: true, product: true } });
  const extras = await moveExtras(ctx, money.ids, (tenant.settings ?? {}) as Record<string, unknown>);
  const dist = tenant.product === "distribution" ? await moveDist(ctx, (tenant.settings ?? {}) as Record<string, unknown>, money.ids) : null;
  // Bounced cheques' reversals change dues like any receipt or payment.
  for (const r of extras.money.receipts) money.received.set(r.customerId, (money.received.get(r.customerId) ?? 0) + r.amountPaise);
  for (const r of extras.money.payments) money.paid.set(r.supplierId, (money.paid.get(r.supplierId) ?? 0) + r.amountPaise);
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
    // A distributor's chemists also owe for wholesale invoices, less credit notes (the device counts both).
    const d = (creditOf.get(c.id) ?? 0) + (dist?.billed.get(c.id) ?? 0) - (dist?.credited.get(c.id) ?? 0) - (backOf.get(c.id) ?? 0) - (money.received.get(c.id) ?? 0) - (custBal.get(c.id) ?? 0);
    return d ? [{ id: randomUUID(), customerId: c.id, amountPaise: d, mode: "cash", ref: "Opening balance, moved from Medoro", userId: ctx.userId, at: OPENING_AT }] : [];
  });
  const openingPayables = suppliers.flatMap((s) => {
    const d = (billedOf.get(s.id) ?? 0) - (money.paid.get(s.id) ?? 0) - (extras.credited.get(s.id) ?? 0) - (suppBal.get(s.id) ?? 0);
    return d ? [{ id: randomUUID(), supplierId: s.id, amountPaise: d, mode: "bank", ref: "Opening balance, moved from Medoro", userId: ctx.userId, at: OPENING_AT }] : [];
  });

  const c = counts[0];
  const nonZero = (m: Map<string, number>) => Object.fromEntries([...m].filter(([, v]) => v !== 0));
  const summary = {
    counts: {
      medicine: meds.length, batch: batches.length, customer: customers.length, supplier: suppliers.length,
      sale: num(c.sales), saleItem: num(c.items), payment: num(c.payments), salesReturn: num(c.returns), purchase: num(c.purchases), purchaseItem: num(c.purchaseItems),
      stockMovement: num(c.movements) + openingStock.length, loyaltyLedger: num(c.loyalty),
      customerReceipt: money.count.receipt + openingDues.length + extras.money.receipts.length,
      supplierPayment: money.count.payment + openingPayables.length + extras.money.payments.length,
      expense: money.count.expense + extras.money.expenses.length,
      ...Object.fromEntries(Object.entries(extras.tables).map(([k, rows]) => [k, rows.length])),
      ...(dist ? Object.fromEntries(Object.entries(dist.tables).map(([k, rows]) => [k, rows.length])) : {}),
    },
    totals: { salesPaise: num(totals[0].sales), returnsPaise: num(totals[0].returns), purchasesPaise: num(totals[0].purchases), expensesPaise: money.spent + extras.money.expenses.reduce((a, e) => a + e.amountPaise, 0) },
    stock: Object.fromEntries(batches.filter((b) => b.qtyAvailable).map((b) => [b.id, b.qtyAvailable])),
    customerDues: nonZero(custBal),
    // Returned goods waiting to be claimed, per batch (a distributor's quarantined stock).
    returnedPool: Object.fromEntries(dist ? (await db.batch.findMany({ where: { tenantId: t, qtyQuarantined: { gt: 0 } }, select: { id: true, qtyQuarantined: true } })).map((b) => [b.id, b.qtyQuarantined]) : []),
    supplierDues: nonZero(suppBal),
    points: nonZero(map(points)),
  };
  const warnings = [
    num(c.voided) ? `${num(c.voided)} cancelled bills stay only in Medoro’s copy (they don’t count anywhere).` : "",
    open ? `${open} delivery orders are still open. Finish or re-enter them on the device.` : "",
    num(quarantined._sum.qtyQuarantined) && !dist ? `${num(quarantined._sum.qtyQuarantined)} units set aside in quarantine aren’t moved as stock.` : "",
    ...extras.warnings,
    "Other account entries (opening balances, journal entries) come across as one opening balance per customer and supplier.",
  ].filter(Boolean);

  await writeAudit(db, { tenantId: t, userId: ctx.userId, userName: ctx.userName, action: "Data copied to a device for the move to Google Drive", entity: "tenant", entityId: t, detail: `${meds.length} medicines, ${num(c.sales)} bills, ${customers.length} customers` });
  return {
    v: 1, exportedAt: new Date().toISOString(),
    settings,
    medicines: meds.map((m) => ({ ...deviceMedicine(m), active: m.active })),
    batches: batches.map((b) => ({ id: b.id, branchId: b.branchId, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: isoOf(b.expiryDate), costPaise: big(b.costPaise), mrpPaise: big(b.mrpPaise), supplierId: b.supplierId, status: b.status === "damaged" ? "quarantine" : b.status })),
    // Erased customers keep their bills but not their details.
    customers: customers.map((x) => x.erasedAt ? { id: x.id, name: "Erased customer", phone: null, gstin: null, creditLimitPaise: 0, address: null, pincode: null, erased: true } : { id: x.id, name: x.name, phone: x.phone, gstin: x.gstin, creditLimitPaise: big(x.creditLimitPaise), address: x.address, pincode: x.pincode, erased: false,
      // Consent to offers on WhatsApp moves with the customer (the counter keeps it as a consent record).
      offers: x.waOptIn && x.marketingWa && x.phone ? { at: (x.optInAt ?? new Date()).toISOString(), method: x.optInMethod ?? "Recorded on Medoro" } : null }),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone, gstin: s.gstin, dl: null, address: null })),
    opening: { stock: openingStock, receipts: openingDues, supplierPayments: openingPayables },
    // Doctors, recalls, cheques, claims, supplier terms and pricing rules (loaded with the base), bounced cheques'
    // reversing rows (loaded with the openings) and the intelligence settings (this device's own).
    extras: { tables: extras.tables, money: extras.money, intel: extras.intel },
    dist: dist ? { tables: dist.tables, settings: dist.settings } : null,
    summary, warnings,
  };
}
export type MoveBase = Awaited<ReturnType<typeof moveBase>>;
