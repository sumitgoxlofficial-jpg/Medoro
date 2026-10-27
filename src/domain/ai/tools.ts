import "server-only";
import { z } from "zod";
import { UserError } from "@/server/action";
import { db } from "@/server/db";
import { can, type Ctx } from "@/server/context";
import { big, inr, inr0 } from "@/lib/money";
import { daysTo, dayMonth, hhmm, startOfTodayIST, todayISO } from "@/lib/dates";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import { forecast, settings, expiryRows, seasonal } from "@/domain/intelligence/service";
import { createPo } from "@/domain/purchasing/service";
import { currentShift } from "@/domain/sales/returns";
import type { Perm } from "@/domain/identity/permissions";

export type ToolResult = { text: string; rows?: { a: string; b: string; c: string }[]; basis?: string; link?: { label: string; href: string } };
export type Tool = {
  name: string; kind: "read" | "write"; perms: Perm[]; description: string; input: z.ZodTypeAny;
  /** JSON schema for the input, given to a local LLM planner. */
  params?: Record<string, unknown>;
  run: (ctx: Ctx, input: never) => Promise<ToolResult>;
  preview?: (ctx: Ctx, input: never) => Promise<ToolResult & { summary: string; bound?: Record<string, unknown> }>;
};

const T: Tool[] = [
  {
    name: "get_sales_summary", kind: "read", perms: [], description: "Sales totals for today, yesterday, this week or this month at the current branch, split by payment mode.",
    input: z.object({ period: z.enum(["today", "yesterday", "week", "month"]).default("today") }),
    params: { period: { type: "string", enum: ["today", "yesterday", "week", "month"] } },
    run: async (ctx, { period }: { period: "today" | "yesterday" | "week" | "month" }) => {
      if (!can(ctx, "sale") && !can(ctx, "reports")) throw new UserError("Your role can’t see sales figures.");
      const t0 = startOfTodayIST();
      const from = period === "today" ? t0 : period === "yesterday" ? new Date(t0.getTime() - 86400_000) : period === "week" ? new Date(t0.getTime() - 6 * 86400_000) : new Date(Date.UTC(+todayISO().slice(0, 4), +todayISO().slice(5, 7) - 1, 1) - 330 * 60_000);
      const to = period === "yesterday" ? t0 : new Date();
      const [agg, pays] = await Promise.all([
        db.sale.aggregate({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: from, lt: to } }, _sum: { totalPaise: true }, _count: true }),
        db.$queryRaw<{ mode: string; a: bigint }[]>`SELECT p.mode::text mode, SUM(p."amountPaise") a FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ${ctx.branchId} AND s.at >= ${from} AND s.at < ${to} GROUP BY 1`,
      ]);
      const label = { today: "Today so far", yesterday: "Yesterday", week: "Last 7 days", month: "This month" }[period];
      return { text: `${label}: ${inr0(big(agg._sum.totalPaise))} across ${agg._count} bill${agg._count === 1 ? "" : "s"}.`, rows: ["cash", "upi", "card", "credit"].map((m) => ({ a: m === "upi" ? "UPI" : m[0].toUpperCase() + m.slice(1), b: "", c: inr0(Number(pays.find((p) => p.mode === m)?.a ?? 0)) })), basis: `Committed invoices incl. GST, ${ctx.branchName}` };
    },
  },
  {
    name: "search_medicines", kind: "read", perms: [], description: "Find a medicine by name, generic or barcode and show sellable stock and price.",
    input: z.object({ query: z.string().min(2).max(60) }),
    params: { query: { type: "string", description: "medicine name, generic or barcode" } },
    run: async (ctx, { query }: { query: string }) => {
      const ms = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, OR: [{ name: { contains: query, mode: "insensitive" } }, { generic: { contains: query, mode: "insensitive" } }, { barcode: query }] }, take: 8 });
      const st = await sellableByMedicine(ctx.tenantId, ctx.branchId);
      return ms.length ? { text: `${ms.length} match${ms.length > 1 ? "es" : ""} for “${query}”:`, rows: ms.map((m) => ({ a: `${m.name} ${m.strength}`, b: m.generic + (m.schedule ? ` · Sch ${m.schedule}` : ""), c: `${st.get(m.id) ?? 0} in stock · ${inr(big(m.mrpPaise))}` })), basis: "Catalogue and sellable batches at this branch" } : { text: `No medicine matches “${query}”.` };
    },
  },
  {
    name: "get_expiry_report", kind: "read", perms: [], description: "Batches at this branch expiring within N days, with value at cost.",
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    params: { days: { type: "integer", minimum: 1, maximum: 365 } },
    run: async (ctx, { days }: { days: number }) => {
      const r = (await expiryRows(ctx, days)).rows;
      return { text: `${r.length} batch${r.length === 1 ? "" : "es"} expire in the next ${days} days${r.length ? `, worth ${inr0(r.reduce((a, x) => a + x.exposure, 0))} at cost` : ""}.`, rows: r.slice(0, 10).map((x) => ({ a: x.medicine, b: `${x.batchNo} · ${x.days} days`, c: inr0(x.exposure) })), basis: "Batch expiry dates; value at purchase cost", link: { label: "Open expiry prevention", href: "/app/expiry" } };
    },
  },
  {
    name: "get_low_stock_report", kind: "read", perms: [], description: "Medicines below their reorder level or reorder point, with suggested order quantity.",
    input: z.object({}),
    run: async (ctx) => {
      const r = (await forecast(ctx, (await settings(ctx.tenantId)).policy)).filter((x) => x.suggestion > 0);
      return { text: r.length ? `${r.length} item${r.length > 1 ? "s" : ""} need reordering:` : "Nothing needs reordering right now.", rows: r.slice(0, 12).map((x) => ({ a: x.name, b: `${x.stock} left · reorder point ${x.rop}`, c: "+" + x.suggestion })), basis: "Sellable stock (expired and quarantined excluded), 28-day sales and your reorder policy", link: r.length ? { label: "Prepare draft PO", href: "#ai:Prepare a purchase order for review" } : undefined };
    },
  },
  {
    name: "get_supplier_balances", kind: "read", perms: ["payments"], description: "Amounts owed to suppliers with next due dates.",
    input: z.object({}),
    run: async (ctx) => {
      const [sups, bal, bills] = await Promise.all([db.supplier.findMany({ where: { tenantId: ctx.tenantId } }), supplierBalances(db, ctx.tenantId), db.supplierBill.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { dueDate: "asc" } })]);
      const rows = sups.filter((s) => (bal.get(s.id) ?? 0) > 0).map((s) => { const o = bills.find((b) => b.supplierId === s.id && b.paidPaise < b.amountPaise); return { s, d: o ? daysTo(o.dueDate) : 9999, due: o?.dueDate }; }).sort((a, b) => a.d - b.d);
      return { text: rows.length ? "Supplier payables, soonest due first:" : "You don’t owe any supplier right now.", rows: rows.map((x) => ({ a: x.s.name, b: x.due ? `due ${dayMonth(x.due)} (${x.d} d)` : "", c: inr0(bal.get(x.s.id) ?? 0) })), basis: "Posted purchase invoices minus payment vouchers" };
    },
  },
  {
    name: "get_customer_outstanding", kind: "read", perms: ["payments"], description: "Customers who owe money (credit sales).",
    input: z.object({}),
    run: async (ctx) => {
      const [cs, bal] = await Promise.all([db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null } }), customerBalances(db, ctx.tenantId)]);
      const rows = cs.filter((c) => (bal.get(c.id) ?? 0) > 0).sort((a, b) => (bal.get(b.id) ?? 0) - (bal.get(a.id) ?? 0));
      return { text: rows.length ? `${rows.length} customer${rows.length > 1 ? "s" : ""} owe ${inr0(rows.reduce((a, c) => a + (bal.get(c.id) ?? 0), 0))}:` : "No customer owes anything.", rows: rows.slice(0, 10).map((c) => ({ a: c.name, b: `limit ${inr0(big(c.creditLimitPaise))}`, c: inr0(bal.get(c.id) ?? 0) })), basis: "Credit sales minus receipts" };
    },
  },
  {
    name: "get_cash_reconciliation", kind: "read", perms: ["sale"], description: "Expected cash in the drawer for the current shift on this counter.",
    input: z.object({}),
    run: async (ctx) => {
      const s = (await currentShift(ctx)).open;
      if (!s) return { text: "No shift is open on this counter. Open one under Returns & shift.", link: { label: "Open Returns & shift", href: "/app/returns" } };
      return { text: `Expected cash in the drawer: ${inr(s.expected)}. Count it on the shift close screen to post any difference.`, rows: [{ a: "Opening float", b: "", c: inr(s.open) }, { a: "Cash sales", b: "", c: inr(s.cash) }, { a: "Cash refunds", b: "", c: inr(-s.refunds) }, { a: "Cash expenses", b: "", c: inr(-s.expenses) }], basis: `Shift opened ${hhmm(new Date(s.openedAt))}`, link: { label: "Close shift", href: "/app/returns" } };
    },
  },
  {
    name: "get_backup_status", kind: "read", perms: ["integrations"], description: "Last backups and whether Google Drive is connected.",
    input: z.object({}),
    run: async (ctx) => {
      const [h, d] = await Promise.all([db.backupManifest.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { startedAt: "desc" }, take: 3 }), db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "gdrive" } } })]);
      return { text: h.length ? `Last backup ${h[0].status} on ${dayMonth(h[0].startedAt, true)} at ${hhmm(h[0].startedAt)}. Google Drive is ${d?.connectedAt ? "connected" : "not connected"}.` : "No backups yet.", rows: h.map((x) => ({ a: `${dayMonth(x.startedAt)} ${hhmm(x.startedAt)}`, b: x.kind, c: x.status })), basis: "Backup manifests on your server", link: { label: "Open Backup & restore", href: "/app/backup" } };
    },
  },
  {
    name: "get_seasonal_forecast", kind: "read", perms: [], description: "Medicines that sell above average in a given month (0 = January … 11 = December), with how much to pre-stock.",
    input: z.object({ month: z.number().int().min(0).max(11) }),
    params: { month: { type: "integer", minimum: 0, maximum: 11 } },
    run: async (ctx, { month }: { month: number }) => {
      const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month];
      const r = await seasonal(ctx, month);
      if (!r.ready) return { text: `Seasonal forecasts need 12 months of sales at this branch. You have ${r.months} so far.`, basis: "Same month last year vs 12-month average" };
      const need = r.plan.filter((x) => x.need > 0);
      return { text: r.plan.length ? `${r.plan.length} item${r.plan.length > 1 ? "s" : ""} sell above average in ${M}. ${need.length ? `Pre-stock ${need.length} of them.` : "Current stock covers the peak."}` : `Nothing sells notably above average in ${M}.`, rows: r.plan.slice(0, 10).map((x) => ({ a: x.name, b: `+${Math.round(x.lift)}% · ${x.stock} in stock`, c: x.need ? "+" + x.need : "OK" })), basis: "Same month last year vs 12-month average, current stock. Weather and outbreaks can change actual demand.", link: { label: "Open Stock intelligence", href: "/app/intelligence" } };
    },
  },
  {
    name: "create_draft_purchase_order", kind: "write", perms: ["purchase", "aiAct"], description: "Prepare a DRAFT purchase order for items that need reordering. Never sent to suppliers.",
    // The planner sends {}; the preview fills in the exact lines, and the confirmation is bound to them.
    input: z.object({ lines: z.array(z.object({ medicineId: z.string(), supplierId: z.string(), qty: z.number().int().positive().max(100000), cost: z.number().int().min(0) })).max(200).optional() }),
    preview: async (ctx) => {
      const rows = (await forecast(ctx, (await settings(ctx.tenantId)).policy)).filter((x) => x.suggestion > 0 && x.supplierId);
      if (!rows.length) throw new UserError("Nothing with a known supplier needs reordering.");
      const total = rows.reduce((a, r) => a + r.suggestion * r.cost, 0);
      return {
        summary: `${rows.length} items · ${inr0(total)}`,
        text: `I’ll save draft purchase orders (one per supplier) for ${rows.length} item${rows.length > 1 ? "s" : ""}. They stay drafts; nothing is sent to suppliers.`,
        rows: [...rows.map((r) => ({ a: r.name, b: `${r.suggestion} × ${inr(r.cost)} · ${r.supplier}`, c: inr0(r.suggestion * r.cost) })), { a: "Estimated total", b: "before GST", c: inr0(total) }],
        basis: "Reorder policy on Stock intelligence, last purchase cost per item",
        bound: { lines: rows.map((r) => ({ medicineId: r.id, supplierId: r.supplierId!, qty: r.suggestion, cost: r.cost })) },
      };
    },
    run: async (ctx, { lines }: { lines?: { medicineId: string; supplierId: string; qty: number; cost: number }[] }) => {
      if (!lines?.length) throw new UserError("Nothing to order.");
      const by = new Map<string, typeof lines>();
      for (const r of lines) by.set(r.supplierId, [...(by.get(r.supplierId) ?? []), r]);
      const nos = [];
      for (const [s, rs] of by) nos.push((await createPo(ctx, { supplierId: s, source: "ai", note: `Drafted by AI, confirmed by ${ctx.userName}`, lines: rs.map((r) => ({ medicineId: r.medicineId, qty: r.qty, rate: r.cost / 100 })) })).no);
      return { text: `${nos.join(", ")} saved as draft. Nothing has been sent to suppliers. Review and place it in Purchases.`, link: { label: "Open Purchases", href: "/app/purchases" } };
    },
  },
];

export const TOOLS = T;
export const toolFor = (name: string) => T.find((t) => t.name === name);
/** Tools this user may use. Write tools are hidden unless the role can confirm AI actions. */
export const toolsFor = (ctx: Ctx) => T.filter((t) => t.perms.every((p) => can(ctx, p)) && (t.kind === "read" || can(ctx, "aiAct")));
