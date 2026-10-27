"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { grantSupport, revokeSupport } from "@/domain/identity/support";
import { run } from "@/server/action";
import { eraseCustomer, savePrivacy, type Privacy } from "@/domain/system/privacy";

export async function privacyAction(p: Partial<Privacy>) { const r = await run(async (c) => savePrivacy(c, p)); revalidatePath("/app", "layout"); return r; }
export async function eraseAction(id: string) { const r = await run((c) => eraseCustomer(c, id), "Personal details erased. Tax invoices are kept with an anonymised party."); revalidatePath("/app", "layout"); return r; }

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
