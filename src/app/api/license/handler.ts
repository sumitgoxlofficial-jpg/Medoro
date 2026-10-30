import "server-only";
import { ZodError } from "zod";
import { UserError } from "@/server/action";
import { LicenceApiError } from "@/staff/licence";

const no = { "Cache-Control": "no-store" };

/** JSON wrapper for the licence server endpoints that pharmacy installations call. */
export async function licenceApi(req: Request, fn: (body: string) => Promise<unknown>) {
  try {
    const body = await req.text();
    if (body.length > 256_000) return Response.json({ error: "Request too large." }, { status: 413, headers: no });
    return Response.json(await fn(body), { headers: no });
  } catch (e) {
    if (e instanceof LicenceApiError) return Response.json({ error: e.message }, { status: e.status, headers: no });
    if (e instanceof ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid request." }, { status: 400, headers: no });
    if (e instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400, headers: no });
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400, headers: no });
    console.error("[licence]", e);
    return Response.json({ error: "Licence server error." }, { status: 500, headers: no });
  }
}
