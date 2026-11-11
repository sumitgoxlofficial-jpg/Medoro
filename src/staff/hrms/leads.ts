import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import type { Staff } from "../auth";
import { LEAD_SOURCES, LOST_REASONS, MOBILE_RE, PRODUCTS, STAGES, digits, product } from "../constants";
import * as console_ from "../sales";
import { audit, can, need, notify, type Me } from "./auth";
import { speaks, stateOf, langOf, langLabel } from "./states";
import { incentives } from "./pay";

// The HRMS sales screens work on the staff console's Lead table, so a pharmacy won here is the same sale and
// commission as one won in the console pipeline. A lead HR hasn't given to anyone has an empty staffId.
const CP = "_cp";
const PLANS = PRODUCTS.filter((p) => !("addon" in p) && !("once" in p));
const PLAN_IDS = PLANS.map((p) => p.id) as [string, ...string[]];
const asStaff = (me: Me): Staff => ({ id: me.id, empNo: me.empNo, name: me.name, email: me.email, role: me.staffRole, referralCode: null, sessionId: me.sessionId });

type LeadRow = { id: string; code: string; name: string; owner: string; phone: string; city: string; source: string; product: string; stage: string; nextOn: Date | null; staffId: string; lostReason: string | null; state?: string };
const out = (l: LeadRow, names?: Map<string, string>) => {
  const p = product(l.product), today = todayISO(), next = l.nextOn ? isoOf(l.nextOn) : null;
  return {
    id: l.id, code: l.code, name: l.name, owner: l.owner, phone: l.phone, city: l.city, state: l.state ?? "", source: l.source, plan: p.name, planPrice: p.m, stage: l.stage, next,
    follow: !next || l.stage === "won" || l.stage === "lost" ? "" : next < today ? "Overdue" : next === today ? "Today" : next === addDays(today, 1) ? "Tomorrow" : `In ${Math.round((dateOnly(next).getTime() - dateOnly(today).getTime()) / 86400_000)} days`,
    due: !!next && next <= today && l.stage !== "won" && l.stage !== "lost", staffId: l.staffId, assignee: l.staffId ? names?.get(l.staffId) ?? "" : "", lostReason: l.lostReason ?? "",
  };
};
export type LeadOut = ReturnType<typeof out>;

export async function myLeads(me: Me) {
  const rows = await db.lead.findMany({ where: { staffId: me.id }, orderBy: [{ nextOn: "asc" }, { createdAt: "desc" }] });
  return rows.map((l) => out(l));
}

async function mine(me: Me, id: string) {
  const l = await db.lead.findUnique({ where: { id } });
  if (!l || (l.staffId !== me.id && !can(me, "leads"))) throw new UserError("Lead not found.");
  return l;
}
/** Moves a lead to any stage. Winning it logs the sale (and commission) exactly as the console pipeline does. */
export async function setStage(me: Me, id: string, stage: string, lostReason = "") {
  const st = z.enum(STAGES.map((s) => s.id) as [string, ...string[]]).parse(stage);
  const l = await mine(me, id);
  if (l.stage === st) return;
  if (l.stage === "won") throw new UserError("A won pharmacy stays won: its sale is already logged.");
  if (st === "won") {
    if (!l.staffId) throw new UserError("Assign this lead to a salesperson first.");
    if (l.staffId !== me.id && me.role !== "admin") throw new UserError("Only the salesperson who owns this lead marks it won.");
    if (me.staffRole !== "sales" && me.staffRole !== "super_admin") throw new UserError("Only sales employees can log a won pharmacy.");
    if (l.discountStatus === "pending") throw new UserError("Waiting for the super admin to approve the discount.");
    if (l.stage !== "trial") await db.lead.update({ where: { id }, data: { stage: "trial", lostReason: null } });
    await console_.moveLead(asStaff(me), id, "forward");
    return;
  }
  if (st === "lost") {
    const reason = z.enum(LOST_REASONS, { message: "Choose why it was lost." }).parse(lostReason);
    await db.lead.update({ where: { id }, data: { stage: "lost", nextOn: null, lostReason: reason } });
    await audit(me, "Lead lost", `${l.code} · ${reason}`);
    return;
  }
  const gap = st === "new" ? 1 : st === "contacted" ? 2 : 3;
  await db.lead.update({ where: { id }, data: { stage: st, lostReason: null, nextOn: dateOnly(addDays(todayISO(), gap)) } });
}
export async function setFollowUp(me: Me, id: string, day: string) {
  const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").parse(day);
  const l = await mine(me, id);
  if (l.stage === "won" || l.stage === "lost") throw new UserError("Closed leads have no follow-up.");
  await db.lead.update({ where: { id }, data: { nextOn: dateOnly(d) } });
}
export async function logCall(me: Me, id: string, note: string) {
  const l = await mine(me, id);
  const next = addDays(todayISO(), 2);
  await db.$transaction([
    db.leadLog.create({ data: { leadId: l.id, staffId: me.id, text: `${String(note).trim().slice(0, 200) || "Call logged"} · ${todayISO()} by ${me.first}` } }),
    ...(l.stage === "won" || l.stage === "lost" ? [] : [db.lead.update({ where: { id }, data: { nextOn: dateOnly(next), ...(l.stage === "new" ? { stage: "contacted" } : {}) } })]),
  ]);
}

/** The salesperson's month: won against target, pipeline, follow-ups due and incentive earned. */
export async function salesSummary(me: Me) {
  const ym = todayISO().slice(0, 7);
  const inc = await incentives(ym); // worked out once and shared with the leaderboard
  const [leads, profile, team] = await Promise.all([myLeads(me), db.hrProfile.findUnique({ where: { staffId: me.id } }), teamBoard(inc)]);
  const mineInc = inc.get(me.id) ?? { won: 0, value: 0, incentive: 0 };
  return {
    leads, target: profile?.monthlyTarget ?? 40, wonMonth: mineInc.won, value: mineInc.value, incentive: mineInc.incentive, pct: Number(profile?.incentivePct ?? 0),
    mrr: leads.filter((l) => l.stage === "won").reduce((a, l) => a + l.planPrice, 0), team,
  };
}
/** Leaderboard for the month: every salesperson's wins against target. */
export async function teamBoard(known?: Awaited<ReturnType<typeof incentives>>) {
  const ym = todayISO().slice(0, 7);
  const [people, inc, counts] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", status: "active", hr: { role: "sales" } }, select: { id: true, name: true, empNo: true, hr: { select: { monthlyTarget: true, incentivePct: true, location: true, homeState: true } } }, orderBy: { name: "asc" } }),
    known ?? incentives(ym),
    db.lead.groupBy({ by: ["staffId", "stage"], _count: true }),
  ]);
  return people.map((u) => {
    const mineCounts = counts.filter((c) => c.staffId === u.id);
    const total = mineCounts.reduce((a, c) => a + c._count, 0);
    const open = mineCounts.filter((c) => c.stage !== "won" && c.stage !== "lost").reduce((a, c) => a + c._count, 0);
    const i = inc.get(u.id) ?? { won: 0, value: 0, incentive: 0 };
    return { id: u.id, name: u.name, empNo: u.empNo, area: u.hr?.location ?? "", home: u.hr?.homeState ?? "", target: u.hr?.monthlyTarget ?? 40, pct: Number(u.hr?.incentivePct ?? 0), won: i.won, incentive: i.incentive, assigned: total, open };
  }).sort((a, b) => b.won - a.won || a.name.localeCompare(b.name));
}

// ── HR: add, upload and hand out leads
const leadSchema = z.object({
  name: z.string().trim().min(3, "Enter the pharmacy name.").max(120), owner: z.string().trim().max(80).default(""),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile."), city: z.string().trim().max(60).default(""),
  plan: z.enum(PLAN_IDS).default("starter"), source: z.string().trim().max(40).default("Field visit"), staffId: z.string().default(""), state: z.string().trim().max(40).default(""),
});
const planOf = (v: string) => { const t = v.trim().toLowerCase(); return PLANS.find((p) => p.id === t || p.name.toLowerCase() === t)?.id ?? (t.startsWith("pro") ? "pro" : t.startsWith("multi") ? "multi" : "starter"); };
const sourceOf = (v: string) => LEAD_SOURCES.find((s) => s.toLowerCase() === v.trim().toLowerCase()) ?? "Field visit";

async function insertLead(i: z.output<typeof leadSchema>) {
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "LEAD"));
  return db.lead.create({ data: { code: `L-${n}`, name: i.name, owner: i.owner || "—", phone: i.phone, city: i.city || "—", source: sourceOf(i.source), product: i.plan, stage: "new", nextOn: i.staffId ? dateOnly(addDays(todayISO(), 1)) : null, staffId: i.staffId, state: stateOf(i.state, i.city) } });
}
export async function addLead(me: Me, raw: z.input<typeof leadSchema>) {
  need(me, "leads");
  const i = leadSchema.parse(raw);
  if (await db.lead.findUnique({ where: { phone: i.phone } })) throw new UserError("This number is already a lead.");
  if (i.staffId) await salesperson(i.staffId);
  const l = await insertLead(i);
  if (i.staffId) await notify([i.staffId], `New lead from HR: ${i.name}`, "slleads");
  await audit(me, "Lead added", `${l.code} · ${i.name}`);
  return l.code;
}
const salesperson = async (id: string) => {
  const u = await db.staffUser.findFirst({ where: { id, kind: "team", status: "active", hr: { role: "sales" } }, select: { id: true, name: true } });
  if (!u) throw new UserError("Choose an active sales employee.");
  return u;
};

/** Minimal CSV reader: quoted fields, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const HEAD = {
  name: ["store", "pharmacy", "name", "pharmacy name", "store name", "shop", "shop name", "medical store", "firm name"],
  owner: ["owner", "owner name", "contact person", "proprietor"], phone: ["phone", "mobile", "mobile number", "phone number", "contact", "contact number", "whatsapp", "whatsapp number"],
  city: ["city", "town", "location", "area"], state: ["state", "lead state", "province"], plan: ["plan", "product", "interested in"], source: ["source", "lead source"],
  assigned: ["assigned to", "assignee", "salesperson", "sales person", "employee", "emp id", "employee id", "assigned"],
};
export const MAX_NEW_PER_RUN = 1500; // one run stays well inside the host's time limit; the rest is picked up by the next run

/**
 * Adds leads from CSV text with columns store, owner, phone, city, plan, source (and, optionally, "assigned to" with an
 * employee ID or name). Already-known phone numbers are skipped, so running it again on the same sheet adds only what is new.
 */
export async function importText(text: string, opts: { maxChars?: number; limit?: number } = {}) {
  if (text.length > (opts.maxChars ?? 2_000_000)) throw new UserError("That file is too large. Upload at most about 10,000 leads at a time.");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new UserError("The sheet has no leads. It needs a header row and at least one lead.");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const ix = { name: col(HEAD.name), owner: col(HEAD.owner), phone: col(HEAD.phone), city: col(HEAD.city), state: col(HEAD.state), plan: col(HEAD.plan), source: col(HEAD.source), assigned: col(HEAD.assigned) };
  if (ix.name < 0 || ix.phone < 0) throw new UserError("The first row must name the columns: store, owner, phone, city, plan, source.");
  const [have, sales] = await Promise.all([
    db.lead.findMany({ select: { phone: true } }),
    db.staffUser.findMany({ where: { kind: "team", status: "active", hr: { role: "sales" } }, select: { id: true, name: true, empNo: true } }),
  ]);
  const known = new Set(have.map((l) => l.phone)), limit = opts.limit ?? Infinity;
  const who = (v: string) => { const t = v.trim().toLowerCase(); return t ? sales.find((u) => u.empNo.toLowerCase() === t || u.name.toLowerCase() === t)?.id ?? "" : ""; };
  let added = 0, assigned = 0, more = false; const skipped: string[] = []; const got = new Map<string, number>();
  for (const [n, r] of rows.slice(1).entries()) {
    const get = (i: number) => (i >= 0 ? r[i] ?? "" : "").trim();
    const staffId = who(get(ix.assigned));
    const p = leadSchema.safeParse({ name: get(ix.name), owner: get(ix.owner), phone: get(ix.phone), city: get(ix.city), state: get(ix.state), plan: planOf(get(ix.plan)), source: get(ix.source) || "Field visit", staffId });
    if (!p.success) { skipped.push(`Row ${n + 2}: ${p.error.issues[0]?.message ?? "invalid"}`); continue; }
    if (known.has(p.data.phone)) { skipped.push(`Row ${n + 2}: ${p.data.phone} is already a lead`); continue; }
    if (added >= limit) { more = true; break; }
    known.add(p.data.phone);
    await insertLead(p.data);
    added++;
    if (staffId) { assigned++; got.set(staffId, (got.get(staffId) ?? 0) + 1); }
  }
  for (const [id, c] of got) await notify([id], `${c} new lead${c > 1 ? "s" : ""} from HR.`, "slleads");
  return { added, assigned, more, skipped: skipped.slice(0, 20), skippedCount: skipped.length };
}
/** CSV with columns store, owner, phone, city, plan, source. Uploaded leads arrive unassigned unless the file names who gets them. */
export async function importLeads(me: Me, text: string) {
  need(me, "leads");
  const r = await importText(text);
  await audit(me, "Leads uploaded", `${r.added} added · ${r.skippedCount} skipped`);
  return r;
}
export async function assignLead(me: Me, id: string, staffId: string) {
  need(me, "leads");
  const l = await db.lead.findUnique({ where: { id } });
  if (!l) throw new UserError("Lead not found.");
  if (l.stage === "won") throw new UserError("A won pharmacy stays with the salesperson who won it.");
  if (staffId) await salesperson(staffId);
  await db.lead.update({ where: { id }, data: { staffId, nextOn: staffId && !l.nextOn && l.stage !== "lost" ? dateOnly(addDays(todayISO(), 1)) : l.nextOn } });
  if (staffId && staffId !== me.id) await notify([staffId], `New lead from HR: ${l.name}`, "slleads");
}
/**
 * Gives every unassigned lead to a salesperson who can talk to it in their own language (a salesperson from Bihar gets leads from
 * Hindi-speaking states only), choosing the one with the fewest open leads. A lead whose state is unknown, or a salesperson with
 * no home state, is not restricted. A lead nobody can take stays unassigned and is counted in `unmatched`.
 */
export async function assignWaiting(): Promise<{ given: number; unmatched: number; unmatchedLang: string[] }> {
  const team = await teamBoard();
  if (!team.length) return { given: 0, unmatched: 0, unmatchedLang: [] };
  const waiting = await db.lead.findMany({ where: { staffId: "" }, orderBy: { createdAt: "asc" } });
  const load = new Map(team.map((t) => [t.id, t.open]));
  const home = new Map(team.map((t) => [t.id, t.home]));
  const got = new Map<string, number>(), langs = new Set<string>();
  let given = 0, unmatched = 0;
  for (const l of waiting) {
    const state = stateOf(l.state, l.city);
    const eligible = [...load.entries()].filter(([id]) => speaks(home.get(id) ?? "", state)).sort((a, b) => a[1] - b[1]);
    if (!eligible.length) { unmatched++; const g = langOf(state); if (g) langs.add(langLabel(g)); continue; }
    const [id] = eligible[0];
    await db.lead.update({ where: { id: l.id }, data: { staffId: id, ...(l.state ? {} : state ? { state } : {}), nextOn: l.stage === "lost" ? null : dateOnly(addDays(todayISO(), 1)) } });
    load.set(id, load.get(id)! + 1); got.set(id, (got.get(id) ?? 0) + 1); given++;
  }
  for (const [id, n] of got) await notify([id], `${n} new lead${n > 1 ? "s" : ""} from HR.`, "slleads");
  return { given, unmatched, unmatchedLang: [...langs] };
}
export async function autoAssign(me: Me) {
  need(me, "leads");
  if (!(await teamBoard()).length) throw new UserError("There are no active sales employees to assign to.");
  const r = await assignWaiting();
  await audit(me, "Leads auto-assigned", `${r.given} given · ${r.unmatched} waiting for a matching language`);
  return r;
}
export async function setSalesTerms(me: Me, staffId: string, raw: { target: number; pct: number }) {
  need(me, "leads");
  const i = z.object({ target: z.coerce.number().int().min(0).max(1000), pct: z.coerce.number().min(0).max(5, "Sales incentive can’t be more than 5%.") }).parse(raw);
  await salesperson(staffId);
  await db.hrProfile.update({ where: { staffId }, data: { monthlyTarget: i.target, incentivePct: i.pct } });
  await audit(me, "Sales target and incentive set", `${staffId} · ${i.target} · ${i.pct}%`);
}
export async function allLeads(me: Me) {
  need(me, "leads");
  const [rows, names] = await Promise.all([
    db.lead.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
    db.staffUser.findMany({ where: { kind: "team" }, select: { id: true, name: true } }),
  ]);
  const nm = new Map(names.map((u) => [u.id, u.name]));
  return rows.map((l) => out(l, nm));
}
export const LEAD_PLANS = PLANS.map((p) => ({ id: p.id as string, name: p.name as string, m: p.m as number }));
