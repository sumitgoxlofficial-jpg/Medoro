import { handleInboundSms } from "@/domain/comms/sms-inbound";

/** Inbound SMS (Twilio, or the http gateway): STOP and similar replies withdraw SMS consent. */
export async function POST(req: Request) {
  const raw = await req.text();
  const r = await handleInboundSms(raw, req.headers);
  if (r === null) return new Response("Forbidden", { status: 403 });
  // Twilio expects TwiML; an empty response sends no reply.
  return new Response("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
