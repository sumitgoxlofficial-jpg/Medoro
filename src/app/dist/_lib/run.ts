import "server-only";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { log } from "@/server/log";
import { UserError, type ActionResult } from "@/server/action";
import { getDistCtx, type DistCtx } from "@/domain/distribution/context";

/** Server-action wrapper for /dist: distribution context, expected errors as messages, page data refreshed. */
export async function distRun<T>(fn: (ctx: DistCtx) => Promise<T>, message?: string | ((d: T) => string)): Promise<ActionResult<T>> {
  const ctx = await getDistCtx();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (ctx.readOnly) return { ok: false, error: "Medoro support access is read-only. Ask the owner to make this change." };
  try {
    const data = await fn(ctx);
    revalidatePath("/dist", "layout");
    return { ok: true, data, message: typeof message === "function" ? message(data) : message };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError || (e instanceof Error && "status" in e)) return { ok: false, error: e.message };
    if (e instanceof Error && /Unbalanced voucher|append-only|violates check constraint/.test(e.message)) { log.error("Distribution integrity check refused a change.", { err: e }); return { ok: false, error: "The change was refused by an integrity check. Nothing was saved." }; }
    log.error("Distribution action failed.", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}

/** Reads a FormData into a plain object (repeated keys become arrays; "on" checkboxes become true). */
export function formObject(fd: FormData, arrays: string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = v === "on" ? true : typeof v === "string" ? v : v;
    if (arrays.includes(k)) o[k] = [...((o[k] as unknown[]) ?? []), val];
    else o[k] = val;
  }
  for (const a of arrays) o[a] ??= [];
  return o;
}
