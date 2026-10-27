import "server-only";
import { ZodError } from "zod";
import { getCtx, type Ctx } from "./context";

export type ActionResult<T = unknown> = { ok: true; data: T; message?: string } | { ok: false; error: string };

export class UserError extends Error {}

/** Wraps a server action: requires a session, turns expected errors into messages. */
export async function run<T>(fn: (ctx: Ctx) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const ctx = await getCtx();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (ctx.readOnly) return { ok: false, error: "Medoro support access is read-only. Ask the pharmacy owner to make this change." };
  try {
    const data = await fn(ctx);
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError || (e instanceof Error && "status" in e)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}
