import "server-only";
import { dataInDrive } from "@/domain/system/drive-state";
import { driveCancelOrder, driveCatalogue, driveOrders, drivePlaceOrder, driveQuote } from "./drive-portal";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { clientInfo, hashPassword, verifyPassword } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { validGstin, GST_STATES } from "@/domain/accounting/gst";
import { customerBalance } from "@/domain/parties/balances";
import { distAuthorize, distView } from "./context";
import { audit, distEnt, num } from "./common";
import { distHas } from "./plans";
import { distSettingsOf, type DistSettings } from "./settings-shape";
import { dlExpiryProblem, dlProblem, normaliseDl } from "./rules/licence";
import { activeSchemes, cancelOrder, placeOrder, quote } from "./orders";
import { invoiceView } from "./billing";
import { openBills } from "./rules/ageing";
import { stockBand } from "./portal-rules";

export const PORTAL_COOKIE = "medoro_portal";
export const CONSENT_VERSION = "2026-11";
const SESSION_DAYS = 14;
const MAX_FAILS = 5;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ───────────── Accounts ─────────────

export const registerSchema = z.object({
  firmName: z.string().trim().min(2, "Enter the pharmacy’s name.").max(120),
  ownerName: z.string().trim().min(2, "Enter the owner / pharmacist name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number."),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  gstin: z.string().trim().toUpperCase().default("").refine((g) => !g || validGstin(g), "GSTIN is not valid (checksum failed)."),
  dl20b: z.string(), dl21b: z.string(), dlExpiry: z.string(),
  address: z.string().trim().min(5, "Enter the shop address.").max(240),
  pincode: z.string().trim().regex(/^\d{6}$/, "PIN code is 6 digits."),
  stateCode: z.string().refine((c) => GST_STATES.some(([k]) => k === c), "Choose the state."),
  consent: z.literal(true, { error: "Agree to the terms and privacy notice to continue." }),
}).superRefine((a, c) => {
  for (const [k, l] of [["dl20b", "Form 20B licence"], ["dl21b", "Form 21B licence"]] as const) { const p = dlProblem(a[k], l); if (p) c.addIssue({ code: "custom", path: [k], message: p }); }
  const e = dlExpiryProblem(a.dlExpiry, todayISO()); if (e) c.addIssue({ code: "custom", path: ["dlExpiry"], message: e });
  if (a.gstin && a.gstin.slice(0, 2) !== a.stateCode) c.addIssue({ code: "custom", path: ["stateCode"], message: "The state doesn’t match the GSTIN." });
});
export type RegisterInput = z.input<typeof registerSchema>;

export async function registerChemist(raw: RegisterInput, ip: string | null) {
  if (!(await rateLimit("portal-register:" + (ip ?? "unknown"), 5, 3600_000))) throw new UserError("Too many sign-ups from this network. Try again in an hour.");
  const i = registerSchema.parse(raw);
  const pw = await hashPassword(i.password);
  try {
    const a = await db.distChemistAccount.create({ data: {
      firmName: i.firmName, ownerName: i.ownerName, email: i.email, phone: i.phone, passwordHash: pw, gstin: i.gstin || null, dl20b: normaliseDl(i.dl20b), dl21b: normaliseDl(i.dl21b),
      dlExpiry: dateOnly(i.dlExpiry), address: i.address, pincode: i.pincode, stateCode: i.stateCode, consentAt: new Date(), consentVersion: CONSENT_VERSION,
    } });
    await createPortalSession(a.id, a.tokenVersion);
    return a.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError("An account with this email or mobile already exists. Sign in instead.");
    throw e;
  }
}

async function createPortalSession(accountId: string, tokenVersion: number) {
  const token = randomBytes(32).toString("base64url");
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.distPortalSession.create({ data: { id: sha(token), accountId, tokenVersion, ip, userAgent, expiresAt } });
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/portal", expires: expiresAt });
}

export async function signInChemist(login: string, password: string) {
  const { ip } = await clientInfo();
  if (!(await rateLimit("portal-signin:" + (ip ?? "unknown"), 30, 900_000))) throw new UserError("Too many attempts from this network. Wait 15 minutes.");
  const id = login.trim().toLowerCase();
  const a = await db.distChemistAccount.findFirst({ where: { OR: [{ email: id }, { phone: id.replace(/^\+91/, "") }] } });
  if (a?.lockedUntil && a.lockedUntil > new Date()) throw new UserError("Account locked after too many wrong passwords. Try again in 15 minutes.");
  const ok = await verifyPassword(a?.passwordHash, password);
  if (!a || !ok) {
    if (a) await db.distChemistAccount.update({ where: { id: a.id }, data: a.failedLogins + 1 >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60000) } : { failedLogins: { increment: 1 } } });
    throw new UserError("Email / mobile or password is wrong.");
  }
  if (a.status === "suspended") throw new UserError("This account is suspended. Contact Medoro support.");
  await db.distChemistAccount.update({ where: { id: a.id }, data: { failedLogins: 0, lockedUntil: null } });
  await createPortalSession(a.id, a.tokenVersion);
}

export async function readPortalAccount() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const s = await db.distPortalSession.findUnique({ where: { id: sha(token) } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  const a = await db.distChemistAccount.findUnique({ where: { id: s.accountId } });
  if (!a || a.tokenVersion !== s.tokenVersion || a.status === "suspended") return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60000) await db.distPortalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  return a;
}
export type PortalAccount = NonNullable<Awaited<ReturnType<typeof readPortalAccount>>>;

export async function signOutChemist() {
  const c = await cookies();
  const token = c.get(PORTAL_COOKIE)?.value;
  if (token) await db.distPortalSession.updateMany({ where: { id: sha(token) }, data: { revokedAt: new Date() } });
  c.delete({ name: PORTAL_COOKIE, path: "/portal" });
}

/** Ends every portal session (password change, suspected misuse). */
export async function signOutEverywhere(accountId: string) {
  await db.distChemistAccount.update({ where: { id: accountId }, data: { tokenVersion: { increment: 1 } } });
}

// ───────────── Discovery and connections ─────────────

async function portalTenants() {
  const ts = await db.tenant.findMany({ where: { product: "distribution" }, select: { id: true, code: true, name: true, settings: true, branches: { where: { active: true }, select: { address: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  return ts.map((t) => ({ ...t, s: distSettingsOf(t.settings) })).filter((t) => t.s.portal.enabled);
}

/** Distributors a chemist can ask to connect to (only those that chose to be listed), and the chemist's connections. */
export async function discover(account: PortalAccount, q = "") {
  const [ts, conns] = await Promise.all([portalTenants(), db.distConnection.findMany({ where: { accountId: account.id } })]);
  const needle = q.trim().toLowerCase();
  return ts.filter((t) => conns.some((c) => c.tenantId === t.id) || (t.s.portal.discoverable && (!needle || t.name.toLowerCase().includes(needle) || t.s.portal.serviceArea.toLowerCase().includes(needle) || t.code.toLowerCase() === needle)))
    .map((t) => ({ tenantId: t.id, code: t.code, name: t.name, area: t.s.portal.serviceArea || t.branches[0]?.address || "", connection: conns.find((c) => c.tenantId === t.id) ?? null }));
}

export async function requestConnection(account: PortalAccount, tenantCode: string, shareKyc: boolean) {
  if (!shareKyc) throw new UserError("The distributor needs your licence and GST details to supply you. Tick “Share my details” to continue.");
  const t = (await portalTenants()).find((x) => x.code === tenantCode);
  if (!t) throw new UserError("Distributor not found or not taking portal orders.");
  if (dlExpiryProblem(isoOf(account.dlExpiry), todayISO())) throw new UserError("Your drug licence has expired. Update it under My account first.");
  try {
    const c = await db.distConnection.create({ data: { tenantId: t.id, accountId: account.id, shareKyc: true } });
    await writeAudit(db, { tenantId: t.id, action: "Portal connection requested", entity: "dist_connection", entityId: c.id, userName: "Chemist portal", detail: `${account.firmName} · DL ${account.dl20b}/${account.dl21b} · ${account.pincode}` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError("You already asked this distributor.");
    throw e;
  }
}

/** Distributor side: connection requests and connected chemists. */
export async function listConnections(ctx: Ctx) {
  distView(ctx, "portal", "masters");
  const conns = await db.distConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { requestedAt: "desc" } });
  const accts = await db.distChemistAccount.findMany({ where: { id: { in: conns.map((c) => c.accountId) } } });
  return conns.map((c) => {
    const a = accts.find((x) => x.id === c.accountId)!;
    // KYC details are visible only because the chemist chose to share them with this distributor.
    return { ...c, firmName: a.firmName, ownerName: a.ownerName, email: c.shareKyc ? a.email : "—", phone: c.shareKyc ? a.phone : "—", gstin: c.shareKyc ? a.gstin : null, dl20b: a.dl20b, dl21b: a.dl21b, dlExpiry: isoOf(a.dlExpiry), address: a.address, pincode: a.pincode, stateCode: a.stateCode };
  });
}

export const approveConnSchema = z.object({ customerId: z.string().default(""), creditLimit: z.union([z.string(), z.number()]).default(0), creditDays: z.coerce.number().int().min(0).max(180).default(21) });

/**
 * Approves a chemist: links the portal account to an existing chemist ledger (matched by the distributor) or creates
 * one from the licence details the chemist shared. Licence validity is checked again here.
 */
export async function approveConnection(ctx: Ctx, connectionId: string, raw: z.input<typeof approveConnSchema>) {
  distAuthorize(ctx, "portal");
  const i = approveConnSchema.parse(raw);
  const ent = await distEnt(ctx.tenantId);
  if (!distHas(ent, "portal")) throw new UserError("The chemist portal is not part of your plan.");
  return db.$transaction(async (tx) => {
    const c = await tx.distConnection.findFirst({ where: { id: connectionId, tenantId: ctx.tenantId } });
    if (!c) throw new UserError("Request not found.");
    if (c.status === "approved") throw new UserError("Already approved.");
    const a = await tx.distChemistAccount.findUniqueOrThrow({ where: { id: c.accountId } });
    const exp = dlExpiryProblem(isoOf(a.dlExpiry), todayISO());
    if (exp) throw new UserError(exp);
    let customerId = i.customerId;
    if (customerId) {
      const ch = await tx.distChemist.findFirst({ where: { tenantId: ctx.tenantId, customerId } });
      if (!ch) throw new UserError("Chemist not found.");
      if (ch.portalAccountId && ch.portalAccountId !== a.id) throw new UserError("That chemist is already linked to another portal account.");
      await tx.distChemist.update({ where: { customerId }, data: { portalAccountId: a.id } });
    } else {
      const phoneTaken = await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: a.phone } });
      if (phoneTaken) throw new UserError(`${phoneTaken.name} already has this mobile number. Link the request to that chemist instead.`);
      const limit = Math.round((Number(i.creditLimit) || 0) * 100);
      customerId = (await tx.customer.create({ data: { tenantId: ctx.tenantId, name: a.firmName, phone: a.phone, gstin: a.gstin, stateCode: a.stateCode, address: a.address, pincode: a.pincode, creditLimitPaise: BigInt(limit) } })).id;
      await tx.distChemist.create({ data: { customerId, tenantId: ctx.tenantId, ownerName: a.ownerName, dl20b: a.dl20b, dl21b: a.dl21b, dlExpiry: a.dlExpiry, creditDays: i.creditDays, portalAccountId: a.id } });
    }
    await tx.distConnection.update({ where: { id: c.id }, data: { status: "approved", customerId, decidedBy: ctx.userId, decidedAt: new Date() } });
    if (a.status === "pending") await tx.distChemistAccount.update({ where: { id: a.id }, data: { status: "verified" } });
    await audit(tx, ctx, "Portal chemist approved", "dist_connection", c.id, `${a.firmName} → chemist ${customerId}`);
    return customerId;
  });
}

export async function decideConnection(ctx: Ctx, connectionId: string, status: "rejected" | "suspended", note: string) {
  distAuthorize(ctx, "portal");
  if (note.trim().length < 3) throw new UserError("Give a reason the chemist will see.");
  return db.$transaction(async (tx) => {
    const c = await tx.distConnection.findFirst({ where: { id: connectionId, tenantId: ctx.tenantId } });
    if (!c) throw new UserError("Request not found.");
    await tx.distConnection.update({ where: { id: c.id }, data: { status, note: note.trim(), decidedBy: ctx.userId, decidedAt: new Date() } });
    await audit(tx, ctx, `Portal chemist ${status}`, "dist_connection", c.id, note.trim());
  });
}

export async function savePortalSettings(ctx: Ctx, raw: Partial<DistSettings["portal"]>) {
  distAuthorize(ctx, "portal");
  const i = z.object({ enabled: z.boolean(), discoverable: z.boolean(), stock: z.enum(["exact", "band", "none"]), showSchemes: z.boolean(), showMrp: z.boolean(), minOrderPaise: z.number().int().min(0).max(10_00_00_000), serviceArea: z.string().trim().max(200) }).partial().parse(raw);
  return db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const s = distSettingsOf(t.settings);
    const next = { ...s, portal: { ...s.portal, ...i } };
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), dist: next } } });
    await audit(tx, ctx, "Portal settings changed", "settings", "dist.portal", JSON.stringify(i));
  });
}

// ───────────── Chemist-side views (only what the distributor allows, only the chemist's own records) ─────────────

/** The approved connection between this account and a distributor, or an error. Every portal read goes through it. */
export async function portalLink(account: PortalAccount, tenantCode: string) {
  const t = await db.tenant.findUnique({ where: { code: tenantCode }, select: { id: true, name: true, code: true, settings: true, product: true, phone: true } });
  if (!t || t.product !== "distribution") throw new UserError("Distributor not found.");
  const s = distSettingsOf(t.settings);
  if (!s.portal.enabled) throw new UserError("This distributor isn’t taking portal orders right now.");
  const c = await db.distConnection.findUnique({ where: { tenantId_accountId: { tenantId: t.id, accountId: account.id } } });
  if (!c || c.status !== "approved" || !c.customerId) throw new UserError("Your request to this distributor isn’t approved yet.");
  const ent = await distEnt(t.id);
  if (!distHas(ent, "portal")) throw new UserError("This distributor’s plan doesn’t include the ordering portal.");
  return { tenant: t, settings: s, customerId: c.customerId };
}

export async function portalCatalogue(account: PortalAccount, tenantCode: string, q = "", take = 60) {
  const L = await portalLink(account, tenantCode);
  // A distributor whose records are in its Drive: the catalogue its device published.
  if (dataInDrive(L.tenant.settings)) return driveCatalogue(L.tenant.id, account.id, q, take);
  const needle = q.trim();
  const dps = await db.distProduct.findMany({ where: { tenantId: L.tenant.id, portalVisible: true, discontinued: false } });
  const meds = await db.medicine.findMany({ where: { tenantId: L.tenant.id, active: true, id: { in: dps.map((d) => d.medicineId) }, ...(needle ? { OR: [{ name: { contains: needle, mode: "insensitive" } }, { generic: { contains: needle, mode: "insensitive" } }] } : {}) }, orderBy: { name: "asc" }, take });
  const branch = await db.branch.findFirstOrThrow({ where: { tenantId: L.tenant.id, active: true }, orderBy: { createdAt: "asc" } });
  const priced = meds.length ? await quote(db, L.tenant.id, branch.id, L.customerId, meds.map((m) => ({ medicineId: m.id, qty: Math.max(1, dps.find((d) => d.medicineId === m.id)?.minOrderQty ?? 1) }))) : [];
  const schemes = L.settings.portal.showSchemes ? (await activeSchemes(db, L.tenant.id)).filter((s) => s.customerIds.length === 0 || s.customerIds.includes(L.customerId)) : [];
  const cos = new Map((await db.distCompany.findMany({ where: { tenantId: L.tenant.id } })).map((c) => [c.id, c.name]));
  const visibleSchemes = await db.distScheme.findMany({ where: { id: { in: schemes.map((s) => s.id) }, portal: true }, select: { id: true } });
  return meds.map((m) => {
    const d = dps.find((x) => x.medicineId === m.id)!, p = priced.find((x) => x.medicineId === m.id)!;
    const sch = schemes.filter((s) => visibleSchemes.some((v) => v.id === s.id) && (s.medicineId === m.id || (!s.medicineId && s.companyId === d.companyId)));
    return {
      medicineId: m.id, name: m.name, generic: m.generic, pack: m.pack, company: cos.get(d.companyId ?? "") ?? m.manufacturer, gstRate: m.gstRate, rate: p.rate, mrp: L.settings.portal.showMrp ? num(m.mrpPaise) : null,
      minOrderQty: d.minOrderQty, stock: stockBand(p.available, L.settings.portal.stock), schemes: sch.map((s) => (s.kind === "free" ? `${s.buyQty}+${s.freeQty}` : `${s.discPct}% off`) + (s.minQty > 1 ? ` (min ${s.minQty})` : "")),
    };
  });
}

export async function portalQuote(account: PortalAccount, tenantCode: string, lines: { medicineId: string; qty: number }[]) {
  const L = await portalLink(account, tenantCode);
  if (dataInDrive(L.tenant.settings)) return driveQuote(L.tenant.id, account.id, lines);
  const branch = await db.branch.findFirstOrThrow({ where: { tenantId: L.tenant.id, active: true }, orderBy: { createdAt: "asc" } });
  const q = await quote(db, L.tenant.id, branch.id, L.customerId, lines);
  return q.map((l) => ({ ...l, available: undefined, stock: stockBand(l.available, L.settings.portal.stock) }));
}

export async function portalPlaceOrder(account: PortalAccount, tenantCode: string, lines: { medicineId: string; qty: number }[], note: string, idempotencyKey: string) {
  const L = await portalLink(account, tenantCode);
  if (dataInDrive(L.tenant.settings)) {
    const r = await drivePlaceOrder(L.tenant.id, account, L.customerId, { lines, note, idempotencyKey });
    return { orderId: r.orderKey, no: "Sent", status: "pending", replayed: r.replayed, creditOk: true, reasons: [] as string[] };
  }
  const hidden = await db.distProduct.count({ where: { tenantId: L.tenant.id, medicineId: { in: lines.map((l) => l.medicineId) }, OR: [{ portalVisible: false }, { discontinued: true }] } });
  if (hidden) throw new UserError("A product in your cart is no longer offered on the portal. Remove it and try again.");
  return placeOrder({ kind: "chemist", tenantId: L.tenant.id, accountId: account.id, customerId: L.customerId }, { customerId: L.customerId, source: "portal", note, idempotencyKey, lines });
}

export async function portalCancelOrder(account: PortalAccount, tenantCode: string, orderId: string) {
  const L = await portalLink(account, tenantCode);
  if (dataInDrive(L.tenant.settings)) return driveCancelOrder(L.tenant.id, account.id, L.customerId, orderId);
  return cancelOrder({ kind: "chemist", tenantId: L.tenant.id, accountId: account.id, customerId: L.customerId }, orderId, "Cancelled by chemist");
}

export async function portalOrders(account: PortalAccount, tenantCode: string) {
  const L = await portalLink(account, tenantCode);
  if (dataInDrive(L.tenant.settings)) return driveOrders(L.tenant.id, account.id);
  const orders = await db.distOrder.findMany({ where: { tenantId: L.tenant.id, customerId: L.customerId }, include: { lines: true }, orderBy: { placedAt: "desc" }, take: 100 });
  const meds = await db.medicine.findMany({ where: { id: { in: [...new Set(orders.flatMap((o) => o.lines.map((l) => l.medicineId)))] } }, select: { id: true, name: true, pack: true } });
  const invs = await db.distInvoice.findMany({ where: { id: { in: orders.map((o) => o.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, no: true, totalPaise: true } });
  return orders.map((o) => ({ id: o.id, no: o.no, status: o.status, placedAt: o.placedAt, estimate: num(o.estimatePaise), rejectReason: o.rejectReason, invoice: invs.find((i) => i.id === o.invoiceId) ? { id: o.invoiceId!, no: invs.find((i) => i.id === o.invoiceId)!.no, total: num(invs.find((i) => i.id === o.invoiceId)!.totalPaise) } : null,
    lines: o.lines.map((l) => ({ medicineId: l.medicineId, name: meds.find((m) => m.id === l.medicineId)?.name ?? "—", pack: meds.find((m) => m.id === l.medicineId)?.pack ?? "", qty: l.qty, freeQty: l.freeQty })) }));
}

/** Shown for a distributor whose records are in its Drive: balances and invoices aren't on Medoro's server. */
const KEPT_BY_DISTRIBUTOR = "This distributor keeps your account and invoices on its own system, not on Medoro. Ask them for your statement or an invoice copy.";

export async function portalAccountSummary(account: PortalAccount, tenantCode: string) {
  const L = await portalLink(account, tenantCode);
  if (dataInDrive(L.tenant.settings)) throw new UserError(KEPT_BY_DISTRIBUTOR);
  const [balance, invs, cancels, chem, cust] = await Promise.all([
    customerBalance(db, L.tenant.id, L.customerId),
    db.distInvoice.findMany({ where: { tenantId: L.tenant.id, customerId: L.customerId }, orderBy: { date: "desc" }, take: 200 }),
    db.distInvoiceCancel.findMany({ where: { tenantId: L.tenant.id }, select: { invoiceId: true } }),
    db.distChemist.findUniqueOrThrow({ where: { customerId: L.customerId } }),
    db.customer.findUniqueOrThrow({ where: { id: L.customerId } }),
  ]);
  const cx = new Set(cancels.map((c) => c.invoiceId));
  const live = invs.filter((i) => !cx.has(i.id));
  const open = openBills(live.map((i) => ({ id: i.id, no: i.no, date: isoOf(i.date), dueDate: isoOf(i.dueDate), total: num(i.totalPaise) })), balance, todayISO());
  const receipts = await db.ledgerLine.findMany({ where: { account: "Sundry debtors", partyType: "customer", partyId: L.customerId, creditPaise: { gt: 0 }, voucher: { tenantId: L.tenant.id, type: "receipt" } }, include: { voucher: true }, orderBy: { voucher: { date: "desc" } }, take: 50 });
  return {
    distributor: L.tenant.name, balance, limit: num(cust.creditLimitPaise), creditDays: chem.creditDays, open,
    invoices: live.map((i) => ({ id: i.id, no: i.no, date: isoOf(i.date), dueDate: isoOf(i.dueDate), total: num(i.totalPaise), open: open.find((o) => o.id === i.id)?.open ?? 0 })),
    payments: receipts.map((r) => ({ date: isoOf(r.voucher.date), no: r.voucher.no, amount: num(r.creditPaise), narration: r.voucher.narration.replace(/^Receipt from [^·]+· /, "") })),
  };
}

/** An invoice of this chemist only (the id alone is not enough). */
export async function portalInvoice(account: PortalAccount, tenantCode: string, invoiceId: string) {
  const L = await portalLink(account, tenantCode);
  if (dataInDrive(L.tenant.settings)) throw new UserError(KEPT_BY_DISTRIBUTOR);
  const inv = await db.distInvoice.findFirst({ where: { id: invoiceId, tenantId: L.tenant.id, customerId: L.customerId }, select: { id: true } });
  if (!inv) throw new UserError("Invoice not found.");
  return invoiceView(L.tenant.id, inv.id);
}
