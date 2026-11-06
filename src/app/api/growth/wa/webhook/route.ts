import { handleWaWebhook, verifyWaWebhook } from "@/staff/growth/comms";

export const dynamic = "force-dynamic";

/** Meta webhook for Medoro's own (platform) WhatsApp number: GET verification, POST events signed with the app secret. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && (await verifyWaWebhook(u.searchParams.get("hub.verify_token") ?? ""))) return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
  try { await handleWaWebhook(raw, req.headers.get("x-hub-signature-256")); return new Response("ok"); }
  catch { return new Response("Forbidden", { status: 403 }); }
}
