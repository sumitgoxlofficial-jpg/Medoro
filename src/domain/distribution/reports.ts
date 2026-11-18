import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, isoOf, istDate, istMidnight, todayISO } from "@/lib/dates";
import { distView } from "./context";
import { num } from "./common";
import { receivables } from "./receivables";
import { claimReconciliation } from "./returns";

export type Report = { title: string; note?: string; columns: string[]; money: number[]; rows: (string | number)[][] };

export const DIST_REPORTS = [
  ["sales-register", "Sales register"],
  ["sales-product", "Sales by product"],
  ["sales-company", "Sales by company"],
  ["sales-chemist", "Sales by chemist"],
  ["sales-salesman", "Salesman performance"],
  ["sales-territory", "Sales by territory"],
  ["purchase-register", "Purchase register"],
  ["stock", "Stock statement (batch-wise)"],
  ["outstanding", "Outstanding & ageing"],
  ["collections", "Collections"],
  ["schemes", "Scheme report"],
  ["deliveries", "Delivery performance"],
  ["claims", "Supplier claims"],
  ["credit-notes", "Credit notes"],
] as const;
export type DistReportId = (typeof DIST_REPORTS)[number][0];
export const isDistReport = (id: string): id is DistReportId => DIST_REPORTS.some(([k]) => k === id);

const rs = (p: number) => Math.round(p) / 100;

export function rangeOf(from?: string, to?: string) {
  const t = todayISO();
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : t.slice(0, 8) + "01";
  const e = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : t;
  if (e < f) throw new UserError("The end date is before the start date.");
  return { from: f, to: e, gte: istMidnight(f), lt: istMidnight(addDays(e, 1)) };
}

/** Invoice lines in the range (cancelled invoices excluded), with product, company, chemist and salesman. */
async function salesLines(ctx: Ctx, r: ReturnType<typeof rangeOf>) {
  const invs = await db.distInvoice.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, at: { gte: r.gte, lt: r.lt } }, include: { lines: true } });
  const cx = new Set((await db.distInvoiceCancel.findMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })).map((c) => c.invoiceId));
  const live = invs.filter((i) => !cx.has(i.id));
  const medIds = [...new Set(live.flatMap((i) => i.lines.map((l) => l.medicineId)))];
  const [meds, dps, cos, custs, chems, sms, terrs] = await Promise.all([
    db.medicine.findMany({ where: { id: { in: medIds } }, select: { id: true, name: true, packSize: true } }),
    db.distProduct.findMany({ where: { medicineId: { in: medIds } } }),
    db.distCompany.findMany({ where: { tenantId: ctx.tenantId } }),
    db.customer.findMany({ where: { id: { in: live.map((i) => i.customerId) } }, select: { id: true, name: true } }),
    db.distChemist.findMany({ where: { tenantId: ctx.tenantId } }),
    db.distSalesman.findMany({ where: { tenantId: ctx.tenantId } }),
    db.distTerritory.findMany({ where: { tenantId: ctx.tenantId } }),
  ]);
  return { live, lines: live.flatMap((i) => i.lines.map((l) => {
    const d = dps.find((x) => x.medicineId === l.medicineId), ch = chems.find((c) => c.customerId === i.customerId);
    return {
      inv: i, l, product: meds.find((m) => m.id === l.medicineId)?.name ?? "—", company: cos.find((c) => c.id === d?.companyId)?.name ?? "Unassigned",
      chemist: custs.find((c) => c.id === i.customerId)?.name ?? "—", salesman: sms.find((s) => s.id === (i.salesmanId ?? ch?.salesmanId))?.name ?? "Unassigned",
      territory: terrs.find((t) => t.id === ch?.territoryId)?.name ?? "Unassigned", taxable: num(l.taxablePaise), cost: num(l.costPaise), qty: l.qty, free: l.freeQty,
    };
  })), sms };
}

function groupBy<T>(rows: T[], key: (r: T) => string, val: (r: T) => number[]) {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const k = key(r), v = val(r), cur = m.get(k) ?? v.map(() => 0);
    m.set(k, cur.map((x, i) => x + v[i]));
  }
  return [...m];
}

export async function distReport(ctx: Ctx, id: DistReportId, from?: string, to?: string): Promise<Report> {
  distView(ctx, "reports");
  const r = rangeOf(from, to);
  const period = `${r.from} to ${r.to}`;
  switch (id) {
    case "sales-register": {
      const { live } = await salesLines(ctx, r);
      const custs = await db.customer.findMany({ where: { id: { in: live.map((i) => i.customerId) } }, select: { id: true, name: true, gstin: true } });
      return { title: `Sales register · ${period}`, columns: ["Date", "Invoice", "Chemist", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Round off", "Total"], money: [4, 5, 6, 7, 8, 9],
        rows: live.sort((a, b) => a.no.localeCompare(b.no)).map((i) => { const c = custs.find((x) => x.id === i.customerId); return [isoOf(i.date), i.no, c?.name ?? "—", i.customerGstin ?? "", rs(num(i.taxablePaise)), rs(num(i.cgstPaise)), rs(num(i.sgstPaise)), rs(num(i.igstPaise)), rs(num(i.roundOffPaise)), rs(num(i.totalPaise))]; }) };
    }
    case "sales-product": case "sales-company": case "sales-chemist": case "sales-territory": {
      const { lines } = await salesLines(ctx, r);
      const key = id === "sales-product" ? (x: (typeof lines)[number]) => x.product : id === "sales-company" ? (x: (typeof lines)[number]) => x.company : id === "sales-chemist" ? (x: (typeof lines)[number]) => x.chemist : (x: (typeof lines)[number]) => x.territory;
      const g = groupBy(lines, key, (x) => [x.qty, x.free, x.taxable, x.cost]).sort((a, b) => b[1][2] - a[1][2]);
      const label = { "sales-product": "Product", "sales-company": "Company", "sales-chemist": "Chemist", "sales-territory": "Territory" }[id];
      return { title: `Sales by ${label.toLowerCase()} · ${period}`, columns: [label, "Packs sold", "Free packs", "Sales (taxable)", "Cost", "Gross margin", "Margin %"], money: [3, 4, 5],
        rows: g.map(([k, [q, f, t, c]]) => [k, q, f, rs(t), rs(c), rs(t - c), t ? Math.round(((t - c) / t) * 1000) / 10 : 0]) };
    }
    case "sales-salesman": {
      const { lines, sms } = await salesLines(ctx, r);
      const g = new Map(groupBy(lines, (x) => x.salesman, (x) => [x.taxable, x.cost]));
      const coll = await db.distCollection.groupBy({ by: ["salesmanId"], where: { tenantId: ctx.tenantId, at: { gte: r.gte, lt: r.lt } }, _sum: { amountPaise: true } });
      const orders = await db.distOrder.groupBy({ by: ["salesmanId"], where: { tenantId: ctx.tenantId, placedAt: { gte: r.gte, lt: r.lt } }, _count: true });
      const names = [...new Set([...sms.map((s) => s.name), ...g.keys()])];
      return { title: `Salesman performance · ${period}`, note: "Target is the monthly target pro-rated to the period.", columns: ["Salesman", "Orders", "Sales (taxable)", "Target", "Achieved %", "Collections", "Gross margin"], money: [2, 3, 5, 6],
        rows: names.map((n) => {
          const s = sms.find((x) => x.name === n), [t, c] = g.get(n) ?? [0, 0];
          const days = (Date.parse(r.to) - Date.parse(r.from)) / 86400000 + 1, target = s ? Math.round((num(s.monthlyTargetPaise) * days) / 30) : 0;
          return [n, orders.find((o) => o.salesmanId === s?.id)?._count ?? 0, rs(t), rs(target), target ? Math.round((t / target) * 1000) / 10 : "", rs(num(coll.find((x) => x.salesmanId === s?.id)?._sum.amountPaise)), rs(t - c)];
        }) };
    }
    case "purchase-register": {
      const grns = await db.grn.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, approvedAt: { gte: r.gte, lt: r.lt } }, include: { items: true }, orderBy: { approvedAt: "asc" } });
      const sups = await db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, gstin: true } });
      return { title: `Purchase register · ${period}`, columns: ["Date", "GRN", "Supplier", "Supplier invoice", "GSTIN", "Lines", "Taxable", "GST", "Total"], money: [6, 7, 8],
        rows: grns.map((g) => { const s = sups.find((x) => x.id === g.supplierId); const tx = g.items.reduce((a, i) => a + num(i.basePaise), 0), gst = g.items.reduce((a, i) => a + num(i.gstPaise), 0); return [istDate(g.approvedAt), g.no, s?.name ?? "—", g.supplierInvoiceNo, s?.gstin ?? "", g.items.length, rs(tx), rs(gst), rs(num(g.totalPaise))]; }) };
    }
    case "stock": {
      const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, OR: [{ qtyAvailable: { gt: 0 } }, { qtyQuarantined: { gt: 0 } }] }, include: { medicine: true }, orderBy: [{ medicine: { name: "asc" } }, { expiryDate: "asc" }] });
      const brs = new Map(ctx.branches.map((b) => [b.id, b.name]));
      return { title: `Stock statement as of ${todayISO()}`, columns: ["Godown", "Product", "Batch", "Expiry", "Packs", "Quarantined", "Cost / pack", "MRP", "Value at cost"], money: [6, 7, 8],
        rows: batches.map((b) => { const p = Math.max(1, b.medicine.packSize); return [brs.get(b.branchId) ?? "—", b.medicine.name, b.batchNo, isoOf(b.expiryDate), b.qtyAvailable / p, b.qtyQuarantined / p, rs(num(b.costPaise)), rs(num(b.mrpPaise)), rs(((b.qtyAvailable + b.qtyQuarantined) / p) * num(b.costPaise))]; }) };
    }
    case "outstanding": {
      const rows = (await receivables(ctx)).filter((x) => x.balance !== 0);
      return { title: `Outstanding & ageing as of ${todayISO()}`, columns: ["Chemist", "Limit", "Balance", "Overdue", "0-30", "31-60", "61-90", "91-120", "120+", "Oldest (days)", "Risk"], money: [1, 2, 3, 4, 5, 6, 7, 8],
        rows: rows.map((x) => [x.name, rs(x.limit), rs(x.balance), rs(x.overdue), rs(x.buckets["0-30"]), rs(x.buckets["31-60"]), rs(x.buckets["61-90"]), rs(x.buckets["91-120"]), rs(x.buckets["120+"]), x.oldestDays, `${x.risk.level} (${x.risk.score})`]) };
    }
    case "collections": {
      const rows = await db.distCollection.findMany({ where: { tenantId: ctx.tenantId, at: { gte: r.gte, lt: r.lt } }, orderBy: { at: "asc" } });
      const [custs, sms] = await Promise.all([db.customer.findMany({ where: { id: { in: rows.map((x) => x.customerId) } }, select: { id: true, name: true } }), db.distSalesman.findMany({ where: { tenantId: ctx.tenantId } })]);
      return { title: `Collections · ${period}`, note: "Field and delivery collections. Office receipts are in the day book.", columns: ["Date", "Receipt", "Chemist", "Mode", "Reference", "Collected by", "Amount"], money: [6],
        rows: rows.map((x) => [istDate(x.at), x.voucherNo, custs.find((c) => c.id === x.customerId)?.name ?? "—", x.mode, x.ref ?? "", sms.find((s) => s.id === x.salesmanId)?.name ?? (x.deliveryId ? "Delivery" : "Office"), rs(num(x.amountPaise))]) };
    }
    case "schemes": {
      const { lines } = await salesLines(ctx, r);
      const schemes = await db.distScheme.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(lines.map((x) => x.l.schemeId).filter((x): x is string => !!x))] } } });
      const g = groupBy(lines.filter((x) => x.l.schemeId), (x) => x.l.schemeId!, (x) => { const per = x.qty + x.free ? x.cost / (x.qty + x.free) : 0; return [x.qty, x.free, x.taxable, x.free * per + num(x.l.discPaise), x.taxable - x.cost]; });
      return { title: `Scheme report · ${period}`, note: "Scheme cost = free goods at landed cost + scheme discount given.", columns: ["Scheme", "Type", "Paid packs", "Free packs", "Sales (taxable)", "Scheme cost", "Gross margin after scheme"], money: [4, 5, 6],
        rows: g.map(([sid, [q, f, t, c, m]]) => { const s = schemes.find((x) => x.id === sid); return [s ? `${s.code} ${s.name}` : sid, s?.kind === "free" ? `${s.buyQty}+${s.freeQty}` : `${num(s?.discPct)}%`, q, f, rs(t), rs(c), rs(m)]; }) };
    }
    case "deliveries": {
      const dels = await db.distDelivery.findMany({ where: { tenantId: ctx.tenantId, updatedAt: { gte: r.gte, lt: r.lt } } });
      const invs = await db.distInvoice.findMany({ where: { id: { in: dels.map((d) => d.invoiceId) } } });
      const by = groupBy(dels, (d) => d.status, (d) => [1, num(d.collectedPaise)]);
      const hours = dels.filter((d) => d.deliveredAt).map((d) => (d.deliveredAt!.getTime() - (invs.find((i) => i.id === d.invoiceId)?.at.getTime() ?? d.deliveredAt!.getTime())) / 3600000);
      const avg = hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : 0;
      return { title: `Delivery performance · ${period}`, note: `Average invoice-to-delivery time: ${avg} hours.`, columns: ["Status", "Invoices", "Collected at door"], money: [2], rows: by.map(([s, [n, c]]) => [s, n, rs(c)]) };
    }
    case "claims": {
      const rec = await claimReconciliation(ctx);
      return { title: `Supplier claims as of ${todayISO()}`, columns: ["Supplier", "Claims", "Claimed", "Credited", "Written off", "Open", "Oldest open (days)"], money: [2, 3, 4, 5], rows: rec.suppliers.map((s) => [s.supplier, s.claims, rs(s.claimed), rs(s.credited), rs(s.writtenOff), rs(s.open), s.oldestOpenDays]) };
    }
    case "credit-notes": {
      const rows = await db.distReturn.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, at: { gte: r.gte, lt: r.lt } }, orderBy: { at: "asc" } });
      const [custs, invs] = await Promise.all([db.customer.findMany({ where: { id: { in: rows.map((x) => x.customerId) } }, select: { id: true, name: true } }), db.distInvoice.findMany({ where: { id: { in: rows.map((x) => x.invoiceId) } }, select: { id: true, no: true } })]);
      return { title: `Credit notes · ${period}`, columns: ["Date", "Credit note", "Chemist", "Against invoice", "Reason", "Taxable", "GST", "Total"], money: [5, 6, 7],
        rows: rows.map((x) => [istDate(x.at), x.no, custs.find((c) => c.id === x.customerId)?.name ?? "—", invs.find((i) => i.id === x.invoiceId)?.no ?? "—", x.reason, rs(num(x.taxablePaise)), rs(num(x.taxPaise)), rs(num(x.totalPaise))]) };
    }
  }
}

export function reportCsv(r: Report): string {
  const esc = (v: string | number) => { const s = String(v); return /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [r.columns, ...r.rows].map((row) => row.map(esc).join(",")).join("\n") + "\n";
}

// ───────────── Dashboard ─────────────

export async function distDashboard(ctx: Ctx) {
  const today = todayISO(), monthStart = today.slice(0, 8) + "01";
  const ids = ctx.branches.map((b) => b.id);
  const [todayInv, monthInv, orders, picks, dels, rec, nearExp, lowStock, collToday, cancels] = await Promise.all([
    db.distInvoice.aggregate({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, at: { gte: istMidnight(today) } }, _sum: { totalPaise: true, taxablePaise: true, costPaise: true }, _count: true }),
    db.distInvoice.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, at: { gte: istMidnight(addDays(today, -29)) } }, select: { id: true, at: true, totalPaise: true, taxablePaise: true, costPaise: true } }),
    db.distOrder.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId, branchId: { in: ids }, status: { in: ["pending", "approved", "picking", "packed"] } }, _count: true }),
    db.distPickList.count({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, status: "open" } }),
    db.distDelivery.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId, status: { in: ["pending", "out"] } }, _count: true }),
    ctx.perms.includes("payments") || ctx.perms.includes("reports") ? receivables(ctx) : Promise.resolve([]),
    db.batch.aggregate({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, qtyAvailable: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + 90 * 86400000) } }, _count: true }),
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint n FROM "Medicine" m WHERE m."tenantId" = ${ctx.tenantId} AND m."reorderLevel" > 0 AND m.active AND COALESCE((SELECT SUM(b."qtyAvailable") FROM "Batch" b WHERE b."medicineId" = m.id AND b.status = 'ok' AND b."expiryDate" > now()), 0) / GREATEST(m."packSize", 1) < m."reorderLevel"`,
    db.distCollection.aggregate({ where: { tenantId: ctx.tenantId, at: { gte: istMidnight(today) } }, _sum: { amountPaise: true } }),
    db.distInvoiceCancel.findMany({ where: { tenantId: ctx.tenantId, at: { gte: istMidnight(addDays(today, -29)) } }, select: { invoiceId: true } }),
  ]);
  const cx = new Set(cancels.map((c) => c.invoiceId));
  const days: { day: string; sales: number }[] = [];
  for (let i = 29; i >= 0; i--) days.push({ day: addDays(today, -i), sales: 0 });
  let mSales = 0, mTaxable = 0, mCost = 0;
  for (const i of monthInv) {
    if (cx.has(i.id)) continue;
    const d = istDate(i.at), row = days.find((x) => x.day === d);
    if (row) row.sales += num(i.totalPaise);
    if (d >= monthStart) { mSales += num(i.totalPaise); mTaxable += num(i.taxablePaise); mCost += num(i.costPaise); }
  }
  const o = (s: string) => orders.find((x) => x.status === s)?._count ?? 0;
  return {
    today: { sales: num(todayInv._sum.totalPaise), invoices: todayInv._count, collections: num(collToday._sum.amountPaise) },
    month: { sales: mSales, margin: mTaxable - mCost, marginPct: mTaxable ? Math.round(((mTaxable - mCost) / mTaxable) * 1000) / 10 : 0 },
    pipeline: { pending: o("pending"), approved: o("approved"), picking: o("picking"), packed: o("packed"), openPicks: picks, toDispatch: dels.find((d) => d.status === "pending")?._count ?? 0, out: dels.find((d) => d.status === "out")?._count ?? 0 },
    receivable: { total: rec.reduce((a, r) => a + Math.max(0, r.balance), 0), overdue: rec.reduce((a, r) => a + r.overdue, 0), highRisk: rec.filter((r) => r.risk.level === "high").length, top: rec.slice(0, 6) },
    alerts: { nearExpiry: nearExp._count, lowStock: Number(lowStock[0]?.n ?? 0) },
    trend: days,
  };
}
