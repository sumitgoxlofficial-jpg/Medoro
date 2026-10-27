import { handleWebhook, verifyWebhook } from "@/domain/comms/whatsapp";

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && (await verifyWebhook(u.searchParams.get("hub.verify_token") ?? ""))) return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  try { await handleWebhook(raw, req.headers.get("x-hub-signature-256")); return new Response("ok"); }
  catch { return new Response("Forbidden", { status: 403 }); }
}
