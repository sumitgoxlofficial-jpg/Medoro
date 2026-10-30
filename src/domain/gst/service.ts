import "server-only";
import { z } from "zod";
import QRCode from "qrcode";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, istDate, istMidnight, todayISO } from "@/lib/dates";
import { big, shareOf, taxableFromInclusive } from "@/lib/money";
import { stockValue } from "@/lib/units";
import { ACC } from "@/domain/accounting/accounts";
import { stateName, stateOf } from "@/domain/accounting/gst";
import { periodOf, type Period } from "@/domain/accounting/service";
import { allocateHalves } from "./tax";
import { CANCEL_REASONS, transportSchema, type TransportInput } from "./contracts";
import { fpOf, hsnCsv, hsnRows, uqcFor, type GstDoc, type GstLine } from "./common";
import { buildGstr1, gstr1Csv } from "./gstr1";
import { buildGstr3b, gstr3bRows, type Itc } from "./gstr3b";
import { defaultTallyMap, ledgerOf, tallyMastersXml, tallyVouchersXml, TALLY_GROUPS, type TallyMap, type TallyParty } from "./tally";
import { buildEwbByIrnPayload, buildIrnPayload, buildTransferEwbPayload, EInvoiceClient, EinvError, einvConfig, type EinvParty, type Transport } from "./einvoice";

/** Consignments above this value need an e-way bill. */
export const EWB_THRESHOLD_PAISE = 50_000_00;

// ───────────── Settings ─────────────

export type GstSettings = { einvoicing: boolean; tallyCompany: string; tallyMap: TallyMap };

export async function gstSettings(tenantId: string): Promise<GstSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, legalName: true, settings: true } });
  const s = (t.settings as { gst?: Partial<GstSettings> }).gst ?? {};
  return { einvoicing: !!s.einvoicing, tallyCompany: s.tallyCompany || t.legalName || t.name, tallyMap: { ...defaultTallyMap(), ...(s.tallyMap ?? {}) } };
}

const settingsSchema = z.object({
  einvoicing: z.boolean().optional(),
  tallyCompany: z.string().trim().min(1, "Enter the company name exactly as in Tally.").max(100).optional(),
  tallyMap: z.record(z.string(), z.object({ ledger: z.string().trim().min(1, "Every account needs a Tally ledger name.").max(100), group: z.enum(TALLY_GROUPS) })).optional(),
});

export async function saveGstSettings(ctx: Ctx, raw: { einvoicing?: boolean; tallyCompany?: string; tallyMap?: TallyMap }) {
  const i = settingsSchema.parse(raw);
  if (i.einvoicing !== undefined) authorize(ctx, "integrations"); else authorize(ctx, "reports");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const cur = (t.settings as { gst?: object }).gst ?? {};
  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), gst: { ...cur, ...i } } } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "GST settings changed", entity: "settings", entityId: "gst",
      detail: [i.einvoicing !== undefined ? `e-invoicing ${i.einvoicing ? "on" : "off"}` : "", i.tallyCompany ? `Tally company ${i.tallyCompany}` : "", i.tallyMap ? `Tally ledger map (${Object.keys(i.tallyMap).length} accounts)` : ""].filter(Boolean).join(" · ") });
  });
}

// ───────────── Registrations ─────────────

/** The GSTINs the user's branches bill under (branch GSTIN, else the pharmacy's), with their branches. */
export async function registrations(ctx: Ctx) {
  const [tenant, branches] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { gstin: true } }),
    db.branch.findMany({ where: { tenantId: ctx.tenantId, id: { in: ctx.branches.map((b) => b.id) } }, orderBy: { createdAt: "asc" } }),
  ]);
  const m = new Map<string, { gstin: string; state: string; branches: { id: string; name: string; code: string }[] }>();
  const unregistered: string[] = [];
  for (const b of branches) {
    const g = b.gstin ?? tenant.gstin;
    if (!g) { unregistered.push(b.name); continue; }
    const r = m.get(g) ?? { gstin: g, state: stateName(g.slice(0, 2)), branches: [] };
    r.branches.push({ id: b.id, name: b.name, code: b.code });
    m.set(g, r);
  }
  return { list: [...m.values()], unregistered };
}

async function registration(ctx: Ctx, gstin: string) {
  const r = (await registrations(ctx)).list.find((x) => x.gstin === gstin);
  if (!r) throw new UserError("None of your branches bills under that GSTIN.");
  return r;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export function monthPeriod(month: string | undefined): Period & { month: string } {
  const m = month && MONTH.test(month) ? month : todayISO().slice(0, 7);
  return { ...periodOf(m), month: m };
}

// ───────────── Documents ─────────────

type SaleRow = Prisma.SaleGetPayload<{ include: { items: true } }>;

/** HSN quantity in the pack's UQC: loose units count as a fraction of their pack. */
const packQty = (i: { loose: boolean; packSize: number }, qty: number) => (i.loose && i.packSize > 1 ? Math.round((qty / i.packSize) * 100) / 100 : qty);

/**
 * Invoices withdrawn from GSTR-1 and reported as cancelled documents: IRNs cancelled at the IRP (with the credit notes
 * that reversed them) and bills voided on the day they were made.
 */
async function cancelledIrnSales(tenantId: string, saleIds: string[]) {
  if (!saleIds.length) return new Set<string>();
  const [rows, voids] = await Promise.all([
    db.eInvoice.findMany({ where: { tenantId, docType: "sale", docId: { in: saleIds }, kind: { in: ["irn", "irn_cancel"] } }, orderBy: { at: "asc" } }),
    db.saleVoid.findMany({ where: { tenantId, saleId: { in: saleIds } }, select: { saleId: true } }),
  ]);
  const last = new Map<string, string>();
  for (const r of rows) last.set(r.docId, r.kind);
  return new Set([...[...last].filter(([, k]) => k === "irn_cancel").map(([id]) => id), ...voids.map((v) => v.saleId)]);
}

/**
 * Invoices and credit notes of the given branches in the period, in the shape the return builders take.
 * Line taxes are split exactly as they were posted: IGST for inter-state sales, otherwise CGST/SGST with the
 * halves allocated so they add up to the document's booked CGST.
 */
export async function gstDocs(tenantId: string, branchIds: string[], p: Period) {
  const [sales, returns, tenant, branches] = await Promise.all([
    db.sale.findMany({ where: { tenantId, branchId: { in: branchIds }, at: { gte: p.from, lt: p.to } }, include: { items: true }, orderBy: [{ at: "asc" }, { invoiceNo: "asc" }] }),
    db.salesReturn.findMany({ where: { tenantId, branchId: { in: branchIds }, at: { gte: p.from, lt: p.to } }, orderBy: [{ at: "asc" }, { creditNoteNo: "asc" }] }),
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { gstin: true } }),
    db.branch.findMany({ where: { tenantId, id: { in: branchIds } }, select: { id: true, gstin: true } }),
  ]);
  const origIds = [...new Set(returns.map((r) => r.saleId))].filter((id) => !sales.some((s) => s.id === id));
  const origs = origIds.length ? await db.sale.findMany({ where: { id: { in: origIds } }, include: { items: true } }) : [];
  const allSales = new Map<string, SaleRow>([...sales, ...origs].map((s) => [s.id, s]));
  // Earlier returns against the same items: credit-note shares are cumulative (see processReturn).
  const history = returns.length ? await db.salesReturn.findMany({ where: { tenantId, saleId: { in: [...allSales.keys()] } }, orderBy: [{ at: "asc" }, { creditNoteNo: "asc" }] }) : [];
  const medIds = [...new Set([...allSales.values()].flatMap((s) => s.items.map((i) => i.medicineId)))];
  const meds = new Map((await db.medicine.findMany({ where: { id: { in: medIds } }, select: { id: true, name: true, hsn: true, form: true } })).map((m) => [m.id, m]));
  const home = (branchId: string) => stateOf(null, branches.find((b) => b.id === branchId)?.gstin ?? tenant.gstin) ?? "";
  const cancelledIds = await cancelledIrnSales(tenantId, [...allSales.keys()]);

  const lineOf = (medicineId: string, rate: number, qty: number, taxable: number, tax: number): GstLine & { tax: number } => {
    const m = meds.get(medicineId);
    return { hsn: (m?.hsn || "3004").replace(/\D/g, "") || "3004", desc: "", uqc: uqcFor(m?.form ?? ""), qty, rate, taxable, igst: 0, cgst: 0, sgst: 0, tax };
  };
  const split = (lines: (GstLine & { tax: number })[], inter: boolean, cgstTotal: number): GstLine[] => {
    const halves = inter ? [] : allocateHalves(lines.map((l) => l.tax), cgstTotal);
    return lines.map(({ tax, ...l }, i) => (inter ? { ...l, igst: tax } : { ...l, cgst: halves[i], sgst: tax - halves[i] }));
  };

  const docs: GstDoc[] = [];
  const cancelled: string[] = [];
  for (const s of sales) {
    if (cancelledIds.has(s.id)) { cancelled.push(s.invoiceNo); continue; }
    const inter = big(s.igstPaise) > 0;
    const raw = s.items.map((i) => lineOf(i.medicineId, i.gstRate, packQty(i, i.qty), big(i.taxablePaise), big(i.mrpPaise) * i.qty - big(i.discountPaise) - big(i.taxablePaise)));
    docs.push({ kind: "inv", no: s.invoiceNo, date: istDate(s.at), value: big(s.totalPaise), pos: s.placeOfSupply ?? home(s.branchId), ctin: s.customerGstin, inter, branchId: s.branchId, lines: split(raw, inter, big(s.cgstPaise)) });
  }
  const done = new Map<string, number>();
  for (const r of history) {
    const s = allSales.get(r.saleId)!;
    const inPeriod = returns.some((x) => x.id === r.id);
    const raw: (GstLine & { tax: number })[] = [];
    for (const l of r.lines as { itemId: string; qty: number; amount: number }[]) {
      const it = s.items.find((x) => x.id === l.itemId);
      if (!it) continue;
      const before = done.get(it.id) ?? 0;
      done.set(it.id, before + l.qty);
      const taxable = shareOf(big(it.taxablePaise), it.qty, before, l.qty);
      raw.push(lineOf(it.medicineId, it.gstRate, packQty(it, l.qty), taxable, l.amount - taxable));
    }
    if (!inPeriod || cancelledIds.has(s.id)) continue;
    const inter = big(s.igstPaise) > 0, tax = raw.reduce((a, l) => a + l.tax, 0);
    docs.push({
      kind: "cn", no: r.creditNoteNo, date: istDate(r.at), value: big(r.amountPaise), pos: s.placeOfSupply ?? home(s.branchId), ctin: s.customerGstin, inter, branchId: r.branchId,
      lines: split(raw, inter, Math.floor(tax / 2)), orig: { no: s.invoiceNo, date: istDate(s.at), value: big(s.totalPaise), inter, ctin: s.customerGstin },
    });
  }
  const warnings = [
    ...docs.filter((d) => d.no.length > 16).slice(0, 1).map((d) => `Document numbers longer than 16 characters (e.g. ${d.no}) are rejected by the GST portal and the IRP. Use a shorter invoice prefix.`),
    ...(cancelled.length ? [`${cancelled.length} voided invoice(s) or invoice(s) with a cancelled IRN are reported as cancelled documents: ${cancelled.join(", ")}.`] : []),
  ];
  return { docs, cancelled, warnings };
}

/** Input tax from the ledgers: purchases less debit notes are ITC; other credits to input tax are reversals. */
export async function itcFor(tenantId: string, branchIds: string[], p: Period): Promise<Itc> {
  const rows = await db.$queryRaw<{ account: string; own: boolean; net: bigint }[]>`
    SELECT l.account, COALESCE(v."refType" IN ('grn', 'supplier_return'), false) own, SUM(l."debitPaise" - l."creditPaise")::bigint net
    FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND v."branchId" = ANY(${branchIds}::text[]) AND v.date >= ${p.from} AND v.date < ${p.to}
      AND l.account IN (${ACC.inIgst}, ${ACC.inCgst}, ${ACC.inSgst}) GROUP BY 1, 2`;
  const get = (acc: string) => {
    const own = Number(rows.find((r) => r.account === acc && r.own)?.net ?? 0), other = Number(rows.find((r) => r.account === acc && !r.own)?.net ?? 0);
    return other >= 0 ? { avl: own + other, rev: 0 } : { avl: own, rev: -other };
  };
  const i = get(ACC.inIgst), c = get(ACC.inCgst), s = get(ACC.inSgst);
  return { igst: i.avl, cgst: c.avl, sgst: s.avl, revIgst: i.rev, revCgst: c.rev, revSgst: s.rev };
}

// ───────────── Returns ─────────────

export async function gstr1For(ctx: Ctx, gstin: string, month?: string) {
  authorizeView(ctx, "reports");
  const r = await registration(ctx, gstin), p = monthPeriod(month);
  const { docs, cancelled, warnings } = await gstDocs(ctx.tenantId, r.branches.map((b) => b.id), p);
  return { json: buildGstr1({ gstin, fp: fpOf(p.month), docs, cancelled }), docs, warnings, period: p };
}

export async function gstr3bFor(ctx: Ctx, gstin: string, month?: string) {
  authorizeView(ctx, "reports");
  const r = await registration(ctx, gstin), p = monthPeriod(month), ids = r.branches.map((b) => b.id);
  const [{ docs }, itc] = await Promise.all([gstDocs(ctx.tenantId, ids, p), itcFor(ctx.tenantId, ids, p)]);
  return { json: buildGstr3b({ gstin, fp: fpOf(p.month), docs, itc }), period: p };
}

/** GSTIN-wise and branch-wise outward tax, ITC and net liability for the month, with an all-branch total. */
export async function gstRollup(ctx: Ctx, month?: string) {
  authorizeView(ctx, "reports");
  const p = monthPeriod(month), regs = await registrations(ctx);
  type Row = { taxable: number; igst: number; cgst: number; sgst: number; itcIgst: number; itcCgst: number; itcSgst: number; invoices: number; creditNotes: number };
  const blank = (): Row => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0, invoices: 0, creditNotes: 0 });
  const add = (a: Row, b: Row) => (Object.keys(a) as (keyof Row)[]).forEach((k) => { a[k] += b[k]; });
  const total = blank();
  const groups = await Promise.all(regs.list.map(async (g) => {
    const sub = blank();
    const branches = await Promise.all(g.branches.map(async (b) => {
      const [{ docs }, itc] = await Promise.all([gstDocs(ctx.tenantId, [b.id], p), itcFor(ctx.tenantId, [b.id], p)]);
      const row = blank();
      for (const d of docs) {
        const sign = d.kind === "cn" ? -1 : 1;
        if (d.kind === "cn") row.creditNotes++; else row.invoices++;
        for (const l of d.lines) { row.taxable += sign * l.taxable; row.igst += sign * l.igst; row.cgst += sign * l.cgst; row.sgst += sign * l.sgst; }
      }
      row.itcIgst = itc.igst - itc.revIgst; row.itcCgst = itc.cgst - itc.revCgst; row.itcSgst = itc.sgst - itc.revSgst;
      add(sub, row);
      return { ...b, ...row };
    }));
    add(total, sub);
    return { gstin: g.gstin, state: g.state, branches, total: sub };
  }));
  return { month: p.month, label: p.label, groups, total, unregistered: regs.unregistered };
}

export type ExportKind = "gstr1-json" | "gstr1-csv" | "gstr3b-json" | "gstr3b-csv" | "hsn-csv" | "tally-vouchers" | "tally-masters";

/** File body, name and type for a download. Writes an audit event. */
export async function gstExport(ctx: Ctx, kind: ExportKind, q: { gstin?: string; month?: string; from?: string; to?: string; scope?: string }) {
  authorize(ctx, "reports");
  let body: string, name: string, type: string, detail: string;
  const tag = (g: string, m: string) => `${g}-${fpOf(m)}`;
  if (kind.startsWith("gstr1") || kind === "hsn-csv") {
    const r = await gstr1For(ctx, q.gstin ?? "", q.month);
    if (kind === "gstr1-json") { body = JSON.stringify(r.json, null, 2); name = `GSTR1-${tag(q.gstin!, r.period.month)}.json`; type = "application/json"; }
    else if (kind === "gstr1-csv") { body = csv(gstr1Csv(r.json)); name = `GSTR1-summary-${tag(q.gstin!, r.period.month)}.csv`; type = "text/csv; charset=utf-8"; }
    else { body = csv(hsnCsv(hsnRows(r.docs))); name = `HSN-summary-${tag(q.gstin!, r.period.month)}.csv`; type = "text/csv; charset=utf-8"; }
    detail = `${kind} · ${q.gstin} · ${r.period.month} · ${r.docs.length} documents`;
  } else if (kind.startsWith("gstr3b")) {
    const r = await gstr3bFor(ctx, q.gstin ?? "", q.month);
    if (kind === "gstr3b-json") { body = JSON.stringify(r.json, null, 2); name = `GSTR3B-${tag(q.gstin!, r.period.month)}.json`; type = "application/json"; }
    else { body = csv(gstr3bRows(r.json)); name = `GSTR3B-${tag(q.gstin!, r.period.month)}.csv`; type = "text/csv; charset=utf-8"; }
    detail = `${kind} · ${q.gstin} · ${r.period.month}`;
  } else if (kind === "tally-vouchers") {
    const x = await tallyVouchers(ctx, q.from, q.to, q.scope);
    body = x.xml; name = `tally-vouchers-${x.from}-to-${x.to}.xml`; type = "application/xml"; detail = `Tally vouchers · ${x.from} to ${x.to} · ${x.count} vouchers${q.scope && q.scope !== "all" ? " · " + q.scope : ""}`;
  } else {
    const x = await tallyMasters(ctx);
    body = x.xml; name = "tally-masters.xml"; type = "application/xml"; detail = `Tally masters · ${x.count} ledgers`;
  }
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "GST export", entity: "report", entityId: kind, detail });
  return { body, name, type };
}

const csv = (rows: (string | number | null | undefined)[][]) => "\uFEFF" + rows.map((r) => r.map((v) => {
  const x = String(v ?? ""), safe = /^[=+\-@]/.test(x) && isNaN(Number(x)) ? "'" + x : x;
  return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}).join(",")).join("\n");

// ───────────── Tally ─────────────

async function partyLedgers(tenantId: string) {
  const [cs, ss] = await Promise.all([
    db.customer.findMany({ where: { tenantId }, select: { id: true, name: true, gstin: true, stateCode: true } }),
    db.supplier.findMany({ where: { tenantId }, select: { id: true, name: true, gstin: true, stateCode: true } }),
  ]);
  const supNames = new Set(ss.map((s) => s.name.toLowerCase()));
  const m = new Map<string, TallyParty>();
  for (const c of cs) m.set(c.id, { ledger: supNames.has(c.name.toLowerCase()) ? `${c.name} (Customer)` : c.name, group: "Sundry Debtors", gstin: c.gstin, state: stateName(stateOf(c.stateCode, c.gstin)) || null });
  for (const s of ss) m.set(s.id, { ledger: s.name, group: "Sundry Creditors", gstin: s.gstin, state: stateName(stateOf(s.stateCode, s.gstin)) || null });
  return m;
}

/** Vouchers in an IST date range. Scope "all" is the whole pharmacy; a GSTIN limits to its branches' vouchers. */
export async function tallyVouchers(ctx: Ctx, fromDay?: string, toDay?: string, scope = "all") {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const p = monthPeriod(undefined);
  const from = fromDay && iso.test(fromDay) ? fromDay : p.fromDay, to = toDay && iso.test(toDay) ? toDay : addDays(p.toDay, -1);
  if (from > to) throw new UserError("The start date is after the end date.");
  const branchIds = scope === "all" ? null : (await registration(ctx, scope)).branches.map((b) => b.id);
  const [vs, settings, parties] = await Promise.all([
    db.voucher.findMany({ where: { tenantId: ctx.tenantId, date: { gte: istMidnight(from), lt: istMidnight(addDays(to, 1)) }, ...(branchIds ? { branchId: { in: branchIds } } : {}) }, include: { lines: true }, orderBy: [{ date: "asc" }, { no: "asc" }] }),
    gstSettings(ctx.tenantId), partyLedgers(ctx.tenantId),
  ]);
  const xml = tallyVouchersXml(settings.tallyCompany, vs.map((v) => ({
    no: v.no, date: istDate(v.date), type: v.type, narration: v.narration,
    lines: v.lines.map((l) => ({ account: l.account, dr: big(l.debitPaise), cr: big(l.creditPaise), partyLedger: l.partyId ? parties.get(l.partyId)?.ledger : undefined })),
  })), settings.tallyMap);
  return { xml, from, to, count: vs.length };
}

export async function tallyMasters(ctx: Ctx) {
  const [settings, parties, used] = await Promise.all([
    gstSettings(ctx.tenantId), partyLedgers(ctx.tenantId),
    db.$queryRaw<{ account: string; party: boolean }[]>`SELECT DISTINCT l.account, l."partyId" IS NOT NULL party FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${ctx.tenantId}`,
  ]);
  const accounts = [...new Set([...Object.keys(settings.tallyMap), ...used.filter((u) => !u.party).map((u) => u.account)])];
  const ps = [...parties.values()].sort((a, b) => a.ledger.localeCompare(b.ledger));
  return { xml: tallyMastersXml(settings.tallyCompany, accounts, settings.tallyMap, ps), count: accounts.length + ps.length };
}

/** Accounts with postings or in the default chart, with the Tally ledger and group each maps to. */
export async function tallyMapping(ctx: Ctx) {
  authorizeView(ctx, "reports");
  const s = await gstSettings(ctx.tenantId);
  const used = await db.$queryRaw<{ account: string }[]>`SELECT DISTINCT l.account FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${ctx.tenantId}`;
  const accounts = [...new Set([...Object.keys(s.tallyMap), ...used.map((u) => u.account)])].sort((a, b) => a.localeCompare(b));
  return { company: s.tallyCompany, rows: accounts.map((a) => ({ account: a, ledger: ledgerOf(s.tallyMap, a), group: s.tallyMap[a]?.group ?? "Suspense A/c" })) };
}

// ───────────── E-invoice and e-way bill ─────────────

export async function einvoiceState(tenantId: string) {
  const cfg = einvConfig(), s = await gstSettings(tenantId);
  return { configured: !!cfg, provider: cfg?.provider ?? null, gstin: cfg?.gstin ?? null, applicable: s.einvoicing, enabled: !!cfg && s.einvoicing };
}

let clientFactory = (cfg: NonNullable<ReturnType<typeof einvConfig>>) => new EInvoiceClient(cfg);
/** Tests swap the HTTP layer. */
export const setEinvClientFactory = (f: typeof clientFactory) => { clientFactory = f; };

async function client(ctx: Ctx) {
  const cfg = einvConfig();
  if (!cfg) throw new UserError("E-invoicing isn’t set up on this server (EINVOICE_* settings).");
  if (!(await gstSettings(ctx.tenantId)).einvoicing) throw new UserError("Turn on “E-invoicing applicable” in GST settings first.");
  return { cfg, api: clientFactory(cfg) };
}

/** "Shop 4, MG Road, Pune 411001" → address, place and PIN. */
export function splitAddress(address: string | null | undefined, fallbackPlace: string) {
  const a = (address ?? "").trim(), pin = /\b([1-9]\d{5})\b/.exec(a)?.[1];
  const parts = a.replace(/\b[1-9]\d{5}\b/, "").split(/[,\n]/).map((x) => x.trim().replace(/[-–]+$/, "").trim()).filter(Boolean);
  const place = [...parts].reverse().find((x) => /[A-Za-z]{3,}/.test(x) && !/\d/.test(x)) ?? fallbackPlace;
  return { address: a || fallbackPlace, place: place.length >= 3 ? place : fallbackPlace, pin: pin ? Number(pin) : null };
}

async function sellerOf(tenantId: string, branchId: string): Promise<EinvParty> {
  const b = await db.branch.findFirstOrThrow({ where: { id: branchId, tenantId }, include: { tenant: true } });
  const gstin = b.gstin ?? b.tenant.gstin;
  if (!gstin) throw new UserError(`${b.name} has no GSTIN.`);
  const a = splitAddress(b.address, b.name);
  if (!a.pin) throw new UserError(`Add the 6-digit PIN code to ${b.name}’s address (Users & branches).`);
  return { gstin, legalName: b.tenant.legalName || b.tenant.name, tradeName: b.tenant.name, address: a.address, place: a.place, pin: a.pin, stateCode: gstin.slice(0, 2), phone: b.tenant.phone };
}

type EinvRow = Awaited<ReturnType<typeof db.eInvoice.findMany>>[number];
const latest = (rows: EinvRow[], kinds: string[]) => [...rows].reverse().find((r) => kinds.includes(r.kind));
const activeIrn = (rows: EinvRow[]) => { const r = latest(rows, ["irn", "irn_cancel"]); return r?.kind === "irn" ? r : null; };

async function einvRows(tenantId: string, docType: string, docId: string) {
  return db.eInvoice.findMany({ where: { tenantId, docType, docId }, orderBy: { at: "asc" } });
}

/** IRN, QR and e-way bill for printing an invoice; null when it has none. */
export async function einvoiceFor(ctx: Ctx, saleId: string) {
  const rows = await einvRows(ctx.tenantId, "sale", saleId);
  const irn = activeIrn(rows), cancelled = latest(rows, ["irn", "irn_cancel"])?.kind === "irn_cancel", ewb = latest(rows, ["ewb"]);
  if (!irn && !cancelled && !ewb) return null;
  return {
    irn: irn?.irn ?? null, ackNo: irn?.ackNo ?? null, ackDt: irn?.ackDt ?? null, cancelled,
    qr: irn?.signedQr ? await QRCode.toDataURL(irn.signedQr, { errorCorrectionLevel: "M", margin: 1, width: 220 }) : null,
    ewbNo: ewb?.ewbNo ?? null, ewbValid: ewb?.ewbValid ?? null,
  };
}

async function saleForIrn(ctx: Ctx, saleId: string) {
  const s = await db.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, include: { items: true, customer: true } });
  if (!s) throw new UserError("Invoice not found.");
  if (!ctx.branches.some((b) => b.id === s.branchId)) throw new UserError("You don’t have access to this invoice’s branch.");
  return s;
}

export async function generateIrn(ctx: Ctx, saleId: string) {
  authorizeAny(ctx, "sale", "reports");
  const { cfg, api } = await client(ctx);
  const s = await saleForIrn(ctx, saleId);
  if (!s.customerGstin || !s.customer) throw new UserError("E-invoices are for B2B invoices: this sale has no customer GSTIN.");
  if (!/^[1-9A-Z][0-9A-Z/-]{0,15}$/.test(s.invoiceNo)) throw new UserError(`Invoice number ${s.invoiceNo} is longer than 16 characters (or uses other characters), which the IRP rejects. Use a shorter invoice prefix for new invoices.`);
  const rows = await einvRows(ctx.tenantId, "sale", s.id);
  if (activeIrn(rows)) throw new UserError("This invoice already has an IRN.");
  if (latest(rows, ["irn", "irn_cancel"])?.kind === "irn_cancel") throw new UserError("This invoice’s IRN was cancelled. The IRP doesn’t issue a new IRN for the same number.");
  const seller = await sellerOf(ctx.tenantId, s.branchId);
  if (seller.gstin !== cfg.gstin) throw new UserError(`E-invoicing on this server is for GSTIN ${cfg.gstin}; this branch bills under ${seller.gstin}.`);
  const ba = splitAddress(s.customer.address, s.customer.name);
  const pin = s.customer.pincode ? Number(s.customer.pincode) : ba.pin;
  if (!s.customer.address || !pin) throw new UserError(`Add ${s.customer.name}’s billing address and PIN code (Parties → Customers) first.`);
  const meds = new Map((await db.medicine.findMany({ where: { id: { in: s.items.map((i) => i.medicineId) } } })).map((m) => [m.id, m]));
  const batches = new Map((await db.batch.findMany({ where: { id: { in: s.items.map((i) => i.batchId) } } })).map((b) => [b.id, b]));
  const inter = big(s.igstPaise) > 0;
  const taxes = s.items.map((i) => big(i.mrpPaise) * i.qty - big(i.discountPaise) - big(i.taxablePaise));
  const halves = inter ? [] : allocateHalves(taxes, big(s.cgstPaise));
  const buyerState = s.customerGstin.slice(0, 2);
  const payload = buildIrnPayload({
    type: "INV", no: s.invoiceNo, date: istDate(s.at), seller, roundOff: big(s.roundOffPaise),
    buyer: { gstin: s.customerGstin, legalName: s.customer.name, address: ba.address, place: ba.place, pin, stateCode: buyerState, phone: s.customer.phone, pos: s.placeOfSupply ?? buyerState },
    items: s.items.map((i, k) => {
      const m = meds.get(i.medicineId)!, b = batches.get(i.batchId);
      return { name: `${m.name} ${m.strength}`.trim(), hsn: (m.hsn || "3004").replace(/\D/g, ""), qty: i.qty, unit: uqcFor(m.form), batch: b?.batchNo, expiry: b ? istDate(b.expiryDate) : undefined, rate: i.gstRate,
        gross: taxableFromInclusive(big(i.mrpPaise) * i.qty, i.gstRate), taxable: big(i.taxablePaise), igst: inter ? taxes[k] : 0, cgst: inter ? 0 : halves[k], sgst: inter ? 0 : taxes[k] - halves[k] };
    }),
  });
  let r;
  try { r = await api.generateIrn(payload); } catch (e) { if (e instanceof EinvError) throw new UserError(`IRP: ${e.message}`); throw e; }
  return db.$transaction(async (tx) => {
    const row = await tx.eInvoice.create({ data: {
      tenantId: ctx.tenantId, branchId: s.branchId, docType: "sale", docId: s.id, docNo: s.invoiceNo, kind: "irn", irn: r.Irn, ackNo: String(r.AckNo), ackDt: r.AckDt, signedQr: r.SignedQRCode, signedInv: r.SignedInvoice ?? null,
      ewbNo: r.EwbNo ? String(r.EwbNo) : null, ewbDate: r.EwbDt ?? null, ewbValid: r.EwbValidTill ?? null, request: payload as object, response: { Irn: r.Irn, AckNo: String(r.AckNo), AckDt: r.AckDt } as object, userId: ctx.userId,
    } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: s.branchId, userId: ctx.userId, userName: ctx.userName, action: "IRN generated", entity: "sale", entityId: s.id, detail: `${s.invoiceNo} · IRN ${r.Irn.slice(0, 12)}… · Ack ${r.AckNo}` });
    return { irn: row.irn!, ackNo: row.ackNo! };
  });
}

/** NIC acknowledgement time "2026-10-31 12:30:00" is IST. */
const ackTime = (s: string) => Date.parse(s.replace(" ", "T") + "+05:30");

/** Cancels the IRN within 24 hours. The sale must first be fully returned so the books match the cancellation. */
export async function cancelIrn(ctx: Ctx, saleId: string, reason: keyof typeof CANCEL_REASONS, remark: string) {
  authorize(ctx, "refund");
  if (!(reason in CANCEL_REASONS)) throw new UserError("Choose a reason.");
  if (remark.trim().length < 3) throw new UserError("Enter a remark for the cancellation.");
  const { api } = await client(ctx);
  const s = await saleForIrn(ctx, saleId);
  const irn = activeIrn(await einvRows(ctx.tenantId, "sale", s.id));
  if (!irn) throw new UserError("This invoice has no active IRN.");
  if (!irn.ackDt || Date.now() - ackTime(irn.ackDt) > 24 * 3600_000) throw new UserError("An IRN can only be cancelled within 24 hours. Issue a credit note instead.");
  if (s.items.some((i) => i.returnedQty < i.qty)) throw new UserError("Return the whole invoice first (Returns), so the books show it as cancelled too.");
  let r;
  try { r = await api.cancelIrn(irn.irn!, reason, remark.trim()); } catch (e) { if (e instanceof EinvError) throw new UserError(`IRP: ${e.message}`); throw e; }
  await db.$transaction(async (tx) => {
    await tx.eInvoice.create({ data: { tenantId: ctx.tenantId, branchId: s.branchId, docType: "sale", docId: s.id, docNo: s.invoiceNo, kind: "irn_cancel", irn: irn.irn, request: { Irn: irn.irn, CnlRsn: reason, CnlRem: remark.trim() }, response: r as object, userId: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: s.branchId, userId: ctx.userId, userName: ctx.userName, action: "IRN cancelled", entity: "sale", entityId: s.id, detail: `${s.invoiceNo} · ${CANCEL_REASONS[reason]} · ${remark.trim()}` });
  });
}



const transport = (t: z.output<typeof transportSchema>): Transport => ({ distanceKm: t.distanceKm, mode: t.mode, vehicleNo: t.vehicleNo || undefined, transporterId: t.transporterId || undefined, transporterName: t.transporterName || undefined, transDocNo: t.transDocNo || undefined, transDocDate: t.transDocDate || undefined });

export async function generateSaleEwb(ctx: Ctx, saleId: string, raw: TransportInput) {
  authorizeAny(ctx, "sale", "reports");
  const t = transportSchema.parse(raw);
  const { api } = await client(ctx);
  const s = await saleForIrn(ctx, saleId);
  const rows = await einvRows(ctx.tenantId, "sale", s.id), irn = activeIrn(rows);
  if (!irn) throw new UserError("Generate the IRN first; the e-way bill is raised against it.");
  if (irn.ewbNo || latest(rows, ["ewb"])) throw new UserError("This invoice already has an e-way bill.");
  const payload = buildEwbByIrnPayload(irn.irn!, transport(t));
  let r;
  try { r = await api.ewbByIrn(payload); } catch (e) { if (e instanceof EinvError) throw new UserError(`E-way bill: ${e.message}`); throw e; }
  await db.$transaction(async (tx) => {
    await tx.eInvoice.create({ data: { tenantId: ctx.tenantId, branchId: s.branchId, docType: "sale", docId: s.id, docNo: s.invoiceNo, kind: "ewb", irn: irn.irn, ewbNo: String(r.EwbNo), ewbDate: r.EwbDt, ewbValid: r.EwbValidTill, request: payload, response: r as object, userId: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: s.branchId, userId: ctx.userId, userName: ctx.userName, action: "E-way bill generated", entity: "sale", entityId: s.id, detail: `${s.invoiceNo} · EWB ${r.EwbNo}` });
  });
  return String(r.EwbNo);
}

/** Value of a transfer at cost, with the medicine's GST rate (shown; a same-GSTIN transfer carries no tax). */
async function transferGoods(tenantId: string, batchId: string, qty: number) {
  const b = await db.batch.findFirstOrThrow({ where: { id: batchId, tenantId }, include: { medicine: true } });
  return { b, value: stockValue(big(b.costPaise), qty, b.medicine.packSize) }; // qty in stock units, cost per pack
}

export async function generateTransferEwb(ctx: Ctx, transferId: string, raw: TransportInput) {
  authorizeAny(ctx, "adjust", "reports");
  const t = transportSchema.parse(raw);
  const { api } = await client(ctx);
  const tr = await db.transfer.findFirst({ where: { id: transferId, tenantId: ctx.tenantId } });
  if (!tr) throw new UserError("Transfer not found.");
  if (!ctx.branches.some((b) => b.id === tr.fromBranch)) throw new UserError("Raise the e-way bill from the sending branch.");
  if (!["pending", "in_transit"].includes(tr.status)) throw new UserError("Only transfers not yet received need an e-way bill.");
  if (latest(await einvRows(ctx.tenantId, "transfer", tr.id), ["ewb"])) throw new UserError("This transfer already has an e-way bill.");
  const [from, to] = await Promise.all([sellerOf(ctx.tenantId, tr.fromBranch), sellerOf(ctx.tenantId, tr.toBranch)]);
  if (from.gstin !== to.gstin) throw new UserError("These branches have different GSTINs: moving stock between them is a taxable supply. Raise a tax invoice for it instead.");
  const { b, value } = await transferGoods(ctx.tenantId, tr.batchId, tr.qty);
  const payload = buildTransferEwbPayload({ no: tr.no, date: istDate(tr.createdAt), from, to, transport: transport(t),
    goods: [{ name: `${b.medicine.name} ${b.medicine.strength}`.trim(), hsn: (b.medicine.hsn || "3004").replace(/\D/g, ""), qty: tr.qty, unit: uqcFor(b.medicine.form), taxable: value, rate: b.medicine.gstRate, igst: 0, cgst: 0, sgst: 0 }] });
  let r;
  try { r = await api.generateEwb(payload); } catch (e) { if (e instanceof EinvError) throw new UserError(`E-way bill: ${e.message}`); throw e; }
  await db.$transaction(async (tx) => {
    await tx.eInvoice.create({ data: { tenantId: ctx.tenantId, branchId: tr.fromBranch, docType: "transfer", docId: tr.id, docNo: tr.no, kind: "ewb", ewbNo: r.EwbNo, ewbDate: r.EwbDt, ewbValid: r.EwbValidTill, request: payload as object, response: r as object, userId: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: tr.fromBranch, userId: ctx.userId, userName: ctx.userName, action: "E-way bill generated", entity: "transfer", entityId: tr.id, detail: `${tr.no} · EWB ${r.EwbNo}` });
  });
  return r.EwbNo;
}

/** B2B invoices of the month and open transfers, with their IRN / e-way bill status. */
export async function einvoiceQueue(ctx: Ctx, month?: string) {
  authorizeView(ctx, "reports");
  const p = monthPeriod(month), mine = ctx.branches.map((b) => b.id);
  const [sales, transfers] = await Promise.all([
    db.sale.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: mine }, customerGstin: { not: null }, at: { gte: p.from, lt: p.to } }, include: { customer: { select: { name: true } }, items: { select: { qty: true, returnedQty: true } } }, orderBy: { at: "desc" }, take: 200 }),
    db.transfer.findMany({ where: { tenantId: ctx.tenantId, fromBranch: { in: mine }, status: { in: ["pending", "in_transit"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const rows = await db.eInvoice.findMany({ where: { tenantId: ctx.tenantId, docId: { in: [...sales.map((s) => s.id), ...transfers.map((t) => t.id)] } }, orderBy: { at: "asc" } });
  const of = (id: string) => rows.filter((r) => r.docId === id);
  const tv = await Promise.all(transfers.map((t) => transferGoods(ctx.tenantId, t.batchId, t.qty)));
  const names = new Map((await db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  return {
    sales: sales.map((s) => {
      const r = of(s.id), irn = activeIrn(r), last = latest(r, ["irn", "irn_cancel"]);
      return { id: s.id, no: s.invoiceNo, at: s.at.toISOString(), customer: s.customer?.name ?? "", gstin: s.customerGstin!, total: big(s.totalPaise), irn: irn?.irn ?? null, ackDt: irn?.ackDt ?? null,
        cancelled: last?.kind === "irn_cancel", ewbNo: irn?.ewbNo ?? latest(r, ["ewb"])?.ewbNo ?? null, ewbRequired: big(s.totalPaise) > EWB_THRESHOLD_PAISE, fullyReturned: s.items.every((i) => i.returnedQty >= i.qty),
        canCancel: !!irn?.ackDt && Date.now() - ackTime(irn.ackDt) <= 24 * 3600_000 };
    }),
    transfers: transfers.map((t, i) => ({ id: t.id, no: t.no, at: t.createdAt.toISOString(), item: `${tv[i].b.medicine.name} ${tv[i].b.batchNo} × ${t.qty}`, from: names.get(t.fromBranch) ?? "", to: names.get(t.toBranch) ?? "", value: tv[i].value, status: t.status, ewbRequired: tv[i].value > EWB_THRESHOLD_PAISE, ewbNo: latest(of(t.id), ["ewb"])?.ewbNo ?? null })),
  };
}
