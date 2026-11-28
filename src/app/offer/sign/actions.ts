"use server";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { clientIp } from "@/server/auth";
import { log } from "@/server/log";
import { declineOffer, sendSignCode, signOffer, verifySignCode } from "@/staff/hrms/offer-sign";

// The candidate's side of signing an offer. No account: the private link (token) is the key, and the email is confirmed by a code.
async function attempt<T>(fn: (ip: string | null, ua: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const h = await headers();
    return { ok: true, data: await fn(clientIp(h), h.get("user-agent") ?? "") };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("offer signing failed", { err: e });
    return { ok: false, error: "Something went wrong. Please try again, or contact HR." };
  }
}
export async function sendOfferCode(token: string) { return attempt((ip) => sendSignCode(token, ip)); }
export async function verifyOfferCode(token: string, code: string) { return attempt((ip) => verifySignCode(token, code, ip)); }
export async function submitOfferSignature(token: string, input: unknown) { return attempt((ip, userAgent) => signOffer(token, input, { ip, userAgent })); }
export async function declineOfferAction(token: string, reason: string) { return attempt((ip) => declineOffer(token, reason, ip)); }
