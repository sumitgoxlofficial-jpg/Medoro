"use server";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { log } from "@/server/log";
import { cpConfirm, cpQuote, cpStart } from "@/staff/online-pay";

type Link = { l: string; s: string };
type Pick = { plan: "starter" | "pro" | "multi"; cycle: "m" | "y"; coupon?: string };

/** No session here: the signed link from the pharmacy's app is the credential, checked on every call. */
async function open<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, data: await fn() }; } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("Pay page action failed.", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was charged; try again." };
  }
}

export const payQuoteAction = async (k: Link, i: Pick) => open(() => cpQuote(k.l, k.s, i));
export const payStartAction = async (k: Link, i: Pick) => open(() => cpStart(k.l, k.s, i));
export const payConfirmAction = async (k: Link, i: { orderId: string; paymentId: string; signature: string }) => open(() => cpConfirm(k.l, k.s, i));
