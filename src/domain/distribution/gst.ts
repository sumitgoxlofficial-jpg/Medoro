import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { istDate } from "@/lib/dates";
import { fpOf, hsnRows, uqcFor, type GstDoc, type GstLine } from "@/domain/gst/common";
import { buildGstr1 } from "@/domain/gst/gstr1";
import { buildGstr3b } from "@/domain/gst/gstr3b";
import { itcFor, monthPeriod, registrations } from "@/domain/gst/service";
import type { Period } from "@/domain/accounting/service";
import { distView } from "./context";
import { num } from "./common";

const lineTax = (tax: number, inter: boolean) => {
  const c = Math.floor(tax / 2);
  return inter ? { igst: tax, cgst: 0, sgst: 0 } : { igst: 0, cgst: c, sgst: tax - c };
};

/**
 * Wholesale invoices and credit notes of the given godowns in the period, as GST return documents. Cancelled
 * invoices are left out of the tables and listed as cancelled documents (doc_issue).
 */
export async function distGstDocs(tenantId: string, branchIds: string[], p: Period) {
  const [invs, rets] = await Promise.all([
    db.distInvoice.findMany({ where: { tenantId, branchId: { in: branchIds }, at: { gte: p.from, lt: p.to } }, include: { lines: true }, orderBy: [{ date: "asc" }, { no: "asc" }] }),
    db.distReturn.findMany({ where: { tenantId, branchId: { in: branchIds }, at: { gte: p.from, lt: p.to } }, include: { lines: true }, orderBy: { at: "asc" } }),
  ]);
  const origIds = [...new Set(rets.map((r) => r.invoiceId))];
  const origs = await db.distInvoice.findMany({ where: { id: { in: origIds } }, include: { lines: true } });
  const cancels = new Set((await db.distInvoiceCancel.findMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })).map((c) => c.invoiceId));
  const allLines = [...invs, ...origs].flatMap((i) => i.lines);
  const meds = new Map((await db.medicine.findMany({ where: { id: { in: [...new Set(allLines.map((l) => l.medicineId))] } }, select: { id: true, name: true, hsn: true, form: true } })).map((m) => [m.id, m]));
  const gl = (medicineId: string, rate: number, qty: number, taxable: number, tax: number, inter: boolean): GstLine => {
    const m = meds.get(medicineId);
    return { hsn: m?.hsn ?? "3004", desc: m?.name ?? "", uqc: uqcFor(m?.form ?? ""), qty, rate, taxable, ...lineTax(tax, inter) };
  };
  const docs: GstDoc[] = [];
  const cancelled: string[] = [];
  for (const i of invs) {
    if (cancels.has(i.id)) { cancelled.push(i.no); continue; }
    // Line taxes add up to the booked totals; CGST/SGST halves are re-balanced to the invoice's booked split.
    const lines = i.lines.filter((l) => l.qty > 0).map((l) => gl(l.medicineId, l.gstRate, l.qty + l.freeQty, num(l.taxablePaise), num(l.taxPaise), i.igst));
    if (!i.igst) {
      const c = lines.reduce((a, l) => a + l.cgst, 0), diff = num(i.cgstPaise) - c;
      if (diff && lines.length) { lines[0].cgst += diff; lines[0].sgst -= diff; }
    }
    docs.push({ kind: "inv", no: i.no, date: istDate(i.at), value: num(i.totalPaise), pos: i.placeOfSupply ?? "", ctin: i.customerGstin, inter: i.igst, branchId: i.branchId, lines });
  }
  for (const r of rets) {
    const o = origs.find((x) => x.id === r.invoiceId)!;
    const lines = r.lines.map((rl) => { const ol = o.lines.find((x) => x.id === rl.invoiceLineId)!; return gl(ol.medicineId, ol.gstRate, rl.qty, num(rl.taxablePaise), num(rl.taxPaise), o.igst); });
    docs.push({ kind: "cn", no: r.no, date: istDate(r.at), value: num(r.totalPaise), pos: o.placeOfSupply ?? "", ctin: o.customerGstin, inter: o.igst, branchId: r.branchId, lines,
      orig: { no: o.no, date: istDate(o.at), value: num(o.totalPaise), inter: o.igst, ctin: o.customerGstin } });
  }
  return { docs, cancelled };
}

async function reg(ctx: Ctx, gstin: string) {
  const r = (await registrations(ctx)).list.find((x) => x.gstin === gstin);
  if (!r) throw new UserError("None of your godowns bills under that GSTIN.");
  return r;
}

export async function distGstr1(ctx: Ctx, gstin: string, month?: string) {
  distView(ctx, "reports");
  const r = await reg(ctx, gstin), p = monthPeriod(month);
  const { docs, cancelled } = await distGstDocs(ctx.tenantId, r.branches.map((b) => b.id), p);
  return { json: buildGstr1({ gstin, fp: fpOf(p.month), docs, cancelled }), docs, cancelled, period: p, hsn: hsnRows(docs) };
}

export async function distGstr3b(ctx: Ctx, gstin: string, month?: string) {
  distView(ctx, "reports");
  const r = await reg(ctx, gstin), p = monthPeriod(month);
  const ids = r.branches.map((b) => b.id);
  const [{ docs }, itc] = await Promise.all([distGstDocs(ctx.tenantId, ids, p), itcFor(ctx.tenantId, ids, p)]);
  return { json: buildGstr3b({ gstin, fp: fpOf(p.month), docs, itc }), itc, period: p };
}

export { registrations as distRegistrations };
