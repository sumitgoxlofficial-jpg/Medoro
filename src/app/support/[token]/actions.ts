"use server";
import { redirect } from "next/navigation";
import { redeemGrant } from "@/domain/identity/support";
import { UserError } from "@/server/action";

export async function startSupportSession(token: string): Promise<{ error: string }> {
  try {
    await redeemGrant(token);
  } catch (e) {
    return { error: e instanceof UserError ? e.message : "Couldn’t start the session. Ask the pharmacy for a new link." };
  }
  redirect("/app");
}
