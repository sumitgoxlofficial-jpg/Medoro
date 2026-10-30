"use server";
import { revalidatePath } from "next/cache";
import { run, UserError } from "@/server/action";
import { importBankStatement, matchBankLine, unmatchBankLine, type BankMapping } from "@/domain/accounting/bank";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function importStatementAction(form: FormData) {
  return fresh(await run(async (ctx) => {
    const f = form.get("file");
    if (!(f instanceof File)) throw new UserError("Choose the statement file.");
    const raw = form.get("mapping");
    let m: BankMapping | null = null;
    if (typeof raw === "string" && raw) {
      try { m = JSON.parse(raw) as BankMapping; } catch { throw new UserError("Column mapping is invalid."); }
      if (!Number.isInteger(m.headerRow) || typeof m.cols !== "object") throw new UserError("Column mapping is invalid.");
    }
    return importBankStatement(ctx, f.name, new Uint8Array(await f.arrayBuffer()), m);
  }));
}
export async function matchAction(bankLineId: string, ledgerLineId: string) { return fresh(await run((c) => matchBankLine(c, bankLineId, ledgerLineId), "Matched and marked reconciled.")); }
export async function unmatchAction(bankLineId: string) { return fresh(await run((c) => unmatchBankLine(c, bankLineId), "Match removed.")); }
