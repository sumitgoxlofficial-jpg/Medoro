"use server";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { clientInfo } from "@/server/auth";
import { log } from "@/server/log";
import * as P from "@/domain/distribution/portal";

async function guard<T>(fn: (a: P.PortalAccount) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const a = await P.readPortalAccount();
  if (!a) return { ok: false, error: "Your session has ended. Sign in again." };
  return wrap(() => fn(a), message);
}
async function wrap<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try { return { ok: true, data: await fn(), message }; }
  catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError || (e instanceof Error && "status" in e)) return { ok: false, error: e.message };
    log.error("Portal action failed.", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}

export async function registerAction(fd: FormData) {
  const o = Object.fromEntries(fd.entries()) as Record<string, string>;
  const { ip } = await clientInfo();
  const r = await wrap(() => P.registerChemist({ ...o, consent: o.consent === "on" } as never, ip));
  if (r.ok) redirect("/portal");
  return r;
}
export async function signInAction(fd: FormData) {
  const r = await wrap(() => P.signInChemist(String(fd.get("login") ?? ""), String(fd.get("password") ?? "")));
  if (r.ok) redirect("/portal");
  return r;
}
export async function signOutAction() { await P.signOutChemist(); redirect("/portal/signin"); }
export async function connectAction(fd: FormData) { return guard((a) => P.requestConnection(a, String(fd.get("code")), fd.get("share") === "on"), "Request sent. The distributor will check your licence and approve you."); }
export async function quotePortalAction(code: string, lines: { medicineId: string; qty: number }[]) { return guard((a) => P.portalQuote(a, code, lines)); }
export async function placePortalOrderAction(code: string, lines: { medicineId: string; qty: number }[], note: string, key: string) { return guard((a) => P.portalPlaceOrder(a, code, lines, note, key), "Order placed."); }
export async function cancelPortalOrderAction(code: string, orderId: string) { return guard((a) => P.portalCancelOrder(a, code, orderId), "Order cancelled."); }
