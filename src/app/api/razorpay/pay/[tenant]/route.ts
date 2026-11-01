import { handlePayWebhook } from "@/domain/system/customer-pay";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

/**
 * A pharmacy's own Razorpay webhook (customer payment links, Drive mode). The owner sets this URL, with their
 * webhook secret, in Razorpay → Settings → Webhooks, event "payment_link.paid".
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tenant)) return new Response("not found", { status: 404 });
  const raw = await req.text();
  try {
    const r = await handlePayWebhook(tenant, raw, req.headers.get("x-razorpay-signature"));
    if (r.status >= 400) log.warn("Customer payment webhook refused.", { note: r.note, tenantId: tenant });
    return new Response(r.note, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("Customer payment webhook failed.", { err: e, tenantId: tenant });
    return new Response("error", { status: 500 });
  }
}
