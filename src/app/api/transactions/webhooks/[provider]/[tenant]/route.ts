import { log } from "@/server/log";
import { handleWebhook } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";

/**
 * A provider's transaction notification for one pharmacy. The provider's signature is checked with that pharmacy's
 * connection secret before anything is read; refused calls store nothing. Unknown or unavailable providers: 404.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string; tenant: string }> }) {
  const { provider, tenant } = await params;
  if (!/^[a-z0-9:-]{2,40}$/.test(provider) || !/^[0-9a-f-]{36}$/i.test(tenant)) return new Response("not found", { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > 1024 * 1024) return new Response("too large", { status: 413 });
  const raw = await req.text();
  try {
    const r = await handleWebhook(provider, tenant, raw, req.headers);
    if (r.status >= 400 && r.status !== 404) log.warn("Bank / provider webhook refused.", { provider, tenantId: tenant, note: r.note });
    return new Response(r.note, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("Bank / provider webhook failed.", { err: e, provider, tenantId: tenant });
    return new Response("error", { status: 500 });
  }
}
