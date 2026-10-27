import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { seal } from "@/server/vault";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { addDays, todayISO, dateOnly, isoOf } from "@/lib/dates";
import { allow, staffAudit, type Staff } from "./auth";
import {
  DEFAULT_RATES, IFSC_BANKS, IFSC_RE, LEAD_SOURCES, LOST_REASONS, MAX_RATE, MOBILE_RE, PAN_RE, PRODUCT_IDS, STAGES, TDS_PCT,
  amountPaise, digits, product, rupees, type ProductId,
} from "./constants";

const CP = "_cp";
const day = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
type Rates = Record<ProductId, { first: number; renew: number }>;

// ── Commission rates and per-person bonus (super admin).
export async function getRates(): Promise<Rates> {
  const r = await db.cpSetting.findUnique({ where: { key: "rates" } });
  return { ...DEFAULT_RATES, ...((r?.value as Partial<Rates>) ?? {}) };
}
export async function getTarget(): Promise<number> {
  const r = await db.cpSetting.findUnique({ where: { key: "target" } });
  return Number((r?.value as { perPersonPaise?: number })?.perPersonPaise ?? 0);
}

const pct = z.coerce.number<string | number>().min(0).max(MAX_RATE, `Rates above ${MAX_RATE}% need finance approval.`);
export async function saveRates(s: Staff, raw: Record<string, { first: string | number; renew: string | number }>, bonuses: Record<string, string | number>, targetRupees: string | number) {
  allow(s, "super_admin");
  const rates = Object.fromEntries(PRODUCT_IDS.map((id) => [id, { first: pct.parse(raw[id]?.first ?? 0), renew: pct.parse(raw[id]?.renew ?? 0) }])) as Rates;
  const target = Math.round(z.coerce.number<string | number>().min(0).max(10_000_000).parse(targetRupees || 0) * 100);
  const sales = await db.staffUser.findMany({ where: { role: "sales" }, select: { id: true } });
  await db.$transaction([
    db.cpSetting.upsert({ where: { key: "rates" }, create: { key: "rates", value: rates }, update: { value: rates } }),
    db.cpSetting.upsert({ where: { key: "target" }, create: { key: "target", value: { perPersonPaise: target } }, update: { value: { perPersonPaise: target } } }),
    ...sales.filter((u) => u.id in bonuses).map((u) => db.staffUser.update({ where: { id: u.id }, data: { bonusPct: z.coerce.number<string | number>().min(0).max(20, "Bonus is at most 20 points.").parse(bonuses[u.id] || 0) } })),
  ]);
  await staffAudit(s, "Commission rates saved", PRODUCT_IDS.map((id) => `${id} ${rates[id].first}/${rates[id].renew}`).join(", "));
}

async function rateFor(staffId: string, productId: string, type: "new" | "renewal") {
  const [rates, u] = await Promise.all([getRates(), db.staffUser.findUnique({ where: { id: staffId }, select: { bonusPct: true } })]);
  const r = rates[productId as ProductId] ?? { first: 0, renew: 0 };
  return (type === "new" ? r.first : r.renew) + Number(u?.bonusPct ?? 0);
}

export async function previewCommission(s: Staff, productId: string, cycle: string) {
  const amount = amountPaise(productId, cycle);
  const rate = await rateFor(s.id, productId, "new");
  return { amount, rate, commission: Math.round((amount * rate) / 100) };
}

// ── Leads pipeline. Sales see their own; the super admin sees everyone's.
const scope = (s: Staff) => (s.role === "super_admin" ? {} : { staffId: s.id });

export const leadSchema = z.object({
  name: z.string().trim().min(3, "Enter the pharmacy name.").max(120),
  owner: z.string().trim().max(80).default(""),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile."),
  city: z.string().trim().max(60).default(""),
  source: z.enum(LEAD_SOURCES), product: z.enum(PRODUCT_IDS),
});

export async function createLead(s: Staff, raw: z.input<typeof leadSchema>) {
  allow(s, "super_admin", "sales");
  const i = leadSchema.parse(raw);
  const dup = await db.lead.findUnique({ where: { phone: i.phone } });
  if (dup) {
    const who = await db.staffUser.findUnique({ where: { id: dup.staffId }, select: { name: true } });
    throw new UserError(`This number is already a lead (${dup.name}, owned by ${who?.name ?? "another salesperson"}).`);
  }
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "LEAD"));
  const lead = await db.lead.create({ data: { code: `L-${n}`, ...i, owner: i.owner || "—", city: i.city || "—", stage: "new", nextOn: dateOnly(addDays(todayISO(), 1)), staffId: s.id } });
  await staffAudit(s, "Lead created", `${lead.code} · ${i.name}`);
  return lead.code;
}

async function ownLead(s: Staff, id: string) {
  const l = await db.lead.findFirst({ where: { id, ...scope(s) } });
  if (!l) throw new UserError("Lead not found.");
  return l;
}

export async function moveLead(s: Staff, id: string, dir: "back" | "forward") {
  allow(s, "super_admin", "sales");
  const l = await ownLead(s, id);
  const i = STAGES.findIndex((x) => x.id === l.stage);
  if (l.stage === "won" || l.stage === "lost") throw new UserError("Closed leads can’t move.");
  if (dir === "back") {
    if (i <= 0) throw new UserError("Already at the first stage.");
    await db.lead.update({ where: { id }, data: { stage: STAGES[i - 1].id } });
    return { won: false };
  }
  if (l.stage === "trial") {
    if (l.discountStatus === "pending") throw new UserError("Waiting for the super admin to approve the discount.");
    const disc = l.discountStatus === "approved" ? l.discountPct ?? 0 : 0;
    await logSaleTx(s, { pharmacy: l.name, phone: l.phone, city: l.city === "—" ? "" : l.city, product: l.product as ProductId, cycle: "m" }, l.staffId, { leadId: l.id, discountPct: disc });
    await db.$transaction([
      db.lead.update({ where: { id }, data: { stage: "won", nextOn: null } }),
      db.leadLog.create({ data: { leadId: id, staffId: s.id, text: `Won ${day(todayISO())} by ${s.name.split(" ")[0]}` } }),
    ]);
    await staffAudit(s, "Lead won", `${l.code} · ${l.name}`);
    return { won: true };
  }
  await db.lead.update({ where: { id }, data: { stage: STAGES[i + 1].id, nextOn: dateOnly(addDays(todayISO(), i + 1 === 2 ? 2 : 3)) } });
  return { won: false };
}

export async function loseLead(s: Staff, id: string, reason: string) {
  allow(s, "super_admin", "sales");
  const r = z.enum(LOST_REASONS).parse(reason);
  const l = await ownLead(s, id);
  if (l.stage === "won" || l.stage === "lost") throw new UserError("This lead is already closed.");
  await db.lead.update({ where: { id }, data: { stage: "lost", nextOn: null, lostReason: r } });
  await staffAudit(s, "Lead lost", `${l.code} · ${r}`);
}

export async function logLeadCall(s: Staff, id: string, note: string) {
  allow(s, "super_admin", "sales");
  const l = await ownLead(s, id);
  const next = addDays(todayISO(), 2);
  await db.$transaction([
    db.leadLog.create({ data: { leadId: l.id, staffId: s.id, text: `${note.trim().slice(0, 200) || "Call logged"} · ${day(todayISO())} by ${s.name.split(" ")[0]} · next follow-up ${day(next)}` } }),
    db.lead.update({ where: { id }, data: { nextOn: dateOnly(next) } }),
  ]);
}

export async function requestDiscount(s: Staff, id: string, discountPct: number) {
  allow(s, "sales");
  const p = z.number().int().min(1).max(30, "Discounts above 30% aren’t allowed.").parse(discountPct);
  const l = await ownLead(s, id);
  if (!["demo", "trial"].includes(l.stage)) throw new UserError("Discounts can be requested once a demo is booked.");
  if (l.discountStatus) throw new UserError("A discount was already requested for this lead.");
  await db.lead.update({ where: { id }, data: { discountPct: p, discountStatus: "pending" } });
  await staffAudit(s, "Discount requested", `${l.code} · ${p}%`);
}

export async function decideDiscount(s: Staff, id: string, approve: boolean) {
  allow(s, "super_admin");
  const l = await db.lead.findUnique({ where: { id } });
  if (!l || l.discountStatus !== "pending") throw new UserError("No pending discount on this lead.");
  await db.lead.update({ where: { id }, data: { discountStatus: approve ? "approved" : "rejected" } });
  await staffAudit(s, approve ? "Discount approved" : "Discount rejected", `${l.code} · ${l.discountPct}%`);
}

export async function pipeline(s: Staff) {
  const [leads, staff] = await Promise.all([
    db.lead.findMany({ where: scope(s), orderBy: { createdAt: "desc" }, include: { logs: { orderBy: { at: "desc" }, take: 1 } } }),
    db.staffUser.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name]));
  return leads.map((l) => ({
    id: l.id, code: l.code, name: l.name, owner: l.owner, phone: l.phone, city: l.city, source: l.source, product: l.product, stage: l.stage,
    nextOn: l.nextOn ? isoOf(l.nextOn) : null, lostReason: l.lostReason, discountPct: l.discountPct, discountStatus: l.discountStatus,
    last: l.logs[0]?.text ?? null, staff: name.get(l.staffId) ?? "", valuePaise: Math.round(product(l.product).m * 100 * (l.discountStatus === "approved" ? (100 - (l.discountPct ?? 0)) / 100 : 1)),
  }));
}

// ── Sales and commission.
export const saleSchema = z.object({
  pharmacy: z.string().trim().min(3, "Enter the pharmacy name.").max(120),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter the owner’s 10-digit mobile."),
  city: z.string().trim().max(60).default(""),
  product: z.enum(PRODUCT_IDS), cycle: z.enum(["m", "y"]),
});

async function logSaleTx(s: Staff, raw: z.input<typeof saleSchema>, staffId: string, extra: { leadId?: string; discountPct?: number } = {}) {
  const i = saleSchema.parse(raw);
  const dup = await db.cpSale.findFirst({ where: { phone: i.phone, product: i.product, status: "pending" } });
  if (dup) throw new UserError("This sale is already waiting for verification.");
  const existing = await db.cpCustomer.findUnique({ where: { phone: i.phone } });
  const type = existing && (existing.product === i.product || existing.addons.includes(i.product)) ? "renewal" : "new";
  const amount = amountPaise(i.product, i.cycle, extra.discountPct ?? 0);
  const rate = await rateFor(staffId, i.product, type);
  const sale = await db.cpSale.create({ data: { date: dateOnly(todayISO()), ...i, customerId: existing?.id ?? null, type, staffId, status: "pending", amountPaise: amount, ratePct: rate, commissionPaise: Math.round((amount * rate) / 100), leadId: extra.leadId ?? null } });
  await staffAudit(s, "Sale logged", `${i.pharmacy} · ${product(i.product).name} · ${rupees(amount)}`);
  return sale.id;
}

export async function logSale(s: Staff, raw: z.input<typeof saleSchema>) {
  allow(s, "sales");
  return logSaleTx(s, raw, s.id);
}

/** Super admin confirms the customer's payment arrived. Creates or updates the customer account. */
export async function verifySale(s: Staff, id: string, decision: "verify" | "reject") {
  allow(s, "super_admin");
  return db.$transaction(async (tx) => {
    const sale = await tx.cpSale.findUnique({ where: { id } });
    if (!sale || sale.status !== "pending") throw new UserError("Only pending sales can be verified.");
    if (decision === "reject") {
      await tx.cpSale.update({ where: { id }, data: { status: "rejected", verifiedBy: s.name, verifiedAt: new Date() } });
      return null;
    }
    const today = todayISO();
    const p = product(sale.product);
    const renews = "once" in p && p.once ? null : dateOnly(sale.cycle === "y" ? addDays(today, 365) : addDays(today, 30));
    let c = await tx.cpCustomer.findUnique({ where: { phone: sale.phone } });
    if (!c) {
      if ("addon" in p || "once" in p) throw new UserError("This pharmacy isn’t a customer yet. Verify its plan sale first.");
      const n = await nextSeq(tx, CP, "CUST");
      c = await tx.cpCustomer.create({ data: { code: `T-${1000 + n}`, name: sale.pharmacy, owner: "", phone: sale.phone, city: sale.city, product: sale.product, addons: [], cycle: sale.cycle, status: "active", since: dateOnly(today), renewsOn: renews, salesStaffId: sale.staffId } });
    } else if (!("once" in p && p.once)) {
      await tx.cpCustomer.update({ where: { id: c.id }, data: "addon" in p ? { addons: c.addons.includes(sale.product) ? c.addons : [...c.addons, sale.product], status: "active" } : { product: sale.product, cycle: sale.cycle, status: "active", renewsOn: renews } });
    }
    await tx.cpSale.update({ where: { id }, data: { status: "verified", verifiedBy: s.name, verifiedAt: new Date(), customerId: c.id } });
    return c.code;
  }).then(async (code) => { await staffAudit(s, decision === "verify" ? "Sale verified" : "Sale rejected", id + (code ? ` · ${code}` : "")); return code; });
}

export async function salesList(s: Staff) {
  const [rows, staff] = await Promise.all([
    db.cpSale.findMany({ where: s.role === "sales" ? { staffId: s.id } : {}, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    db.staffUser.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name]));
  return rows.map((x) => ({ id: x.id, date: isoOf(x.date), pharmacy: x.pharmacy, product: x.product, cycle: x.cycle, type: x.type, staff: name.get(x.staffId) ?? "", staffId: x.staffId, status: x.status, amount: x.amountPaise, commission: x.commissionPaise, rate: Number(x.ratePct) }));
}

// ── Bank details for commission payouts. Encrypted at rest; only the last 4 digits are ever shown.
export const bankSchema = z.object({
  holder: z.string().trim().min(3, "Enter the name exactly as it appears in your bank.").max(80),
  account: z.string().regex(/^\d{9,18}$/, "Account number should be 9 to 18 digits."),
  account2: z.string(),
  ifsc: z.string().trim().toUpperCase().regex(IFSC_RE, "Enter a valid 11-character IFSC code."),
  pan: z.string().trim().toUpperCase().regex(PAN_RE, "Enter a valid PAN, like ABCDE1234F. It is needed for TDS."),
  type: z.enum(["Savings", "Current"]),
  consent: z.literal(true, { error: "Please confirm the account is in your name." }),
}).refine((b) => b.account === b.account2, { message: "Account numbers do not match.", path: ["account2"] });

export async function saveBank(s: Staff, raw: z.input<typeof bankSchema>) {
  allow(s, "sales");
  const b = bankSchema.parse(raw);
  const data = { holder: b.holder, accountSealed: seal(b.account).toString("base64"), last4: b.account.slice(-4), ifsc: b.ifsc, bank: IFSC_BANKS[b.ifsc.slice(0, 4)] ?? "Bank " + b.ifsc.slice(0, 4), type: b.type, panSealed: seal(b.pan).toString("base64"), panMasked: b.pan.slice(0, 2) + "•••••" + b.pan.slice(-3), status: "pending", addedAt: new Date(), verifiedAt: null, verifiedBy: null };
  await db.staffBank.upsert({ where: { staffId: s.id }, create: { staffId: s.id, ...data }, update: data });
  await staffAudit(s, "Payout bank account saved", `${data.bank} •••• ${data.last4}`);
}

/** Finance confirms the account (cancelled cheque or bank check) before any payout goes to it. */
export async function verifyBank(s: Staff, staffId: string) {
  allow(s, "super_admin");
  const b = await db.staffBank.findUnique({ where: { staffId }, include: { staff: { select: { name: true } } } });
  if (!b) throw new UserError("No bank account on file.");
  await db.staffBank.update({ where: { staffId }, data: { status: "verified", verifiedAt: new Date(), verifiedBy: s.name } });
  await staffAudit(s, "Payout bank account verified", `${b.staff.name} · ${b.bank} •••• ${b.last4}`);
}

export async function myBank(s: Staff) {
  const b = await db.staffBank.findUnique({ where: { staffId: s.id } });
  return b ? { holder: b.holder, last4: b.last4, ifsc: b.ifsc, bank: b.bank, type: b.type, panMasked: b.panMasked, status: b.status, addedAt: isoOf(b.addedAt), verifiedAt: b.verifiedAt ? isoOf(b.verifiedAt) : null } : null;
}

/** Records the payout for verified sales whose salesperson has a verified bank account. Money moves through the bank, outside Medoro. */
export async function runPayout(s: Staff) {
  allow(s, "super_admin");
  const ver = await db.cpSale.findMany({ where: { status: "verified" } });
  if (!ver.length) throw new UserError("Nothing verified to pay out yet.");
  const banks = await db.staffBank.findMany({ where: { staffId: { in: [...new Set(ver.map((x) => x.staffId))] } }, include: { staff: { select: { name: true } } } });
  const ok = new Set(banks.filter((b) => b.status === "verified").map((b) => b.staffId));
  const pay = ver.filter((x) => ok.has(x.staffId));
  const ref = `PAY-${todayISO().slice(0, 7)}`;
  if (pay.length) await db.cpSale.updateMany({ where: { id: { in: pay.map((x) => x.id) }, status: "verified" }, data: { status: "paid", paidAt: new Date(), payoutRef: ref } });
  const staff = await db.staffUser.findMany({ where: { id: { in: ver.filter((x) => !ok.has(x.staffId)).map((x) => x.staffId) } }, select: { name: true } });
  await staffAudit(s, "Payout run recorded", `${pay.length} sales · ${rupees(pay.reduce((a, x) => a + x.commissionPaise, 0))} gross · ${ref}`);
  return { paid: pay.length, held: staff.map((u) => u.name) };
}

export async function payouts(s: Staff) {
  const [rows, staff, banks] = await Promise.all([
    db.cpSale.findMany({ where: { ...(s.role === "sales" ? { staffId: s.id } : {}), status: { not: "rejected" } }, orderBy: { date: "desc" } }),
    db.staffUser.findMany({ select: { id: true, name: true } }),
    db.staffBank.findMany(),
  ]);
  const by = new Map<string, typeof rows>();
  for (const x of rows) { const k = isoOf(x.date).slice(0, 7) + "|" + x.staffId; by.set(k, [...(by.get(k) ?? []), x]); }
  const name = new Map(staff.map((u) => [u.id, u.name]));
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, xs]) => {
    const [month, sid] = k.split("|");
    const gross = xs.reduce((a, x) => a + x.commissionPaise, 0), tds = Math.round((gross * TDS_PCT) / 100);
    const bank = banks.find((b) => b.staffId === sid);
    return {
      key: k, month, staffId: sid, staff: name.get(sid) ?? sid, n: xs.length, gross, tds, net: gross - tds,
      status: xs.every((x) => x.status === "paid") ? "paid" : xs.some((x) => x.status === "verified") ? "scheduled" : "awaiting",
      bank: bank ? { label: `${bank.bank.split(" ")[0]} •••• ${bank.last4}`, verified: bank.status === "verified" } : null,
    };
  });
}

export async function pendingBanks() {
  const b = await db.staffBank.findMany({ where: { status: "pending" }, include: { staff: { select: { name: true, empNo: true } } } });
  return b.map((x) => ({ staffId: x.staffId, name: x.staff.name, empNo: x.staff.empNo, label: `${x.bank} •••• ${x.last4}`, holder: x.holder, ifsc: x.ifsc, panMasked: x.panMasked, addedAt: isoOf(x.addedAt) }));
}
