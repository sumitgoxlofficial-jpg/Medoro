import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { DIST_ORDER_AAD, sealJson } from "@/drivedb/inbox";
import type { PortalMessage } from "@/drivedb/dist-portal";
import { invoiceTotals } from "./rules/pricing";
import { num } from "./common";

/**
 * The chemist portal for a distributor whose records live in its own Google Drive (phase D5, option 1 of
 * docs/DIST_DRIVE_PLAN.md). Medoro keeps only:
 *   - the catalogue the distributor's device publishes (products, PTR / PTS, MRP if shown, stock as the distributor
 *     chose to show it, schemes open to every chemist, each portal chemist's price tier);
 *   - each portal order sealed for the distributor's devices (only they can read it; deleted once taken in);
 *   - the chemist's own view of their order and the status the device reports (order no, invoice no and total).
 * No bills, balances, purchase prices or chemist-specific rates. Device side: src/drivedb/dist-portal.ts.
 */

const stockView = z.object({ label: z.string().max(40), tone: z.enum(["green", "amber", "red", "gray"]), packs: z.number().int().min(0).nullable() });
const item = z.object({
  medicineId: z.string().min(1).max(64), name: z.string().trim().min(1).max(160), generic: z.string().max(200).default(""), pack: z.string().max(60).default(""),
  company: z.string().max(160).nullable().default(null), gstRate: z.number().int().refine((r) => [0, 3, 5, 12, 18, 28].includes(r), "Bad GST rate."),
  ptr: z.number().int().min(0).max(100_000_000), pts: z.number().int().min(0).max(100_000_000), mrp: z.number().int().min(0).max(100_000_000).nullable(),
  minOrderQty: z.number().int().min(1).max(100_000), stock: stockView, schemes: z.array(z.string().max(40)).max(10).default([]),
});
export const publishSchema = z.object({
  catalogue: z.object({ items: z.array(item).max(20_000), tiers: z.record(z.string().max(64), z.enum(["ptr", "pts"])).default({}), enabled: z.boolean(), minOrderPaise: z.number().int().min(0) }).optional(),
  statuses: z.array(z.object({
    key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), status: z.enum(["pending", "approved", "picking", "packed", "invoiced", "dispatched", "delivered", "cancelled", "rejected"]),
    orderNo: z.string().max(40).nullable(), invoiceNo: z.string().max(40).nullable(), invoiceTotalPaise: z.number().int().min(0).nullable(), reason: z.string().max(300).nullable(),
  })).max(500).default([]),
});
export type PublishInput = z.input<typeof publishSchema>;

/** A device of a Drive-mode distributor publishes the portal catalogue and its portal orders' statuses. */
export async function publishPortal(tenantId: string, deviceId: string, raw: PublishInput) {
  const p = publishSchema.parse(raw);
  if (p.catalogue) {
    const { items, tiers, enabled, minOrderPaise } = p.catalogue;
    const data = { items: { enabled, minOrderPaise, items } as unknown as Prisma.InputJsonValue, tiers: tiers as Prisma.InputJsonValue, deviceId, publishedAt: new Date() };
    await db.distPortalCatalog.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  }
  let updated = 0;
  for (const s of p.statuses) {
    updated += (await db.distPortalOrder.updateMany({ where: { tenantId, orderKey: s.key }, data: { status: s.status, orderNo: s.orderNo, invoiceNo: s.invoiceNo, invoiceTotalPaise: s.invoiceTotalPaise == null ? null : BigInt(s.invoiceTotalPaise), reason: s.reason } })).count;
  }
  return { catalogue: !!p.catalogue, updated };
}

type Catalogue = { enabled: boolean; minOrderPaise: number; items: z.infer<typeof item>[] };
async function catalogueOf(tenantId: string) {
  const c = await db.distPortalCatalog.findUnique({ where: { tenantId } });
  if (!c) throw new UserError("This distributor hasn’t published its products yet. Please try again later.");
  return { ...(c.items as unknown as Catalogue), tiers: c.tiers as Record<string, "ptr" | "pts">, publishedAt: c.publishedAt };
}
const rateFor = (i: { ptr: number; pts: number }, tier: string | undefined) => (tier === "pts" && i.pts > 0 ? i.pts : i.ptr);

/** What a connected chemist sees: products with their tier's rate. */
export async function driveCatalogue(tenantId: string, accountId: string, q = "", take = 60) {
  const c = await catalogueOf(tenantId);
  if (!c.enabled) throw new UserError("This distributor isn’t taking portal orders right now.");
  const needle = q.trim().toLowerCase();
  return c.items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.generic.toLowerCase().includes(needle)).slice(0, take)
    .map((i) => ({ medicineId: i.medicineId, name: i.name, generic: i.generic, pack: i.pack, company: i.company ?? "", gstRate: i.gstRate, rate: rateFor(i, c.tiers[accountId]), mrp: i.mrp, minOrderQty: i.minOrderQty, stock: i.stock, schemes: i.schemes }));
}

/** A cart priced from the catalogue (the distributor's device confirms rates, schemes and credit on approval). */
export async function driveQuote(tenantId: string, accountId: string, lines: { medicineId: string; qty: number }[]) {
  const c = await catalogueOf(tenantId);
  return lines.map((l) => {
    const i = c.items.find((x) => x.medicineId === l.medicineId);
    if (!i) return { medicineId: l.medicineId, name: "Not offered", pack: "", qty: l.qty, rate: 0, gstRate: 0, stock: { label: "Not offered", tone: "gray" as const, packs: null }, problem: "No longer offered on the portal." };
    const problem = !Number.isInteger(l.qty) || l.qty < 1 ? "Enter a quantity." : l.qty < i.minOrderQty ? `Minimum order is ${i.minOrderQty}.` : null;
    return { medicineId: i.medicineId, name: i.name, pack: i.pack, qty: l.qty, rate: rateFor(i, c.tiers[accountId]), gstRate: i.gstRate, stock: i.stock, schemes: i.schemes, problem };
  });
}

export const portalOrderSchema = z.object({
  note: z.string().trim().max(300).default(""), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Missing order key; reload and try again."),
  lines: z.array(z.object({ medicineId: z.string().min(1).max(64), qty: z.number().int().min(1).max(100_000) })).min(1, "Add at least one product.").max(300),
});

/** Sends a chemist's order to the distributor's devices, sealed. It waits for approval there, as any order does. */
export async function drivePlaceOrder(tenantId: string, account: { id: string; firmName: string }, customerId: string, raw: z.input<typeof portalOrderSchema>) {
  const i = portalOrderSchema.parse(raw);
  if (new Set(i.lines.map((l) => l.medicineId)).size !== i.lines.length) throw new UserError("A product appears twice. Combine the lines.");
  const seen = await db.distPortalOrder.findUnique({ where: { tenantId_orderKey: { tenantId, orderKey: i.idempotencyKey } } });
  if (seen) return { orderKey: seen.orderKey, status: seen.status, replayed: true };
  const c = await catalogueOf(tenantId);
  const q = await driveQuote(tenantId, account.id, i.lines);
  const bad = q.find((l) => l.problem);
  if (bad) throw new UserError(`${bad.name}: ${bad.problem}`);
  const est = invoiceTotals(q.map((l) => ({ qty: l.qty, rate: l.rate, gstRate: l.gstRate })), false).total;
  if (est < c.minOrderPaise) throw new UserError(`Minimum order value is ₹${(c.minOrderPaise / 100).toFixed(0)}.`);
  const devices = await db.driveDevice.findMany({ where: { tenantId, status: "approved" } });
  if (!devices.length) throw new UserError("The distributor’s system isn’t set up to take portal orders yet.");
  const msg: PortalMessage = { kind: "order", key: i.idempotencyKey, accountId: account.id, customerId, lines: i.lines, note: i.note, at: new Date().toISOString() };
  const rows = await Promise.all(devices.map(async (d) => ({ tenantId, deviceId: d.deviceId, orderKey: i.idempotencyKey, sealed: await sealJson(d.publicKey as JsonWebKey, msg, DIST_ORDER_AAD) })));
  try {
    await db.$transaction([
      db.distPortalOrder.create({ data: { tenantId, accountId: account.id, orderKey: i.idempotencyKey, lines: q.map((l) => ({ medicineId: l.medicineId, name: l.name, pack: l.pack, qty: l.qty })), estimatePaise: BigInt(est) } }),
      db.distOrderInbox.createMany({ data: rows, skipDuplicates: true }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { orderKey: i.idempotencyKey, status: "sent", replayed: true };
    throw e;
  }
  await writeAudit(db, { tenantId, action: "Order sent from portal", entity: "dist_portal_order", entityId: i.idempotencyKey, userName: "Chemist portal", detail: `${account.firmName} · ${q.length} line(s)` });
  return { orderKey: i.idempotencyKey, status: "sent", replayed: false };
}

/** A chemist asks to cancel an order the distributor hasn't approved yet. */
export async function driveCancelOrder(tenantId: string, accountId: string, customerId: string, orderKey: string) {
  const o = await db.distPortalOrder.findUnique({ where: { tenantId_orderKey: { tenantId, orderKey } } });
  if (!o || o.accountId !== accountId) throw new UserError("Order not found.");
  if (o.status !== "sent" && o.status !== "pending") throw new UserError("This order can no longer be cancelled from the portal. Call your distributor.");
  const devices = await db.driveDevice.findMany({ where: { tenantId, status: "approved" } });
  const msg: PortalMessage = { kind: "cancel", key: orderKey, accountId, customerId, at: new Date().toISOString() };
  const rows = await Promise.all(devices.map(async (d) => ({ tenantId, deviceId: d.deviceId, orderKey: `${orderKey}:cancel`, sealed: await sealJson(d.publicKey as JsonWebKey, msg, DIST_ORDER_AAD) })));
  await db.distOrderInbox.createMany({ data: rows, skipDuplicates: true });
  await db.distPortalOrder.update({ where: { id: o.id }, data: { reason: "Cancellation requested" } });
}

/** The chemist's own orders to this distributor, with the status its device reported. */
export async function driveOrders(tenantId: string, accountId: string) {
  const rows = await db.distPortalOrder.findMany({ where: { tenantId, accountId }, orderBy: { placedAt: "desc" }, take: 100 });
  // Same shape as the server-held portal's orders; "sent" (not yet taken in by the distributor) shows as awaiting approval.
  return rows.map((o) => ({ id: o.orderKey, no: o.orderNo ?? "Sent", status: o.status === "sent" ? "pending" : o.status, placedAt: o.placedAt, estimate: num(o.estimatePaise), rejectReason: o.reason,
    invoice: o.invoiceNo ? { id: o.orderKey, no: o.invoiceNo, total: num(o.invoiceTotalPaise) } : null,
    lines: (o.lines as { medicineId?: string; name: string; pack: string; qty: number }[]).map((l) => ({ medicineId: l.medicineId ?? "", name: l.name, pack: l.pack, qty: l.qty, freeQty: 0 })) }));
}

/** This device's waiting portal messages (still sealed), and taking them off once taken in. */
export async function distInboxFor(tenantId: string, deviceId: string) {
  return (await db.distOrderInbox.findMany({ where: { tenantId, deviceId }, orderBy: { createdAt: "asc" }, take: 100 })).map((r) => ({ key: r.orderKey, sealed: r.sealed }));
}
export async function ackDistInbox(tenantId: string, keys: string[]) {
  const ok = keys.filter((k) => /^[A-Za-z0-9_-]{8,64}(:cancel)?$/.test(k)).slice(0, 100);
  if (!ok.length) return 0;
  return (await db.distOrderInbox.deleteMany({ where: { tenantId, orderKey: { in: ok } } })).count;
}

/** Records a Drive-mode distributor's approval of a portal chemist: the chemist lives on its devices, Medoro keeps only the link. */
export async function linkConnection(tenantId: string, userId: string, connectionId: string, customerId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(customerId)) throw new UserError("Bad chemist id.");
  const c = await db.distConnection.findFirst({ where: { id: connectionId, tenantId } });
  if (!c) throw new UserError("Request not found.");
  if (c.status === "approved" && c.customerId === customerId) return;
  await db.distConnection.update({ where: { id: c.id }, data: { status: "approved", customerId, decidedBy: userId, decidedAt: new Date() } });
  await db.distChemistAccount.updateMany({ where: { id: c.accountId, status: "pending" }, data: { status: "verified" } });
  await writeAudit(db, { tenantId, userId, action: "Portal chemist approved", entity: "dist_connection", entityId: c.id, detail: "Chemist kept on the distributor’s devices" });
}
