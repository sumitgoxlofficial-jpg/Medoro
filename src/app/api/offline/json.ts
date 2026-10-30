import "server-only";
import { ZodError } from "zod";
import { getCtx, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { log } from "@/server/log";

/** JSON API wrapper for the offline billing endpoints, which the device calls with its session cookie. */
export async function api(fn: (ctx: Ctx) => Promise<unknown>) {
  const ctx = await getCtx();
  const no = { "Cache-Control": "no-store" };
  if (!ctx) return Response.json({ error: "Sign in again to sync offline bills." }, { status: 401, headers: no });
  if (ctx.readOnly) return Response.json({ error: "Medoro support access is read-only." }, { status: 403, headers: no });
  try {
    return Response.json(await fn(ctx), { headers: no });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid input." }, { status: 400, headers: no });
    if (e instanceof UserError || (e instanceof Error && "status" in e)) return Response.json({ error: e.message }, { status: 409, headers: no });
    log.error("Offline API failed.", { err: e });
    return Response.json({ error: "Something went wrong." }, { status: 500, headers: no });
  }
}
