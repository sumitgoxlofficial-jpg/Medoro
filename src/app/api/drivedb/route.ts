import { ZodError } from "zod";
import { getCtx } from "@/server/context";
import { UserError } from "@/server/action";
import { rejectCrossSite } from "@/server/csrf";
import { log } from "@/server/log";
import { CHUNK_MAX, registerDevice, relay } from "@/domain/system/drivedb-relay";
import { resetFakeDrive } from "@/domain/system/gdrive";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
const no = { "Cache-Control": "no-store" };

/**
 * DriveDB relay for Drive mode devices (see domain/system/drivedb-relay.ts). The device calls it with its session
 * cookie: POST /api/drivedb?op=…&device=… — a binary body for writes, a binary answer for reads. Only encrypted
 * files pass through; nothing is stored here.
 */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: "Sign in again to sync with Google Drive." }, { status: 401, headers: no });
  if (ctx.readOnly) return Response.json({ error: "Medoro support access is read-only." }, { status: 403, headers: no });
  const url = new URL(req.url), op = url.searchParams.get("op") ?? "", device = url.searchParams.get("device") ?? "";
  try {
    if (Number(req.headers.get("content-length") ?? 0) > CHUNK_MAX + 1024) return Response.json({ error: "Too big." }, { status: 413, headers: no });
    // Browser tests only (fake Drive on, never on Vercel): start a Drive test from an empty folder.
    if (op === "e2e-reset") { resetFakeDrive(ctx.tenantId); await db.driveDevice.deleteMany({ where: { tenantId: ctx.tenantId } }); return Response.json({ ok: true }, { headers: no }); }
    if (op === "register") return Response.json(await registerDevice(ctx, await req.json()), { headers: no });
    const body = Buffer.from(await req.arrayBuffer());
    const r = await relay(ctx, device, op, url.searchParams, body);
    if ("bytes" in r && r.bytes) return new Response(new Uint8Array(r.bytes), { headers: { ...no, "Content-Type": "application/octet-stream", "X-Size": String(r.size) } });
    return Response.json(r, { headers: no });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid input." }, { status: 400, headers: no });
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 403, headers: no });
    if (e instanceof Error && "status" in e) return Response.json({ error: e.message }, { status: 502, headers: no });
    // The device closed or reloaded the page mid-sync: nothing went wrong here, it retries on its own.
    if (req.signal.aborted || (e as { code?: string })?.code === "ECONNRESET" || (e instanceof Error && e.message === "aborted")) return new Response(null, { status: 499 });
    log.error("DriveDB relay failed.", { err: e });
    return Response.json({ error: "Something went wrong." }, { status: 500, headers: no });
  }
}
