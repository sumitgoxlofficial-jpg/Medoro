import "server-only";
import { db } from "@/server/db";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { istDate, todayISO } from "@/lib/dates";
import { phoneMasker } from "@/domain/system/strict";
import { refillDue, campaignRef } from "@/domain/comms/crm";
import { customerStats, lastMonths, retention, SEGMENTS, type CustomerStats, type Purchase, type Segment } from "./customer-segments";

/**
 * Customer intelligence over real bills. Voided bills are removed and sales returns are netted off the bill they
 * belong to; erased customers are excluded. Customers are shared by the whole pharmacy, so the branch filter scopes
 * the bills that count, limited to branches the user may access. Read-only: nothing here sends a message.
 */
const DAY = 86400_000;

export type CustomerRow = { id: string; name: string; phone: string | null; segment: Segment; lastDay: string; recencyDays: number; usualGapDays: number | null; visits12m: number; avgBasketPaise: number; netPaise: number; value12mPaise: number | null; marketingConsent: boolean };
export type RefillRow = { customerId: string; customer: string; phone: string | null; medicine: string; interval: number; last: string; due: string; inDays: number; canMessage: boolean };
export type CampaignPerf = { id: string; name: string; at: string; status: string; sent: number; delivered: number; read: number; failed: number; buyers: number; revenuePaise: number };

export type CustomerIntel = {
  scope: { branchId: string | null; branchName: string };
  totals: { customers: number; activeLast90: number; repeatPct: number | null; avgBasketPaise: number | null };
  segments: { segment: Segment; count: number; netPaise: number }[];
  monthly: { month: string; customers: number; spendPaise: number; avgSpendPaise: number | null }[];
  retention: { month: string; base: number; kept: number; rate: number | null }[];
  lapsed: CustomerRow[]; top: CustomerRow[]; refills: RefillRow[]; campaigns: CampaignPerf[];
};

function scope(ctx: Ctx, branchId: string | null) {
  if (!branchId) return { ids: ctx.branches.map((b) => b.id), name: "All my branches", id: null as string | null };
  const b = ctx.branches.find((x) => x.id === branchId);
  if (!b) throw new UserError("You don’t have access to that branch.");
  return { ids: [b.id], name: b.name, id: b.id as string | null };
}

export async function customerIntel(ctx: Ctx, branchId: string | null = null, now = new Date()): Promise<CustomerIntel> {
  authorize(ctx, "reports");
  const sc = scope(ctx, branchId), today = todayISO(now);
  const sales = await db.$queryRaw<{ customerId: string; at: Date; net: bigint }[]>`
    SELECT s."customerId", s.at, (s."totalPaise" - COALESCE((SELECT sum(r."amountPaise") FROM "SalesReturn" r WHERE r."saleId" = s.id), 0))::bigint net
    FROM "Sale" s JOIN "Customer" c ON c.id = s."customerId"
    WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${sc.ids}) AND s."customerId" IS NOT NULL AND c."erasedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)`;
  const by = new Map<string, Purchase[]>(), months = lastMonths(today, 12), monthSet = new Map<string, Set<string>>();
  const monthly = new Map<string, { people: Set<string>; spend: number }>(months.map((m) => [m, { people: new Set(), spend: 0 }]));
  for (const s of sales) {
    const day = istDate(s.at), net = Number(s.net);
    by.set(s.customerId, [...(by.get(s.customerId) ?? []), { day, netPaise: net }]);
    const mk = day.slice(0, 7);
    monthSet.set(s.customerId, (monthSet.get(s.customerId) ?? new Set()).add(mk));
    const m = monthly.get(mk); if (m) { m.people.add(s.customerId); m.spend += net; }
  }
  const stats = new Map<string, CustomerStats>();
  for (const [id, p] of by) { const st = customerStats(p, today); if (st) stats.set(id, st); }
  const [cust, mask] = await Promise.all([
    db.customer.findMany({ where: { id: { in: [...stats.keys()] } }, select: { id: true, name: true, phone: true, marketingWa: true, marketingSms: true } }),
    phoneMasker(ctx),
  ]);
  const rows: CustomerRow[] = cust.map((c) => { const s = stats.get(c.id)!; return { id: c.id, name: c.name, phone: mask(c.phone), segment: s.segment, lastDay: s.lastDay, recencyDays: s.recencyDays, usualGapDays: s.usualGapDays, visits12m: s.visits12m, avgBasketPaise: s.avgBasketPaise, netPaise: s.netPaise, value12mPaise: s.value12mPaise, marketingConsent: c.marketingWa || c.marketingSms }; });

  const segs = SEGMENTS.map((segment) => { const r = rows.filter((x) => x.segment === segment); return { segment, count: r.length, netPaise: r.reduce((a, x) => a + x.netPaise, 0) }; });
  const allSales = [...stats.values()].reduce((a, s) => a + s.purchases, 0), allNet = [...stats.values()].reduce((a, s) => a + s.netPaise, 0);
  const repeat = [...stats.values()].filter((s) => s.visits >= 2).length;

  // Refill suggestions for follow-up. The owner sees everyone due; "canMessage" is true only with consent on file.
  const due = (await refillDue(ctx.tenantId, true)).filter((r) => stats.has(r.customerId));
  const refills: RefillRow[] = due.map((r) => ({ customerId: r.customerId, customer: r.customer, phone: mask(r.phone), medicine: r.medicine, interval: r.interval, last: r.last, due: r.due, inDays: r.inDays, canMessage: r.consent })).slice(0, 100);

  return {
    scope: { branchId: sc.id, branchName: sc.name },
    totals: { customers: rows.length, activeLast90: rows.filter((r) => r.recencyDays <= 90).length, repeatPct: rows.length ? Math.round((repeat / rows.length) * 1000) / 10 : null, avgBasketPaise: allSales ? Math.round(allNet / allSales) : null },
    segments: segs,
    monthly: months.map((month) => { const m = monthly.get(month)!; return { month, customers: m.people.size, spendPaise: m.spend, avgSpendPaise: m.people.size ? Math.round(m.spend / m.people.size) : null }; }),
    retention: retention(monthSet, months),
    lapsed: rows.filter((r) => r.segment === "lapsed").sort((a, b) => b.netPaise - a.netPaise).slice(0, 50),
    top: [...rows].sort((a, b) => b.netPaise - a.netPaise).slice(0, 20),
    refills,
    campaigns: await campaignPerformance(ctx),
  };
}

/**
 * What happened to each campaign. Counts come from the delivery log. "Buyers" are recipients who had a bill (not voided)
 * within 14 days AFTER their message: an association, not proof the message caused it.
 */
export async function campaignPerformance(ctx: Ctx): Promise<CampaignPerf[]> {
  authorize(ctx, "reports");
  const camps = await db.campaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!camps.length) return [];
  const msgs = await db.waMessage.findMany({ where: { tenantId: ctx.tenantId, invoiceId: { in: camps.map((c) => campaignRef(c.id)) } }, select: { invoiceId: true, status: true, recipient: true, createdAt: true } });
  const phones = [...new Set(msgs.map((m) => m.recipient))];
  const people = phones.length ? await db.customer.findMany({ where: { tenantId: ctx.tenantId, phone: { in: phones }, erasedAt: null }, select: { id: true, phone: true } }) : [];
  const idByPhone = new Map(people.map((p) => [p.phone!, p.id]));
  const sales = people.length ? await db.$queryRaw<{ customerId: string; at: Date; net: bigint }[]>`
    SELECT s."customerId", s.at, (s."totalPaise" - COALESCE((SELECT sum(r."amountPaise") FROM "SalesReturn" r WHERE r."saleId" = s.id), 0))::bigint net FROM "Sale" s
    WHERE s."tenantId" = ${ctx.tenantId} AND s."customerId" = ANY(${people.map((p) => p.id)}) AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)` : [];
  return camps.map((c) => {
    const mine = msgs.filter((m) => m.invoiceId === campaignRef(c.id));
    const buyers = new Set<string>(); let revenue = 0;
    for (const m of mine) {
      const cid = idByPhone.get(m.recipient); if (!cid) continue;
      for (const s of sales) if (s.customerId === cid && s.at >= m.createdAt && s.at.getTime() - m.createdAt.getTime() <= 14 * DAY) { buyers.add(cid); revenue += Number(s.net); }
    }
    const n = (f: (s: string) => boolean) => mine.filter((m) => f(m.status)).length;
    return { id: c.id, name: c.name, at: c.createdAt.toISOString(), status: c.status, sent: mine.length, delivered: n((s) => s === "delivered" || s === "read"), read: n((s) => s === "read"), failed: n((s) => s === "failed"), buyers: buyers.size, revenuePaise: revenue };
  });
}
