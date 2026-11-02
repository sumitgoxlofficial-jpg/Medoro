import "server-only";
import { ZodError } from "zod";
import { getCtx, type Ctx } from "./context";
import { UserError } from "./action";
import { rejectCrossSite } from "./csrf";
import { log } from "./log";

const no = { "Cache-Control": "no-store" };

/**
 * A JSON API route for the signed-in user: session from the cookie (the pharmacy is never taken from the request),
 * cross-site check on writes, errors as { error } with a status. Permission checks stay in the domain functions.
 */
export function api<P>(fn: (ctx: Ctx, req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, route: { params: Promise<P> }) => {
    if (req.method !== "GET") { const blocked = rejectCrossSite(req); if (blocked) return blocked; }
    const ctx = await getCtx();
    if (!ctx) return Response.json({ error: "Sign in again." }, { status: 401, headers: no });
    try {
      return Response.json(await fn(ctx, req, await route.params), { headers: no });
    } catch (e) {
      if (e instanceof ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid input." }, { status: 400, headers: no });
      if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400, headers: no });
      if (e instanceof Error && "status" in e && typeof (e as { status: unknown }).status === "number") return Response.json({ error: e.message }, { status: (e as unknown as { status: number }).status, headers: no });
      log.error("API route failed.", { err: e, path: new URL(req.url).pathname });
      return Response.json({ error: "Something went wrong." }, { status: 500, headers: no });
    }
  };
}

/** JSON body of at most 64 KB. */
export async function jsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 65_536) throw new UserError("Request too large.");
  try { return (text ? JSON.parse(text) : {}) as T; } catch { throw new UserError("Invalid JSON."); }
}
