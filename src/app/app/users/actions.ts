"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { addCounter, inviteEmployee, issueReset, resetTwoStep, revokeInvite, saveBranch, setUserPermission, togglePermission, updateMember, verifyAudit, type branchSchema, type inviteSchema, type MemberPatch } from "@/domain/identity/admin";
import { approveTransfer, cancelTransfer, receiveTransfer, rejectTransfer } from "@/domain/inventory/adjust";
import type { Perm } from "@/domain/identity/permissions";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function inviteAction(i: z.input<typeof inviteSchema>) { return fresh(await run(async (c) => inviteEmployee(c, i))); }
export async function resetAction(id: string) { return fresh(await run(async (c) => issueReset(c, id))); }
export async function resetTwoStepAction(id: string) { return fresh(await run(async (c) => resetTwoStep(c, id))); }
export async function memberAction(id: string, patch: MemberPatch) { return fresh(await run((c) => updateMember(c, id, patch), "Saved. Their open sessions were signed out.")); }
export async function revokeInviteAction(id: string) { return fresh(await run((c) => revokeInvite(c, id), "Invite revoked.")); }
export async function permAction(roleId: string, perm: Perm) { return fresh(await run(async (c) => togglePermission(c, roleId, perm))); }
export async function userPermAction(userId: string, perm: Perm, state: "role" | "grant" | "revoke") { return run(async (c) => setUserPermission(c, userId, perm, state)); }
export async function branchAction(id: string | null, i: z.input<typeof branchSchema>) { return fresh(await run(async (c) => saveBranch(c, id, i), id ? "Branch saved." : "Branch added with Counter 1.")); }
export async function counterAction(branchId: string) { return fresh(await run(async (c) => addCounter(c, branchId))); }
export async function transferAction(id: string, a: "approve" | "reject" | "receive" | "cancel") {
  if (a === "receive") {
    const r = await run((c) => receiveTransfer(c, id));
    return fresh(r.ok ? { ...r, message: r.data ?? "Received. Stock added at this branch." } : r);
  }
  return fresh(await run((c) => (a === "approve" ? approveTransfer(c, id) : a === "reject" ? rejectTransfer(c, id) : cancelTransfer(c, id)), a === "approve" ? "Approved. Stock is in transit." : a === "reject" ? "Transfer rejected." : "Transfer cancelled. Stock is back at the sending branch."));
}
export async function verifyAction() { return run(async (c) => verifyAudit(c)); }
