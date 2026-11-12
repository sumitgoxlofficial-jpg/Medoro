import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { product } from "../constants";
import { audit, can, loadSettings, need, notify, type Me } from "./auth";
import { monthLabel, type Settings } from "./constants";
import { postSalaryJournal } from "./finance";
import { openBankAccount } from "./people";
import { AFTER_LEAVING, BEFORE_JOINING, addMonths, closeExits, holidays, leaveBalances, monthFor, weekend } from "./time";

const ymRe = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month.");

/**
 * Income tax for a year under the new regime (FY 2025-26 slabs): ₹75,000 standard deduction, no tax up to
 * ₹12,00,000 of taxable income (section 87A rebate, with marginal relief just above it), 4% cess. An estimate for
 * monthly TDS; a CA should confirm it for people with other income or the old regime.
 */
export function annualTax(grossYear: number): number {
  const taxable = Math.max(0, grossYear - 75_000);
  if (taxable <= 1_200_000) return 0;
  const slabs: [number, number][] = [[400_000, 0], [800_000, 0.05], [1_200_000, 0.1], [1_600_000, 0.15], [2_000_000, 0.2], [2_400_000, 0.25], [Infinity, 0.3]];
  let tax = 0, prev = 0;
  for (const [upto, rate] of slabs) { if (taxable > prev) tax += (Math.min(taxable, upto) - prev) * rate; prev = upto; }
  tax = Math.min(tax, taxable - 1_200_000);
  return Math.round(tax * 1.04);
}

export type Slip = { workDays: number; lopDays: number; basic: number; hra: number; special: number; incentive: number; reimburse: number; encash: number; gratuity: number; gross: number; pf: number; esi: number; pt: number; tds: number; lop: number; net: number };

/** One month's salary from the annual CTC. Basic is half, HRA 40% of basic, the rest is special allowance. */
export function computeSlip(ctc: number, o: { workDays: number; lopDays: number; incentive: number; reimburse: number; ptax: number; encash?: number; gratuity?: number }): Slip {
  const monthly = Math.round(ctc / 12);
  const lopDays = Math.min(Math.max(0, o.lopDays), o.workDays);
  const basic = Math.round(monthly * 0.5), hra = Math.round(basic * 0.4), special = monthly - basic - hra;
  const lop = o.workDays ? Math.round((monthly * lopDays) / o.workDays) : 0;
  const encash = o.encash ?? 0, gratuity = o.gratuity ?? 0;
  const gross = monthly - lop + o.incentive + encash;
  const paidShare = monthly ? (monthly - lop) / monthly : 0;
  const pf = Math.round(Math.min(basic * paidShare, 15_000) * 0.12);
  const esi = monthly <= 21_000 ? Math.ceil(gross * 0.0075) : 0;
  const pt = gross >= 12_000 ? o.ptax : 0;
  const tds = Math.round((annualTax(ctc) / 12) * paidShare);
  return { workDays: o.workDays, lopDays, basic, hra, special, incentive: o.incentive, reimburse: o.reimburse, encash, gratuity, gross, pf, esi, pt, tds, lop, net: Math.max(0, gross - pf - esi - pt - tds) + o.reimburse + gratuity };
}

/**
 * Full and final settlement for someone whose last working day is `exit`. Unused privilege leave is paid at a day's
 * basic (monthly basic ÷ 26). Gratuity is due after five years (4 years 240 days counts): 15 days' basic for each year
 * of service, a part-year of six months or more counting as a year. An estimate: a CA should confirm it.
 */
export function finalSettlement(ctc: number, joinDate: string, exit: string, leaveLeft: number) {
  const basic = Math.round(Math.round(ctc / 12) * 0.5);
  const days = Math.max(0, Math.round((dateOnly(exit).getTime() - dateOnly(joinDate).getTime()) / 86_400_000) + 1);
  const years = days / 365.25, full = Math.floor(years);
  const eligible = full >= 5 || (full === 4 && days - Math.round(4 * 365.25) >= 240);
  const counted = years - full >= 0.5 ? full + 1 : full;
  return { encashDays: leaveLeft, encash: Math.round((basic / 26) * leaveLeft), gratuity: eligible ? Math.round((basic * 15 * counted) / 26) : 0 };
}

/** Incentive for a month: the salesperson's rate on the annual plan value of the pharmacies they won in it. */
export async function incentives(ym: string) {
  const from = new Date(`${ym}-01T00:00:00+05:30`);
  const to = new Date(`${addMonths(ym, 1)}-01T00:00:00+05:30`);
  const [wins, rateRows] = await Promise.all([
    db.leadLog.findMany({ where: { text: { startsWith: "Won" }, at: { gte: from, lt: to } }, include: { lead: { select: { staffId: true, product: true, stage: true } } }, relationLoadStrategy: "join" }),
    db.hrProfile.findMany({ where: { role: "sales" }, select: { staffId: true, incentivePct: true } }),
  ]);
  const rates = new Map(rateRows.map((p) => [p.staffId, Number(p.incentivePct)]));
  const out = new Map<string, { won: number; value: number; incentive: number }>();
  const seen = new Set<string>();
  for (const w of wins) {
    if (w.lead.stage !== "won" || seen.has(w.leadId)) continue;
    seen.add(w.leadId);
    const value = product(w.lead.product).m * 12;
    const cur = out.get(w.lead.staffId) ?? { won: 0, value: 0, incentive: 0 };
    cur.won++; cur.value += value; cur.incentive += Math.round((value * (rates.get(w.lead.staffId) ?? 0)) / 100);
    out.set(w.lead.staffId, cur);
  }
  return out;
}

type Line = Slip & { staffId: string; name: string; empNo: string; dept: string; status: "draft" | "paid"; paidOn: string | null; hasBank: boolean; final: string | null };

/** The month's payroll: saved payslips where it has been processed, a live draft for everyone else. */
export async function payrollFor(me: Me, ymRaw: string): Promise<{ ym: string; label: string; lines: Line[]; processed: boolean; canProcess: boolean; note: string }> {
  need(me, "payroll");
  const ym = ymRe.parse(ymRaw), s = await loadSettings();
  await closeExits(true);
  const first = `${ym}-01`, last = isoOf(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)));
  const [staff, saved, inc, claims] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", role: { not: "partner" } }, include: { hr: true }, orderBy: { name: "asc" } }),
    db.hrPayslip.findMany({ where: { month: ym } }),
    incentives(ym),
    db.hrClaim.findMany({ where: { status: "approved", paidMonth: null } }),
  ]);
  const lines: Line[] = [];
  for (const u of staff) {
    const have = saved.find((p) => p.staffId === u.id);
    const exitDay = u.hr?.exitDate ? isoOf(u.hr.exitDate) : null;
    const base = { staffId: u.id, name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", hasBank: !!u.hr?.bankLast4, final: exitDay && exitDay.slice(0, 7) === ym ? exitDay : null };
    if (have) { lines.push({ ...base, ...slipOf(have), status: "paid", paidOn: have.paidOn ? isoOf(have.paidOn) : null }); continue; }
    if (!u.hr || u.hr.ctc <= 0) continue;
    // Someone who left is paid up to their last working day, in the month they left.
    const exit = u.hr.exitDate ? isoOf(u.hr.exitDate) : null;
    if (u.status !== "active" && !(u.status === "deactivated" && exit && exit >= first)) continue;
    if (exit && exit < first) continue;
    // The month someone leaves carries their full and final settlement.
    const fnf = base.final && u.hr.joinDate ? finalSettlement(u.hr.ctc, isoOf(u.hr.joinDate), base.final, (await leaveBalances(u.id, s, base.final.slice(0, 4))).find((b) => b.id === "privilege")?.left ?? 0) : null;
    if (u.hr.joinDate && isoOf(u.hr.joinDate) > last) continue;
    const m = await monthFor(u.id, ym, s);
    const workDays = m.cells.filter((c) => c.kind !== "weekend" && c.kind !== "holiday").length;
    // Working days before joining or after the last working day are not paid.
    const before = m.cells.filter((c) => c.kind === "before" && (c.label === BEFORE_JOINING || c.label === AFTER_LEAVING)).length;
    const reimburse = claims.filter((c) => c.staffId === u.id).reduce((a, c) => a + c.amount, 0);
    lines.push({ ...base, ...computeSlip(u.hr.ctc, { workDays, lopDays: m.counts.absent + m.counts.unpaid + before, incentive: inc.get(u.id)?.incentive ?? 0, reimburse, ptax: s.ptax, encash: fnf?.encash, gratuity: fnf?.gratuity }), status: "draft", paidOn: null });
  }
  const drafts = lines.filter((l) => l.status === "draft").length;
  const future = ym > todayISO().slice(0, 7);
  // A month is processed once and can't be redone, so it opens on its last working day: by then every absence is known.
  const hol = new Set((await holidays(first, last)).map((h) => h.day));
  let opens = last;
  while (opens > first && (weekend(opens, s.weekOff) || hol.has(opens))) opens = isoOf(new Date(dateOnly(opens).getTime() - 86_400_000));
  const early = !future && todayISO() < opens;
  return {
    ym, label: monthLabel(ym), lines, processed: !drafts && lines.length > 0, canProcess: drafts > 0 && !future && !early,
    note: future ? "This month hasn’t started." : !lines.length ? "No one has a salary (annual CTC) set yet. Set it on the employee’s profile."
      : early && drafts ? `This is a preview. ${monthLabel(ym)} can be processed from ${opens}, its last working day, so that every absence is counted.` : "",
  };
}
const slipOf = (p: { workDays: number; lopDays: number; basic: number; hra: number; special: number; incentive: number; reimburse: number; encash: number; gratuity: number; gross: number; pf: number; esi: number; pt: number; tds: number; lop: number; net: number }): Slip =>
  ({ workDays: p.workDays, lopDays: p.lopDays, basic: p.basic, hra: p.hra, special: p.special, incentive: p.incentive, reimburse: p.reimburse, encash: p.encash, gratuity: p.gratuity, gross: p.gross, pf: p.pf, esi: p.esi, pt: p.pt, tds: p.tds, lop: p.lop, net: p.net });

/** Saves a payslip for everyone in the draft and marks their approved claims paid. `lop` overrides loss-of-pay days per person. */
export async function processPayroll(me: Me, ymRaw: string, lop: Record<string, number> = {}) {
  const run = await payrollFor(me, ymRaw);
  if (!run.canProcess) throw new UserError(run.note || "This month is already processed.");
  const s = await loadSettings();
  const drafts = run.lines.filter((l) => l.status === "draft");
  const ctc = new Map((await db.hrProfile.findMany({ where: { staffId: { in: drafts.map((d) => d.staffId) } }, select: { staffId: true, ctc: true } })).map((p) => [p.staffId, p.ctc]));
  const paidOn = dateOnly(todayISO());
  let n = 0, total = 0;
  await db.$transaction(async (tx) => {
    for (const d of drafts) {
      const over = lop[d.staffId];
      const slip = over === undefined ? d : computeSlip(ctc.get(d.staffId) ?? 0, { workDays: d.workDays, lopDays: z.number().min(0).max(31).multipleOf(0.5, "Loss-of-pay days are whole or half days.").parse(over), incentive: d.incentive, reimburse: d.reimburse, ptax: s.ptax, encash: d.encash, gratuity: d.gratuity });
      await tx.hrPayslip.create({ data: { staffId: d.staffId, month: run.ym, ...slipOf(slip), status: "paid", paidOn, runBy: me.id } });
      await tx.hrClaim.updateMany({ where: { staffId: d.staffId, status: "approved", paidMonth: null }, data: { paidMonth: run.ym } });
      n++; total += slip.net;
    }
  });
  await notify(drafts.map((d) => d.staffId), `Your ${run.label} payslip is ready.`, "payslips");
  await audit(me, "Payroll processed", `${run.label} · ${n} payslip${n === 1 ? "" : "s"}`);
  // The "Post the salary journal" workflow adds the month's journal entry (when switched on).
  await postSalaryJournal(me.id, run.label, total).catch((e) => log.error("salary journal failed", { err: e }));
  return n;
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => { const v = String(c); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? "'" + v : v; }).join(",")).join("\n");

/** Bank transfer file for a processed month: account numbers are opened for this download only, and it is audited. */
export async function bankFile(me: Me, ymRaw: string) {
  need(me, "payroll");
  const ym = ymRe.parse(ymRaw);
  const slips = await db.hrPayslip.findMany({ where: { month: ym } });
  if (!slips.length) throw new UserError("Process this month’s payroll first.");
  const staff = await db.staffUser.findMany({ where: { id: { in: slips.map((p) => p.staffId) } }, include: { hr: true } });
  const rows = slips.map((p) => { const u = staff.find((x) => x.id === p.staffId); return [u?.empNo ?? "", u?.hr?.bankHolder || u?.name || "", openBankAccount(u?.hr?.bankAccountSealed ?? null), u?.hr?.bankIfsc ?? "", p.net, `Salary ${monthLabel(ym)}`]; });
  await audit(me, "Bank transfer file downloaded", monthLabel(ym));
  return { name: `medoro-salary-${ym}.csv`, text: csv([["Employee ID", "Beneficiary", "Account number", "IFSC", "Amount", "Narration"], ...rows]) };
}
export async function payrollReport(me: Me, ymRaw: string) {
  const run = await payrollFor(me, ymRaw);
  const head = ["Employee ID", "Name", "Department", "Paid days", "LOP days", "Basic", "HRA", "Special", "Incentive", "Leave encashment", "Gross", "PF", "ESI", "Prof. tax", "TDS", "Reimbursement", "Gratuity", "Net pay", "Status", "Last working day"];
  return { name: `medoro-payroll-${run.ym}.csv`, text: csv([head, ...run.lines.map((l) => [l.empNo, l.name, l.dept, l.workDays - l.lopDays, l.lopDays, l.basic, l.hra, l.special, l.incentive, l.encash, l.gross, l.pf, l.esi, l.pt, l.tds, l.reimburse, l.gratuity, l.net, l.status, l.final ?? ""])]) };
}

// ── Payslips
export async function myPayslips(staffId: string) {
  const rows = await db.hrPayslip.findMany({ where: { staffId }, orderBy: { month: "desc" } });
  return rows.map((p) => ({ id: p.id, month: p.month, label: monthLabel(p.month), net: p.net, gross: p.gross, tds: p.tds, paidOn: p.paidOn ? isoOf(p.paidOn) : null }));
}
/** A payslip with what the printed page needs. Its owner can open it, and so can anyone with Payroll. */
export async function payslip(me: Me, id: string) {
  const p = await db.hrPayslip.findUnique({ where: { id } });
  if (!p || (p.staffId !== me.id && !can(me, "payroll"))) throw new UserError("Payslip not found.");
  const [u, s] = await Promise.all([db.staffUser.findUniqueOrThrow({ where: { id: p.staffId }, include: { hr: true } }), loadSettings()]);
  return {
    id: p.id, month: p.month, label: monthLabel(p.month), paidOn: p.paidOn ? isoOf(p.paidOn) : null, ...slipOf(p),
    emp: { name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", designation: u.hr?.designation ?? "", joinDate: u.hr?.joinDate ? isoOf(u.hr.joinDate) : "", pan: u.hr?.panMasked ?? "", uan: u.hr?.uan ?? "", bank: u.hr?.bankLast4 ? `${u.hr.bankName} ••••${u.hr.bankLast4}` : "" },
    lastDay: u.hr?.exitDate && isoOf(u.hr.exitDate).slice(0, 7) === p.month ? isoOf(u.hr.exitDate) : null,
    company: (s as Settings).company,
  };
}
