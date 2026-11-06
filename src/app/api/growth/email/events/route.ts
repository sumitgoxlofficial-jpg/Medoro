import { handleEmailEvent } from "@/staff/growth/comms";

export const dynamic = "force-dynamic";

/** Bounce, complaint, reply and delivery events from the email provider (or a relay), HMAC-signed. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 200_000) return new Response("Too large", { status: 413 });
  try { return Response.json({ ok: true, type: await handleEmailEvent(raw, req.headers.get("x-medoro-signature")) }); }
  catch { return new Response("Forbidden", { status: 403 }); }
}
