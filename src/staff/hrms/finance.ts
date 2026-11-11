import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { todayISO } from "@/lib/dates";
import { audit, loadSettings, need, type Me } from "./auth";
import { ALL_REGISTERS, GST_RATES, REGISTERS, registerOf, type Register } from "./constants";

// Medoro's own books, kept as simple registers. Each HrRecord row is one line of a register: `v` holds its columns
// in order, `on` its date, and an invoice also carries the full document so it can be printed again.
const HR = "_hrms";
export type InvoiceDoc = {
  no: string; date: string; due: string; client: string; gstin: string; address: string; state: string; notes: string;
  items: { desc: string; hsn: string; qty: number; rate: number; gst: number }[];
  taxable: number; tax: number; total: number; intra: boolean;
};
type Data = { v: string[]; on: string; doc?: InvoiceDoc };
const num = (s: string) => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };

export type Row = { id: string; v: string[]; on: string; hasDoc: boolean };
export async function rows(kind: string, take = 500): Promise<Row[]> {
  const list = await db.hrRecord.findMany({ where: { kind }, orderBy: { createdAt: "desc" }, take });
  return list.map((r) => { const d = r.data as unknown as Data; return { id: r.id, v: d.v, on: d.on, hasDoc: !!d.doc }; });
}
const stats = (reg: Register, list: Row[]) => {
  const out: [string, string][] = [[reg.label, String(list.length)]];
  if (reg.money !== undefined) {
    const sum = (f: (r: Row) => boolean) => list.filter(f).reduce((a, r) => a + num(r.v[reg.money!]), 0);
    out.push(["Total", "₹" + Math.round(sum(() => true)).toLocaleString("en-IN")]);
    const si = reg.cols.findIndex((c) => c === "Status");
    if (si >= 0) for (const st of reg.status.slice(0, 2)) out.push([st, "₹" + Math.round(sum((r) => r.v[si] === st)).toLocaleString("en-IN")]);
  }
  return out;
};

/** The registers of one accounts screen, with their rows and totals. */
export async function registers(me: Me, screen: string) {
  need(me, "finance");
  const regs = REGISTERS[screen] ?? [];
  return Promise.all(regs.map(async (reg) => { const list = await rows(reg.id); return { reg, rows: list, stats: stats(reg, list) }; }));
}

/** The first column is numbered for you when the register has a prefix and it is left blank. */
export async function addRecord(me: Me, kind: string, values: string[]) {
  need(me, "finance");
  const reg = registerOf(kind);
  if (!reg) throw new UserError("Unknown register.");
  if (kind === "invoices") throw new UserError("Create invoices with the invoice form.");
  const v = reg.cols.map((_, i) => String(values[i] ?? "").trim().slice(0, 200));
  if (reg.prefix && !v[0]) v[0] = await number(reg.prefix);
  if (!v[reg.prefix ? 1 : 0]) throw new UserError(`Enter the ${reg.cols[reg.prefix ? 1 : 0].toLowerCase()}.`);
  if (reg.money !== undefined) { const n = num(v[reg.money]); if (n < 0) throw new UserError("Amounts can’t be negative."); v[reg.money] = String(Math.round(n * 100) / 100); }
  const last = reg.cols.length - 1;
  if (reg.status.length && !reg.status.includes(v[last])) v[last] = reg.status[0];
  await db.hrRecord.create({ data: { kind, data: { v, on: todayISO() }, byId: me.id } });
  await audit(me, `${reg.label}: record added`, v.slice(0, 2).join(" · "));
}
const number = async (prefix: string) => `${prefix}-${String(await db.$transaction((tx) => nextSeq(tx, HR, prefix))).padStart(4, "0")}`;

export async function setRecordStatus(me: Me, id: string, status: string) {
  need(me, "finance");
  const r = await db.hrRecord.findUnique({ where: { id } });
  const reg = r && registerOf(r.kind);
  if (!r || !reg || !reg.status.includes(status)) throw new UserError("Record not found.");
  const d = r.data as unknown as Data;
  const v = [...d.v]; v[reg.cols.length - 1] = status;
  await db.hrRecord.update({ where: { id }, data: { data: { ...d, v } } });
  await audit(me, `${reg.label}: status changed`, `${v[0]} · ${status}`);
}
export async function deleteRecord(me: Me, id: string) {
  need(me, "finance");
  const r = await db.hrRecord.findUnique({ where: { id } });
  if (!r) throw new UserError("Record not found.");
  const d = r.data as unknown as Data;
  if (d.doc && d.v[3] !== "Draft") throw new UserError("An invoice that was sent can’t be deleted. Raise a credit note instead.");
  await db.hrRecord.delete({ where: { id } });
  await audit(me, `${registerOf(r.kind)?.label ?? r.kind}: record deleted`, d.v.slice(0, 2).join(" · "));
}

// ── GST invoice
const invoiceSchema = z.object({
  client: z.string().trim().min(2, "Enter the client’s name.").max(120), gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "The client’s GSTIN looks wrong."),
  address: z.string().trim().max(300).default(""), state: z.string().trim().max(40).default(""), due: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).default(""), notes: z.string().trim().max(400).default(""),
  draft: z.boolean().default(false),
  items: z.array(z.object({
    desc: z.string().trim().min(1, "Describe each item.").max(200), hsn: z.string().trim().max(10).default(""), qty: z.coerce.number().positive("Quantity must be more than 0.").max(100000),
    rate: z.coerce.number().min(0).max(100_000_000), gst: z.coerce.number().refine((g) => (GST_RATES as readonly number[]).includes(g), "Choose a GST rate."),
  })).min(1, "Add at least one item.").max(50),
});
export async function createInvoice(me: Me, raw: z.input<typeof invoiceSchema>) {
  need(me, "finance");
  const i = invoiceSchema.parse(raw);
  const s = await loadSettings();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const taxable = r2(i.items.reduce((a, it) => a + it.qty * it.rate, 0)), tax = r2(i.items.reduce((a, it) => a + (it.qty * it.rate * it.gst) / 100, 0));
  // Same state: CGST + SGST. Another state: IGST. Without both states known it is treated as the same state.
  const intra = !i.state || !s.company.state || i.state.toLowerCase() === s.company.state.toLowerCase();
  const no = await number("INV");
  const doc: InvoiceDoc = { no, date: todayISO(), due: i.due, client: i.client, gstin: i.gstin, address: i.address, state: i.state, notes: i.notes, items: i.items, taxable, tax, total: Math.round(taxable + tax), intra };
  const rec = await db.hrRecord.create({ data: { kind: "invoices", data: { v: [no, i.client, String(doc.total), i.draft ? "Draft" : "Sent"], on: doc.date, doc }, byId: me.id } });
  await audit(me, "Invoice created", `${no} · ${i.client} · ₹${doc.total}`);
  return { id: rec.id, no };
}
export async function invoice(me: Me, id: string) {
  need(me, "finance");
  const r = await db.hrRecord.findUnique({ where: { id } });
  const d = r?.data as unknown as Data | undefined;
  if (!r || r.kind !== "invoices" || !d?.doc) throw new UserError("Invoice not found.");
  return { doc: d.doc, status: d.v[3], company: (await loadSettings()).company };
}

// ── Dashboard and statements, all worked out from the registers and payroll
export async function summary(me: Me) {
  need(me, "finance");
  const ym = todayISO().slice(0, 7);
  const [all, slips, claimsOpen, claimsMonth] = await Promise.all([
    db.hrRecord.findMany({ where: { kind: { in: ALL_REGISTERS.map((r) => r.id) } } }),
    db.hrPayslip.findMany({ select: { month: true, net: true, gross: true, tds: true, pf: true, esi: true, pt: true, reimburse: true } }),
    db.hrClaim.count({ where: { status: { in: ["pending_hr", "pending_admin"] } } }),
    db.hrClaim.findMany({ where: { status: "approved", decidedAt: { gte: new Date(`${ym}-01T00:00:00+05:30`) } }, select: { amount: true } }),
  ]);
  const of = (kind: string) => all.filter((r) => r.kind === kind).map((r) => r.data as unknown as Data);
  const inv = of("invoices"), bills = of("expenses"), receipts = of("receipts"), bank = of("bank");
  const total = (list: Data[], col: number, f: (d: Data) => boolean = () => true) => list.filter(f).reduce((a, d) => a + num(d.v[col]), 0);
  const invoiced = total(inv, 2, (d) => d.v[3] !== "Draft"), paid = total(inv, 2, (d) => d.v[3] === "Paid");
  const months = [...new Set([...inv, ...bills].map((d) => d.on.slice(0, 7)).concat(slips.map((p) => p.month)))].sort().slice(-6);
  const gst = months.map((m) => {
    const out = inv.filter((d) => d.on.startsWith(m) && d.v[3] !== "Draft").reduce((a, d) => a + (d.doc?.tax ?? 0), 0);
    const inp = total(bills, 3, (d) => d.on.startsWith(m));
    return { month: m, output: Math.round(out), input: Math.round(inp), payable: Math.round(out - inp) };
  });
  const payrollAll = slips.reduce((a, p) => a + p.gross, 0), expenses = total(bills, 2);
  return {
    payrollMonth: slips.filter((p) => p.month === ym).reduce((a, p) => a + p.net, 0), payslipsMonth: slips.filter((p) => p.month === ym).length,
    claimsMonth: claimsMonth.reduce((a, c) => a + c.amount, 0), claimsOpen,
    invoiced, received: paid + total(receipts, 2), receivable: invoiced - paid, overdue: total(inv, 2, (d) => d.v[3] === "Overdue"),
    expenses, payable: total(bills, 2, (d) => d.v[4] === "Due"), bank: total(bank, 2),
    spend: [["Salaries", payrollAll], ["Bills & expenses", expenses], ["Reimbursements", slips.reduce((a, p) => a + p.reimburse, 0)]] as [string, number][],
    statutory: { tds: slips.reduce((a, p) => a + p.tds, 0), pf: slips.reduce((a, p) => a + p.pf, 0), esi: slips.reduce((a, p) => a + p.esi, 0), pt: slips.reduce((a, p) => a + p.pt, 0) },
    pnl: { income: Math.round(inv.filter((d) => d.v[3] !== "Draft").reduce((a, d) => a + (d.doc?.taxable ?? num(d.v[2])), 0)), expenses: Math.round(expenses), payroll: payrollAll },
    gst, ageing: inv.filter((d) => d.v[3] === "Sent" || d.v[3] === "Overdue").map((d) => ({ no: d.v[0], client: d.v[1], amount: num(d.v[2]), on: d.on, status: d.v[3] })),
  };
}
