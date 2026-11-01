"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { grantSupport, revokeSupport } from "@/domain/identity/support";
import { decideRemoteRequest } from "@/domain/system/licence";
import { run } from "@/server/action";
import { eraseCustomer, saveGrievance, savePrivacy, type Grievance, type Privacy } from "@/domain/system/privacy";
import { previewRetention, runRetentionNow } from "@/domain/system/retention";
import { cancelDeletion, requestDeletion } from "@/domain/system/deletion";

export async function privacyAction(p: Partial<Privacy>) { const r = await run(async (c) => savePrivacy(c, p)); revalidatePath("/app", "layout"); return r; }
export async function grievanceAction(g: Grievance) { const r = await run((c) => saveGrievance(c, g), "Saved. It prints on invoices from now on."); revalidatePath("/app", "layout"); return r; }
export async function retentionPreviewAction() { return run((c) => previewRetention(c)); }
export async function retentionRunAction() { const r = await run((c) => runRetentionNow(c)); revalidatePath("/app", "layout"); return r; }
export async function eraseAction(id: string) { const r = await run((c) => eraseCustomer(c, id), "Personal details erased. Tax invoices are kept with an anonymised party."); revalidatePath("/app", "layout"); return r; }

export async function requestDeletionAction(code: string, downloaded: boolean) {
  const r = await run(async (c) => { const p = await requestDeletion(c, { code, downloaded }); return p.scheduledFor; });
  revalidatePath("/app", "layout"); return r;
}
export async function cancelDeletionAction() { const r = await run((c) => cancelDeletion(c), "Deletion cancelled. Your pharmacy stays as it is."); revalidatePath("/app", "layout"); return r; }

// ── Medoro support access

async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}
export async function grantSupportAction(minutes: number, reason: string) {
  const r = await run(async (c) => grantSupport(c, { minutes, reason }, await origin()));
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}
export async function revokeSupportAction() {
  const r = await run((c) => revokeSupport(c), "Support access ended. Their session is signed out.");
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}
export async function decideRemoteAction(requestId: string, approve: boolean, minutes: number) {
  const r = await run(async (c) => decideRemoteRequest(c, requestId, approve, minutes, await origin()), approve ? "Access approved. The link went to Medoro support; it works once and only until the time you chose." : "Request declined. Medoro support has been told.");
  revalidatePath("/app", "layout");
  return r;
}
