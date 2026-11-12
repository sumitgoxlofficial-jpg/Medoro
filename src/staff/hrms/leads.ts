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
import { speaks, stateName, stateOf, langOf, langLabel } from "./states";
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
  name: ["store", "pharmacy", "name", "pharmacy name", "store name", "shop", "shop name", "medical store", "firm name", "medical shop", "chemist"],
  owner: ["owner", "owner name", "contact person", "proprietor"], phone: ["phone", "mobile", "mobile number", "phone number", "contact", "contact number", "whatsapp", "whatsapp number", "mobile no", "phone no"],
  city: ["city", "town"], locality: ["locality / area", "locality", "area", "location"], address: ["full address", "address"], state: ["state", "lead state", "province"],
  plan: ["plan", "product", "interested in"], source: ["source", "lead source"],
  assigned: ["assigned to", "assignee", "salesperson", "sales person", "employee", "emp id", "employee id", "assigned"],
};
export const MAX_NEW_PER_RUN = 5000; // one run stays well inside the host's time limit; the rest is picked up by the next run

const cleanCity = (v: string) => v.replace(/\d{5,6}/g, "").replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
/** "…, Kankarbagh, Patna, Bihar 800020" → { city: "Patna", state: "Bihar" } */
function fromAddress(address: string): { city: string; state: string } {
  const parts = address.split(",").map((x) => x.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const st = stateName(cleanCity(parts[i]));
    if (st) return { state: st, city: i > 0 ? cleanCity(parts[i - 1]) : "" };
  }
  return { state: "", city: "" };
}
/** The header row of a tab: the first of its top rows that has a shop-name column and a phone column (titles and totals above it are ignored). */
function findHeader(rows: string[][]) {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const head = rows[r].map((h) => h.trim().toLowerCase());
    const col = (names: string[]) => head.findIndex((h) => names.includes(h));
    const ix = { name: col(HEAD.name), owner: col(HEAD.owner), phone: col(HEAD.phone), city: col(HEAD.city), locality: col(HEAD.locality), address: col(HEAD.address), state: col(HEAD.state), plan: col(HEAD.plan), source: col(HEAD.source), assigned: col(HEAD.assigned) };
    if (ix.name >= 0 && ix.phone >= 0) return { row: r, ix };
  }
  return null;
}
/** Reserves `n` lead numbers at once (one query instead of one per lead). Returns the first. */
async function reserveCodes(n: number): Promise<number> {
  const rows = await db.$queryRaw<{ first: number }[]>`
    INSERT INTO "Sequence" ("tenantId", "key", "next") VALUES (${CP}, 'LEAD', ${n + 1})
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "next" = "Sequence"."next" + ${n}
    RETURNING "next" - ${n} AS first`;
  return Number(rows[0].first);
}

/**
 * Adds leads from the tabs of a workbook (or one CSV). Each tab needs a header row with a shop-name and a phone column; rows above it
 * (titles, totals) are ignored, and a tab named after a state gives its leads that state. Optional columns: owner, city, state, plan,
 * source, full address (the town and state are read from it), and "assigned to" (employee ID or name). Phone numbers already known are
 * skipped, so syncing the same sheet again adds only what is new.
 */
export async function importTabs(tabs: { name: string; rows: string[][] }[], opts: { limit?: number } = {}) {
  const [have, sales] = await Promise.all([
    db.lead.findMany({ select: { phone: true } }),
    db.staffUser.findMany({ where: { kind: "team", status: "active", hr: { role: "sales" } }, select: { id: true, name: true, empNo: true } }),
  ]);
  const known = new Set(have.map((l) => l.phone)), limit = opts.limit ?? Infinity;
  const who = (v: string) => { const t = v.trim().toLowerCase(); return t ? sales.find((u) => u.empNo.toLowerCase() === t || u.name.toLowerCase() === t)?.id ?? "" : ""; };
  const fresh: z.output<typeof leadSchema>[] = []; const skipped: string[] = []; let skippedCount = 0, more = false, tabsRead = 0;
  for (const tab of tabs) {
    const h = findHeader(tab.rows);
    if (!h) continue;
    tabsRead++;
    const { ix } = h, tabState = stateName(tab.name);
    for (let r = h.row + 1; r < tab.rows.length && !more; r++) {
      const row = tab.rows[r], get = (i: number) => (i >= 0 ? row[i] ?? "" : "").trim();
      if (!row.some((c) => c.trim())) continue;
      const addr = fromAddress(get(ix.address));
      const p = leadSchema.safeParse({
        name: get(ix.name), owner: get(ix.owner), phone: get(ix.phone), city: get(ix.city) || addr.city || get(ix.locality), state: get(ix.state) || addr.state || tabState,
        plan: planOf(get(ix.plan)), source: get(ix.source) || "Field visit", staffId: who(get(ix.assigned)),
      });
      const where = `${tab.name ? `${tab.name} · ` : ""}row ${r + 1}`;
      if (!p.success) { skippedCount++; if (skipped.length < 20) skipped.push(`${where}: ${p.error.issues[0]?.message ?? "invalid"}`); continue; }
      if (known.has(p.data.phone)) { skippedCount++; if (skipped.length < 20) skipped.push(`${where}: ${p.data.phone} is already a lead`); continue; }
      if (fresh.length >= limit) { more = true; break; }
      known.add(p.data.phone);
      fresh.push(p.data);
    }
  }
  if (!tabsRead) throw new UserError("Couldn’t find the columns. Each tab needs a header row with a shop name (store, pharmacy…) and a phone (mobile…) column.");
  let added = 0, assigned = 0;
  if (fresh.length) {
    const first = await reserveCodes(fresh.length), tomorrow = dateOnly(addDays(todayISO(), 1));
    const rows = fresh.map((i, k) => ({ code: `L-${first + k}`, name: i.name, owner: i.owner || "—", phone: i.phone, city: i.city || "—", source: sourceOf(i.source), product: i.plan, stage: "new", nextOn: i.staffId ? tomorrow : null, staffId: i.staffId, state: stateOf(i.state, i.city) }));
    for (let k = 0; k < rows.length; k += 1000) added += (await db.lead.createMany({ data: rows.slice(k, k + 1000), skipDuplicates: true })).count;
    const got = new Map<string, number>();
    for (const l of rows) if (l.staffId) { assigned++; got.set(l.staffId, (got.get(l.staffId) ?? 0) + 1); }
    for (const [id, c] of got) await notify([id], `${c} new lead${c > 1 ? "s" : ""} from HR.`, "slleads");
  }
  return { added, assigned, more, skipped, skippedCount };
}
/** CSV text with a header row (see importTabs). */
export async function importText(text: string, opts: { maxChars?: number; limit?: number } = {}) {
  if (text.length > (opts.maxChars ?? 2_000_000)) throw new UserError("That file is too large. Upload at most about 10,000 leads at a time.");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new UserError("The sheet has no leads. It needs a header row and at least one lead.");
  return importTabs([{ name: "", rows }], { limit: opts.limit });
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
  const langs = new Set<string>(), plan = new Map<string, { open: string[]; lost: string[] }>(), states: { id: string; state: string }[] = [];
  let given = 0, unmatched = 0;
  for (const l of waiting) {
    const state = stateOf(l.state, l.city);
    const eligible = [...load.entries()].filter(([id]) => speaks(home.get(id) ?? "", state)).sort((a, b) => a[1] - b[1]);
    if (!eligible.length) { unmatched++; const g = langOf(state); if (g) langs.add(langLabel(g)); continue; }
    const [id] = eligible[0];
    const p = plan.get(id) ?? { open: [], lost: [] };
    (l.stage === "lost" ? p.lost : p.open).push(l.id); plan.set(id, p);
    if (!l.state && state) states.push({ id: l.id, state });
    load.set(id, load.get(id)! + 1); given++;
  }
  // One update per salesperson (and one per state learned from the town), not one per lead.
  const tomorrow = dateOnly(addDays(todayISO(), 1));
  for (const [id, p] of plan) {
    if (p.open.length) await db.lead.updateMany({ where: { id: { in: p.open } }, data: { staffId: id, nextOn: tomorrow } });
    if (p.lost.length) await db.lead.updateMany({ where: { id: { in: p.lost } }, data: { staffId: id, nextOn: null } });
    await notify([id], `${p.open.length + p.lost.length} new lead${p.open.length + p.lost.length > 1 ? "s" : ""} from HR.`, "slleads");
  }
  for (const [state, ids] of Object.entries(states.reduce<Record<string, string[]>>((m, x) => ((m[x.state] ??= []).push(x.id), m), {}))) await db.lead.updateMany({ where: { id: { in: ids } }, data: { state } });
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
