import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, daysTo, isoOf, istDate, istMidnight, todayISO } from "@/lib/dates";
import { createPoIn } from "@/domain/purchasing/service";
import { distAuthorize, distView } from "./context";
import { audit, distSettings, num, requireDistFeature } from "./common";
import { avgDaily, demandForecast, isDeadStock, nextMonthTrend, profitability, reorderQty, schemeImpact } from "./rules/analytics";
import { DEFAULT_POLICY, expiryLoss } from "./rules/expiry";
import { receivables } from "./receivables";
import { reservedUnits } from "./orders";

// Everything here reads the distributor's own posted records (invoices, GRNs, batches, ledgers) for the godowns
// the user can see. Nothing here posts a financial transaction: the only write is a DRAFT purchase order, which a
// person reviews and places from Purchases.

const HISTORY = 120;

/** Packs sold per product per day (paid + free) over the last `days` days, oldest first, ending yesterday. */
async function salesSeries(ctx: Ctx, days = HISTORY, branchIds = ctx.branches.map((b) => b.id)) {
  const start = addDays(todayISO(), -days), end = todayISO();
  const rows = await db.$queryRaw<{ m: string; d: Date; q: bigint }[]>`
    SELECT l."medicineId" m, i.date d, SUM(l.qty + l."freeQty")::bigint q
    FROM "DistInvoiceLine" l JOIN "DistInvoice" i ON i.id = l."invoiceId"
    WHERE i."tenantId" = ${ctx.tenantId} AND i."branchId" = ANY(${branchIds}) AND i.date >= ${new Date(start)} AND i.date < ${new Date(end)}
      AND NOT EXISTS (SELECT 1 FROM "DistInvoiceCancel" c WHERE c."invoiceId" = i.id)
    GROUP BY 1, 2`;
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const arr = out.get(r.m) ?? new Array<number>(days).fill(0);
    const idx = Math.round((r.d.getTime() - new Date(start + "T00:00:00Z").getTime()) / 86400000);
    if (idx >= 0 && idx < days) arr[idx] += Number(r.q);
    out.set(r.m, arr);
  }
  return { start, series: out };
}

async function stockPosition(ctx: Ctx, branchIds = ctx.branches.map((b) => b.id)) {
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: branchIds }, status: "ok", qtyAvailable: { gt: 0 }, expiryDate: { gt: new Date() } }, include: { medicine: { select: { packSize: true } } } });
  const res = await reservedUnits(db, ctx.tenantId, batches.map((b) => b.id));
  const onHand = new Map<string, number>(), reserved = new Map<string, number>();
  for (const b of batches) {
    const p = Math.max(1, b.medicine.packSize);
    onHand.set(b.medicineId, (onHand.get(b.medicineId) ?? 0) + b.qtyAvailable / p);
    reserved.set(b.medicineId, (reserved.get(b.medicineId) ?? 0) + (res[b.id] ?? 0) / p);
  }
  const pos = await db.purchaseOrder.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: branchIds }, status: { in: ["ordered", "partially_received"] } }, include: { items: true } });
  const received = await db.grnItem.groupBy({ by: ["poItemId"], where: { poItemId: { in: pos.flatMap((p) => p.items.map((i) => i.id)) } }, _sum: { qty: true } });
  const onOrder = new Map<string, number>();
  for (const it of pos.flatMap((p) => p.items)) onOrder.set(it.medicineId, (onOrder.get(it.medicineId) ?? 0) + Math.max(0, it.qty - (received.find((r) => r.poItemId === it.id)?._sum.qty ?? 0)));
  return { onHand, reserved, onOrder };
}

export type Recommendation = { medicineId: string; name: string; company: string; supplierId: string | null; supplier: string | null; onHand: number; onOrder: number; reserved: number; daily: number; method: "forecast" | "average"; leadDays: number; reorderPoint: number; packs: number; rate: number; value: number };

/** Purchase recommendations and automatic reorder suggestions per product. */
export async function purchaseRecommendations(ctx: Ctx): Promise<Recommendation[]> {
  distView(ctx, "purchase", "insights");
  const settings = await distSettings(ctx.tenantId);
  const [{ start, series }, pos, products, meds] = await Promise.all([
    salesSeries(ctx), stockPosition(ctx),
    db.distProduct.findMany({ where: { tenantId: ctx.tenantId, discontinued: false } }),
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, name: true, reorderLevel: true } }),
  ]);
  const [principals, companies, suppliers, lastGrn] = await Promise.all([
    db.distPrincipal.findMany({ where: { tenantId: ctx.tenantId } }),
    db.distCompany.findMany({ where: { tenantId: ctx.tenantId } }),
    db.supplier.findMany({ where: { tenantId: ctx.tenantId } }),
    db.$queryRaw<{ m: string; rate: bigint; s: string }[]>`SELECT DISTINCT ON (gi."medicineId") gi."medicineId" m, gi."ratePaise" rate, g."supplierId" s FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId" WHERE g."tenantId" = ${ctx.tenantId} ORDER BY gi."medicineId", g."approvedAt" DESC`,
  ]);
  const out: Recommendation[] = [];
  for (const p of products) {
    const m = meds.find((x) => x.id === p.medicineId);
    if (!m) continue;
    const s = series.get(p.medicineId) ?? new Array<number>(HISTORY).fill(0);
    const f = demandForecast({ start, values: s }, 30);
    const daily = f ? f.daily : avgDaily({ start, values: s }, 60);
    const pr = principals.find((x) => x.id === p.principalId);
    const g = lastGrn.find((x) => x.m === p.medicineId);
    const sup = suppliers.find((x) => x.id === (pr?.supplierId ?? g?.s));
    const leadDays = Math.max(1, Math.ceil(Number(sup?.leadDays ?? 2)));
    const onHand = Math.floor(pos.onHand.get(p.medicineId) ?? 0), onOrder = pos.onOrder.get(p.medicineId) ?? 0, reserved = Math.floor(pos.reserved.get(p.medicineId) ?? 0);
    const r = reorderQty({ onHand, onOrder, reserved, dailyDemand: daily, leadDays, coverDays: settings.coverDays, safetyDays: settings.safetyDays, packSize: 1, minOrder: 0 });
    const belowLevel = m.reorderLevel > 0 && onHand + onOrder - reserved < m.reorderLevel;
    const packs = r.packs || (belowLevel ? m.reorderLevel - (onHand + onOrder - reserved) : 0);
    if (packs <= 0) continue;
    const rate = num(g?.rate) || num(p.ptsPaise) || Math.round(num(p.ptrPaise) * 0.9);
    out.push({ medicineId: p.medicineId, name: m.name, company: companies.find((c) => c.id === p.companyId)?.name ?? "—", supplierId: sup?.id ?? null, supplier: sup?.name ?? null, onHand, onOrder, reserved, daily: Math.round(daily * 100) / 100, method: f ? "forecast" : "average", leadDays, reorderPoint: r.reorderPoint, packs, rate, value: packs * rate });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Turns chosen recommendations into DRAFT purchase orders, one per supplier. Placing them stays a human step. */
export async function draftPurchaseOrders(ctx: Ctx, medicineIds: string[]) {
  distAuthorize(ctx, "purchase");
  const recs = (await purchaseRecommendations(ctx)).filter((r) => medicineIds.includes(r.medicineId));
  if (!recs.length) throw new UserError("Choose at least one suggestion.");
  const noSup = recs.find((r) => !r.supplierId);
  if (noSup) throw new UserError(`${noSup.name} has no supplier. Link its principal to a supplier first.`);
  const by = new Map<string, Recommendation[]>();
  for (const r of recs) by.set(r.supplierId!, [...(by.get(r.supplierId!) ?? []), r]);
  return db.$transaction(async (tx) => {
    const made: string[] = [];
    for (const [supplierId, rs] of by) {
      const po = await createPoIn(tx, ctx, { supplierId, source: "ai", note: "Suggested by Distribution intelligence", lines: rs.map((r) => ({ medicineId: r.medicineId, qty: r.packs, rate: (r.rate / 100).toFixed(2) })) });
      made.push(po.no);
    }
    await audit(tx, ctx, "Draft POs from recommendations", "purchase_order", null, `${made.join(", ")} · ${recs.length} product(s) · review and place under Purchases`);
    return made;
  });
}

/** Batches likely to expire unsold at the current sales pace, with the loss after expected principal credit. */
export async function expiryRisk(ctx: Ctx) {
  distView(ctx, "insights", "purchase", "reports");
  const { start, series } = await salesSeries(ctx, 90);
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, status: "ok", qtyAvailable: { gt: 0 }, expiryDate: { gt: new Date(), lte: new Date(Date.now() + 240 * 86400000) } }, include: { medicine: true }, orderBy: { expiryDate: "asc" } });
  const dps = await db.distProduct.findMany({ where: { tenantId: ctx.tenantId, medicineId: { in: batches.map((b) => b.medicineId) } } });
  const prs = await db.distPrincipal.findMany({ where: { tenantId: ctx.tenantId } });
  // Earlier batches of the same product sell first (FEFO), so each batch gets the demand left after them.
  const used = new Map<string, number>();
  return batches.map((b) => {
    const pack = Math.max(1, b.medicine.packSize), units = b.qtyAvailable / pack, left = daysTo(b.expiryDate);
    const rate = avgDaily({ start, values: series.get(b.medicineId) ?? [] }, 60);
    const ahead = used.get(b.medicineId) ?? 0;
    const daysForThis = Math.max(0, left - (rate > 0 ? ahead / rate : 0));
    used.set(b.medicineId, ahead + units);
    const pr = prs.find((p) => p.id === dps.find((d) => d.medicineId === b.medicineId)?.principalId);
    const pol = pr ? { claimBeforeDays: pr.claimBeforeDays, claimAfterDays: pr.claimAfterDays, claimCreditPct: num(pr.claimCreditPct) } : DEFAULT_POLICY;
    const e = expiryLoss(units, rate, daysForThis, num(b.costPaise), pol);
    return { batchId: b.id, name: b.medicine.name, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), daysLeft: left, packs: units, dailyRate: Math.round(rate * 100) / 100, unsold: e.unsold, atRisk: e.unsold * num(b.costPaise), recoverable: e.recoverable, loss: e.loss };
  }).filter((x) => x.unsold > 0).sort((a, b) => b.loss - a.loss);
}

/** Products with stock and no sale in `days` days, by value. */
export async function deadStock(ctx: Ctx, days = 90) {
  distView(ctx, "insights", "purchase", "reports");
  const [batches, last] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, qtyAvailable: { gt: 0 } }, include: { medicine: true } }),
    db.$queryRaw<{ m: string; d: Date }[]>`SELECT l."medicineId" m, MAX(i.date) d FROM "DistInvoiceLine" l JOIN "DistInvoice" i ON i.id = l."invoiceId" WHERE i."tenantId" = ${ctx.tenantId} GROUP BY 1`,
  ]);
  const by = new Map<string, { name: string; packs: number; value: number; batches: number }>();
  for (const b of batches) {
    const p = Math.max(1, b.medicine.packSize), cur = by.get(b.medicineId) ?? { name: b.medicine.name, packs: 0, value: 0, batches: 0 };
    cur.packs += b.qtyAvailable / p; cur.value += (b.qtyAvailable / p) * num(b.costPaise); cur.batches++;
    by.set(b.medicineId, cur);
  }
  const today = todayISO();
  return [...by].map(([id, v]) => { const l = last.find((x) => x.m === id); return { medicineId: id, ...v, value: Math.round(v.value), lastSale: l ? isoOf(l.d) : null }; })
    .filter((x) => isDeadStock(x.lastSale, today, x.packs, days)).sort((a, b) => b.value - a.value);
}

/** Product profitability over the last `days` days: sales, cost, scheme cost (free goods + scheme discount), margins. */
export async function productProfitability(ctx: Ctx, days = 90) {
  distView(ctx, "insights", "reports");
  const rows = await db.$queryRaw<{ m: string; rev: bigint; cost: bigint; q: bigint; f: bigint; disc: bigint; freecost: bigint }[]>`
    SELECT l."medicineId" m, SUM(l."taxablePaise")::bigint rev, SUM(l."costPaise")::bigint cost, SUM(l.qty)::bigint q, SUM(l."freeQty")::bigint f,
      SUM(CASE WHEN l."schemeId" IS NOT NULL THEN l."discPaise" ELSE 0 END)::bigint disc,
      SUM(CASE WHEN l.qty + l."freeQty" > 0 THEN l."costPaise" * l."freeQty" / (l.qty + l."freeQty") ELSE 0 END)::bigint freecost
    FROM "DistInvoiceLine" l JOIN "DistInvoice" i ON i.id = l."invoiceId"
    WHERE i."tenantId" = ${ctx.tenantId} AND i."branchId" = ANY(${ctx.branches.map((b) => b.id)}) AND i.at >= ${new Date(Date.now() - days * 86400000)}
      AND NOT EXISTS (SELECT 1 FROM "DistInvoiceCancel" c WHERE c."invoiceId" = i.id)
    GROUP BY 1`;
  const meds = await db.medicine.findMany({ where: { id: { in: rows.map((r) => r.m) } }, select: { id: true, name: true } });
  return rows.map((r) => {
    const p = profitability({ revenue: num(r.rev), cost: num(r.cost), schemeCost: num(r.disc), qty: num(r.q) });
    return { medicineId: r.m, name: meds.find((m) => m.id === r.m)?.name ?? "—", packs: num(r.q), free: num(r.f), revenue: num(r.rev), cost: num(r.cost), freeGoodsCost: num(r.freecost), schemeDisc: num(r.disc), ...p };
  }).sort((a, b) => b.gross - a.gross);
}

/** Each scheme that ran: sales and margin during it vs the same length of time just before it, net of its cost. */
export async function schemeProfitability(ctx: Ctx) {
  distView(ctx, "insights", "reports");
  const schemes = await db.distScheme.findMany({ where: { tenantId: ctx.tenantId, validFrom: { lte: new Date() } }, orderBy: { validFrom: "desc" }, take: 50 });
  const out = [];
  for (const s of schemes) {
    const from = isoOf(s.validFrom), to = isoOf(s.validTo) < todayISO() ? isoOf(s.validTo) : todayISO();
    const len = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000 + 1);
    const medIds = s.medicineId ? [s.medicineId] : (await db.distProduct.findMany({ where: { tenantId: ctx.tenantId, companyId: s.companyId }, select: { medicineId: true } })).map((x) => x.medicineId);
    const window = async (a: string, b: string) => {
      const r = await db.$queryRaw<{ q: bigint; m: bigint; fc: bigint; d: bigint }[]>`
        SELECT COALESCE(SUM(l.qty), 0)::bigint q, COALESCE(SUM(l."taxablePaise" - l."costPaise"), 0)::bigint m,
          COALESCE(SUM(CASE WHEN l."schemeId" = ${s.id} AND l.qty + l."freeQty" > 0 THEN l."costPaise" * l."freeQty" / (l.qty + l."freeQty") ELSE 0 END), 0)::bigint fc,
          COALESCE(SUM(CASE WHEN l."schemeId" = ${s.id} THEN l."discPaise" ELSE 0 END), 0)::bigint d
        FROM "DistInvoiceLine" l JOIN "DistInvoice" i ON i.id = l."invoiceId"
        WHERE i."tenantId" = ${ctx.tenantId} AND l."medicineId" = ANY(${medIds}) AND i.date >= ${new Date(a)} AND i.date <= ${new Date(b)}
          AND NOT EXISTS (SELECT 1 FROM "DistInvoiceCancel" c WHERE c."invoiceId" = i.id)`;
      return { qty: num(r[0]?.q), margin: num(r[0]?.m), freeCost: num(r[0]?.fc), disc: num(r[0]?.d) };
    };
    const during = await window(from, to), before = await window(addDays(from, -len), addDays(from, -1));
    // Margin already nets free goods' cost (it is in costPaise) and discounts (they reduce taxable value), so the
    // scheme cost is reported for information and the uplift compares margins directly.
    const imp = schemeImpact({ before: { qty: before.qty, margin: before.margin }, during: { qty: during.qty, margin: during.margin }, schemeCost: 0 });
    out.push({ id: s.id, code: s.code, name: s.name, from, to, before, during, schemeCost: during.freeCost + during.disc, ...imp, verdict: imp.uplift > 0 ? "profitable" : imp.uplift < 0 ? "loss-making" : "neutral" });
  }
  return out;
}

/** Next month's sales from the last six months' trend, and next 30 days per top product. */
export async function salesForecast(ctx: Ctx) {
  distView(ctx, "insights", "reports");
  const rows = await db.$queryRaw<{ ym: string; v: bigint }[]>`
    SELECT to_char(i.date, 'YYYY-MM') ym, SUM(i."totalPaise")::bigint v FROM "DistInvoice" i
    WHERE i."tenantId" = ${ctx.tenantId} AND i.date >= ${new Date(addDays(todayISO().slice(0, 8) + "01", -183))} AND i.date < ${new Date(todayISO().slice(0, 8) + "01")}
      AND NOT EXISTS (SELECT 1 FROM "DistInvoiceCancel" c WHERE c."invoiceId" = i.id)
    GROUP BY 1 ORDER BY 1`;
  const months = rows.map((r) => ({ month: r.ym, sales: num(r.v) }));
  const t = nextMonthTrend(months.map((m) => m.sales));
  const { start, series } = await salesSeries(ctx);
  const meds = await db.medicine.findMany({ where: { id: { in: [...series.keys()] } }, select: { id: true, name: true } });
  const products = [...series].map(([id, s]) => ({ id, name: meds.find((m) => m.id === id)?.name ?? "—", f: demandForecast({ start, values: s }, 30), last30: s.slice(-30).reduce((a, b) => a + b, 0) }))
    .filter((p) => p.f).sort((a, b) => b.f!.total - a.f!.total).slice(0, 15).map((p) => ({ id: p.id, name: p.name, last30: p.last30, next30: Math.round(p.f!.total), low: Math.round(p.f!.low), high: Math.round(p.f!.high) }));
  return { months, next: t ? { sales: t.next, slope: t.slope } : null, products };
}

export async function creditRisks(ctx: Ctx) {
  distView(ctx, "insights", "payments", "reports");
  return (await receivables(ctx)).filter((r) => r.balance > 0).sort((a, b) => b.risk.score - a.risk.score);
}

// ───────────── Management reporting assistant ─────────────

export type AssistantAnswer = { answer: string; table?: { columns: string[]; rows: (string | number)[][] }; source: string; actions?: { label: string; href: string }[] };

const rup = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

/**
 * Answers management questions from the distributor's own data with fixed, auditable queries (no language model,
 * nothing leaves the server). It can point to an action, never perform one.
 */
export async function askAssistant(ctx: Ctx, question: string): Promise<AssistantAnswer> {
  distView(ctx, "insights");
  await requireDistFeature(ctx.tenantId, "insights");
  const q = question.toLowerCase();
  const has = (...w: string[]) => w.some((x) => q.includes(x));
  if (has("reorder", "purchase", "buy", "order from", "खरीद")) {
    const r = await purchaseRecommendations(ctx);
    return { answer: r.length ? `${r.length} products are at or below their reorder point. Suggested buying: ${rup(r.reduce((a, x) => a + x.value, 0))} at last purchase rates.` : "Nothing needs reordering at the current sales pace.",
      table: { columns: ["Product", "Supplier", "On hand", "Daily sale", "Suggest (packs)", "Value"], rows: r.slice(0, 10).map((x) => [x.name, x.supplier ?? "—", x.onHand, x.daily, x.packs, rup(x.value)]) }, source: "Last 120 days of invoices, stock, open POs and supplier lead times.", actions: [{ label: "Review & draft POs", href: "/dist/insights?tab=purchase" }] };
  }
  if (has("expir", "एक्सपायरी")) {
    const r = await expiryRisk(ctx);
    return { answer: r.length ? `${r.length} batches will likely expire unsold: ${rup(r.reduce((a, x) => a + x.atRisk, 0))} at cost, ${rup(r.reduce((a, x) => a + x.loss, 0))} after expected principal credit.` : "No batch is expected to expire unsold at the current pace.",
      table: { columns: ["Product", "Batch", "Expiry", "Packs", "Unsold (est.)", "Loss after credit"], rows: r.slice(0, 10).map((x) => [x.name, x.batchNo, x.expiry, x.packs, x.unsold, rup(x.loss)]) }, source: "Batches expiring in 240 days, 60-day sales pace, FEFO order, principal claim terms.", actions: [{ label: "Expiry workbench", href: "/dist/expiry" }] };
  }
  if (has("dead", "slow", "not selling", "non-moving")) {
    const r = await deadStock(ctx);
    return { answer: r.length ? `${r.length} products haven’t sold in 90 days, holding ${rup(r.reduce((a, x) => a + x.value, 0))} of stock.` : "No dead stock: every product in stock sold in the last 90 days.",
      table: { columns: ["Product", "Packs", "Value", "Last sale"], rows: r.slice(0, 10).map((x) => [x.name, x.packs, rup(x.value), x.lastSale ?? "never"]) }, source: "Stock on hand and the last invoice date per product." };
  }
  if (has("outstanding", "owe", "due", "credit", "risk", "collect", "receivable", "pending payment", "बकाया", "उधार")) {
    const r = await creditRisks(ctx);
    return { answer: r.length ? `${rup(r.reduce((a, x) => a + x.balance, 0))} is outstanding from ${r.length} chemists, ${rup(r.reduce((a, x) => a + x.overdue, 0))} overdue. ${r.filter((x) => x.risk.level === "high").length} are high risk.` : "No chemist owes anything.",
      table: { columns: ["Chemist", "Balance", "Overdue", "Oldest (days)", "Risk", "Why"], rows: r.slice(0, 10).map((x) => [x.name, rup(x.balance), rup(x.overdue), x.oldestDays, `${x.risk.level} ${x.risk.score}`, x.risk.factors.join("; ")]) }, source: "Ledger balances, invoice ages, bounced cheques, 90-day collections.", actions: [{ label: "Credit control", href: "/dist/credit" }] };
  }
  if (has("scheme", "offer")) {
    const r = await schemeProfitability(ctx);
    return { answer: r.length ? `${r.filter((x) => x.verdict === "profitable").length} of ${r.length} schemes raised gross margin over the period before them.` : "No schemes have run yet.",
      table: { columns: ["Scheme", "Period", "Qty before → during", "Margin change", "Scheme cost", "Verdict"], rows: r.slice(0, 10).map((x) => [`${x.code} ${x.name}`, `${x.from} – ${x.to}`, `${x.before.qty} → ${x.during.qty}`, rup(x.extraMargin), rup(x.schemeCost), x.verdict]) }, source: "Invoice lines during each scheme vs the same number of days before it." };
  }
  if (has("profit", "margin", "मुनाफ")) {
    const r = await productProfitability(ctx);
    const tot = r.reduce((a, x) => ({ rev: a.rev + x.revenue, g: a.g + x.gross }), { rev: 0, g: 0 });
    return { answer: `Last 90 days: sales ${rup(tot.rev)}, gross margin ${rup(tot.g)} (${tot.rev ? Math.round((tot.g / tot.rev) * 1000) / 10 : 0}%).`,
      table: { columns: ["Product", "Sales", "Gross margin", "Margin %", "Free goods cost"], rows: r.slice(0, 10).map((x) => [x.name, rup(x.revenue), rup(x.gross), x.grossPct ?? "—", rup(x.freeGoodsCost)]) }, source: "Invoice lines (taxable value) less landed cost of every pack shipped, last 90 days." };
  }
  if (has("forecast", "next month", "predict", "sales")) {
    const f = await salesForecast(ctx);
    return { answer: f.next ? `Next month’s sales trend to about ${rup(f.next.sales)} (${f.next.slope >= 0 ? "rising" : "falling"} ${rup(Math.abs(f.next.slope))} a month).` : "At least three full months of invoices are needed for a sales forecast.",
      table: { columns: ["Product", "Last 30 days", "Next 30 days", "80% range"], rows: f.products.slice(0, 10).map((x) => [x.name, x.last30, x.next30, `${x.low}–${x.high}`]) }, source: "Monthly invoice totals (least-squares trend) and the per-product demand model." };
  }
  const today = await db.distInvoice.aggregate({ where: { tenantId: ctx.tenantId, at: { gte: istMidnight(todayISO()) } }, _sum: { totalPaise: true }, _count: true });
  return { answer: `Today: ${today._count} invoices worth ${rup(num(today._sum.totalPaise))}. Ask about reorders, expiry risk, dead stock, outstanding / credit risk, scheme results, margins or the sales forecast.`, source: `Invoices raised today (${istDate(new Date())}).` };
}
