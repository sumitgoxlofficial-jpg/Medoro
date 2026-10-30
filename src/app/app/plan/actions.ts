"use server";
import { revalidatePath } from "next/cache";
import { run, UserError } from "@/server/action";
import { authorize } from "@/server/context";
import { checkIn, claimPayment, connectLicenceKey, requestAddon, requestCancel, type paymentSchema } from "@/domain/system/licence";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
const note = (sent: boolean, ok: string) => (sent ? ok : "Saved. It goes to Medoro with the next licence check-in (Medoro can’t be reached right now).");

export async function checkNowAction() {
  return fresh(await run(async (c) => {
    authorize(c, "users");
    const r = await checkIn(c.tenantId);
    if (!r.ok) throw new UserError(("error" in r && r.error) || "This installation isn’t connected to a licence server.");
  }, "Licence checked with Medoro."));
}

export async function connectKeyAction(key: string) {
  return fresh(await run((c) => connectLicenceKey(c, key), "Licence key saved and verified."));
}

export async function addonAction(add: boolean) {
  const r = await run((c) => requestAddon(c, add));
  return fresh(r.ok ? { ...r, message: note(r.data.sent, add ? "Request sent. The AI add-on switches on when Medoro confirms it." : "Request sent. Medoro removes the add-on from your next bill.") } : r);
}

export async function cancelAction(reason: string) {
  const r = await run((c) => requestCancel(c, reason));
  return fresh(r.ok ? { ...r, message: note(r.data.sent, "Cancellation requested. Medoro confirms it; you keep full access until the paid period ends.") } : r);
}

export async function paidAction(input: z.input<typeof paymentSchema>) {
  const r = await run((c) => claimPayment(c, input));
  return fresh(r.ok ? { ...r, message: note(r.data.sent, "Thanks! Medoro checks the payment (usually within a working day); your plan and invoice update automatically.") } : r);
}
