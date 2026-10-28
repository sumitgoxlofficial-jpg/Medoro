import { getCtx } from "@/server/context";
import { db } from "@/server/db";
import { subscribe } from "@/server/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Serverless hosts end long requests; the browser reconnects on its own (retry: 3000).
export const maxDuration = 300;

/**
 * Server-sent events: tells the signed-in browser when something in its pharmacy changed
 * (a sale at another counter, stock received, a voucher posted…) so screens refresh themselves.
 * Only table names and branch ids are sent, never data.
 */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { cleanup(); } };
      let unsub: () => void = () => {};
      try {
        unsub = await subscribe(ctx.tenantId, (c) => send(`event: change\ndata: ${JSON.stringify({ t: c.t, branch: c.branch })}\n\n`));
      } catch {
        send("event: down\ndata: {}\n\n");
        controller.close();
        return;
      }
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      // A revoked or expired session (e.g. ended support access) closes the stream.
      const alive = async () => {
        const s = await db.session.findUnique({ where: { id: ctx.sessionId }, include: { user: { select: { tokenVersion: true, active: true } } } }).catch(() => undefined);
        return s === undefined || (!!s && !s.revokedAt && s.expiresAt > new Date() && s.user.active && s.tokenVersion === s.user.tokenVersion);
      };
      const check = setInterval(async () => { if (!(await alive())) { send("event: signedout\ndata: {}\n\n"); cleanup(); } }, 60_000);
      cleanup = () => { clearInterval(ping); clearInterval(check); unsub(); try { controller.close(); } catch { /* already closed */ } };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
