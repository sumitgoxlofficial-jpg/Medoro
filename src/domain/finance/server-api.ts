import "server-only";
/**
 * Transactions, reconciliation and reports over the API for a pharmacy whose data is on this server. A Drive
 * pharmacy's transactions live on its counters and in its Google Drive, so these answer 409 for it.
 */
import { db } from "@/server/db";
import { authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { driveModeOn } from "@/domain/system/drive-mode";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { parseNarration } from "./narration";
import { allocatedByLine } from "./bills";

export class OnCountersError extends Error {
  status = 409;
  constructor() { super("This pharmacy’s bank transactions live on its counters and in its Google Drive. Use Billing (device) → UPI & Bank."); }
}

async function serverOnly(ctx: Ctx) {
  authorizeView(ctx, "payments", "reports");
  if (ctx.moved || ctx.mustMove || (await driveModeOn(ctx.tenantId))) throw new OnCountersError();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function range(from?: string | null, to?: string | null) {
  const t = to && ISO.test(to) ? to : todayISO(), f = from && ISO.test(from) ? from : addDays(t, -29);
  if (f > t) throw new UserError("Pick a valid date range.");
  return [f, t] as const;
}

type LineRow = Awaited<ReturnType<typeof db.bankLine.findMany>>[number];
async function viewLines(ctx: Ctx, lines: LineRow[]) {
  const paid = await allocatedByLine(db, ctx.tenantId);
  return lines.map((l) => {
    const n = parseNarration(l.description, l.ref ?? ""), amt = big(l.amountPaise), billPaid = paid.get(l.id) ?? 0;
    const status = l.ledgerLineId ? "matched" : billPaid >= amt && amt > 0 ? "matched" : billPaid > 0 ? "partial" : amt > 0 ? "unmatched" : "debit";
    return {
      id: l.id, date: isoOf(l.date), amountPaise: Math.abs(amt), direction: amt > 0 ? "credit" : "debit", description: l.description, ref: l.ref,
      utr: n.utr, channel: n.channel, counterpartyName: n.name, counterpartyVpa: n.vpa, balancePaise: l.balancePaise == null ? null : big(l.balancePaise),
      status, matchedTo: l.ledgerLineId ? "book entry" : billPaid ? "credit bills" : null, billPaidPaise: billPaid,
    };
  });
}

export async function listTransactions(ctx: Ctx, p: URLSearchParams) {
  await serverOnly(ctx);
  const [from, to] = range(p.get("from"), p.get("to"));
  const q = (p.get("q") ?? "").trim().slice(0, 60);
  const lines = await db.bankLine.findMany({
    where: { tenantId: ctx.tenantId, date: { gte: dateOnly(from), lte: dateOnly(to) }, ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { ref: { contains: q } }] } : {}) },
    orderBy: [{ date: "desc" }, { row: "asc" }], take: Math.min(1000, Math.max(1, Number(p.get("limit") ?? 500) || 500)),
  });
  const status = p.get("status");
  return { from, to, transactions: (await viewLines(ctx, lines)).filter((t) => !status || t.status === status) };
}

export async function getTransaction(ctx: Ctx, id: string) {
  await serverOnly(ctx);
  const l = await db.bankLine.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { statement: { select: { fileName: true, createdAt: true } }, allocations: true } });
  if (!l) throw new UserError("Transaction not found.");
  const [v] = await viewLines(ctx, [l]);
  return { ...v, source: l.statement.fileName, importedAt: l.statement.createdAt.toISOString(), allocations: l.allocations.map((a) => ({ id: a.id, saleId: a.saleId, amountPaise: big(a.amountPaise), kind: a.kind, rule: a.rule, voucherId: a.voucherId, reversesId: a.reversesId })) };
}

/** Credits by day and by channel (UPI collections), with how much is matched. */
export async function collectionsReport(ctx: Ctx, p: URLSearchParams) {
  const { transactions, from, to } = await listTransactions(ctx, new URLSearchParams({ from: p.get("from") ?? "", to: p.get("to") ?? "", limit: "1000" }));
  const credits = transactions.filter((t) => t.direction === "credit");
  const group = (key: (t: (typeof credits)[number]) => string) => {
    const m = new Map<string, { key: string; count: number; totalPaise: number; matchedPaise: number }>();
    for (const t of credits) {
      const k = key(t), g = m.get(k) ?? { key: k, count: 0, totalPaise: 0, matchedPaise: 0 };
      g.count++; g.totalPaise += t.amountPaise; g.matchedPaise += t.status === "matched" ? t.amountPaise : Math.min(t.amountPaise, t.billPaidPaise);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  };
  return { from, to, daily: group((t) => t.date), monthly: group((t) => t.date.slice(0, 7)), byChannel: group((t) => t.channel), unmatched: credits.filter((t) => t.status !== "matched") };
}
