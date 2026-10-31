import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { seal, unseal } from "@/server/vault";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { rateLimit } from "@/server/rate-limit";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { checkRequestSignature, formatLicenceKey, signDoc, type LicenceDoc } from "@/lib/licence";
import { allow, staffAudit, type Staff } from "./auth";
import { MOBILE_RE, SLA_MIN, TICKET_CATEGORIES, amountPaise, digits, product, rupees } from "./constants";
import { rateFor } from "./sales";

/**
 * The licence server. Pharmacy installations (self-hosted or hosted) register, then check in daily with
 * requests signed by their instance token; each answer is a licence document signed with LICENSE_SIGNING_KEY.
 * Only licence and support data cross this boundary: never the pharmacy's own records.
 */

const CP = "_cp";
const TRIAL_DAYS = 7;

export class LicenceApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function signingKey() {
  const k = process.env.LICENSE_SIGNING_KEY;
  if (!k) throw new LicenceApiError(503, "This server isn’t set up as a licence server (LICENSE_SIGNING_KEY is not set).");
  return k;
}

type Customer = NonNullable<Awaited<ReturnType<typeof db.cpCustomer.findUnique>>>;
const tokenOf = (c: Customer) => (c.licenceToken ? unseal(Buffer.from(c.licenceToken, "base64")).toString("utf8") : null);

/** Checks a pharmacy's signed request and returns its customer record. */
export async function authenticate(licenceId: string | null, signature: string | null, body: string) {
  const c = licenceId && /^[0-9a-f-]{36}$/i.test(licenceId) ? await db.cpCustomer.findUnique({ where: { licenceId } }) : null;
  const token = c ? tokenOf(c) : null;
  if (!c || !token || !checkRequestSignature(token, body, signature)) throw new LicenceApiError(401, "Licence not recognised. Check the licence key under Plan.");
  return c;
}

function newCredentials() {
  const token = randomBytes(32).toString("base64url");
  return { licenceId: randomUUID(), token, sealed: seal(token).toString("base64") };
}

// ── Registration: a new installation starts its trial without anyone at Medoro doing anything.
export const registerSchema = z.object({
  pharmacy: z.string().trim().min(3).max(120),
  owner: z.string().trim().max(80).default(""),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "The owner’s 10-digit mobile is needed to start the licence."),
  email: z.string().trim().max(120).default(""),
  city: z.string().trim().max(60).default(""),
  gstin: z.string().trim().max(15).default(""),
  drugLicence: z.string().trim().max(60).default(""),
  setupAt: z.string().datetime(),
  branches: z.number().int().min(0).max(1000).default(1),
  devices: z.number().int().min(0).max(10000).default(1),
  deployment: z.string().trim().max(40).default(""),
  appVersion: z.string().trim().max(40).default(""),
});

export async function register(raw: unknown, ip: string | null) {
  signingKey();
  if (!(await rateLimit("licence-register:" + (ip ?? "unknown"), 10, 3600_000))) throw new LicenceApiError(429, "Too many registrations from this address. Try again in an hour.");
  const i = registerSchema.parse(raw);
  if (await db.cpCustomer.findUnique({ where: { phone: i.phone } })) {
    throw new LicenceApiError(409, "This mobile already has a Medoro account. Ask Medoro support for your licence key and enter it under Plan.");
  }
  // The trial runs TRIAL_DAYS from setup, and never longer than TRIAL_DAYS from now.
  const setup = isoOf(new Date(Math.min(Date.parse(i.setupAt), Date.now())));
  const ends = [addDays(setup, TRIAL_DAYS), addDays(todayISO(), TRIAL_DAYS)].sort()[0];
  const cred = newCredentials();
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "CUST"));
  const c = await db.cpCustomer.create({
    data: {
      code: `T-${1000 + n}`, name: i.pharmacy, owner: i.owner, phone: i.phone, email: i.email, city: i.city, gstin: i.gstin, drugLicence: i.drugLicence,
      product: i.branches > 1 ? "multi" : "pro", addons: [], cycle: "m", status: "trial", since: dateOnly(setup), renewsOn: dateOnly(ends),
      branches: i.branches, devices: i.devices, deployment: i.deployment, appVersion: i.appVersion || null, lastCheckIn: new Date(),
      licenceId: cred.licenceId, licenceToken: cred.sealed,
    },
  });
  await staffAudit({ id: null, name: "Licence server" }, "Trial started from the app", `${c.code} · ${c.name}`);
  return { licenceId: cred.licenceId, token: cred.token };
}

/** Staff give an existing customer (e.g. one created when a sale was verified) a licence key for their installation. */
export async function issueLicenceKey(s: Staff, customerId: string) {
  allow(s, "super_admin", "care");
  const c = await db.cpCustomer.findUnique({ where: { id: customerId } });
  if (!c) throw new UserError("Customer not found.");
  const cred = newCredentials();
  const licenceId = c.licenceId ?? cred.licenceId;
  await db.cpCustomer.update({ where: { id: c.id }, data: { licenceId, licenceToken: cred.sealed } });
  await staffAudit(s, c.licenceId ? "Licence key reissued" : "Licence key issued", c.code);
  return formatLicenceKey(licenceId, cred.token);
}

// ── Requests the pharmacy sends (from its outbox).
const reqSchema = z.object({ id: z.string().uuid(), kind: z.string().max(40), payload: z.record(z.string(), z.unknown()), createdBy: z.string().max(80).default("") });
export const checkinSchema = z.object({
  appVersion: z.string().trim().max(40).default(""),
  branches: z.number().int().min(0).max(1000).default(1),
  devices: z.number().int().min(0).max(10000).default(1),
  deployment: z.string().trim().max(40).default(""),
  requests: z.array(reqSchema).max(50).default([]),
});
type Req = z.infer<typeof reqSchema>;
type Result = LicenceDoc["processed"][number];

const ticketReq = z.object({ subject: z.string().trim().min(4, "Add a short subject.").max(140), message: z.string().trim().max(4000).default(""), category: z.enum(TICKET_CATEGORIES).catch("General") });
const replyReq = z.object({ code: z.string().max(20), text: z.string().trim().min(1, "Write a reply first.").max(4000) });
const addonReq = z.object({ addon: z.literal("ai") });
const cancelReq = z.object({ reason: z.string().trim().max(500).default("") });
const payReq = z.object({
  product: z.enum(["starter", "pro", "multi", "ai"]), cycle: z.enum(["m", "y"]),
  reference: z.string().trim().min(4).max(60), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amountRupees: z.number().min(0).max(10_000_000), payer: z.string().trim().max(120).default(""),
});
const remoteReq = z.object({ requestId: z.string().uuid(), approved: z.boolean(), link: z.string().url().max(500).optional(), expiresAt: z.string().datetime().optional() });

async function handle(c: Customer, r: Req): Promise<Result> {
  const by = r.createdBy || c.owner || c.name;
  switch (r.kind) {
    case "ticket": {
      if (await db.ticketMessage.findUnique({ where: { id: r.id } })) return { id: r.id, ok: true, ref: (await db.ticketMessage.findUniqueOrThrow({ where: { id: r.id }, include: { ticket: true } })).ticket.code };
      const i = ticketReq.parse(r.payload);
      const n = await db.$transaction((tx) => nextSeq(tx, CP, "TICKET"));
      const t = await db.ticket.create({
        data: {
          code: `TK-${1000 + n}`, customerId: c.id, subject: i.subject, priority: "medium", channel: "App", category: i.category, status: "open",
          firstResponseDue: new Date(Date.now() + SLA_MIN.medium * 60_000),
          messages: { create: { id: r.id, text: i.message || i.subject, byName: by, fromCustomer: true } },
        },
      });
      return { id: r.id, ok: true, ref: t.code };
    }
    case "ticket_reply": {
      if (await db.ticketMessage.findUnique({ where: { id: r.id } })) return { id: r.id, ok: true };
      const i = replyReq.parse(r.payload);
      const t = await db.ticket.findFirst({ where: { code: i.code, customerId: c.id } });
      if (!t) return { id: r.id, ok: false, error: "Ticket not found." };
      await db.$transaction([
        db.ticketMessage.create({ data: { id: r.id, ticketId: t.id, text: i.text, byName: by, fromCustomer: true } }),
        db.ticket.update({ where: { id: t.id }, data: { status: "open", resolvedAt: null } }),
      ]);
      return { id: r.id, ok: true, ref: t.code };
    }
    case "addon_add": case "addon_remove": case "cancel": {
      const dup = await db.cpBillingEvent.findUnique({ where: { requestId: r.id } });
      if (dup) return { id: r.id, ok: true, ref: dup.id };
      const detail = r.kind === "cancel" ? `Cancel the plan${cancelReq.parse(r.payload).reason ? ` · ${cancelReq.parse(r.payload).reason}` : ""}` : `${r.kind === "addon_add" ? "Add" : "Remove"} ${product(addonReq.parse(r.payload).addon).name}`;
      const e = await db.cpBillingEvent.create({ data: { customerId: c.id, kind: r.kind, status: "open", detail, requestId: r.id, byName: by } });
      return { id: r.id, ok: true, ref: e.id };
    }
    case "payment": {
      const dup = await db.cpBillingEvent.findUnique({ where: { requestId: r.id } });
      if (dup) return { id: r.id, ok: true, ref: dup.id };
      const i = payReq.parse(r.payload);
      const amount = amountPaise(i.product, i.cycle);
      const staffId = c.salesStaffId ?? "";
      const rate = staffId ? await rateFor(staffId, i.product, "renewal") : 0;
      const e = await db.$transaction(async (tx) => {
        const sale = await tx.cpSale.create({
          data: { date: dateOnly(todayISO()), pharmacy: c.name, phone: c.phone, city: c.city, customerId: c.id, product: i.product, cycle: i.cycle, type: "renewal", staffId, status: "pending", amountPaise: amount, ratePct: rate, commissionPaise: Math.round((amount * rate) / 100), payRef: i.reference },
        });
        return tx.cpBillingEvent.create({
          data: { customerId: c.id, kind: "payment_claim", status: "open", amountPaise: amount, reference: i.reference, saleId: sale.id, requestId: r.id, byName: by,
            detail: `${product(i.product).name} · ${i.cycle === "y" ? "yearly" : "monthly"} · ₹${i.amountRupees.toLocaleString("en-IN")} paid ${i.paidOn}${i.payer ? ` by ${i.payer}` : ""} (list ${rupees(Math.round(amount * 1.18))} incl. GST)` },
        });
      });
      return { id: r.id, ok: true, ref: e.id };
    }
    case "remote_decision": {
      const i = remoteReq.parse(r.payload);
      const ra = await db.remoteAccessRequest.findFirst({ where: { id: i.requestId, customerId: c.id } });
      if (!ra) return { id: r.id, ok: false, error: "Request not found." };
      if (ra.status === "requested") {
        await db.remoteAccessRequest.update({ where: { id: ra.id }, data: {
          status: i.approved ? "approved" : "denied", decidedAt: new Date(),
          expiresAt: i.approved && i.expiresAt ? new Date(i.expiresAt) : null, link: i.approved && i.link ? seal(i.link).toString("base64") : null,
        } });
      }
      return { id: r.id, ok: true };
    }
    default:
      return { id: r.id, ok: false, error: `Unknown request “${r.kind}”.` };
  }
}

export async function processRequests(c: Customer, reqs: Req[]) {
  const out: Result[] = [];
  for (const r of reqs) {
    try { out.push(await handle(c, r)); } catch (e) {
      if (e instanceof z.ZodError) out.push({ id: r.id, ok: false, error: e.issues[0]?.message ?? "Invalid request." });
      else throw e;
    }
  }
  return out;
}

export async function licenceDoc(customerId: string, processed: Result[] = []): Promise<LicenceDoc> {
  const c = await db.cpCustomer.findUniqueOrThrow({ where: { id: customerId } });
  const since = new Date(Date.now() - 90 * 86400_000);
  const [events, tickets, remote, staff] = await Promise.all([
    db.cpBillingEvent.findMany({ where: { customerId: c.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.ticket.findMany({ where: { customerId: c.id, OR: [{ status: { not: "resolved" } }, { createdAt: { gte: since } }] }, orderBy: { createdAt: "desc" }, take: 20, include: { messages: { where: { internal: false }, orderBy: { at: "asc" } } } }),
    db.remoteAccessRequest.findMany({ where: { customerId: c.id, status: "requested", requestedAt: { gt: new Date(Date.now() - 86400_000) } }, orderBy: { requestedAt: "desc" } }),
    db.staffUser.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name]));
  const ticketCode = new Map<string, string>();
  for (const r of remote) if (r.ticketId && !ticketCode.has(r.ticketId)) ticketCode.set(r.ticketId, (await db.ticket.findUnique({ where: { id: r.ticketId }, select: { code: true } }))?.code ?? "");
  return {
    v: 1, licenceId: c.licenceId!, customerCode: c.code, issuedAt: new Date().toISOString(),
    plan: c.product, planName: product(c.product).name, cycle: c.cycle, status: c.status, endsOn: c.renewsOn ? isoOf(c.renewsOn) : null, graceDays: c.graceDays, addons: c.addons,
    invoices: events.filter((e) => e.kind === "invoice").map((e) => ({ number: e.number ?? e.id, date: e.createdAt.toISOString(), description: e.detail, amountPaise: e.amountPaise, gstPaise: e.gstPaise, reference: e.reference })),
    billing: events.filter((e) => e.kind !== "invoice").slice(0, 30).map((e) => ({ id: e.id, requestId: e.requestId, kind: e.kind, status: e.status, detail: e.detail, at: e.createdAt.toISOString() })),
    tickets: tickets.map((t) => ({ code: t.code, subject: t.subject, status: t.status, createdAt: t.createdAt.toISOString(), messages: t.messages.map((m) => ({ id: m.id, by: m.fromCustomer ? m.byName : `${m.byName.split(" ")[0]} (Medoro)`, text: m.text, at: m.at.toISOString(), fromCustomer: m.fromCustomer })) })),
    remote: remote.map((r) => ({ id: r.id, by: name.get(r.staffId) ?? "Medoro support", ticket: r.ticketId ? ticketCode.get(r.ticketId) || null : null, requestedAt: r.requestedAt.toISOString() })),
    processed,
  };
}

/** One check-in: record what the installation reported, act on its requests, answer with a signed licence. */
export async function checkin(c: Customer, raw: unknown) {
  const key = signingKey();
  const i = checkinSchema.parse(raw);
  await db.cpCustomer.update({ where: { id: c.id }, data: { lastCheckIn: new Date(), appVersion: i.appVersion || null, branches: i.branches, devices: i.devices, ...(i.deployment ? { deployment: i.deployment } : {}) } });
  const processed = await processRequests(c, i.requests);
  return signDoc(await licenceDoc(c.id, processed), key);
}

// ── Staff actions on a customer's licence and billing.
export async function extendTrial(s: Staff, customerId: string, days: number) {
  allow(s, "super_admin", "care");
  const d = z.number().int().min(1, "Extend by 1 to 30 days.").max(30, "Extend by 1 to 30 days.").parse(days);
  const c = await db.cpCustomer.findUnique({ where: { id: customerId } });
  if (!c) throw new UserError("Customer not found.");
  if (c.status !== "trial") throw new UserError("Only trials can be extended. For paying customers, verify a payment.");
  const today = todayISO();
  const from = c.renewsOn && isoOf(c.renewsOn) > today ? isoOf(c.renewsOn) : today;
  const ends = addDays(from, d);
  await db.$transaction([
    db.cpCustomer.update({ where: { id: c.id }, data: { renewsOn: dateOnly(ends) } }),
    db.cpBillingEvent.create({ data: { customerId: c.id, kind: "trial_extended", status: "done", detail: `Trial extended by ${d} day${d === 1 ? "" : "s"} to ${ends}`, byName: s.name, decidedAt: new Date(), decidedBy: s.name } }),
  ]);
  await staffAudit(s, "Trial extended", `${c.code} · +${d} days → ${ends}`);
  return ends;
}

/** Approve or reject an add-on or cancellation request from the app. Approved changes reach the pharmacy in its next licence. */
export async function decideBillingRequest(s: Staff, id: string, approve: boolean) {
  allow(s, "super_admin");
  const e = await db.cpBillingEvent.findUnique({ where: { id }, include: { customer: true } });
  if (!e || e.status !== "open" || !["addon_add", "addon_remove", "cancel"].includes(e.kind)) throw new UserError("No open request to decide.");
  const c = e.customer;
  const data = !approve ? null
    : e.kind === "addon_add" ? { addons: c.addons.includes("ai") ? c.addons : [...c.addons, "ai"] }
    : e.kind === "addon_remove" ? { addons: c.addons.filter((a) => a !== "ai") }
    : { status: "cancelled" };
  await db.$transaction([
    ...(data ? [db.cpCustomer.update({ where: { id: c.id }, data })] : []),
    db.cpBillingEvent.update({ where: { id }, data: { status: approve ? "done" : "rejected", decidedAt: new Date(), decidedBy: s.name } }),
  ]);
  await staffAudit(s, approve ? "Billing request approved" : "Billing request rejected", `${c.code} · ${e.detail}`);
}

export async function billingEvents(customerId: string) {
  const rows = await db.cpBillingEvent.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((e) => ({ id: e.id, kind: e.kind, status: e.status, number: e.number, amount: e.amountPaise, gst: e.gstPaise, reference: e.reference, detail: e.detail, by: e.byName, at: e.createdAt.toISOString(), decidedBy: e.decidedBy }));
}

/** The support link an owner approved a remote-access request with, while it can still be used. */
export function approvedLink(r: { status: string; link: string | null; expiresAt: Date | null } | null) {
  if (!r || r.status !== "approved" || !r.link || !r.expiresAt || r.expiresAt < new Date()) return null;
  return { link: unseal(Buffer.from(r.link, "base64")).toString("utf8"), expiresAt: r.expiresAt.toISOString() };
}
