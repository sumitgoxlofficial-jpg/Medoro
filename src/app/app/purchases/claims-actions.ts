"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { acknowledgeClaim, creditClaim, raiseClaim, type ClaimCreditInput, type ClaimReason } from "@/domain/inventory/claims";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function raiseClaimAction(batchId: string, qty: number, reason: ClaimReason, note: string) {
  return fresh(await run((c) => raiseClaim(c, { batchId, qty, reason, note })));
}
export async function acknowledgeClaimAction(id: string) { return fresh(await run((c) => acknowledgeClaim(c, id), "Marked acknowledged by the supplier.")); }
export async function creditClaimAction(id: string, input: ClaimCreditInput) {
  return fresh(await run(async (c) => {
    const r = await creditClaim(c, id, input);
    return r.status === "credited" ? "Claim settled. The supplier payable is reduced by the credit note." : r.status === "rejected" ? "Claim closed as rejected and written off." : "Credit recorded. The rest of the claim stays open.";
  }));
}
