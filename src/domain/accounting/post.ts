import "server-only";
import type { Tx } from "@/server/db";
import { nextSeq, pad } from "@/server/sequence";
import { fiscalYear } from "@/lib/dates";

export type Line = { account: string; dr?: number; cr?: number; partyType?: "customer" | "supplier"; partyId?: string };

const PREFIX: Record<string, string> = { receipt: "RV", payment: "PV", journal: "JV", credit_note: "CN", debit_note: "DN", reversal: "RJ", sales: "SV", purchase: "PU" };

/** Posts a balanced voucher. Throws if debits ≠ credits. */
export async function postVoucher(tx: Tx, v: {
  tenantId: string; branchId?: string | null; type: keyof typeof PREFIX; narration: string; userId: string;
  refType?: string; refId?: string; reversesId?: string; date?: Date; lines: Line[];
  /** Use the source document's number (e.g. a credit note's) instead of taking the next voucher number. */
  no?: string;
}) {
  const lines = v.lines.filter((l) => (l.dr ?? 0) !== 0 || (l.cr ?? 0) !== 0);
  const dr = lines.reduce((a, l) => a + (l.dr ?? 0), 0), cr = lines.reduce((a, l) => a + (l.cr ?? 0), 0);
  if (dr !== cr) throw new Error(`Unbalanced voucher (${dr} ≠ ${cr})`);
  if (lines.some((l) => (l.dr ?? 0) < 0 || (l.cr ?? 0) < 0 || !Number.isInteger(l.dr ?? 0) || !Number.isInteger(l.cr ?? 0))) throw new Error("Voucher amounts must be positive whole paise");
  const p = PREFIX[v.type];
  const no = v.no ?? `${p}-${fiscalYear()}-${pad(await nextSeq(tx, v.tenantId, `V:${p}:${fiscalYear()}`))}`;
  return tx.voucher.create({
    data: {
      tenantId: v.tenantId, branchId: v.branchId ?? null, no, type: v.type as never,
      date: v.date ?? new Date(), narration: v.narration, refType: v.refType ?? null, refId: v.refId ?? null, reversesId: v.reversesId ?? null, postedBy: v.userId,
      lines: { create: lines.map((l) => ({ account: l.account, debitPaise: BigInt(l.dr ?? 0), creditPaise: BigInt(l.cr ?? 0), partyType: l.partyType ?? null, partyId: l.partyId ?? null })) },
    },
  });
}
