import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { isoOf, daysTo } from "@/lib/dates";
import { phoneMasker } from "@/domain/system/strict";
import { writeOff } from "./adjust";
import { affectedBatches } from "./recalls";

/**
 * Trace and resolution report of one recall notice, over the branches the user can access. Quantities are in stock units
 * and come from the stock-movement ledger, so they add up: what is still on the shelf, what was sold (net of returns and
 * voids), what went back to the supplier, what was destroyed or returned to the manufacturer.
 */
export const DISPOSAL_METHODS = ["destroyed", "returned_manufacturer"] as const;

export type BatchTrace = { batchId: string; branch: string; branchId: string; medicine: string; batchNo: string; expiry: string; status: string; onHand: number; sold: number; returnedToSupplier: number; disposed: number; transferredOut: number; traced: number; sellableNow: boolean };
export type RecallReport = {
  notice: { id: string; ref: string; product: string; manufacturer: string | null; batchNos: string[]; source: string; noticeNo: string | null; sourceUrl: string | null; publishedAt: string; reason: string; status: string; attestedBy: string | null; attestedAt: string | null; recordedAt: string; resolvedAt: string | null; resolutionNote: string | null };
  batches: BatchTrace[];
  totals: { onHand: number; sold: number; returnedToSupplier: number; disposed: number; traced: number; sellableNow: number };
  customers: { customer: string; phone: string | null; invoiceNo: string; at: string; qty: number; unit: string; canMessage: boolean }[];
  disposals: { at: string; branch: string; batchNo: string; qty: number; method: string; reference: string | null; by: string }[];
  audit: { at: string; who: string; action: string; detail: string | null }[];
  /** Why this recall can or can't be closed now. */
  closable: { ok: boolean; reason: string };
};

export async function recallReport(ctx: Ctx, id: string): Promise<RecallReport> {
  authorizeView(ctx, "adjust", "users", "reports");
  const r = await db.recall.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw new UserError("Recall not found.");
  const visible = ctx.branches.map((b) => b.id), names = new Map(ctx.branches.map((b) => [b.id, b.name]));
  const bs = await affectedBatches(db, ctx.tenantId, r, { branchId: { in: visible } });
  const ids = bs.map((b) => b.id);
  const mv = ids.length ? await db.stockMovement.groupBy({ by: ["batchId", "type"], where: { tenantId: ctx.tenantId, batchId: { in: ids } }, _sum: { qty: true } }) : [];
  const sum = (batchId: string, ...types: string[]) => mv.filter((m) => m.batchId === batchId && types.includes(m.type)).reduce((a, m) => a + (m._sum.qty ?? 0), 0);
  const out = (...types: string[]) => (b: string) => { const n = sum(b, ...types); return n === 0 ? 0 : -n; }; // movements leave stock as negatives; report them as positive units (and never -0)
  const batches: BatchTrace[] = bs.map((b) => {
    const sold = out("sale", "return", "void")(b.id), back = out("supplier_return")(b.id), disposed = out("write_off")(b.id), moved = out("transfer_out")(b.id);
    return { batchId: b.id, branchId: b.branchId, branch: names.get(b.branchId) ?? "", medicine: b.medicine.name, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), status: b.status, onHand: b.qtyAvailable, sold, returnedToSupplier: back, disposed, transferredOut: moved, traced: b.qtyAvailable + sold + back + disposed + moved, sellableNow: b.status === "ok" && b.qtyAvailable > 0 && daysTo(b.expiryDate) > 0 };
  }).sort((a, b) => a.branch.localeCompare(b.branch) || a.batchNo.localeCompare(b.batchNo));
  const total = (k: "onHand" | "sold" | "returnedToSupplier" | "disposed" | "traced") => batches.reduce((a, b) => a + b[k], 0);

  const [lines, mask, discs, events] = await Promise.all([
    ids.length ? db.saleItem.findMany({ where: { batchId: { in: ids }, sale: { tenantId: ctx.tenantId, customerId: { not: null }, voided: null } }, select: { qty: true, returnedQty: true, loose: true, sale: { select: { invoiceNo: true, at: true, customer: { select: { name: true, phone: true, waOptIn: true, smsOptIn: true, erasedAt: true } } } } }, orderBy: { sale: { at: "desc" } }, take: 500 }) : [],
    phoneMasker(ctx),
    db.recallDisposal.findMany({ where: { tenantId: ctx.tenantId, recallId: id, branchId: { in: visible } }, orderBy: { at: "asc" } }),
    db.auditEvent.findMany({ where: { tenantId: ctx.tenantId, entity: "recall", entityId: id }, orderBy: { id: "asc" }, select: { at: true, userName: true, action: true, detail: true } }),
  ]);
  const people = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set([r.verifiedBy, ...discs.map((d) => d.userId)].filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const who = (u: string | null) => people.find((p) => p.id === u)?.name ?? null;
  const batchById = new Map(batches.map((b) => [b.batchId, b]));
  const customers = lines.filter((l) => l.qty - l.returnedQty > 0 && l.sale.customer && !l.sale.customer.erasedAt).map((l) => ({
    customer: l.sale.customer!.name, phone: mask(l.sale.customer!.phone), invoiceNo: l.sale.invoiceNo, at: l.sale.at.toISOString(), qty: l.qty - l.returnedQty, unit: l.loose ? "loose unit(s)" : "pack(s)",
    // Consent to be contacted about their own purchases (transactional). It says nothing about marketing, and a recall message is not marketing.
    canMessage: l.sale.customer!.waOptIn || l.sale.customer!.smsOptIn,
  }));
  const open = batches.filter((b) => b.onHand > 0);
  return {
    notice: { id: r.id, ref: r.sourceRef, product: r.product, manufacturer: r.manufacturer, batchNos: r.batchNos, source: r.source, noticeNo: r.noticeNo, sourceUrl: r.sourceUrl, publishedAt: isoOf(r.publishedAt), reason: r.reason, status: r.status, attestedBy: who(r.verifiedBy), attestedAt: r.verifiedAt?.toISOString() ?? null, recordedAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null, resolutionNote: r.resolutionNote },
    batches, totals: { onHand: total("onHand"), sold: total("sold"), returnedToSupplier: total("returnedToSupplier"), disposed: total("disposed"), traced: total("traced"), sellableNow: batches.filter((b) => b.sellableNow).reduce((a, b) => a + b.onHand, 0) },
    customers,
    disposals: discs.map((d) => ({ at: d.at.toISOString(), branch: names.get(d.branchId) ?? "", batchNo: batchById.get(d.batchId)?.batchNo ?? "", qty: d.qty, method: d.method, reference: d.reference, by: who(d.userId) ?? "" })),
    audit: events.map((e) => ({ at: e.at.toISOString(), who: e.userName ?? "System", action: e.action, detail: e.detail })),
    closable: r.status === "resolved" ? { ok: false, reason: "Already resolved." } : open.length ? { ok: false, reason: `${open.reduce((a, b) => a + b.onHand, 0)} unit(s) still held in ${open.length} batch(es): return or dispose of them, or record why they remain.` } : { ok: true, reason: "No affected stock is left in the branches you can see." },
  };
}

/** Destroys (or hands back to the manufacturer) recalled stock held at the current branch, as a normal write-off plus a disposal record. */
export async function disposeRecalled(ctx: Ctx, recallId: string, batchId: string, qty: number, method: (typeof DISPOSAL_METHODS)[number], reference: string, note?: string) {
  authorize(ctx, "adjust");
  if (!DISPOSAL_METHODS.includes(method)) throw new UserError("Choose how the stock was disposed of.");
  if (!Number.isInteger(qty) || qty < 1) throw new UserError("Enter a quantity.");
  const ref = reference.trim();
  if (ref.length < 3) throw new UserError("Enter the destruction certificate or return note number.");
  const r = await db.recall.findFirst({ where: { id: recallId, tenantId: ctx.tenantId } });
  if (!r) throw new UserError("Recall not found.");
  const b = (await affectedBatches(db, ctx.tenantId, r, { id: batchId })).at(0);
  if (!b) throw new UserError("That batch is not affected by this notice.");
  if (b.branchId !== ctx.branchId) throw new UserError("Dispose of stock at the branch that holds it.");
  const no = await writeOff(ctx, batchId, qty, `Recall ${r.sourceRef}: ${method === "destroyed" ? "destroyed" : "returned to manufacturer"} · ${ref}`);
  await db.recallDisposal.create({ data: { tenantId: ctx.tenantId, recallId, branchId: b.branchId, batchId, qty, method, reference: ref, stockOutNo: no, note: note?.trim() || null, userId: ctx.userId } });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Recall disposal ${r.sourceRef}`, entity: "recall", entityId: recallId, detail: `${b.medicine.name} ${b.batchNo} × ${qty} · ${method} · ${ref} · ${no}` });
  return no;
}
