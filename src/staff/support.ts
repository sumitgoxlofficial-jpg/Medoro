import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { allow, staffAudit, type Staff } from "./auth";
import { MOBILE_RE, SLA_MIN, TICKET_CATEGORIES, TICKET_CHANNELS, digits } from "./constants";
import { approvedLink, billingEvents } from "./licence";

const CP = "_cp";
// Sales see the pharmacies they sold to; customer care and super admins see all.
const custScope = (s: Staff) => (s.role === "sales" ? { salesStaffId: s.id } : {});

export async function customers(s: Staff) {
  const rows = await db.cpCustomer.findMany({ where: custScope(s), orderBy: { code: "asc" }, include: { tickets: { where: { status: { not: "resolved" } }, select: { priority: true } } } });
  return rows.map((c) => ({ id: c.id, code: c.code, name: c.name, owner: c.owner, phone: c.phone, email: c.email, city: c.city, gstin: c.gstin, product: c.product, addons: c.addons, cycle: c.cycle, status: c.status, openTickets: c.tickets.length }));
}

/** 0–100 from subscription status, open high-priority tickets and how recently the licence checked in. */
export function health(status: string, highOpen: number, lastCheckIn: Date | null) {
  const base = ({ active: 88, trial: 62, grace: 38, cancelled: 8 } as Record<string, number>)[status] ?? 50;
  const stale = lastCheckIn ? Math.min(20, Math.floor((Date.now() - lastCheckIn.getTime()) / 86400_000) * 2) : 0;
  return Math.max(0, base - highOpen * 12 - stale);
}

export async function customerDetail(s: Staff, id: string) {
  const c = await db.cpCustomer.findFirst({ where: { id, ...custScope(s) }, include: { notes: { orderBy: { at: "desc" } }, tickets: { orderBy: { createdAt: "desc" } } } });
  if (!c) return null;
  const [salesperson, remote, billing] = await Promise.all([
    c.salesStaffId ? db.staffUser.findUnique({ where: { id: c.salesStaffId }, select: { name: true } }) : null,
    db.remoteAccessRequest.findFirst({ where: { customerId: id }, orderBy: { requestedAt: "desc" } }),
    billingEvents(id),
  ]);
  const hi = c.tickets.filter((t) => t.status !== "resolved" && t.priority === "high").length;
  return {
    id: c.id, code: c.code, name: c.name, owner: c.owner, phone: c.phone, email: c.email, address: c.address, city: c.city, gstin: c.gstin, drugLicence: c.drugLicence,
    product: c.product, addons: c.addons, cycle: c.cycle, status: c.status, since: isoOf(c.since), renewsOn: c.renewsOn ? isoOf(c.renewsOn) : null,
    branches: c.branches, devices: c.devices, deployment: c.deployment, lastCheckIn: c.lastCheckIn?.toISOString() ?? null, appVersion: c.appVersion,
    salesperson: salesperson?.name ?? null, health: health(c.status, hi, c.lastCheckIn), highOpen: hi,
    notes: c.notes.map((n) => ({ id: n.id, text: n.text, by: n.byName, at: n.at.toISOString() })),
    tickets: c.tickets.map((t) => ({ id: t.id, code: t.code, subject: t.subject, status: t.status })),
    remote: remote ? { status: remote.status, at: remote.requestedAt.toISOString(), ...(s.role !== "sales" ? { access: approvedLink(remote) } : {}) } : null,
    licensed: !!c.licenceId, graceDays: c.graceDays, billing,
  };
}

export const customerSchema = z.object({
  name: z.string().trim().min(3, "Enter the pharmacy name.").max(120),
  owner: z.string().trim().max(80).default(""),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter the owner’s 10-digit mobile."),
  email: z.string().trim().max(120).default(""), city: z.string().trim().max(60).default(""),
  product: z.enum(["starter", "pro", "multi"]), cycle: z.enum(["m", "y"]),
});

/** For pharmacies that start a trial on their own (no salesperson). */
export async function addTrialCustomer(s: Staff, raw: z.input<typeof customerSchema>) {
  allow(s, "super_admin", "care");
  const i = customerSchema.parse(raw);
  if (await db.cpCustomer.findUnique({ where: { phone: i.phone } })) throw new UserError("A customer with this mobile already exists.");
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "CUST"));
  const c = await db.cpCustomer.create({ data: { code: `T-${1000 + n}`, ...i, addons: [], status: "trial", since: dateOnly(todayISO()), renewsOn: dateOnly(addDays(todayISO(), 14)) } });
  await staffAudit(s, "Trial customer added", `${c.code} · ${c.name}`);
  return c.id;
}

const STATUS = z.enum(["trial", "active", "grace", "cancelled"]);
export async function setCustomerStatus(s: Staff, id: string, status: string) {
  allow(s, "super_admin");
  const st = STATUS.parse(status);
  const c = await db.cpCustomer.update({ where: { id }, data: { status: st } });
  await staffAudit(s, "Customer status changed", `${c.code} → ${st}`);
}

export async function addNote(s: Staff, customerId: string, text: string, call = false) {
  const t = String(text ?? "").trim().slice(0, 1000);
  if (!t && !call) throw new UserError("Write the note first.");
  const c = await db.cpCustomer.findFirst({ where: { id: customerId, ...custScope(s) } });
  if (!c) throw new UserError("Customer not found.");
  await db.cpNote.create({ data: { customerId, staffId: s.id, byName: s.name, text: call ? `Call logged · ${t || "spoke with owner, no issues"}` : t } });
}

/**
 * Asks the pharmacy owner for a time-limited, read-only support session. Medoro staff can't
 * open a pharmacy's data without it; the owner approves from their own Medoro app.
 */
export async function requestRemote(s: Staff, customerId: string, ticketId?: string) {
  allow(s, "super_admin", "care");
  const c = await db.cpCustomer.findUnique({ where: { id: customerId } });
  if (!c) throw new UserError("Customer not found.");
  const open = await db.remoteAccessRequest.findFirst({ where: { customerId, status: "requested", requestedAt: { gt: new Date(Date.now() - 86400_000) } } });
  if (open) throw new UserError(`Already requested. Waiting for ${c.owner || "the owner"} to approve in their app.`);
  await db.remoteAccessRequest.create({ data: { customerId, staffId: s.id, ticketId: ticketId ?? null, status: "requested" } });
  await staffAudit(s, "Remote access requested", c.code);
}

// ── Support tickets (customer care and super admin).
export const ticketSchema = z.object({
  customerId: z.string().uuid(), subject: z.string().trim().min(4, "Add a short subject.").max(140),
  message: z.string().trim().max(4000).default(""), priority: z.enum(["high", "medium", "low"]),
  channel: z.enum(TICKET_CHANNELS), category: z.enum(TICKET_CATEGORIES),
});

export async function createTicket(s: Staff, raw: z.input<typeof ticketSchema>) {
  allow(s, "super_admin", "care");
  const i = ticketSchema.parse(raw);
  const c = await db.cpCustomer.findUnique({ where: { id: i.customerId } });
  if (!c) throw new UserError("Customer not found.");
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "TICKET"));
  const t = await db.ticket.create({
    data: {
      code: `TK-${1000 + n}`, customerId: c.id, subject: i.subject, priority: i.priority, channel: i.channel, category: i.category, status: "open",
      assigneeId: s.role === "care" ? s.id : null, firstResponseDue: new Date(Date.now() + SLA_MIN[i.priority] * 60_000),
      messages: i.message ? { create: { text: i.message, byName: c.owner || c.name, fromCustomer: true } } : undefined,
    },
  });
  await staffAudit(s, "Ticket opened", `${t.code} · ${c.code}`);
  return t.id;
}

export async function tickets() {
  const rows = await db.ticket.findMany({ orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true } } } });
  return rows.map((t) => ({ id: t.id, code: t.code, subject: t.subject, customer: t.customer.name, priority: t.priority, status: t.status, createdAt: t.createdAt.toISOString(), assigneeId: t.assigneeId }));
}

export async function ticketDetail(id: string) {
  const t = await db.ticket.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true, phone: true, owner: true } }, messages: { orderBy: { at: "asc" } } } });
  if (!t) return null;
  const remote = await db.remoteAccessRequest.findFirst({ where: { customerId: t.customerId }, orderBy: { requestedAt: "desc" } });
  return {
    id: t.id, code: t.code, subject: t.subject, category: t.category, channel: t.channel, priority: t.priority, status: t.status, assigneeId: t.assigneeId, escalatedTo: t.escalatedTo,
    customer: t.customer, firstResponseDue: t.firstResponseDue.toISOString(), firstResponseAt: t.firstResponseAt?.toISOString() ?? null, resolvedAt: t.resolvedAt?.toISOString() ?? null,
    messages: t.messages.map((m) => ({ id: m.id, text: m.text, by: m.byName, internal: m.internal, fromCustomer: m.fromCustomer, at: m.at.toISOString() })),
    remote: remote ? { status: remote.status, at: remote.requestedAt.toISOString(), access: approvedLink(remote) } : null,
  };
}

/** Saves a reply or internal note. Replies reach the pharmacy's Help screen at its next licence check-in; internal notes never leave the console. */
export async function replyTicket(s: Staff, id: string, text: string, internal: boolean, resolve: boolean) {
  allow(s, "super_admin", "care");
  const body = String(text ?? "").trim().slice(0, 4000);
  const t = await db.ticket.findUnique({ where: { id } });
  if (!t) throw new UserError("Ticket not found.");
  if (!body && !resolve) throw new UserError("Write a reply first.");
  const now = new Date();
  await db.$transaction([
    ...(body ? [db.ticketMessage.create({ data: { ticketId: id, text: body, byName: s.name, staffId: s.id, internal } })] : []),
    db.ticket.update({ where: { id }, data: {
      firstResponseAt: !internal && body && !t.firstResponseAt ? now : undefined,
      status: resolve ? "resolved" : t.status === "resolved" && body && !internal ? "open" : undefined,
      resolvedAt: resolve ? now : undefined,
    } }),
  ]);
  if (resolve) await staffAudit(s, "Ticket resolved", t.code);
}

export async function updateTicket(s: Staff, id: string, patch: { status?: string; priority?: string; assigneeId?: string | null }) {
  allow(s, "super_admin", "care");
  const p = z.object({ status: z.enum(["open", "waiting", "resolved"]).optional(), priority: z.enum(["high", "medium", "low"]).optional(), assigneeId: z.string().uuid().nullable().optional() }).parse(patch);
  if (p.assigneeId) {
    const a = await db.staffUser.findFirst({ where: { id: p.assigneeId, role: { in: ["care", "super_admin"] }, status: "active" } });
    if (!a) throw new UserError("Assign to an active customer care member.");
  }
  await db.ticket.update({ where: { id }, data: { ...p, resolvedAt: p.status === "resolved" ? new Date() : p.status ? null : undefined } });
}

export async function escalateTicket(s: Staff, id: string) {
  allow(s, "super_admin", "care");
  const t = await db.ticket.findUnique({ where: { id } });
  if (!t) throw new UserError("Ticket not found.");
  const next = !t.escalatedTo ? "L2 support" : "Engineering";
  if (t.escalatedTo === "Engineering") throw new UserError("Already with Engineering.");
  await db.$transaction([
    db.ticket.update({ where: { id }, data: { escalatedTo: next, priority: t.priority === "low" ? "medium" : t.priority } }),
    db.ticketMessage.create({ data: { ticketId: id, text: `Escalated to ${next}.`, byName: s.name, staffId: s.id, internal: true } }),
  ]);
  await staffAudit(s, "Ticket escalated", `${t.code} → ${next}`);
  return next;
}

// ── Overview for the super admin.
export async function overview() {
  const month = dateOnly(todayISO().slice(0, 7) + "-01");
  const [byStatus, monthSales, owed, pending, openT, highT, salesStaff] = await Promise.all([
    db.cpCustomer.groupBy({ by: ["status"], _count: true }),
    db.cpSale.findMany({ where: { date: { gte: month }, status: { not: "rejected" } } }),
    db.cpSale.aggregate({ where: { status: "verified" }, _sum: { commissionPaise: true } }),
    db.cpSale.aggregate({ where: { status: "pending" }, _sum: { commissionPaise: true } }),
    db.ticket.count({ where: { status: { not: "resolved" } } }),
    db.ticket.count({ where: { status: { not: "resolved" }, priority: "high" } }),
    db.staffUser.findMany({ where: { role: "sales" }, select: { id: true, name: true, team: true } }),
  ]);
  const count = (k: string) => byStatus.find((x) => x.status === k)?._count ?? 0;
  return {
    active: count("active"), trial: count("trial"), grace: count("grace"),
    monthRevenue: monthSales.reduce((a, x) => a + x.amountPaise, 0), monthCount: monthSales.length,
    owed: owed._sum.commissionPaise ?? 0, pendingCommission: pending._sum.commissionPaise ?? 0, openTickets: openT, highTickets: highT,
    leaders: salesStaff.map((u) => {
      const xs = monthSales.filter((x) => x.staffId === u.id);
      return { name: u.name, team: u.team, n: xs.length, revenue: xs.reduce((a, x) => a + x.amountPaise, 0), commission: xs.reduce((a, x) => a + x.commissionPaise, 0), pending: xs.filter((x) => x.status !== "paid").reduce((a, x) => a + x.commissionPaise, 0) };
    }).sort((a, b) => b.revenue - a.revenue),
  };
}

/** Sidebar badges. */
export async function badges(s: Staff) {
  const today = dateOnly(todayISO());
  const [tickets, employees, sales, disc, due] = await Promise.all([
    s.role !== "sales" ? db.ticket.count({ where: { status: { not: "resolved" } } }) : 0,
    s.role === "super_admin" ? db.staffUser.count({ where: { status: "pending" } }) : 0,
    s.role === "super_admin" ? db.cpSale.count({ where: { status: "pending" } }) : 0,
    s.role === "super_admin" ? db.lead.count({ where: { discountStatus: "pending" } }) : 0,
    s.role === "sales" ? db.lead.count({ where: { staffId: s.id, nextOn: { lte: today }, stage: { notIn: ["won", "lost"] } } }) : 0,
  ]);
  return { tickets, employees, sales, leads: s.role === "super_admin" ? disc : due };
}
