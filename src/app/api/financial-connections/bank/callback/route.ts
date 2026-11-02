import { getCtx } from "@/server/context";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { completeCallback } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";

/**
 * The provider sends the browser back here after the pharmacy approves (or declines). The single-use state checked
 * in completeCallback ties the answer to the user who started it. Then back to UPI & Bank Connect with the result.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: Record<string, string>) => Response.redirect(new URL(`/app/money?${new URLSearchParams(q)}`, url), 303);
  const ctx = await getCtx();
  if (!ctx) return Response.redirect(new URL(`/signin?next=${encodeURIComponent(url.pathname + url.search)}`, url), 303);
  try {
    const r = await completeCallback(ctx, url.searchParams);
    return r.ok ? back({ connected: r.connection.displayName }) : back({ connectError: r.message });
  } catch (e) {
    if (!(e instanceof UserError)) log.error("Connection callback failed.", { err: e });
    return back({ connectError: e instanceof Error && e instanceof UserError ? e.message : "The connection couldn’t be completed. Start again." });
  }
}
