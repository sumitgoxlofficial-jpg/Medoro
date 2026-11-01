import "server-only";
import { db } from "@/server/db";
import { unseal } from "@/server/vault";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { allow, staffAudit, type Staff } from "./auth";
import { TDS_PCT, rupees } from "./constants";

// ── Reference partners: the admin view, the leaderboard, and paying commission through RazorpayX.

/** Start dates (IST) of today, this week (from Monday) and this month. */
export function periodStarts(today = todayISO()) {
  const dow = (dateOnly(today).getUTCDay() + 6) % 7; // Monday = 0
  return { today, week: addDays(today, -dow), month: today.slice(0, 7) + "-01" };
}
export type Period = keyof ReturnType<typeof periodStarts>;

/** "Ravi Kulkarni" → "Ravi K." so partners see who leads without full names of others. */
export const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.pop();
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

type Board = { staffId: string; name: string; area: string; sales: number; signups: number; earnedPaise: number }[];

/**
 * Top reference partners for today, this week and this month: paying pharmacies (sales) first, then sign-ups.
 * Earnings are included; the partner dashboard leaves them out for everyone but the viewer.
 */
export async function leaderboard(today = todayISO(), limit = 10): Promise<Record<Period, Board>> {
  const starts = periodStarts(today);
  const partners = await db.staffUser.findMany({ where: { role: "partner", status: "active" }, select: { id: true, name: true, team: true } });
  const out = {} as Record<Period, Board>;
  if (!partners.length) return { today: [], week: [], month: [] };
  const ids = partners.map((p) => p.id);
  const [sales, signups] = await Promise.all([
    db.cpSale.findMany({ where: { staffId: { in: ids }, status: { not: "rejected" }, date: { gte: dateOnly(starts.month < starts.week ? starts.month : starts.week) } }, select: { staffId: true, date: true, commissionPaise: true } }),
    db.$queryRaw<{ staffId: string; at: string }[]>`
      SELECT settings->'referral'->>'staffId' AS "staffId", settings->'referral'->>'at' AS "at" FROM "Tenant"
      WHERE settings->'referral'->>'staffId' = ANY(${ids}) AND settings->'referral'->>'at' >= ${new Date(dateOnly(starts.month < starts.week ? starts.month : starts.week).getTime() - 5.5 * 3600_000).toISOString()}`,
  ]);
  const istDay = (iso: string) => todayISO(new Date(iso));
  for (const period of ["today", "week", "month"] as const) {
    const from = starts[period];
    const rows = new Map(partners.map((p) => [p.id, { staffId: p.id, name: p.name, area: p.team, sales: 0, signups: 0, earnedPaise: 0 }]));
    for (const s of sales) if (isoOf(s.date) >= from) { const r = rows.get(s.staffId)!; r.sales++; r.earnedPaise += s.commissionPaise; }
    for (const t of signups) if (t.at && istDay(t.at) >= from) { const r = rows.get(t.staffId); if (r) r.signups++; }
    out[period] = [...rows.values()]
      .filter((r) => r.sales || r.signups)
      .sort((a, b) => b.sales - a.sales || b.signups - a.signups || b.earnedPaise - a.earnedPaise || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
  return out;
}

/** The leaderboard as a partner sees it: short names, no one else's earnings, and their own rank. */
export async function partnerLeaderboard(s: Staff) {
  const b = await leaderboard(todayISO(), 1000);
  const view = (rows: Board) => {
    const rank = rows.findIndex((r) => r.staffId === s.id);
    return {
      top: rows.slice(0, 10).map((r, i) => ({ rank: i + 1, me: r.staffId === s.id, name: r.staffId === s.id ? "You" : shortName(r.name), area: r.area, sales: r.sales, signups: r.signups })),
      myRank: rank >= 0 ? rank + 1 : null,
    };
  };
  return { today: view(b.today), week: view(b.week), month: view(b.month) };
}

/** Every reference partner with what they've brought in and what Medoro owes them. Super admin only. */
export async function partnerOverview(s: Staff) {
  allow(s, "super_admin");
  const month = todayISO().slice(0, 7);
  const [partners, sales, banks, tenants] = await Promise.all([
    db.staffUser.findMany({ where: { role: "partner" }, orderBy: { createdAt: "desc" } }),
    db.cpSale.findMany({ where: { status: { not: "rejected" } }, select: { staffId: true, date: true, status: true, commissionPaise: true } }),
    db.staffBank.findMany(),
    db.$queryRaw<{ staffId: string; status: string | null }[]>`
      SELECT t.settings->'referral'->>'staffId' AS "staffId", m.status FROM "Tenant" t LEFT JOIN "SubscriptionMeta" m ON m."tenantId" = t.id
      WHERE t.settings->'referral'->>'staffId' IS NOT NULL`,
  ]);
  const rows = partners.map((p) => {
    const mine = sales.filter((x) => x.staffId === p.id);
    const sum = (f: (x: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((a, x) => a + x.commissionPaise, 0);
    const refs = tenants.filter((t) => t.staffId === p.id);
    const bank = banks.find((b) => b.staffId === p.id);
    const ready = sum((x) => x.status === "verified");
    return {
      id: p.id, empNo: p.empNo, name: p.name, email: p.email, phone: p.phone, area: p.team, status: p.status, code: p.referralCode, google: !!p.googleSub,
      joined: isoOf(p.createdAt), signups: refs.length, paying: refs.filter((t) => t.status === "active").length,
      monthPaise: sum((x) => isoOf(x.date).startsWith(month)), totalPaise: sum(() => true), readyPaise: ready,
      readyNetPaise: ready - Math.round((ready * TDS_PCT) / 100), processingPaise: sum((x) => x.status === "processing"), paidPaise: sum((x) => x.status === "paid"),
      bank: bank ? { label: `${bank.bank.split(" ")[0]} •••• ${bank.last4}`, holder: bank.holder, ifsc: bank.ifsc, verified: bank.status === "verified" } : null,
    };
  });
  return rows;
}

export async function payoutHistory(s: Staff, staffId?: string) {
  if (s.role !== "super_admin") staffId = s.id;
  const [rows, staff] = await Promise.all([
    db.staffPayout.findMany({ where: staffId ? { staffId } : {}, orderBy: { createdAt: "desc" }, take: 100 }),
    db.staffUser.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, ref: r.ref, staff: name.get(r.staffId) ?? "", staffId: r.staffId, gross: r.grossPaise, tds: r.tdsPaise, net: r.netPaise, n: r.saleIds.length, method: r.method, status: r.status, utr: r.utr, failure: r.failure, at: r.createdAt.toISOString() }));
}

// ── RazorpayX payouts

type Env = Record<string, string | undefined>;
export function razorpayX(env: Env = process.env) {
  const keyId = env.RAZORPAYX_KEY_ID || env.RAZORPAY_KEY_ID, secret = env.RAZORPAYX_KEY_SECRET || env.RAZORPAY_KEY_SECRET, account = env.RAZORPAYX_ACCOUNT_NUMBER;
  return keyId && secret && account ? { keyId, secret, account } : null;
}
export const razorpayXEnabled = () => !!razorpayX();

type RzpPayout = { id: string; status: string; utr?: string | null; failure_reason?: string | null; status_details?: { description?: string | null } | null };

async function rzpx<T>(path: string, body: unknown, idem?: string): Promise<T> {
  const c = razorpayX();
  if (!c) throw new UserError("RazorpayX payouts aren’t set up. Add RAZORPAYX_ACCOUNT_NUMBER, or record a bank transfer instead.");
  const r = await fetch("https://api.razorpay.com/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${c.keyId}:${c.secret}`).toString("base64"), "Content-Type": "application/json", ...(idem ? { "X-Payout-Idempotency": idem } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!r.ok) throw new UserError(`Razorpay: ${j.error?.description ?? `HTTP ${r.status}`}`);
  return j;
}

/** The RazorpayX fund account for a staff member's verified bank account, created once and kept. */
async function fundAccount(staffId: string) {
  const b = await db.staffBank.findUnique({ where: { staffId }, include: { staff: true } });
  if (!b || b.status !== "verified") throw new UserError("Verify this person’s bank account first.");
  if (b.rzpFundAccountId) return b.rzpFundAccountId;
  const contact = await rzpx<{ id: string }>("/contacts", { name: b.holder.slice(0, 50), email: b.staff.email, contact: b.staff.phone, type: "vendor", reference_id: b.staff.empNo });
  const account = unseal(Buffer.from(b.accountSealed, "base64")).toString();
  const fa = await rzpx<{ id: string }>("/fund_accounts", { contact_id: contact.id, account_type: "bank_account", bank_account: { name: b.holder.slice(0, 120), ifsc: b.ifsc, account_number: account } });
  await db.staffBank.update({ where: { staffId }, data: { rzpFundAccountId: fa.id } });
  return fa.id;
}

/** Locks this person's verified commission into a payout record. Returns null when there's nothing to pay. */
async function claim(s: Staff, staffId: string, method: "razorpay" | "manual") {
  return db.$transaction(async (tx) => {
    const u = await tx.staffUser.findUnique({ where: { id: staffId } });
    if (!u || (u.role !== "partner" && u.role !== "sales")) throw new UserError("Not a sales person or reference partner.");
    const ver = await tx.$queryRaw<{ id: string; commissionPaise: number }[]>`SELECT id, "commissionPaise" FROM "CpSale" WHERE "staffId" = ${staffId} AND status = 'verified' FOR UPDATE`;
    if (!ver.length) throw new UserError("Nothing ready to pay for this person.");
    const gross = ver.reduce((a, x) => a + x.commissionPaise, 0), tds = Math.round((gross * TDS_PCT) / 100);
    const n = await tx.staffPayout.count({ where: { staffId } });
    const ref = `MP${todayISO().slice(0, 7).replace("-", "")}${u.empNo.replace(/\W/g, "")}N${n + 1}`;
    const p = await tx.staffPayout.create({ data: { ref, staffId, grossPaise: gross, tdsPaise: tds, netPaise: gross - tds, saleIds: ver.map((x) => x.id), method, status: "processing", createdBy: s.name } });
    await tx.cpSale.updateMany({ where: { id: { in: p.saleIds } }, data: { status: "processing", payoutRef: ref } });
    return { p, u };
  });
}

/** Moves a payout and its sales to the result Razorpay (or the admin) reports. */
async function settlePayout(id: string, st: "paid" | "failed" | "processing", info: { utr?: string | null; failure?: string | null; rzpPayoutId?: string } = {}) {
  await db.$transaction(async (tx) => {
    const p = await tx.staffPayout.findUnique({ where: { id } });
    if (!p || p.status !== "processing") return;
    await tx.staffPayout.update({ where: { id }, data: { status: st, utr: info.utr ?? p.utr, failure: info.failure ?? null, ...(info.rzpPayoutId ? { rzpPayoutId: info.rzpPayoutId } : {}) } });
    if (st === "paid") await tx.cpSale.updateMany({ where: { id: { in: p.saleIds }, status: "processing" }, data: { status: "paid", paidAt: new Date() } });
    if (st === "failed") await tx.cpSale.updateMany({ where: { id: { in: p.saleIds }, status: "processing" }, data: { status: "verified", payoutRef: null } });
  });
}

const rzpState = (status: string): "paid" | "failed" | "processing" =>
  status === "processed" ? "paid" : ["reversed", "rejected", "cancelled", "failed"].includes(status) ? "failed" : "processing";
const why = (x: RzpPayout) => x.status_details?.description || x.failure_reason || `Payout ${x.status}`;

/** Pays this person's ready commission (after TDS) to their verified bank account through RazorpayX. */
export async function payWithRazorpay(s: Staff, staffId: string) {
  allow(s, "super_admin");
  if (!razorpayXEnabled()) throw new UserError("RazorpayX payouts aren’t set up. Add RAZORPAYX_ACCOUNT_NUMBER, or record a bank transfer instead.");
  const fa = await fundAccount(staffId);
  const { p, u } = await claim(s, staffId, "razorpay");
  try {
    const r = await rzpx<RzpPayout>("/payouts", {
      account_number: razorpayX()!.account, fund_account_id: fa, amount: p.netPaise, currency: "INR",
      mode: p.netPaise > 5_00_000_00 ? "NEFT" : "IMPS", purpose: "payout", queue_if_low_balance: true,
      reference_id: p.ref, narration: "Medoro partner payout",
    }, p.ref);
    const st = rzpState(r.status);
    await db.staffPayout.update({ where: { id: p.id }, data: { rzpPayoutId: r.id } });
    if (st !== "processing") await settlePayout(p.id, st, { utr: r.utr, failure: st === "failed" ? why(r) : null });
    await staffAudit(s, "Payout sent with Razorpay", `${u.name} · ${rupees(p.netPaise)} after TDS · ${p.ref} · ${r.id} (${r.status})`);
    if (st === "failed") throw new UserError(`Razorpay didn’t send it: ${why(r)}. The commission is ready to pay again.`);
    return { ref: p.ref, net: p.netPaise, status: st };
  } catch (e) {
    const cur = await db.staffPayout.findUnique({ where: { id: p.id } });
    if (cur?.status === "processing" && !cur.rzpPayoutId) await settlePayout(p.id, "failed", { failure: e instanceof Error ? e.message.slice(0, 300) : "Razorpay error" });
    throw e;
  }
}

/** Full bank details of a verified account, for a super admin paying by bank transfer or UPI. Every view is audited. */
export async function payoutBankDetails(s: Staff, staffId: string) {
  allow(s, "super_admin");
  const b = await db.staffBank.findUnique({ where: { staffId }, include: { staff: { select: { name: true, empNo: true } } } });
  if (!b || b.status !== "verified") throw new UserError("Verify this person’s bank account first.");
  await staffAudit(s, "Payout bank details viewed", `${b.staff.name} · ${b.staff.empNo} · ${b.bank} •••• ${b.last4}`);
  return { holder: b.holder, account: unseal(Buffer.from(b.accountSealed, "base64")).toString(), ifsc: b.ifsc, bank: b.bank, type: b.type };
}

/** Records a commission payment made outside Razorpay (bank transfer or UPI), with its reference. */
export async function recordBankTransfer(s: Staff, staffId: string, utr: string) {
  allow(s, "super_admin");
  const ref = String(utr ?? "").trim();
  if (ref.length < 6) throw new UserError("Enter the bank or UPI reference (UTR) of the transfer.");
  const { p, u } = await claim(s, staffId, "manual");
  await settlePayout(p.id, "paid", { utr: ref.slice(0, 40) });
  await staffAudit(s, "Payout recorded", `${u.name} · ${rupees(p.netPaise)} after TDS · ${p.ref} · UTR ${ref}`);
  return { ref: p.ref, net: p.netPaise };
}

/** Asks Razorpay for the latest status of a payout still on its way. */
export async function refreshPayout(s: Staff, id: string) {
  allow(s, "super_admin");
  const p = await db.staffPayout.findUnique({ where: { id } });
  if (!p?.rzpPayoutId) throw new UserError("Not a Razorpay payout.");
  if (p.status !== "processing") return { status: p.status };
  const r = await rzpx<RzpPayout>(`/payouts/${p.rzpPayoutId}`, undefined);
  const st = rzpState(r.status);
  await settlePayout(p.id, st, { utr: r.utr, failure: st === "failed" ? why(r) : null });
  return { status: st };
}

/** RazorpayX webhook events (payout.processed, payout.reversed, payout.failed, payout.rejected, payout.updated). */
export async function payoutWebhook(event: string, x: RzpPayout | undefined) {
  if (!x?.id) return "no payout";
  const p = await db.staffPayout.findUnique({ where: { rzpPayoutId: x.id } });
  if (!p) return "unknown payout";
  const st = event === "payout.processed" ? "paid" : ["payout.reversed", "payout.failed", "payout.rejected"].includes(event) ? "failed" : rzpState(x.status);
  await settlePayout(p.id, st, { utr: x.utr, failure: st === "failed" ? why(x) : null });
  return `payout ${st}`;
}

