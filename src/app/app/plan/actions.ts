"use server";
import { revalidatePath } from "next/cache";
import { run, UserError } from "@/server/action";
import { authorize } from "@/server/context";
import { checkIn, claimPayment, connectLicenceKey, payOnlineLink, requestAddon, requestCancel, type paymentSchema } from "@/domain/system/licence";
import type { z } from "zod";
import { confirmCheckout, createOrder, markFailed, quote, resumeSubscription, type orderSchema } from "@/domain/system/razorpay";

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

/** The price with a coupon code applied, shown before paying. */
export async function couponAction(input: z.input<typeof orderSchema>) {
  return run(async (c) => { authorize(c, "users"); return quote(input); });
}

/** Starts a Razorpay Checkout payment for a plan (a 100% coupon activates it straight away). */
export async function payOnlineAction(input: z.input<typeof orderSchema>) {
  const r = await run(async (c) => { authorize(c, "users"); return createOrder(c, input); });
  return r.ok && r.data.free ? fresh({ ...r, message: "Coupon applied. Your plan is active." }) : r;
}

/** Razorpay Checkout's success callback. */
export async function confirmOnlineAction(i: { orderId: string; paymentId: string; signature: string }) {
  const r = await run(async (c) => { authorize(c, "users"); return confirmCheckout(c, i); });
  return fresh(r.ok ? { ...r, message: r.data.duplicate ? "This plan was already paid a few minutes ago, so this second payment is being refunded to you automatically (5–7 working days)." : "Payment received. Your plan is active." } : r);
}

/** Checkout reported a failed attempt. */
export async function failedOnlineAction(i: { orderId: string; reason: string }) {
  return fresh(await run(async (c) => { authorize(c, "users"); await markFailed(c, i); }));
}

/** Hosted pharmacies: undo a cancellation made by Medoro support while the paid period lasts. */
export async function resumeOnlineAction() {
  return fresh(await run(async (c) => { authorize(c, "users"); await resumeSubscription(c); }, "Cancellation undone. Your plan continues."));
}

/** Self-hosted and desktop installations: the signed link to Medoro's pay page. */
export async function payLinkAction() {
  return run(async (c) => { authorize(c, "users"); return payOnlineLink(c.tenantId); });
}
