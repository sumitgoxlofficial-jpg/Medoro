import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, dateOnly, daysTo, isoOf, istMidnight, todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher, type Line } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { CHEQUE_STATUS, type ChequeStatus } from "./cheque-types";

export { CHEQUE_STATUS };
export type { ChequeStatus };
type Direction = "received" | "issued";

export const chequeLabel = (i: { chequeNo: string; bank: string; chequeDate: string }) => `Cheque ${i.chequeNo} · ${i.bank} · dated ${i.chequeDate}`;

/**
 * Registers a cheque behind a receipt or payment voucher that was posted to the clearing account (Cheques in hand
 * for cheques received, Cheques issued for cheques given). The bank account moves only when the cheque clears.
 * Cheques may be post-dated; a cheque older than three months is stale and refused.
 */
export async function recordCheque(tx: Tx, ctx: Ctx, c: { direction: Direction; partyType: "customer" | "supplier"; partyId: string; voucherId: string; input: { chequeNo: string; bank: string; chequeDate: string; amount: number; ref: string } }) {
  const d = daysTo(c.input.chequeDate);
  if (d < -90) throw new UserError("That cheque is more than three months old (stale). It can’t be deposited.");
  if (d > 365) throw new UserError("The cheque date is more than a year away. Check the date.");
  if (await tx.cheque.findFirst({ where: { tenantId: ctx.tenantId, direction: c.direction, partyId: c.partyId, no: c.input.chequeNo } })) throw new UserError(`Cheque ${c.input.chequeNo} is already recorded for this party.`);
  return tx.cheque.create({ data: {
    tenantId: ctx.tenantId, branchId: ctx.branchId, direction: c.direction, partyType: c.partyType, partyId: c.partyId, no: c.input.chequeNo, bank: c.input.bank,
    chequeDate: dateOnly(c.input.chequeDate), amountPaise: BigInt(c.input.amount), status: "pending", voucherId: c.voucherId, note: c.input.ref || null, createdBy: ctx.userId,
  } });
}

async function lockCheque(tx: Tx, ctx: Ctx, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"chq:" + id}))`;
  const c = await tx.cheque.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw new UserError("Cheque not found.");
  const party = c.partyType === "supplier" ? await tx.supplier.findUnique({ where: { id: c.partyId }, select: { name: true } }) : await tx.customer.findUnique({ where: { id: c.partyId }, select: { name: true } });
  return { ...c, party: party?.name ?? "" };
}

const when = (day: string) => (day === todayISO() ? new Date() : istMidnight(day));
const dayOf = (v: string | undefined) => {
  const d = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayISO();
  if (daysTo(d) > 0) throw new UserError("The date can’t be in the future.");
  return d;
};

/** Received cheque handed to the bank. No posting: the money is still not in the account. */
export async function depositCheque(ctx: Ctx, id: string) {
  authorize(ctx, "payments");
  return db.$transaction(async (tx) => {
    const c = await lockCheque(tx, ctx, id);
    if (c.direction !== "received") throw new UserError("Only cheques you received are deposited.");
    if (c.status !== "pending") throw new UserError(`Cheque ${c.no} is already ${c.status}.`);
    if (daysTo(c.chequeDate) > 0) throw new UserError(`Cheque ${c.no} is post-dated. Deposit it on or after ${isoOf(c.chequeDate)}.`);
    await tx.cheque.update({ where: { id }, data: { status: "deposited", depositedAt: new Date() } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: c.branchId, userId: ctx.userId, userName: ctx.userName, action: "Cheque deposited", entity: "cheque", entityId: id, detail: `${c.no} · ${c.bank} · ${c.party} · ${inr(big(c.amountPaise))}` });
  });
}

/** Cheque cleared on the bank statement: the clearing account is settled against the bank. */
export async function clearCheque(ctx: Ctx, id: string, on?: string) {
  authorize(ctx, "payments");
  const day = dayOf(on);
  return db.$transaction(async (tx) => {
    const c = await lockCheque(tx, ctx, id);
    const from: ChequeStatus = c.direction === "received" ? "deposited" : "pending";
    if (c.status !== from) throw new UserError(c.direction === "received" && c.status === "pending" ? `Deposit cheque ${c.no} first.` : `Cheque ${c.no} is ${c.status}.`);
    if (day < isoOf(c.chequeDate)) throw new UserError(`A cheque dated ${isoOf(c.chequeDate)} can’t clear before that date.`);
    const amt = big(c.amountPaise);
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: c.branchId, type: "journal", userId: ctx.userId, refType: "cheque_clear", refId: c.id, date: when(day),
      narration: `Cheque ${c.no} cleared · ${c.direction === "received" ? "from" : "to"} ${c.party} · ${c.bank}`,
      lines: c.direction === "received" ? [{ account: ACC.bank, dr: amt }, { account: ACC.chequesInHand, cr: amt }] : [{ account: ACC.chequesIssued, dr: amt }, { account: ACC.bank, cr: amt }] });
    await tx.cheque.update({ where: { id }, data: { status: "cleared", clearedAt: when(day) } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: c.branchId, userId: ctx.userId, userName: ctx.userName, action: `Cheque cleared ${v.no}`, entity: "cheque", entityId: id, detail: `${c.no} · ${c.party} · ${inr(amt)} · ${day}` });
    return v.no;
  });
}

const paise = z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v === "" ? 0 : v)) || 0) * 100)).refine((p) => p >= 0, "Charges can’t be negative.");
export const bounceSchema = z.object({
  reason: z.string().trim().min(3, "Enter the bank’s return reason (e.g. funds insufficient).").max(120),
  /** Charge recovered from the customer, or penalty the supplier levies on us. */
  charge: paise.default(0),
  /** What our bank deducted for the return. */
  bankCharge: paise.default(0),
  on: z.string().optional(),
});

/**
 * Cheque returned unpaid. The receipt or payment is undone through the clearing account (the party owes, or is
 * owed, the amount again), bills paid by an issued cheque are reopened, and charges are booked: a charge recovered
 * from a customer is debited to them and offsets Bank charges; a supplier's penalty is added to the payable; our
 * bank's deduction is a Bank charges expense.
 */
export async function bounceCheque(ctx: Ctx, id: string, raw: z.input<typeof bounceSchema>) {
  authorize(ctx, "payments");
  const i = bounceSchema.parse(raw);
  const day = dayOf(i.on);
  return db.$transaction(async (tx) => {
    const c = await lockCheque(tx, ctx, id);
    if (c.direction === "received" ? !["pending", "deposited"].includes(c.status) : c.status !== "pending") throw new UserError(`Cheque ${c.no} is ${c.status}; it can’t bounce now.`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"party:" + c.partyId}))`;
    const amt = big(c.amountPaise);
    const party = { partyType: c.partyType as "customer" | "supplier", partyId: c.partyId };
    const lines: Line[] = c.direction === "received"
      ? [{ account: ACC.debtors, dr: amt + i.charge, ...party }, { account: ACC.chequesInHand, cr: amt }, { account: ACC.bankCharges, cr: i.charge }]
      : [{ account: ACC.chequesIssued, dr: amt }, { account: ACC.bankCharges, dr: i.charge }, { account: ACC.creditors, cr: amt + i.charge, ...party }];
    if (i.bankCharge) lines.push({ account: ACC.bankCharges, dr: i.bankCharge }, { account: ACC.bank, cr: i.bankCharge });
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: c.branchId, type: "journal", userId: ctx.userId, refType: "cheque_bounce", refId: c.id, date: when(day),
      narration: `Cheque ${c.no} bounced · ${c.party} · ${i.reason}${i.charge ? ` · charges ${inr(i.charge)}` : ""}`, lines });
    if (c.direction === "issued") {
      let left = amt;
      for (const b of await tx.supplierBill.findMany({ where: { tenantId: ctx.tenantId, supplierId: c.partyId, paidPaise: { gt: 0n } }, orderBy: [{ dueDate: "desc" }, { date: "desc" }] })) {
        if (left <= 0) break;
        const take = Math.min(big(b.paidPaise), left);
        await tx.supplierBill.update({ where: { id: b.id }, data: { paidPaise: { decrement: BigInt(take) } } });
        left -= take;
      }
      if (i.charge) await tx.supplierBill.create({ data: { tenantId: ctx.tenantId, supplierId: c.partyId, ref: `Cheque ${c.no} return charges`, date: dateOnly(day), dueDate: dateOnly(day), amountPaise: BigInt(i.charge) } });
    }
    await tx.cheque.update({ where: { id }, data: { status: "bounced", bouncedAt: when(day), bounceReason: i.reason, chargePaise: BigInt(i.charge) } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: c.branchId, userId: ctx.userId, userName: ctx.userName, action: `Cheque bounced ${v.no}`, entity: "cheque", entityId: id,
      detail: `${c.no} · ${c.party} · ${inr(amt)} · ${i.reason}${i.charge ? ` · charge ${inr(i.charge)}` : ""}${i.bankCharge ? ` · bank ${inr(i.bankCharge)}` : ""}` });
    return v.no;
  });
}

export async function listCheques(ctx: Ctx, opts: { open?: boolean } = {}) {
  authorizeView(ctx, "payments", "reports");
  const rows = await db.cheque.findMany({
    where: { tenantId: ctx.tenantId, ...(opts.open ? { status: { in: ["pending", "deposited"] } } : { OR: [{ status: { in: ["pending", "deposited"] } }, { createdAt: { gte: new Date(Date.now() - 180 * 86400_000) } }] }) },
    orderBy: [{ chequeDate: "asc" }, { createdAt: "asc" }], take: 500,
  });
  const [sups, cus] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.filter((r) => r.partyType === "supplier").map((r) => r.partyId) } }, select: { id: true, name: true } }),
    db.customer.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.filter((r) => r.partyType === "customer").map((r) => r.partyId) } }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id, direction: r.direction as Direction, party: (r.partyType === "supplier" ? sups : cus).find((p) => p.id === r.partyId)?.name ?? "", partyType: r.partyType,
    no: r.no, bank: r.bank, date: isoOf(r.chequeDate), days: daysTo(r.chequeDate), amount: big(r.amountPaise), status: r.status as ChequeStatus, note: r.note,
    bounceReason: r.bounceReason, charge: big(r.chargePaise), clearedAt: r.clearedAt?.toISOString() ?? null,
  }));
}

/** Open cheques dated within the next `days` days (or earlier): to deposit, or to keep funds ready for. */
export async function dueCheques(ctx: Ctx, days = 3) {
  const limit = addDays(todayISO(), days);
  return (await listCheques(ctx, { open: true })).filter((c) => c.date <= limit);
}
