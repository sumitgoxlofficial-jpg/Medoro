import "server-only";
import { z } from "zod";
import { UserError } from "@/server/action";
import { db } from "@/server/db";
import { can, type Ctx } from "@/server/context";
import { big, inr, inr0 } from "@/lib/money";
import { daysTo, dayMonth, hhmm, monthYear, startOfTodayIST, todayISO } from "@/lib/dates";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { adjustStock } from "@/domain/inventory/adjust";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import { forecast, settings, expiryRows, seasonal } from "@/domain/intelligence/service";
import { createPo } from "@/domain/purchasing/service";
import { currentShift, processReturn, returnableLines } from "@/domain/sales/returns";
import { REFUND_MODES } from "@/domain/sales/contracts";
import { periodOf, recordExpense } from "@/domain/accounting/service";
import { EXPENSE_ACCOUNTS } from "@/domain/accounting/accounts";
import { PHARMACY_REPORTS, REPORTS } from "@/domain/accounting/reports";
import { backupNow } from "@/domain/system/backup";
import type { Perm } from "@/domain/identity/permissions";
import { REPORT_IDS } from "./planner";

/** `names` lists personal names in the result, so they can be redacted before it goes to a remote model. */
export type ToolResult = { text: string; rows?: { a: string; b: string; c: string }[]; basis?: string; link?: { label: string; href: string }; names?: string[] };
/** `hi`: answer in Hindi (Devanagari). */
export type RunOpts = { hi: boolean };
export type Tool = {
  name: string; kind: "read" | "write"; perms: Perm[]; description: string; input: z.ZodTypeAny;
  /** JSON schema for the input, given to a model planner. */
  params?: Record<string, unknown>;
  /** Confirm button label for write tools. */
  label?: [en: string, hi: string];
  run: (ctx: Ctx, input: never, o: RunOpts) => Promise<ToolResult>;
  preview?: (ctx: Ctx, input: never, o: RunOpts) => Promise<ToolResult & { summary: string; bound?: Record<string, unknown> }>;
  /** Runs at confirm time against current data; throws a UserError if the previewed action no longer holds. */
  revalidate?: (ctx: Ctx, input: never) => Promise<void>;
};

const H = (o: RunOpts, en: string, hi: string) => (o.hi ? hi : en);
const s = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
const like = (q: string) => ({ contains: q, mode: "insensitive" as const });

const REPORT_HI: Record<string, string> = {
  "sales-register": "बिक्री रजिस्टर", "stock-valuation": "स्टॉक मूल्यांकन", "expiry-exposure": "एक्सपायरी जोखिम", "low-stock": "कम स्टॉक", "supplier-dues": "सप्लायर बकाया",
  "customer-dues": "ग्राहक बकाया", "gst-summary": "GST सारांश", "day-book": "डे बुक", "trial-balance": "ट्रायल बैलेंस", "stock-movements": "स्टॉक मूवमेंट",
};
const STATUS: Record<string, [string, string]> = { ok: ["Sellable", "बिक्री योग्य"], quarantine: ["Quarantined", "क्वारंटीन"], damaged: ["Damaged", "क्षतिग्रस्त"], recalled: ["Recalled", "रिकॉल"] };

async function poRows(ctx: Ctx) {
  return (await forecast(ctx, (await settings(ctx.tenantId)).policy)).filter((x) => x.suggestion > 0 && x.supplierId);
}

/** The drawer's expected cash, if a shift is open on this counter and holds less than `paise`. */
async function drawerShort(ctx: Ctx, paise: number) {
  const sh = (await currentShift(ctx)).open;
  return sh && sh.expected < paise ? sh.expected : null;
}

async function findSale(ctx: Ctx, ref: string) {
  const where = { tenantId: ctx.tenantId, branchId: ctx.branchId };
  const exact = await db.sale.findFirst({ where: { ...where, invoiceNo: { equals: ref, mode: "insensitive" } } });
  if (exact || !/^\d{1,6}$/.test(ref)) return exact;
  return db.sale.findFirst({ where: { ...where, invoiceNo: { endsWith: "/" + ref.padStart(6, "0") } }, orderBy: { at: "desc" } });
}

type RefundIn = { invoice: string; medicine?: string; qty?: number; refundMode?: (typeof REFUND_MODES)[number]; condition?: "sealed" | "damaged"; reason: string; saleId?: string; lines?: { itemId: string; qty: number; left: number }[] };
type AdjustIn = { batchNo: string; medicine?: string; delta: number; reason: string; batchId?: string; expectedQty?: number };
type ExpenseIn = { account: (typeof EXPENSE_ACCOUNTS)[number]; amount: number; method: "Cash" | "Bank" | "UPI"; note: string };
type PoIn = { lines?: { medicineId: string; supplierId: string; qty: number; cost: number }[] };

const T: Tool[] = [
  {
    name: "get_sales_summary", kind: "read", perms: [], description: "Sales totals for today, yesterday, this week or this month at the current branch, split by payment mode.",
    input: z.object({ period: z.enum(["today", "yesterday", "week", "month"]).default("today") }),
    params: { period: { type: "string", enum: ["today", "yesterday", "week", "month"] } },
    run: async (ctx, { period }: { period: "today" | "yesterday" | "week" | "month" }, o) => {
      if (!can(ctx, "sale") && !can(ctx, "reports")) throw new UserError(H(o, "Your role can’t see sales figures.", "आपकी भूमिका बिक्री के आँकड़े नहीं देख सकती।"));
      const t0 = startOfTodayIST();
      const from = period === "today" ? t0 : period === "yesterday" ? new Date(t0.getTime() - 86400_000) : period === "week" ? new Date(t0.getTime() - 6 * 86400_000) : new Date(Date.UTC(+todayISO().slice(0, 4), +todayISO().slice(5, 7) - 1, 1) - 330 * 60_000);
      const to = period === "yesterday" ? t0 : new Date();
      const [agg, pays] = await Promise.all([
        db.sale.aggregate({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: from, lt: to } }, _sum: { totalPaise: true }, _count: true }),
        db.$queryRaw<{ mode: string; a: bigint }[]>`SELECT p.mode::text mode, SUM(p."amountPaise") a FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ${ctx.branchId} AND s.at >= ${from} AND s.at < ${to} GROUP BY 1`,
      ]);
      const label = o.hi ? { today: "आज अब तक", yesterday: "कल", week: "पिछले 7 दिन", month: "इस महीने" }[period] : { today: "Today so far", yesterday: "Yesterday", week: "Last 7 days", month: "This month" }[period];
      const total = inr0(big(agg._sum.totalPaise));
      return {
        text: H(o, `${label}: ${total} across ${agg._count} ${s(agg._count, "bill")}.`, `${label}: ${agg._count} बिलों में ${total} की बिक्री।`),
        rows: ["cash", "upi", "card", "credit"].map((m) => ({ a: o.hi ? { cash: "नकद", upi: "UPI", card: "कार्ड", credit: "उधार" }[m]! : m === "upi" ? "UPI" : m[0].toUpperCase() + m.slice(1), b: "", c: inr0(Number(pays.find((p) => p.mode === m)?.a ?? 0)) })),
        basis: H(o, `Committed invoices incl. GST, ${ctx.branchName}`, `GST सहित जमा बिल, ${ctx.branchName}`),
      };
    },
  },
  {
    name: "search_medicines", kind: "read", perms: [], description: "Find a medicine by name, generic or barcode and show sellable stock and price.",
    input: z.object({ query: z.string().min(2).max(60) }),
    params: { query: { type: "string", description: "medicine name, generic or barcode" } },
    run: async (ctx, { query }: { query: string }, o) => {
      const ms = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, OR: [{ name: like(query) }, { generic: like(query) }, { barcode: query }] }, take: 8 });
      const st = await sellableByMedicine(ctx.tenantId, ctx.branchId);
      return ms.length
        ? { text: H(o, `${ms.length} ${s(ms.length, "match", "matches")} for “${query}”:`, `“${query}” के ${ms.length} परिणाम:`), rows: ms.map((m) => ({ a: `${m.name} ${m.strength}`, b: m.generic + (m.schedule ? ` · Sch ${m.schedule}` : ""), c: H(o, `${st.get(m.id) ?? 0} in stock`, `स्टॉक ${st.get(m.id) ?? 0}`) + ` · ${inr(big(m.mrpPaise))}` })), basis: H(o, "Catalogue and sellable batches at this branch", "इस शाखा की सूची और बिक्री योग्य बैच") }
        : { text: H(o, `No medicine matches “${query}”.`, `“${query}” से कोई दवा नहीं मिली।`) };
    },
  },
  {
    name: "get_batch_inventory", kind: "read", perms: [], description: "Batches of a medicine at a branch with batch number, expiry, quantity and status (sellable, quarantined, damaged, recalled, expired), earliest expiry first.",
    input: z.object({ query: z.string().trim().min(2).max(60), branch: z.string().trim().max(40).optional() }),
    params: { query: { type: "string", description: "medicine name, generic or barcode" }, branch: { type: "string", description: "branch name or code; omit for the current branch" } },
    run: async (ctx, { query, branch }: { query: string; branch?: string }, o) => {
      const want = branch?.toLowerCase();
      const br = want ? ctx.branches.find((b) => b.name.toLowerCase() === want || b.code.toLowerCase() === want) ?? ctx.branches.find((b) => b.name.toLowerCase().includes(want)) : ctx.branches.find((b) => b.id === ctx.branchId);
      if (!br) throw new UserError(H(o, `You don’t have access to a branch called “${branch}”.`, `“${branch}” नाम की कोई शाखा आपके लिए उपलब्ध नहीं है।`));
      const ms = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, OR: [{ name: like(query) }, { generic: like(query) }, { barcode: query }] }, select: { id: true }, take: 5 });
      if (!ms.length) return { text: H(o, `No medicine matches “${query}”.`, `“${query}” से कोई दवा नहीं मिली।`) };
      const bs = await db.batch.findMany({
        where: { tenantId: ctx.tenantId, branchId: br.id, medicineId: { in: ms.map((m) => m.id) }, OR: [{ qtyAvailable: { gt: 0 } }, { qtyQuarantined: { gt: 0 } }] },
        include: { medicine: { select: { name: true, strength: true } } }, orderBy: { expiryDate: "asc" }, take: 20,
      });
      if (!bs.length) return { text: H(o, `No stock of “${query}” at ${br.name}.`, `${br.name} में “${query}” का स्टॉक नहीं है।`), link: { label: H(o, "Open Inventory", "इन्वेंटरी खोलें"), href: "/app/inventory" } };
      const today = todayISO();
      const rows = bs.map((b) => {
        const d = daysTo(b.expiryDate, today);
        const st = d <= 0 ? H(o, "Expired", "एक्सपायर") : H(o, ...STATUS[b.status]);
        return { b, d, sellable: d > 0 && b.status === "ok", row: { a: `${b.medicine.name} ${b.medicine.strength}`, b: `${b.batchNo} · ${H(o, "exp", "समाप्ति")} ${monthYear(b.expiryDate)}${d > 0 && d <= 90 ? ` (${d} ${H(o, "d", "दिन")})` : ""}`, c: `${b.qtyAvailable}${b.qtyQuarantined ? ` +${b.qtyQuarantined} ${H(o, "held", "रोका")}` : ""} · ${st}` } };
      });
      const sellable = rows.filter((r) => r.sellable).reduce((a, r) => a + r.b.qtyAvailable, 0);
      return {
        text: H(o, `${bs.length} ${s(bs.length, "batch", "batches")} with stock at ${br.name}; ${sellable} sellable ${s(sellable, "unit")}.`, `${br.name} में ${bs.length} बैच में स्टॉक है; ${sellable} यूनिट बिक्री योग्य।`),
        rows: rows.map((r) => r.row),
        basis: H(o, `Batches with stock at ${br.name}, earliest expiry first (FEFO)`, `${br.name} के स्टॉक वाले बैच, सबसे पहले समाप्त होने वाले ऊपर (FEFO)`),
        link: { label: H(o, "Open Inventory", "इन्वेंटरी खोलें"), href: "/app/inventory" },
      };
    },
  },
  {
    name: "get_expiry_report", kind: "read", perms: [], description: "Batches at this branch expiring within N days, with value at cost.",
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    params: { days: { type: "integer", minimum: 1, maximum: 365 } },
    run: async (ctx, { days }: { days: number }, o) => {
      const r = (await expiryRows(ctx, days)).rows;
      const worth = inr0(r.reduce((a, x) => a + x.exposure, 0));
      return {
        text: H(o, `${r.length} ${s(r.length, "batch", "batches")} expire in the next ${days} days${r.length ? `, worth ${worth} at cost` : ""}.`, `अगले ${days} दिनों में ${r.length} बैच एक्सपायर होंगे${r.length ? `, लागत मूल्य ${worth}` : ""}।`),
        rows: r.slice(0, 10).map((x) => ({ a: x.medicine, b: `${x.batchNo} · ${x.days} ${H(o, "days", "दिन")}`, c: inr0(x.exposure) })),
        basis: H(o, "Batch expiry dates; value at purchase cost", "बैच की समाप्ति तिथि; मूल्य खरीद लागत पर"), link: { label: H(o, "Open expiry prevention", "एक्सपायरी रोकथाम खोलें"), href: "/app/expiry" },
      };
    },
  },
  {
    name: "get_low_stock_report", kind: "read", perms: [], description: "Medicines below their reorder level or reorder point, with suggested order quantity.",
    input: z.object({}),
    run: async (ctx, _i, o) => {
      const r = (await forecast(ctx, (await settings(ctx.tenantId)).policy)).filter((x) => x.suggestion > 0);
      return {
        text: r.length ? H(o, `${r.length} ${s(r.length, "item")} need reordering:`, `${r.length} दवाओं को फिर से मँगाना है:`) : H(o, "Nothing needs reordering right now.", "अभी कुछ भी मँगाने की ज़रूरत नहीं है।"),
        rows: r.slice(0, 12).map((x) => ({ a: x.name, b: H(o, `${x.stock} left · reorder point ${x.rop}`, `${x.stock} बचा · रीऑर्डर बिंदु ${x.rop}`), c: "+" + x.suggestion })),
        basis: H(o, "Sellable stock (expired and quarantined excluded), 28-day sales and your reorder policy", "बिक्री योग्य स्टॉक (एक्सपायर और क्वारंटीन छोड़कर), 28 दिन की बिक्री और आपकी रीऑर्डर नीति"),
        link: r.length ? { label: H(o, "Prepare draft PO", "ड्राफ्ट PO बनाएँ"), href: "#ai:Prepare a purchase order for review" } : undefined,
      };
    },
  },
  {
    name: "get_supplier_balances", kind: "read", perms: ["payments"], description: "Amounts owed to suppliers with next due dates.",
    input: z.object({}),
    run: async (ctx, _i, o) => {
      const [sups, bal, bills] = await Promise.all([db.supplier.findMany({ where: { tenantId: ctx.tenantId } }), supplierBalances(db, ctx.tenantId), db.supplierBill.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { dueDate: "asc" } })]);
      const rows = sups.filter((x) => (bal.get(x.id) ?? 0) > 0).map((x) => { const b = bills.find((y) => y.supplierId === x.id && y.paidPaise < y.amountPaise); return { x, d: b ? daysTo(b.dueDate) : 9999, due: b?.dueDate }; }).sort((a, b) => a.d - b.d);
      return {
        text: rows.length ? H(o, "Supplier payables, soonest due first:", "सप्लायर बकाया, सबसे पहले देय ऊपर:") : H(o, "You don’t owe any supplier right now.", "अभी किसी सप्लायर का कुछ बकाया नहीं है।"),
        rows: rows.map((r) => ({ a: r.x.name, b: r.due ? H(o, `due ${dayMonth(r.due)} (${r.d} d)`, `देय ${dayMonth(r.due)} (${r.d} दिन)`) : "", c: inr0(bal.get(r.x.id) ?? 0) })),
        basis: H(o, "Posted purchase invoices minus payment vouchers", "खरीद बिल घटा भुगतान वाउचर"),
      };
    },
  },
  {
    name: "get_customer_outstanding", kind: "read", perms: ["payments"], description: "Customers who owe money (credit sales).",
    input: z.object({}),
    run: async (ctx, _i, o) => {
      const [cs, bal] = await Promise.all([db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null } }), customerBalances(db, ctx.tenantId)]);
      const rows = cs.filter((c) => (bal.get(c.id) ?? 0) > 0).sort((a, b) => (bal.get(b.id) ?? 0) - (bal.get(a.id) ?? 0));
      const total = inr0(rows.reduce((a, c) => a + (bal.get(c.id) ?? 0), 0));
      const top = rows.slice(0, 10);
      return {
        text: rows.length ? H(o, `${rows.length} ${s(rows.length, "customer")} owe ${total}:`, `${rows.length} ग्राहकों पर ${total} बकाया है:`) : H(o, "No customer owes anything.", "किसी ग्राहक पर कोई बकाया नहीं है।"),
        rows: top.map((c) => ({ a: c.name, b: H(o, `limit ${inr0(big(c.creditLimitPaise))}`, `सीमा ${inr0(big(c.creditLimitPaise))}`), c: inr0(bal.get(c.id) ?? 0) })),
        basis: H(o, "Credit sales minus receipts", "उधार बिक्री घटा प्राप्तियाँ"), names: top.map((c) => c.name),
      };
    },
  },
  {
    name: "get_cash_reconciliation", kind: "read", perms: ["sale"], description: "Expected cash in the drawer for the current shift on this counter.",
    input: z.object({}),
    run: async (ctx, _i, o) => {
      const sh = (await currentShift(ctx)).open;
      if (!sh) return { text: H(o, "No shift is open on this counter. Open one under Returns & shift.", "इस काउंटर पर कोई शिफ्ट खुली नहीं है। Returns & shift में खोलें।"), link: { label: H(o, "Open Returns & shift", "Returns & shift खोलें"), href: "/app/returns" } };
      return {
        text: H(o, `Expected cash in the drawer: ${inr(sh.expected)}. Count it on the shift close screen to post any difference.`, `गल्ले में अपेक्षित नकद: ${inr(sh.expected)}। अंतर दर्ज करने के लिए शिफ्ट बंद करते समय गिनें।`),
        rows: [{ a: H(o, "Opening float", "शुरुआती नकद"), b: "", c: inr(sh.open) }, { a: H(o, "Cash sales", "नकद बिक्री"), b: "", c: inr(sh.cash) }, { a: H(o, "Cash refunds", "नकद रिफंड"), b: "", c: inr(-sh.refunds) }, { a: H(o, "Cash expenses", "नकद खर्च"), b: "", c: inr(-sh.expenses) }],
        basis: H(o, `Shift opened ${hhmm(new Date(sh.openedAt))}`, `शिफ्ट ${hhmm(new Date(sh.openedAt))} पर खुली`), link: { label: H(o, "Close shift", "शिफ्ट बंद करें"), href: "/app/returns" },
      };
    },
  },
  {
    name: "get_backup_status", kind: "read", perms: ["integrations"], description: "Last backups and whether Google Drive is connected.",
    input: z.object({}),
    run: async (ctx, _i, o) => {
      const [h, d] = await Promise.all([db.backupManifest.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { startedAt: "desc" }, take: 3 }), db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "gdrive" } } })]);
      const drive = d?.connectedAt ? H(o, "connected", "जुड़ा है") : H(o, "not connected", "जुड़ा नहीं है");
      return {
        text: h.length ? H(o, `Last backup ${h[0].status} on ${dayMonth(h[0].startedAt, true)} at ${hhmm(h[0].startedAt)}. Google Drive is ${drive}.`, `आखिरी बैकअप ${dayMonth(h[0].startedAt, true)} को ${hhmm(h[0].startedAt)} बजे (${h[0].status})। Google Drive ${drive}।`) : H(o, "No backups yet.", "अभी तक कोई बैकअप नहीं।"),
        rows: h.map((x) => ({ a: `${dayMonth(x.startedAt)} ${hhmm(x.startedAt)}`, b: x.kind, c: x.status })), basis: H(o, "Backup manifests on your server", "आपके सर्वर पर बैकअप रिकॉर्ड"), link: { label: H(o, "Open Backup & restore", "Backup & restore खोलें"), href: "/app/backup" },
      };
    },
  },
  {
    name: "get_seasonal_forecast", kind: "read", perms: [], description: "Medicines that sell above average in a given month (0 = January … 11 = December), with how much to pre-stock.",
    input: z.object({ month: z.number().int().min(0).max(11) }),
    params: { month: { type: "integer", minimum: 0, maximum: 11 } },
    run: async (ctx, { month }: { month: number }, o) => {
      const M = (o.hi ? ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"] : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])[month];
      const r = await seasonal(ctx, month);
      const basis = H(o, "Same month last year vs 12-month average", "पिछले साल का यही महीना बनाम 12 महीने का औसत");
      if (!r.ready) return { text: H(o, `Seasonal forecasts need 12 months of sales at this branch. You have ${r.months} so far.`, `मौसमी अनुमान के लिए इस शाखा की 12 महीने की बिक्री चाहिए। अभी ${r.months} महीने की है।`), basis };
      const need = r.plan.filter((x) => x.need > 0);
      return {
        text: r.plan.length
          ? H(o, `${r.plan.length} ${s(r.plan.length, "item")} sell above average in ${M}. ${need.length ? `Pre-stock ${need.length} of them.` : "Current stock covers the peak."}`, `${M} में ${r.plan.length} दवाएँ औसत से ज़्यादा बिकती हैं। ${need.length ? `इनमें से ${need.length} पहले से मँगा लें।` : "मौजूदा स्टॉक काफ़ी है।"}`)
          : H(o, `Nothing sells notably above average in ${M}.`, `${M} में कुछ भी औसत से ख़ास ज़्यादा नहीं बिकता।`),
        rows: r.plan.slice(0, 10).map((x) => ({ a: x.name, b: `+${Math.round(x.lift)}% · ${x.stock} ${H(o, "in stock", "स्टॉक")}`, c: x.need ? "+" + x.need : "OK" })),
        basis: basis + H(o, ", current stock. Weather and outbreaks can change actual demand.", ", मौजूदा स्टॉक। मौसम और बीमारी का प्रकोप असली माँग बदल सकते हैं।"), link: { label: H(o, "Open Stock intelligence", "Stock intelligence खोलें"), href: "/app/intelligence" },
      };
    },
  },
  {
    name: "generate_report", kind: "read", perms: ["reports"], description: "Link to download one of the accounting CSV reports for a period (month = this month, last = last month, fy = this financial year, or YYYY-MM) for the current branch or all branches.",
    input: z.object({ report: z.enum(REPORT_IDS), period: z.string().regex(/^(month|last|fy|\d{4}-(0[1-9]|1[0-2]))$/).default("month"), scope: z.enum(["branch", "all"]).default("branch") }),
    params: { report: { type: "string", enum: [...REPORT_IDS] }, period: { type: "string", description: "month, last, fy or YYYY-MM" }, scope: { type: "string", enum: ["branch", "all"] } },
    run: async (ctx, i: { report: (typeof REPORT_IDS)[number]; period: string; scope: "branch" | "all" }, o) => {
      if (/^\d{4}-\d{2}$/.test(i.period) && i.period > todayISO().slice(0, 7)) throw new UserError(H(o, "That month hasn’t happened yet.", "वह महीना अभी आया नहीं है।"));
      const def = REPORTS.find((r) => r[0] === i.report)!;
      const p = periodOf(i.period);
      const pharmacy = PHARMACY_REPORTS.includes(i.report);
      const all = !pharmacy && i.scope === "all" && ctx.branches.length > 1;
      const name = o.hi ? REPORT_HI[i.report] : def[1];
      const where = pharmacy ? H(o, "whole pharmacy", "पूरी फार्मेसी") : all ? H(o, `all ${ctx.branches.length} branches`, `सभी ${ctx.branches.length} शाखाएँ`) : ctx.branchName;
      return {
        text: H(o, `${name} for ${p.label} (${where}) is ready to download as CSV.`, `${p.label} की ${name} रिपोर्ट (${where}) CSV में डाउनलोड के लिए तैयार है।`),
        basis: H(o, `${def[2]}. Built when you download it; the download is recorded in the audit trail.`, "डाउनलोड करते समय बनती है; डाउनलोड ऑडिट में दर्ज होता है।"),
        link: { label: H(o, `Download ${def[1]} (CSV)`, `${name} डाउनलोड करें (CSV)`), href: `/api/reports/${i.report}?period=${p.key}${all ? "&scope=all" : ""}` },
      };
    },
  },
  {
    name: "create_draft_purchase_order", kind: "write", perms: ["purchase", "aiAct"], label: ["Create draft PO", "ड्राफ्ट PO बनाएँ"], description: "Prepare a DRAFT purchase order for items that need reordering. Never sent to suppliers.",
    // The planner sends {}; the preview fills in the exact lines, and the confirmation is bound to them.
    input: z.object({ lines: z.array(z.object({ medicineId: z.string(), supplierId: z.string(), qty: z.number().int().positive().max(100000), cost: z.number().int().min(0) })).max(200).optional() }),
    preview: async (ctx, _i, o) => {
      const rows = await poRows(ctx);
      if (!rows.length) throw new UserError(H(o, "Nothing with a known supplier needs reordering.", "जिनका सप्लायर पता है, उनमें से कुछ भी मँगाने की ज़रूरत नहीं है।"));
      const total = rows.reduce((a, r) => a + r.suggestion * r.cost, 0);
      return {
        summary: `${rows.length} items · ${inr0(total)}`,
        text: H(o, `I’ll save draft purchase orders (one per supplier) for ${rows.length} ${s(rows.length, "item")}. They stay drafts; nothing is sent to suppliers.`, `मैं ${rows.length} दवाओं के लिए ड्राफ्ट खरीद आदेश (हर सप्लायर का एक) सहेजूँगा। ये ड्राफ्ट ही रहेंगे; सप्लायर को कुछ नहीं भेजा जाएगा।`),
        rows: [...rows.map((r) => ({ a: r.name, b: `${r.suggestion} × ${inr(r.cost)} · ${r.supplier}`, c: inr0(r.suggestion * r.cost) })), { a: H(o, "Estimated total", "अनुमानित कुल"), b: H(o, "before GST", "GST से पहले"), c: inr0(total) }],
        basis: H(o, "Reorder policy on Stock intelligence, last purchase cost per item", "Stock intelligence की रीऑर्डर नीति, हर दवा की पिछली खरीद लागत"),
        bound: { lines: rows.map((r) => ({ medicineId: r.id, supplierId: r.supplierId!, qty: r.suggestion, cost: r.cost })) },
      };
    },
    // Stock may have arrived since the preview: never order more than is still needed.
    revalidate: async (ctx, { lines }: PoIn) => {
      if (!lines?.length) throw new UserError("Nothing to order.");
      const now = new Map((await poRows(ctx)).map((r) => [r.id, r]));
      const names = new Map((await db.medicine.findMany({ where: { id: { in: lines.map((l) => l.medicineId) } }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
      const over = lines.filter((l) => l.qty > (now.get(l.medicineId)?.suggestion ?? 0));
      if (over.length) throw new UserError(`Stock changed since the preview: ${over.map((l) => `${names.get(l.medicineId) ?? "an item"} now needs ${now.get(l.medicineId)?.suggestion ?? 0}, not ${l.qty}`).join("; ")}. Ask again for fresh quantities.`);
    },
    run: async (ctx, { lines }: PoIn) => {
      if (!lines?.length) throw new UserError("Nothing to order.");
      const by = new Map<string, typeof lines>();
      for (const r of lines) by.set(r.supplierId, [...(by.get(r.supplierId) ?? []), r]);
      const nos = [];
      for (const [sup, rs] of by) nos.push((await createPo(ctx, { supplierId: sup, source: "ai", note: `Drafted by AI, confirmed by ${ctx.userName}`, lines: rs.map((r) => ({ medicineId: r.medicineId, qty: r.qty, rate: r.cost / 100 })) })).no);
      return { text: `${nos.join(", ")} saved as draft. Nothing has been sent to suppliers. Review and place it in Purchases.`, link: { label: "Open Purchases", href: "/app/purchases" } };
    },
  },
  {
    name: "create_draft_expense", kind: "write", perms: ["payments", "aiAct"], label: ["Record expense", "खर्च दर्ज करें"], description: "Record a shop expense (rent, electricity, salaries, tea, delivery, repairs, phone, bank charges, stationery or miscellaneous) paid by cash, bank or UPI. Amount in rupees.",
    input: z.object({ account: z.enum(EXPENSE_ACCOUNTS), amount: z.number().positive().max(10_000_000), method: z.enum(["Cash", "Bank", "UPI"]).default("Cash"), note: z.string().trim().max(120).default("") }),
    params: { account: { type: "string", enum: [...EXPENSE_ACCOUNTS] }, amount: { type: "number", description: "rupees" }, method: { type: "string", enum: ["Cash", "Bank", "UPI"] }, note: { type: "string" } },
    preview: async (ctx, i: ExpenseIn, o) => {
      const paise = Math.round(i.amount * 100);
      const short = i.method === "Cash" ? await drawerShort(ctx, paise) : null;
      if (short !== null) throw new UserError(H(o, `The drawer should hold only ${inr(short)} on this shift. Pay it by bank or UPI, or check the amount.`, `इस शिफ्ट में गल्ले में सिर्फ़ ${inr(short)} होना चाहिए। बैंक या UPI से भरें, या राशि जाँचें।`));
      return {
        summary: `${i.account} · ${inr(paise)} · ${i.method}`,
        text: H(o, `I’ll record an expense of ${inr(paise)} under ${i.account}, paid by ${i.method}.`, `मैं ${i.account} में ${inr(paise)} का खर्च दर्ज करूँगा, भुगतान ${i.method === "Cash" ? "नकद" : i.method} से।`),
        rows: [{ a: H(o, "Account", "खाता"), b: "", c: i.account }, { a: H(o, "Amount", "राशि"), b: "", c: inr(paise) }, { a: H(o, "Paid by", "भुगतान"), b: "", c: i.method }, ...(i.note ? [{ a: H(o, "Note", "टिप्पणी"), b: "", c: i.note }] : [])],
        basis: H(o, "Posts a payment voucher, the same as Accounts → Record expense", "भुगतान वाउचर बनेगा, जैसे Accounts → Record expense में"),
      };
    },
    revalidate: async (ctx, i: ExpenseIn) => {
      const short = i.method === "Cash" ? await drawerShort(ctx, Math.round(i.amount * 100)) : null;
      if (short !== null) throw new UserError(`The drawer now holds only ${inr(short)} on this shift. Nothing was recorded.`);
    },
    run: async (ctx, i: ExpenseIn) => {
      const no = await recordExpense(ctx, { account: i.account, amount: i.amount, method: i.method, note: i.note });
      return { text: `Expense ${no} recorded: ${inr(Math.round(i.amount * 100))} under ${i.account}, paid by ${i.method}.`, link: { label: "Open Accounts", href: "/app/accounts" } };
    },
  },
  {
    name: "request_backup", kind: "write", perms: ["integrations", "aiAct"], label: ["Back up now", "अभी बैकअप लें"], description: "Start an encrypted backup now (saved on the server, and to Google Drive if connected).",
    input: z.object({}),
    preview: async (ctx, _i, o) => {
      const [running, last, d] = await Promise.all([
        db.backupManifest.findFirst({ where: { tenantId: ctx.tenantId, status: "running", startedAt: { gt: new Date(Date.now() - 15 * 60_000) } } }),
        db.backupManifest.findFirst({ where: { tenantId: ctx.tenantId, status: { in: ["verified", "partial"] } }, orderBy: { startedAt: "desc" } }),
        db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "gdrive" } } }),
      ]);
      if (running) throw new UserError(H(o, "A backup is already running.", "एक बैकअप पहले से चल रहा है।"));
      return {
        summary: "Manual backup",
        text: H(o, `I’ll take an encrypted backup now and verify it${d?.connectedAt ? ", then copy it to Google Drive" : ""}.`, `मैं अभी एन्क्रिप्टेड बैकअप लेकर उसकी जाँच करूँगा${d?.connectedAt ? ", फिर Google Drive पर कॉपी करूँगा" : ""}।`),
        rows: [{ a: H(o, "Last good backup", "आखिरी सफल बैकअप"), b: "", c: last ? `${dayMonth(last.startedAt, true)} ${hhmm(last.startedAt)}` : H(o, "none", "कोई नहीं") }, { a: "Google Drive", b: "", c: d?.connectedAt ? H(o, "connected", "जुड़ा है") : H(o, "not connected", "जुड़ा नहीं है") }],
        basis: H(o, "Same as Backup & restore → Back up now", "Backup & restore → Back up now जैसा"),
      };
    },
    run: async (ctx) => {
      const r = await backupNow(ctx);
      return { text: `Backup verified (${(r.size / 1048576).toFixed(1)} MB), saved on the server${r.drive ? " and Google Drive" : ""}.${r.note ? " " + r.note : ""}`, link: { label: "Open Backup & restore", href: "/app/backup" } };
    },
  },
  {
    name: "request_stock_adjustment", kind: "write", perms: ["adjust", "aiAct"], label: ["Adjust stock", "स्टॉक समायोजित करें"], description: "Correct the quantity of one batch at the current branch up (positive delta) or down (negative delta). A reason is required.",
    input: z.object({ batchNo: z.string().trim().min(1).max(40), medicine: z.string().trim().max(60).optional(), delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, "Enter the units to add or remove."), reason: z.string().trim().max(200).default(""), batchId: z.string().uuid().optional(), expectedQty: z.number().int().optional() }),
    params: { batchNo: { type: "string" }, medicine: { type: "string", description: "medicine name, if the batch number is ambiguous" }, delta: { type: "integer", description: "units to add (positive) or remove (negative)" }, reason: { type: "string" } },
    preview: async (ctx, i: AdjustIn, o) => {
      if (i.reason.length < 3) throw new UserError(H(o, "Give a reason for the adjustment, for example “… reason damaged strip”.", "समायोजन का कारण बताएँ, जैसे “… कारण पत्ता टूटा”।"));
      const bs = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchNo: { equals: i.batchNo, mode: "insensitive" }, ...(i.medicine ? { medicine: { OR: [{ name: like(i.medicine) }, { generic: like(i.medicine) }] } } : {}) }, include: { medicine: true }, take: 5 });
      if (!bs.length) throw new UserError(H(o, `No batch ${i.batchNo}${i.medicine ? ` of ${i.medicine}` : ""} at ${ctx.branchName}.`, `${ctx.branchName} में बैच ${i.batchNo} नहीं मिला।`));
      if (bs.length > 1) throw new UserError(H(o, `Batch ${i.batchNo} exists for ${bs.map((b) => b.medicine.name).join(", ")}. Say which medicine.`, `बैच ${i.batchNo} कई दवाओं (${bs.map((b) => b.medicine.name).join(", ")}) में है। दवा का नाम बताएँ।`));
      const b = bs[0];
      if (b.qtyAvailable + i.delta < 0) throw new UserError(H(o, `Only ${b.qtyAvailable} of ${b.medicine.name} ${b.batchNo} in stock.`, `${b.medicine.name} ${b.batchNo} का स्टॉक सिर्फ़ ${b.qtyAvailable} है।`));
      const sign = i.delta > 0 ? "+" : "";
      return {
        summary: `${b.medicine.name} ${b.batchNo} ${sign}${i.delta} · ${i.reason}`,
        text: H(o, `I’ll adjust ${b.medicine.name} batch ${b.batchNo} by ${sign}${i.delta}: ${b.qtyAvailable} → ${b.qtyAvailable + i.delta}.`, `मैं ${b.medicine.name} बैच ${b.batchNo} का स्टॉक ${sign}${i.delta} करूँगा: ${b.qtyAvailable} → ${b.qtyAvailable + i.delta}।`),
        rows: [{ a: `${b.medicine.name} ${b.medicine.strength}`, b: `${b.batchNo} · ${monthYear(b.expiryDate)}`, c: `${b.qtyAvailable} → ${b.qtyAvailable + i.delta}` }, { a: H(o, "Value at cost", "लागत मूल्य"), b: "", c: inr(i.delta * big(b.costPaise)) }, { a: H(o, "Reason", "कारण"), b: "", c: i.reason }],
        basis: H(o, "Same as Inventory → Adjust stock: stock movement and stock-value voucher at batch cost", "Inventory → Adjust stock जैसा: स्टॉक मूवमेंट और बैच लागत पर वाउचर"),
        bound: { batchId: b.id, expectedQty: b.qtyAvailable },
      };
    },
    revalidate: async (ctx, i: AdjustIn) => {
      const b = i.batchId ? await db.batch.findFirst({ where: { id: i.batchId, tenantId: ctx.tenantId } }) : null;
      if (!b || b.branchId !== ctx.branchId) throw new UserError("This batch isn’t at your current branch. Switch branch and ask again.");
      if (b.qtyAvailable !== i.expectedQty) throw new UserError(`Stock of batch ${b.batchNo} changed since the preview (${i.expectedQty} → ${b.qtyAvailable}). Ask again to see a fresh preview.`);
    },
    run: async (ctx, i: AdjustIn) => {
      const no = await adjustStock(ctx, i.batchId!, i.delta, i.reason);
      return { text: `${no} posted: batch ${i.batchNo} ${i.delta > 0 ? "+" : ""}${i.delta} (${i.reason}).`, link: { label: "Open Inventory", href: "/app/inventory" } };
    },
  },
  {
    name: "request_refund", kind: "write", perms: ["refund", "aiAct"], label: ["Issue refund", "रिफंड करें"], description: "Return items against an invoice at the current branch and issue a credit note: the whole invoice, or qty of one medicine. A reason is required. Condition sealed puts stock back on sale; damaged doesn't.",
    input: z.object({
      invoice: z.string().trim().min(1).max(40), medicine: z.string().trim().max(60).optional(), qty: z.number().int().positive().max(10000).optional(),
      refundMode: z.enum(REFUND_MODES).optional(), condition: z.enum(["sealed", "damaged"]).optional(), reason: z.string().trim().max(200).default(""),
      saleId: z.string().uuid().optional(), lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().positive(), left: z.number().int() })).max(100).optional(),
    }),
    params: { invoice: { type: "string", description: "invoice number, or its last digits" }, medicine: { type: "string" }, qty: { type: "integer" }, refundMode: { type: "string", enum: [...REFUND_MODES] }, condition: { type: "string", enum: ["sealed", "damaged"] }, reason: { type: "string" } },
    preview: async (ctx, i: RefundIn, o) => {
      if (i.reason.length < 3) throw new UserError(H(o, "Give a reason for the return, for example “… reason wrong medicine”.", "वापसी का कारण बताएँ, जैसे “… कारण गलत दवा”।"));
      const sale = await findSale(ctx, i.invoice);
      if (!sale) throw new UserError(H(o, `No invoice ${i.invoice} at ${ctx.branchName}.`, `${ctx.branchName} में बिल ${i.invoice} नहीं मिला।`));
      const r = (await returnableLines(ctx, sale.id))!;
      let lines = r.lines.filter((x) => x.sold - x.returned > 0);
      if (!lines.length) throw new UserError(H(o, `Everything on ${sale.invoiceNo} has already been returned.`, `${sale.invoiceNo} का सारा सामान पहले ही वापस हो चुका है।`));
      if (i.medicine) lines = lines.filter((x) => x.name.toLowerCase().includes(i.medicine!.toLowerCase()));
      if (!lines.length) throw new UserError(H(o, `${sale.invoiceNo} has no returnable line for “${i.medicine}”.`, `${sale.invoiceNo} में “${i.medicine}” की कोई लाइन वापसी योग्य नहीं है।`));
      if (i.qty && lines.length > 1) throw new UserError(H(o, `Several lines on ${sale.invoiceNo} match. Say which medicine.`, `${sale.invoiceNo} में कई लाइनें मिलती हैं। दवा का नाम बताएँ।`));
      if (i.qty && i.qty > lines[0].sold - lines[0].returned) throw new UserError(H(o, `Only ${lines[0].sold - lines[0].returned} of ${lines[0].name} can still be returned.`, `${lines[0].name} की सिर्फ़ ${lines[0].sold - lines[0].returned} यूनिट वापस हो सकती हैं।`));
      const picks = lines.map((x) => ({ itemId: x.itemId, qty: i.qty ?? x.sold - x.returned, left: x.sold - x.returned }));
      const mode = sale.payMode === "credit" ? "Adjust customer credit" : i.refundMode ?? (sale.payMode === "upi" || sale.payMode === "card" ? "UPI refund" : "Cash");
      if (mode === "Adjust customer credit" && !r.hasCustomer) throw new UserError(H(o, "Walk-in sales can’t be refunded to customer credit.", "बिना ग्राहक वाले बिल का रिफंड उधार खाते में नहीं हो सकता।"));
      const condition = i.condition ?? "damaged";
      const amount = lines.reduce((a, x, k) => a + Math.round(x.unitNet * picks[k].qty), 0);
      return {
        summary: `${sale.invoiceNo} · ${inr(amount)} · ${mode} · ${condition} · ${i.reason}`,
        text: H(o, `I’ll issue a credit note against ${sale.invoiceNo}${r.customer ? ` (${r.customer})` : ""} for about ${inr(amount)}, refunded as ${mode}. ${condition === "sealed" ? "Sealed stock goes back on sale." : "Items are not put back on sale (say “sealed” if they are unopened)."}`, `मैं ${sale.invoiceNo}${r.customer ? ` (${r.customer})` : ""} पर लगभग ${inr(amount)} का क्रेडिट नोट बनाऊँगा, रिफंड: ${mode}। ${condition === "sealed" ? "सील बंद सामान फिर से बिक्री में जाएगा।" : "सामान दोबारा बिक्री में नहीं जाएगा (बंद पैक हो तो “sealed” कहें)।"}`),
        rows: lines.map((x, k) => ({ a: x.name, b: `${x.batchNo} · ${picks[k].qty} ${H(o, "of", "/")} ${x.sold - x.returned}`, c: inr(Math.round(x.unitNet * picks[k].qty)) })),
        basis: H(o, "Same as Returns & shift: GST reversed, refund at the net price paid", "Returns & shift जैसा: GST वापस, भुगतान की गई शुद्ध कीमत पर रिफंड"),
        names: r.customer ? [r.customer] : [],
        bound: { saleId: sale.id, lines: picks, refundMode: mode, condition },
      };
    },
    revalidate: async (ctx, i: RefundIn) => {
      const r = i.saleId ? await returnableLines(ctx, i.saleId) : null;
      if (!r || !i.lines?.length) throw new UserError("Invoice not found. Ask again.");
      for (const l of i.lines) {
        const x = r.lines.find((y) => y.itemId === l.itemId);
        if (!x || x.sold - x.returned !== l.left) throw new UserError(`${r.no} changed since the preview (another return was processed). Ask again to see what can still be returned.`);
      }
    },
    run: async (ctx, i: RefundIn) => {
      const r = await processReturn(ctx, { saleId: i.saleId!, lines: i.lines!.map((l) => ({ itemId: l.itemId, qty: l.qty })), condition: i.condition ?? "damaged", refundMode: i.refundMode ?? "Cash", reason: i.reason });
      return { text: `Credit note ${r.creditNote} issued: ${inr(r.amount)} refunded as ${r.mode}.`, link: { label: "Open Returns & shift", href: "/app/returns" } };
    },
  },
];

export const TOOLS = T;
export const toolFor = (name: string) => T.find((t) => t.name === name);
/** Tools this user may use. Write tools are hidden unless the role can confirm AI actions. */
export const toolsFor = (ctx: Ctx) => T.filter((t) => t.perms.every((p) => can(ctx, p)) && (t.kind === "read" || can(ctx, "aiAct")));
