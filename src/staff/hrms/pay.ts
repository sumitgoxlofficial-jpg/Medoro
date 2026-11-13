import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { product } from "../constants";
import { audit, can, loadSettings, need, notify, type Me } from "./auth";
import { monthLabel, type Settings } from "./constants";
import { postSalaryJournal } from "./finance";
import { openBankAccount } from "./people";
import { AFTER_LEAVING, BEFORE_JOINING, addMonths, closeExits, holidays, leaveBalances, rangeFor, weekend } from "./time";
import { cycleWindow, payOnWorkingDay } from "./cycles";
import { namesMatch } from "./digilocker";

const ymRe = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month.");

export type TaxRegime = "new" | "old";
/**
 * Income tax for a year (FY 2025-26 rules), for the monthly TDS estimate.
 * New regime: ₹75,000 standard deduction, no tax up to ₹12,00,000 of taxable income (section 87A rebate, with marginal
 * relief just above it). Old regime: ₹50,000 standard deduction and the deductions HR accepted (80C, 80D, HRA…), slabs of
 * 5% / 20% / 30% above ₹2,50,000 / ₹5,00,000 / ₹10,00,000, no tax up to ₹5,00,000 of taxable income. 4% cess on both.
 * A CA should confirm it for people with other income.
 */
export function annualTax(grossYear: number, regime: TaxRegime = "new", declared = 0): number {
  const run = (taxable: number, slabs: [number, number][]) => { let tax = 0, prev = 0; for (const [upto, rate] of slabs) { if (taxable > prev) tax += (Math.min(taxable, upto) - prev) * rate; prev = upto; } return tax; };
  if (regime === "old") {
    const taxable = Math.max(0, grossYear - 50_000 - Math.max(0, declared));
    if (taxable <= 500_000) return 0;
    return Math.round(run(taxable, [[250_000, 0], [500_000, 0.05], [1_000_000, 0.2], [Infinity, 0.3]]) * 1.04);
  }
  const taxable = Math.max(0, grossYear - 75_000);
  if (taxable <= 1_200_000) return 0;
  const tax = Math.min(run(taxable, [[400_000, 0], [800_000, 0.05], [1_200_000, 0.1], [1_600_000, 0.15], [2_000_000, 0.2], [2_400_000, 0.25], [Infinity, 0.3]]), taxable - 1_200_000);
  return Math.round(tax * 1.04);
}

export type Slip = { workDays: number; lopDays: number; basic: number; hra: number; special: number; incentive: number; reimburse: number; encash: number; gratuity: number; gross: number; pf: number; esi: number; pt: number; tds: number; lop: number; net: number };

/** One month's salary from the annual CTC. Basic is half, HRA 40% of basic, the rest is special allowance. */
export function computeSlip(ctc: number, o: { workDays: number; lopDays: number; incentive: number; reimburse: number; ptax: number; encash?: number; gratuity?: number; regime?: TaxRegime; declared?: number }): Slip {
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
  const tds = Math.round((annualTax(ctc, o.regime, o.declared) / 12) * paidShare);
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

/** Incentive for the days from `from` to `to` inclusive: the salesperson's rate on the annual plan value of the pharmacies they won in them. */
export async function incentivesBetween(from: string, to: string) {
  const fromAt = new Date(`${from}T00:00:00+05:30`);
  const toAt = new Date(`${addDays(to, 1)}T00:00:00+05:30`);
  const [wins, rateRows] = await Promise.all([
    db.leadLog.findMany({ where: { text: { startsWith: "Won" }, at: { gte: fromAt, lt: toAt } }, include: { lead: { select: { staffId: true, product: true, stage: true } } }, relationLoadStrategy: "join" }),
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
/** Incentive for a calendar month. */
export const incentives = (ym: string) => incentivesBetween(`${ym}-01`, addDays(`${addMonths(ym, 1)}-01`, -1));

/**
 * Can this person be paid into a bank account that is theirs? The account number and IFSC must be saved, and the holder's
 * name must be the employee's own (initials count) unless HR has confirmed the account (a joint account, a spelling).
 */
export function bankStatus(h: { bankLast4: string; bankIfsc: string; bankHolder: string; bankConfirmedAt: Date | null; bankAccountSealed: Uint8Array | null } | null | undefined, name: string) {
  if (!h?.bankLast4 || !h.bankIfsc || !h.bankAccountSealed) return { ok: false, issue: "No bank account saved." , fixable: false };
  if (!h.bankHolder.trim()) return { ok: false, issue: "The bank account has no holder name.", fixable: false };
  if (!namesMatch(h.bankHolder, name) && !h.bankConfirmedAt) return { ok: false, issue: `The account holder (${h.bankHolder}) isn’t this employee’s name.`, fixable: true };
  return { ok: true, issue: "", fixable: false };
}

type Line = Slip & {
  staffId: string; name: string; empNo: string; dept: string; status: "draft" | "paid"; paidOn: string | null; hasBank: boolean; final: string | null;
  /** The days this payslip pays for and the day it is due in the bank. */
  from: string; to: string; payDate: string; cycleDay: number;
  /** Ready to be processed now: the pay period is over and the salary has a bank account of their own to go to. */
  ready: boolean; opens: string; bankIssue: string; canConfirmBank: boolean;
};

/**
 * The payroll for a pay month: saved payslips where processed, a live draft for everyone else. Each person is on their own
 * pay period: a calendar month, or (a new joiner) a monthly cycle from their joining day, so the same pay month holds
 * different periods for different people. A payslip is processed once the last working day of its period has come, and only
 * for people whose salary has an account of their own to go to.
 */
export async function payrollFor(me: Me, ymRaw: string): Promise<{ ym: string; label: string; lines: Line[]; processed: boolean; canProcess: boolean; note: string }> {
  need(me, "payroll");
  const ym = ymRe.parse(ymRaw), s = await loadSettings();
  await closeExits(true);
  const today = todayISO();
  const [staff, saved, claims] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", role: { not: "partner" } }, include: { hr: true }, orderBy: { name: "asc" } }),
    db.hrPayslip.findMany({ where: { month: ym } }),
    db.hrClaim.findMany({ where: { status: "approved", paidMonth: null } }),
  ]);
  const incCache = new Map<string, Awaited<ReturnType<typeof incentivesBetween>>>();
  const holCache = new Map<string, Set<string>>();
  const holidaysIn = async (from: string, to: string) => { const k = from + "|" + to; if (!holCache.has(k)) holCache.set(k, new Set((await holidays(from, to)).map((h) => h.day))); return holCache.get(k)!; };
  /** The due date moved back to a working day: salary is not paid on a weekly off or a holiday. */
  const payOn = async (due: string) => { const hol = await holidaysIn(addDays(due, -14), due); return payOnWorkingDay(due, (d) => weekend(d, s.weekOff) || hol.has(d)); };
  const lines: Line[] = [];
  for (const u of staff) {
    const have = saved.find((p) => p.staffId === u.id);
    const cycleDay = u.hr?.payCycleDay ?? 0, win = cycleWindow(cycleDay, ym);
    const exitDay = u.hr?.exitDate ? isoOf(u.hr.exitDate) : null;
    const bank = bankStatus(u.hr, u.name);
    const base = { staffId: u.id, name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", hasBank: !!u.hr?.bankLast4, final: exitDay && exitDay >= win.from && exitDay <= win.to ? exitDay : null, cycleDay, bankIssue: bank.issue, canConfirmBank: bank.fixable };
    if (have) {
      const from = have.periodFrom ? isoOf(have.periodFrom) : win.from, to = have.periodTo ? isoOf(have.periodTo) : win.to;
      lines.push({ ...base, ...slipOf(have), status: "paid", paidOn: have.paidOn ? isoOf(have.paidOn) : null, from, to, payDate: have.payDate ? isoOf(have.payDate) : await payOn(win.payDate), ready: false, opens: "", bankIssue: "", canConfirmBank: false });
      continue;
    }
    if (!u.hr || u.hr.ctc <= 0) continue;
    // Someone who left is paid up to their last working day, in the period it falls in.
    const exit = u.hr.exitDate ? isoOf(u.hr.exitDate) : null;
    if (u.status !== "active" && !(u.status === "deactivated" && exit && exit >= win.from)) continue;
    if (exit && exit < win.from) continue;
    if (u.hr.joinDate && isoOf(u.hr.joinDate) > win.to) continue;
    // The period someone leaves in carries their full and final settlement.
    const fnf = base.final && u.hr.joinDate ? finalSettlement(u.hr.ctc, isoOf(u.hr.joinDate), base.final, (await leaveBalances(u.id, s, base.final.slice(0, 4))).find((b) => b.id === "privilege")?.left ?? 0) : null;
    const m = await rangeFor(u.id, win.from, win.to, s);
    const workDays = m.cells.filter((c) => c.kind !== "weekend" && c.kind !== "holiday").length;
    // Working days before joining or after the last working day are not paid.
    const before = m.cells.filter((c) => c.kind === "before" && (c.label === BEFORE_JOINING || c.label === AFTER_LEAVING)).length;
    const reimburse = claims.filter((c) => c.staffId === u.id).reduce((a, c) => a + c.amount, 0);
    const ik = win.from + "|" + win.to;
    if (!incCache.has(ik)) incCache.set(ik, await incentivesBetween(win.from, win.to));
    // A period is processed once and can't be redone, so it opens on its last working day (or the day they leave): by then every absence is known.
    const end = base.final ?? win.to, hol = await holidaysIn(win.from, end);
    let opens = end;
    while (opens > win.from && (weekend(opens, s.weekOff) || hol.has(opens))) opens = addDays(opens, -1);
    lines.push({ ...base, ...computeSlip(u.hr.ctc, { workDays, lopDays: m.counts.absent + m.counts.unpaid + before, incentive: incCache.get(ik)!.get(u.id)?.incentive ?? 0, reimburse, ptax: s.ptax, encash: fnf?.encash, gratuity: fnf?.gratuity, ...taxOf(u.hr) }),
      status: "draft", paidOn: null, from: win.from, to: win.to, payDate: await payOn(win.payDate), ready: today >= opens && bank.ok, opens });
  }
  const drafts = lines.filter((l) => l.status === "draft");
  const ready = drafts.filter((l) => l.ready), stillOpen = drafts.filter((l) => today < l.opens);
  const earliest = stillOpen.map((l) => l.opens).sort()[0];
  const blocked = drafts.filter((l) => today >= l.opens && l.bankIssue);
  let note = "";
  if (!lines.length) note = "No one has a salary (annual CTC) set yet. Set it on the employee’s profile.";
  else if (!ready.length && drafts.length) note = [
    earliest ? `This is a preview. ${monthLabel(ym)} can be processed from ${earliest}, the last working day of the pay period, so that every absence is counted.` : "",
    blocked.length ? `Fix the bank account shown against ${blocked.length === 1 ? "this person" : "these people"} before they can be paid.` : "",
  ].filter(Boolean).join(" ");
  else if (blocked.length) note = `${blocked.length} ${blocked.length === 1 ? "person is" : "people are"} left out until their bank account is fixed (shown in the list).`;
  return { ym, label: monthLabel(ym), lines, processed: !drafts.length && lines.length > 0, canProcess: ready.length > 0, note };
}
const taxOf = (h: { taxRegime: string; taxDeclared: number } | null | undefined) => ({ regime: (h?.taxRegime === "old" ? "old" : "new") as TaxRegime, declared: h?.taxDeclared ?? 0 });
/** What the company pays on top of a payslip: its own PF share (equal to the employee's) and ESI at 3.25% of gross. */
export const employerCost = (p: { pf: number; esi: number; gross: number }) => ({ pf: p.pf, esi: p.esi ? Math.ceil(p.gross * 0.0325) : 0 });
const slipOf = (p: { workDays: number; lopDays: number; basic: number; hra: number; special: number; incentive: number; reimburse: number; encash: number; gratuity: number; gross: number; pf: number; esi: number; pt: number; tds: number; lop: number; net: number }): Slip =>
  ({ workDays: p.workDays, lopDays: p.lopDays, basic: p.basic, hra: p.hra, special: p.special, incentive: p.incentive, reimburse: p.reimburse, encash: p.encash, gratuity: p.gratuity, gross: p.gross, pf: p.pf, esi: p.esi, pt: p.pt, tds: p.tds, lop: p.lop, net: p.net });

/** Saves a payslip for everyone in the run who is ready and marks their approved claims paid. `lop` overrides loss-of-pay days per person. */
export async function processPayroll(me: Me, ymRaw: string, lop: Record<string, number> = {}) {
  const run = await payrollFor(me, ymRaw);
  if (!run.canProcess) throw new UserError(run.note || "This month is already processed.");
  const s = await loadSettings();
  const drafts = run.lines.filter((l) => l.status === "draft" && l.ready); // the rest wait for their period to end or their bank account to be fixed
  const prof = new Map((await db.hrProfile.findMany({ where: { staffId: { in: drafts.map((d) => d.staffId) } }, select: { staffId: true, ctc: true, taxRegime: true, taxDeclared: true } })).map((p) => [p.staffId, p]));
  const paidOn = dateOnly(todayISO());
  let n = 0, total = 0;
  await db.$transaction(async (tx) => {
    for (const d of drafts) {
      const over = lop[d.staffId];
      const slip = over === undefined ? d : computeSlip(prof.get(d.staffId)?.ctc ?? 0, { ...taxOf(prof.get(d.staffId)), workDays: d.workDays, lopDays: z.number().min(0).max(31).multipleOf(0.5, "Loss-of-pay days are whole or half days.").parse(over), incentive: d.incentive, reimburse: d.reimburse, ptax: s.ptax, encash: d.encash, gratuity: d.gratuity });
      await tx.hrPayslip.create({ data: { staffId: d.staffId, month: run.ym, ...slipOf(slip), periodFrom: dateOnly(d.from), periodTo: dateOnly(d.to), payDate: dateOnly(d.payDate), status: "paid", paidOn, runBy: me.id } });
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
/** "13 Nov to 12 Dec 2026" for a pay period, or the month when the payslip is from before pay periods were recorded. */
export const periodText = (from: Date | string | null, to: Date | string | null, ym: string) => {
  if (!from || !to) return monthLabel(ym);
  const f = typeof from === "string" ? from : isoOf(from), t = typeof to === "string" ? to : isoOf(to);
  const d = (x: string) => new Date(x + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${d(f)} to ${d(t)} ${t.slice(0, 4)}`;
};
export async function bankFile(me: Me, ymRaw: string) {
  need(me, "payroll");
  const ym = ymRe.parse(ymRaw);
  const slips = await db.hrPayslip.findMany({ where: { month: ym } });
  if (!slips.length) throw new UserError("Process this month’s payroll first.");
  const staff = await db.staffUser.findMany({ where: { id: { in: slips.map((p) => p.staffId) } }, include: { hr: true } });
  const rows = slips.map((p) => { const u = staff.find((x) => x.id === p.staffId); return [u?.empNo ?? "", u?.hr?.bankHolder || u?.name || "", openBankAccount(u?.hr?.bankAccountSealed ?? null), u?.hr?.bankIfsc ?? "", p.net, `Salary ${periodText(p.periodFrom, p.periodTo, ym)}`, p.payDate ? isoOf(p.payDate) : ""]; });
  await audit(me, "Bank transfer file downloaded", monthLabel(ym));
  // Every payslip here was processed only for an account of the employee's own (see bankStatus), and each is due on its own pay date.
  return { name: `medoro-salary-${ym}.csv`, text: csv([["Employee ID", "Beneficiary", "Account number", "IFSC", "Amount", "Narration", "Pay on"], ...rows]) };
}
export async function payrollReport(me: Me, ymRaw: string) {
  const run = await payrollFor(me, ymRaw);
  const head = ["Employee ID", "Name", "Department", "Paid days", "LOP days", "Basic", "HRA", "Special", "Incentive", "Leave encashment", "Gross", "PF", "ESI", "Prof. tax", "TDS", "Reimbursement", "Gratuity", "Net pay", "Status", "Last working day", "Employer PF", "Employer ESI", "Pay period from", "Pay period to", "Pay date"];
  return { name: `medoro-payroll-${run.ym}.csv`, text: csv([head, ...run.lines.map((l) => [l.empNo, l.name, l.dept, l.workDays - l.lopDays, l.lopDays, l.basic, l.hra, l.special, l.incentive, l.encash, l.gross, l.pf, l.esi, l.pt, l.tds, l.reimburse, l.gratuity, l.net, l.status, l.final ?? "", employerCost(l).pf, employerCost(l).esi, l.from, l.to, l.payDate])]) };
}

/**
 * PF return for a processed month, in the EPFO ECR text layout (fields joined by #~#): UAN, name, gross wages, EPF, EPS
 * and EDLI wages, employee EPF (12%), EPS (8.33% of EPS wages), the employer's EPF share (the difference), NCP days,
 * refund of advances. People without a UAN are listed in `missing` and left out: EPFO rejects a line without one.
 */
export async function pfReturn(me: Me, ymRaw: string) {
  need(me, "payroll");
  const ym = ymRe.parse(ymRaw);
  const slips = await db.hrPayslip.findMany({ where: { month: ym, pf: { gt: 0 } } });
  if (!slips.length) throw new UserError("Process this month’s payroll first.");
  const staff = await db.staffUser.findMany({ where: { id: { in: slips.map((p) => p.staffId) } }, include: { hr: true } });
  const missing: string[] = [], lines: string[] = [];
  for (const p of slips) {
    const u = staff.find((x) => x.id === p.staffId);
    if (!u?.hr?.uan) { missing.push(u?.name ?? p.staffId); continue; }
    const wage = Math.round(p.pf / 0.12), eps = Math.round(Math.min(wage, 15_000) * 0.0833);
    lines.push([u.hr.uan, u.name.toUpperCase().replace(/[^A-Z ]/g, ""), p.gross, wage, Math.min(wage, 15_000), Math.min(wage, 15_000), p.pf, eps, p.pf - eps, Math.ceil(p.lopDays), 0].join("#~#"));
  }
  await audit(me, "PF return downloaded", monthLabel(ym));
  return { name: `medoro-pf-ecr-${ym}.txt`, text: lines.join("\n"), missing };
}
/** ESI contributions for a processed month: one row per insured person, with both shares. */
export async function esiReturn(me: Me, ymRaw: string) {
  need(me, "payroll");
  const ym = ymRe.parse(ymRaw);
  const slips = await db.hrPayslip.findMany({ where: { month: ym, esi: { gt: 0 } } });
  if (!(await db.hrPayslip.count({ where: { month: ym } }))) throw new UserError("Process this month’s payroll first.");
  const staff = await db.staffUser.findMany({ where: { id: { in: slips.map((p) => p.staffId) } }, include: { hr: true } });
  const rows = slips.map((p) => { const u = staff.find((x) => x.id === p.staffId); return [u?.hr?.esiNo ?? "", u?.empNo ?? "", u?.name ?? "", p.workDays - p.lopDays, p.gross, p.esi, employerCost(p).esi]; });
  await audit(me, "ESI return downloaded", monthLabel(ym));
  return { name: `medoro-esi-${ym}.csv`, text: csv([["ESI number", "Employee ID", "Name", "Paid days", "Wages", "Employee share (0.75%)", "Employer share (3.25%)"], ...rows]), missing: [] as string[] };
}
/** A financial year's salary and tax (April to March) for one person: what a CA needs for Form 16. Own, or with Payroll. */
export async function taxStatement(me: Me, staffId: string, fyStart: number) {
  if (staffId !== me.id) need(me, "payroll");
  const y = z.number().int().min(2020).max(2100).parse(fyStart);
  const slips = await db.hrPayslip.findMany({ where: { staffId, month: { gte: `${y}-04`, lte: `${y + 1}-03` } }, orderBy: { month: "asc" } });
  if (!slips.length) throw new UserError(`No payslips in FY ${y}-${String(y + 1).slice(2)}.`);
  const u = await db.staffUser.findUniqueOrThrow({ where: { id: staffId }, include: { hr: true } });
  const sum = (k: "gross" | "pf" | "esi" | "pt" | "tds" | "net" | "reimburse" | "gratuity") => slips.reduce((a, p) => a + p[k], 0);
  const rows: (string | number)[][] = [
    ["Employee", u.name], ["Employee ID", u.empNo], ["PAN", u.hr?.panMasked ?? ""], ["Financial year", `${y}-${String(y + 1).slice(2)}`], ["Tax regime", u.hr?.taxRegime === "old" ? "Old" : "New"], [],
    ["Month", "Gross", "PF", "ESI", "Professional tax", "TDS", "Reimbursement", "Gratuity", "Net pay"],
    ...slips.map((p) => [monthLabel(p.month), p.gross, p.pf, p.esi, p.pt, p.tds, p.reimburse, p.gratuity, p.net]),
    ["Total", sum("gross"), sum("pf"), sum("esi"), sum("pt"), sum("tds"), sum("reimburse"), sum("gratuity"), sum("net")],
  ];
  return { name: `medoro-tax-statement-${u.empNo}-FY${y}.csv`, text: csv(rows), missing: [] as string[] };
}

// ── Payslips
export async function myPayslips(staffId: string) {
  const rows = await db.hrPayslip.findMany({ where: { staffId }, orderBy: { month: "desc" } });
  return rows.map((p) => ({ id: p.id, month: p.month, label: monthLabel(p.month), net: p.net, gross: p.gross, tds: p.tds, paidOn: p.paidOn ? isoOf(p.paidOn) : null, period: periodText(p.periodFrom, p.periodTo, p.month), payDate: p.payDate ? isoOf(p.payDate) : null }));
}
/** A payslip with what the printed page needs. Its owner can open it, and so can anyone with Payroll. */
export async function payslip(me: Me, id: string) {
  const p = await db.hrPayslip.findUnique({ where: { id } });
  if (!p || (p.staffId !== me.id && !can(me, "payroll"))) throw new UserError("Payslip not found.");
  const [u, s] = await Promise.all([db.staffUser.findUniqueOrThrow({ where: { id: p.staffId }, include: { hr: true } }), loadSettings()]);
  return {
    id: p.id, month: p.month, label: monthLabel(p.month), paidOn: p.paidOn ? isoOf(p.paidOn) : null, ...slipOf(p),
    emp: { name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", designation: u.hr?.designation ?? "", joinDate: u.hr?.joinDate ? isoOf(u.hr.joinDate) : "", pan: u.hr?.panMasked ?? "", uan: u.hr?.uan ?? "", bank: u.hr?.bankLast4 ? `${u.hr.bankName} ••••${u.hr.bankLast4}` : "" },
    employer: employerCost(p), regime: u.hr?.taxRegime === "old" ? "old" : "new",
    period: periodText(p.periodFrom, p.periodTo, p.month), payDate: p.payDate ? isoOf(p.payDate) : null,
    lastDay: u.hr?.exitDate && (p.periodFrom && p.periodTo ? isoOf(u.hr.exitDate) >= isoOf(p.periodFrom) && isoOf(u.hr.exitDate) <= isoOf(p.periodTo) : isoOf(u.hr.exitDate).slice(0, 7) === p.month) ? isoOf(u.hr.exitDate) : null,
    company: (s as Settings).company,
  };
}
