import { handleWebhook } from "@/domain/system/razorpay";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

/** Razorpay webhook (payment.captured, order.paid). Set its URL to https://<your domain>/api/razorpay/webhook. */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await handleWebhook(raw, req.headers.get("x-razorpay-signature"));
    if (r.status !== 200) log.warn("Razorpay webhook refused.", { note: r.note });
    return new Response(r.note, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("Razorpay webhook failed.", { err: e });
    return new Response("error", { status: 500 });
  }
}
