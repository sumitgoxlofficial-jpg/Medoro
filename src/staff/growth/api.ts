import "server-only";
import { ZodError, type ZodType } from "zod";
import { UserError } from "@/server/action";
import { rejectCrossSite } from "@/server/csrf";
import { hit } from "@/server/ratelimit";
import { log } from "@/server/log";
import { getStaff } from "../auth";
import { actorFor, can, type Actor } from "./access";
import type { Perm } from "./constants";

/**
 * JSON API for Growth Intelligence at /staff/api/growth/*. Same rules as the console: a staff session (the cookie is
 * scoped to /staff), a Growth role and the permission, re-checked on every request. State-changing requests must come
 * from this site (Origin / Sec-Fetch-Site), every caller is rate limited, input is validated with Zod.
 * Responses: { success: true, ...data } or { success: false, error } with a matching HTTP status.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (error: string, status: number) => json({ success: false, error }, status);

export async function growthApi(req: Request, perm: Perm | null, fn: (a: Actor) => Promise<unknown>): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const x = rejectCrossSite(req);
    if (x) return fail("Cross-site request blocked.", 403);
  }
  const s = await getStaff();
  if (!s) return fail("Sign in to the staff console.", 401);
  const a = await actorFor(s);
  if (!a) return fail("You don’t have access to Growth Intelligence.", 403);
  if (perm && !can(a, perm)) return fail("Your Growth role can’t do that.", 403);
  const rl = await hit({ name: "growthApi", limit: 600, windowSec: 600, what: "API requests" }, a.id);
  if (!rl.ok) return new Response(JSON.stringify({ success: false, error: "Too many requests." }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) } });
  try {
    const data = await fn(a);
    if (data instanceof Response) return data;
    return json({ success: true, ...(data && typeof data === "object" && !Array.isArray(data) ? data : { data }) });
  } catch (e) {
    if (e instanceof ZodError) return fail(e.issues[0]?.message ?? "Invalid input.", 400);
    if (e instanceof UserError) return fail(e.message, /not found/i.test(e.message) ? 404 : /already/i.test(e.message) ? 409 : /can’t do that|only/i.test(e.message) ? 403 : 422);
    if (e instanceof SyntaxError) return fail("Send a JSON body.", 400);
    log.error("growth api failed", { err: e, path: new URL(req.url).pathname });
    return fail("Something went wrong. Nothing was saved.", 500);
  }
}

/** Parses a JSON body (max 1 MB) with an optional schema. */
export async function body<T = Record<string, unknown>>(req: Request, schema?: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 1_000_000) throw new UserError("The request body is too large.");
  const v = text ? JSON.parse(text) : {};
  return schema ? schema.parse(v) : (v as T);
}
export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());
