import "server-only";
import { ZodError } from "zod";
import { UserError } from "@/server/action";
import { clientInfo } from "@/server/auth";
import { log } from "@/server/log";
import { deviceFor } from "@/staff/hrms/workforce";

// The Windows workforce agent's API. It authenticates with a device token (Authorization: Bearer), never a cookie, so
// browser CSRF doesn't apply; a revoked or unknown token always gets 401 and the agent stops and forgets its token.
const no = { "cache-control": "no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: no });

export async function agentApi(req: Request, fn: (ctx: { device: Awaited<ReturnType<typeof deviceFor>>; ip: string | null; body: unknown }) => Promise<Response>, opts: { device: boolean } = { device: true }) {
  try {
    const { ip } = await clientInfo().catch(() => ({ ip: null as string | null }));
    const device = opts.device ? await deviceFor(req.headers.get("authorization")) : null;
    if (opts.device && !device) return json({ error: "This device is not enrolled or was removed." }, 401);
    let body: unknown = null;
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 512_000) return json({ error: "Request too large." }, 413);
      body = text ? JSON.parse(text) : {};
    }
    return await fn({ device, ip: ip ?? null, body });
  } catch (e) {
    if (e instanceof ZodError) return json({ error: "Invalid request: " + (e.issues[0]?.message ?? "") }, 400);
    if (e instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
    if (e instanceof UserError) return json({ error: e.message }, 400);
    log.error("agent api failed", { err: e });
    return json({ error: "Server error." }, 500);
  }
}
